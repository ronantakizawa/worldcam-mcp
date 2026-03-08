import { execFile } from 'child_process';
import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId } from '../types.js';
import { captureYouTubeFrame, fetchImage, isFfmpegAvailable, isYtDlpAvailable } from '../screenshot.js';
import { Cache } from '../cache.js';

export class YouTubeSource extends CameraSource {
  readonly name = 'youtube' as const;
  readonly displayName = 'YouTube Live Streams';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = true;

  private _available: boolean | null = null;
  private searchCache = new Cache<Camera[]>(30 * 60 * 1000); // 30 min

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    const [ffmpeg, ytdlp] = await Promise.all([
      isFfmpegAvailable(),
      isYtDlpAvailable(),
    ]);
    this._available = ffmpeg && ytdlp;
    return this._available;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const query = this.buildSearchQuery(filters);
    const limit = filters.limit ?? 10;
    const cacheKey = `yt:${query}:${limit}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    // Search YouTube for live webcam streams via yt-dlp
    const searchCount = Math.min(limit * 2, 30);
    const cameras = await this.ytSearch(query, searchCount);

    const results = cameras.slice(0, limit);
    this.searchCache.set(cacheKey, results);
    return results;
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(nativeId)) return null;

    // Verify the video exists and get its title via yt-dlp
    try {
      const title = await this.getVideoTitle(nativeId);
      if (!title) return null;
      return {
        id: formatCameraId('youtube', nativeId),
        source: 'youtube',
        title,
        country: 'unknown',
        categories: ['other'],
        status: 'active',
        streamUrl: `https://www.youtube.com/watch?v=${nativeId}`,
      };
    } catch {
      return null;
    }
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(nativeId)) {
      throw new Error(`Invalid YouTube video ID: ${nativeId}`);
    }

    try {
      return await captureYouTubeFrame(nativeId);
    } catch {
      // Fallback: YouTube thumbnail (updated periodically for live streams)
      const thumbUrl = `https://img.youtube.com/vi/${nativeId}/maxresdefault.jpg`;
      try {
        const result = await fetchImage(thumbUrl, { timeout: 5000 });
        if (result.buffer.length < 1000) {
          throw new Error('Thumbnail too small — stream likely dead');
        }
        return {
          buffer: result.buffer,
          mimeType: result.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        };
      } catch {
        throw new Error(
          `YouTube stream ${nativeId} appears to be offline. yt-dlp and thumbnail fallback both failed.`
        );
      }
    }
  }

  async getCameraCount(): Promise<number> {
    return 0; // Dynamic — unknown count
  }

  async getCountries(): Promise<string[]> {
    return []; // Dynamic — discovered at search time
  }

  async getCategories(): Promise<Category[]> {
    return ['city', 'wildlife', 'nature', 'beach', 'landmark'];
  }

  /**
   * Build a YouTube search query from filters.
   */
  private buildSearchQuery(filters: SearchFilters): string {
    const parts: string[] = ['live webcam'];
    if (filters.query) parts.push(filters.query);
    if (filters.city) parts.push(filters.city);
    if (filters.country) parts.push(filters.country);
    if (filters.category && filters.category !== 'other') parts.push(filters.category);
    return parts.join(' ');
  }

  /**
   * Search YouTube for live streams using yt-dlp.
   * Fast search (no per-result liveness check) — liveness is verified at capture time.
   */
  private ytSearch(query: string, count: number): Promise<Camera[]> {
    return new Promise((resolve) => {
      execFile(
        'yt-dlp',
        [
          '--flat-playlist',
          '--print', '%(id)s\t%(title)s',
          '--no-warnings',
          '--no-playlist',
          `ytsearch${count}:${query}`,
        ],
        { timeout: 20000, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          const cameras = String(stdout)
            .trim()
            .split('\n')
            .filter((line) => line.includes('\t'))
            .map((line) => {
              const tabIdx = line.indexOf('\t');
              const id = line.substring(0, tabIdx);
              const title = line.substring(tabIdx + 1);
              return {
                id: formatCameraId('youtube', id),
                source: 'youtube' as const,
                title: title || `YouTube Live ${id}`,
                country: 'unknown',
                categories: ['other'] as string[],
                status: 'active' as const,
                streamUrl: `https://www.youtube.com/watch?v=${id}`,
              };
            });
          resolve(cameras);
        }
      );
    });
  }

  /**
   * Get a video's title via yt-dlp. Returns null if not found or not live.
   */
  private getVideoTitle(videoId: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        'yt-dlp',
        [
          '--get-title',
          '--no-warnings',
          '--no-playlist',
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { timeout: 10000, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const title = String(stdout).trim().split('\n')[0];
          resolve(title || null);
        }
      );
    });
  }
}
