import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage, fetchMjpegFrame } from '../screenshot.js';
import { Cache } from '../cache.js';

interface CamHackerCamera {
  id: string;
  feedUrl: string;
  title: string;
  country: string;
  city?: string;
}

export class CamHackerSource extends CameraSource {
  readonly name = 'camhacker' as const;
  readonly displayName = 'CamHacker (Public IP Cameras)';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  private cache = new Cache<CamHackerCamera[]>(10 * 60 * 1000); // 10 min

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const cameras = await this.scrapeCameraList();

    let results = cameras.map((c) => this.toCameraObj(c));

    if (filters.country) {
      results = results.filter(
        (c) => c.country.toLowerCase() === filters.country!.toLowerCase()
      );
    }
    if (filters.city) {
      results = results.filter((c) =>
        c.city?.toLowerCase().includes(filters.city!.toLowerCase())
      );
    }
    if (filters.query) {
      const q = filters.query.toLowerCase();
      results = results.filter((c) => c.title.toLowerCase().includes(q));
    }

    const limit = filters.limit ?? 10;
    return results.slice(0, limit);
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    // Validate nativeId — only allow alphanumeric, hyphens, and "feed-" prefix
    if (!/^[a-zA-Z0-9_-]+$/.test(nativeId)) {
      return null;
    }

    const cameras = await this.scrapeCameraList();
    const cam = cameras.find((c) => c.id === nativeId);
    return cam ? this.toCameraObj(cam) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(nativeId)) {
      throw new CameraOfflineError(formatCameraId('camhacker', nativeId));
    }

    const camera = await this.getCamera(nativeId);
    if (!camera || !camera.streamUrl) {
      throw new CameraOfflineError(formatCameraId('camhacker', nativeId));
    }

    try {
      // Try as static JPEG first
      const result = await fetchImage(camera.streamUrl, { timeout: 5000 });
      return {
        buffer: result.buffer,
        mimeType: result.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
      };
    } catch {
      // Fall back to MJPEG stream
      try {
        return await fetchMjpegFrame(camera.streamUrl, { timeout: 5000 });
      } catch {
        throw new CameraOfflineError(formatCameraId('camhacker', nativeId));
      }
    }
  }

  async getCameraCount(): Promise<number> {
    const cameras = await this.scrapeCameraList();
    return cameras.length;
  }

  async getCountries(): Promise<string[]> {
    const cameras = await this.scrapeCameraList();
    return [...new Set(cameras.map((c) => c.country))].sort();
  }

  async getCategories(): Promise<Category[]> {
    return ['city', 'traffic', 'other'];
  }

  private async scrapeCameraList(): Promise<CamHackerCamera[]> {
    const cacheKey = 'camhacker:list';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const resp = await fetch('https://camhacker.com/', {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!resp.ok) {
        return [];
      }

      const html = await resp.text();
      const cameras = this.parseCameraList(html);
      this.cache.set(cacheKey, cameras);
      return cameras;
    } catch {
      return [];
    }
  }

  private parseCameraList(html: string): CamHackerCamera[] {
    const cameras: CamHackerCamera[] = [];

    // CamHacker lists cameras with their MJPG feed URLs
    // Look for camera links and image sources
    const camRegex = /<a[^>]+href="([^"]*\/camera\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi;

    let match;
    let idx = 0;
    while ((match = camRegex.exec(html)) !== null) {
      const pageUrl = match[1];
      const imgUrl = match[2];

      // Extract a simple ID from the URL or use index
      const idMatch = pageUrl.match(/\/camera\/([^/]+)/);
      const id = idMatch ? idMatch[1] : String(idx);

      cameras.push({
        id,
        feedUrl: imgUrl,
        title: `CamHacker Camera #${id}`,
        country: 'unknown',
      });
      idx++;
    }

    // Also try to find direct MJPEG feed URLs in the page
    const mjpegRegex = /["'](https?:\/\/[^"']+\.mjpg[^"']*|https?:\/\/[^"']+mjpeg[^"']*|https?:\/\/[^"']+axis-cgi[^"']*|https?:\/\/[^"']+video\.cgi[^"']*)["']/gi;
    while ((match = mjpegRegex.exec(html)) !== null) {
      const feedUrl = match[1];
      const id = `feed-${idx}`;
      cameras.push({
        id,
        feedUrl,
        title: `CamHacker Feed #${idx}`,
        country: 'unknown',
      });
      idx++;
    }

    return cameras;
  }

  private toCameraObj(cam: CamHackerCamera): Camera {
    return {
      id: formatCameraId('camhacker', cam.id),
      source: 'camhacker',
      title: cam.title,
      country: cam.country,
      city: cam.city,
      categories: ['other'],
      status: 'active',
      streamUrl: cam.feedUrl,
    };
  }
}
