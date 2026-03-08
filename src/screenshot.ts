import { execFile } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * Fetch a static image URL and return its buffer.
 */
export async function fetchImage(
  url: string,
  options: {
    timeout?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<{ buffer: Buffer; mimeType: string }> {
  const timeout = options.timeout ?? 10000;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...options.headers,
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }

  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';

  return { buffer, mimeType };
}

/**
 * Extract the first JPEG frame from an MJPEG stream.
 */
export async function fetchMjpegFrame(
  url: string,
  options: { timeout?: number } = {}
): Promise<{ buffer: Buffer; mimeType: 'image/jpeg' }> {
  const timeout = options.timeout ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching MJPEG from ${url}`);
    }

    const contentType = resp.headers.get('content-type') || '';

    // If it's a plain JPEG, just return the whole body
    if (contentType.startsWith('image/jpeg') || contentType.startsWith('image/png')) {
      const arrayBuf = await resp.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mimeType: 'image/jpeg' };
    }

    // For multipart MJPEG streams, extract the first JPEG frame
    if (!resp.body) {
      throw new Error('No response body for MJPEG stream');
    }

    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxBytes = 5 * 1024 * 1024; // 5MB safety limit

    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;

      // Concatenate and look for JPEG markers
      const combined = Buffer.concat(chunks);
      const soiIdx = combined.indexOf(Buffer.from([0xff, 0xd8]));
      if (soiIdx === -1) continue;

      const eoiIdx = combined.indexOf(Buffer.from([0xff, 0xd9]), soiIdx + 2);
      if (eoiIdx === -1) continue;

      // Found a complete JPEG frame
      const jpeg = combined.subarray(soiIdx, eoiIdx + 2);
      reader.cancel();
      return { buffer: Buffer.from(jpeg), mimeType: 'image/jpeg' };
    }

    throw new Error('Could not extract JPEG frame from MJPEG stream');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grab one frame from an HLS stream using ffmpeg.
 */
export async function captureHlsFrame(
  hlsUrl: string,
  options: { ffmpegPath?: string; timeout?: number; referer?: string } = {}
): Promise<{ buffer: Buffer; mimeType: 'image/jpeg' }> {
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const timeout = options.timeout ?? 15000;

  const args = [
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  ];

  if (options.referer) {
    args.push('-referer', options.referer);
  }

  args.push(
    '-i', hlsUrl,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-loglevel', 'error',
    'pipe:1',
  );

  return new Promise((resolve, reject) => {
    const proc = execFile(
      ffmpegPath,
      args,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout,
        encoding: 'buffer',
      },
      (error, stdout) => {
        if (error) {
          return reject(new Error(`ffmpeg failed: ${error.message}`));
        }
        const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as any);
        if (buf.length === 0) {
          return reject(new Error('ffmpeg produced no output'));
        }
        resolve({ buffer: buf, mimeType: 'image/jpeg' });
      }
    );

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg not found or failed to start: ${err.message}`));
    });
  });
}

/**
 * Capture a frame from a YouTube live stream using yt-dlp + ffmpeg.
 */
export async function captureYouTubeFrame(
  videoId: string,
  options: { timeout?: number } = {}
): Promise<{ buffer: Buffer; mimeType: 'image/jpeg' }> {
  // Validate video ID format to prevent command injection
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error(`Invalid YouTube video ID: ${videoId}`);
  }

  const timeout = options.timeout ?? 20000;

  // First get the direct stream URL from yt-dlp
  // --match-filter ensures we only grab actually-live streams (not VODs or redirected videos)
  // --no-playlist prevents yt-dlp from following playlist/mix redirects
  // --print urls,title lets us verify the stream hasn't been replaced by a different video
  const streamUrl = await new Promise<string>((resolve, reject) => {
    execFile(
      'yt-dlp',
      [
        '--get-url',
        '--get-title',
        '-f', 'best[height<=720]',
        '--no-warnings',
        '--no-playlist',
        '--match-filter', 'is_live',
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          return reject(new Error(`yt-dlp failed for ${videoId}: ${error.message}`));
        }
        const lines = String(stdout).trim().split('\n');
        // With --get-title + --get-url, first line is title, second is URL
        if (lines.length < 2 || !lines[1]) {
          return reject(new Error(`yt-dlp returned no URL for ${videoId}`));
        }
        resolve(lines[1]);
      }
    );
  });

  // Then grab a frame with ffmpeg
  return captureHlsFrame(streamUrl, { timeout });
}

/**
 * Check if ffmpeg is available on the system.
 */
export async function isFfmpegAvailable(ffmpegPath?: string): Promise<boolean> {
  const path = ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  return new Promise((resolve) => {
    execFile(path, ['-version'], { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Check if yt-dlp is available on the system.
 */
export async function isYtDlpAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Save a buffer to disk.
 */
export async function saveToDisk(buffer: Buffer, savePath: string): Promise<string> {
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);
  return savePath;
}
