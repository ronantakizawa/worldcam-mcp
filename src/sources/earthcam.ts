import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { captureHlsFrame, isFfmpegAvailable } from '../screenshot.js';
import { Cache } from '../cache.js';

interface EarthCamEntry {
  id: string;
  title: string;
  pageUrl: string;
  country: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  categories: Category[];
}

// Curated list of EarthCam cameras — we scrape the page for the live HLS URL
const EARTHCAM_STREAMS: EarthCamEntry[] = [
  {
    id: 'timessquare',
    title: 'Times Square, New York (4K)',
    pageUrl: 'https://www.earthcam.com/usa/newyork/timessquare/?cam=tsrobo1',
    country: 'US',
    city: 'New York',
    latitude: 40.758,
    longitude: -73.985,
    categories: ['city', 'landmark'],
  },
  {
    id: 'templebar',
    title: 'Temple Bar, Dublin',
    pageUrl: 'https://www.earthcam.com/world/ireland/dublin/?cam=templebar',
    country: 'IE',
    city: 'Dublin',
    latitude: 53.345,
    longitude: -6.264,
    categories: ['city', 'landmark'],
  },
  {
    id: 'abbeyroad',
    title: 'Abbey Road Crossing, London',
    pageUrl: 'https://www.earthcam.com/world/england/london/?cam=abbeyroad_702',
    country: 'GB',
    city: 'London',
    latitude: 51.532,
    longitude: -0.178,
    categories: ['city', 'landmark'],
  },
  {
    id: 'bourbon',
    title: 'Bourbon Street, New Orleans',
    pageUrl: 'https://www.earthcam.com/usa/louisiana/neworleans/bourbonstreet/?cam=bourbonstreet',
    country: 'US',
    city: 'New Orleans',
    latitude: 29.958,
    longitude: -90.065,
    categories: ['city'],
  },
  {
    id: 'miamibeach',
    title: 'Miami Beach',
    pageUrl: 'https://www.earthcam.com/usa/florida/miamibeach/?cam=miamibeach2',
    country: 'US',
    city: 'Miami',
    latitude: 25.790,
    longitude: -80.130,
    categories: ['beach'],
  },
];

export class EarthCamSource extends CameraSource {
  readonly name = 'earthcam' as const;
  readonly displayName = 'EarthCam';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = true;

  private _available: boolean | null = null;
  private hlsCache = new Cache<string>(5 * 60 * 1000); // 5 min

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    this._available = await isFfmpegAvailable();
    return this._available;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    let results = EARTHCAM_STREAMS.map((e) => this.toCameraObj(e));

    if (filters.country) {
      results = results.filter((c) => c.country.toLowerCase() === filters.country!.toLowerCase());
    }
    if (filters.city) {
      results = results.filter((c) => c.city?.toLowerCase().includes(filters.city!.toLowerCase()));
    }
    if (filters.category) {
      results = results.filter((c) => c.categories.includes(filters.category!));
    }
    if (filters.query) {
      const q = filters.query.toLowerCase();
      results = results.filter((c) => c.title.toLowerCase().includes(q));
    }

    const limit = filters.limit ?? 10;
    return results.slice(0, limit);
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    const entry = EARTHCAM_STREAMS.find((e) => e.id === nativeId);
    return entry ? this.toCameraObj(entry) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const entry = EARTHCAM_STREAMS.find((e) => e.id === nativeId);
    if (!entry) {
      throw new CameraOfflineError(formatCameraId('earthcam', nativeId));
    }

    // Scrape the page for the authenticated HLS URL
    const hlsUrl = await this.getHlsUrl(entry);
    if (!hlsUrl) {
      throw new CameraOfflineError(formatCameraId('earthcam', nativeId));
    }

    try {
      return await captureHlsFrame(hlsUrl, { timeout: 15000, referer: entry.pageUrl });
    } catch {
      throw new CameraOfflineError(formatCameraId('earthcam', nativeId));
    }
  }

  private async getHlsUrl(entry: EarthCamEntry): Promise<string | null> {
    const cached = this.hlsCache.get(entry.id);
    if (cached) return cached;

    try {
      const resp = await fetch(entry.pageUrl, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!resp.ok) return null;
      let html = await resp.text();

      // EarthCam uses JSON-escaped forward slashes in its JS config
      // Pattern: html5_streampath":"\/fecnetwork\/...\/playlist.m3u8?..."
      const streamPathMatch = html.match(/html5_streampath["']?\s*[":]\s*["']([^"']+\.m3u8[^"']*)["']/);
      const domainMatch = html.match(/html5_streamingdomain["']?\s*[":]\s*["']([^"']+)["']/);

      if (streamPathMatch) {
        // Unescape JSON forward slashes
        const domain = (domainMatch ? domainMatch[1] : 'https://videos-3.earthcam.com').replace(/\\\//g, '/');
        let streamPath = streamPathMatch[1].replace(/\\\//g, '/');
        // Unescape URL-encoded characters
        streamPath = decodeURIComponent(streamPath.replace(/%2B/g, '+').replace(/%2F/g, '/').replace(/%3D/g, '='));

        const hlsUrl = streamPath.startsWith('http')
          ? streamPath
          : `${domain}${streamPath.startsWith('/') ? '' : '/'}${streamPath}`;
        this.hlsCache.set(entry.id, hlsUrl);
        return hlsUrl;
      }

      return null;
    } catch {
      return null;
    }
  }

  async getCameraCount(): Promise<number> {
    return EARTHCAM_STREAMS.length;
  }

  async getCountries(): Promise<string[]> {
    return [...new Set(EARTHCAM_STREAMS.map((e) => e.country))].sort();
  }

  async getCategories(): Promise<Category[]> {
    const cats = new Set<Category>();
    for (const e of EARTHCAM_STREAMS) {
      for (const c of e.categories) cats.add(c);
    }
    return [...cats].sort();
  }

  private toCameraObj(entry: EarthCamEntry): Camera {
    return {
      id: formatCameraId('earthcam', entry.id),
      source: 'earthcam',
      title: entry.title,
      country: entry.country,
      city: entry.city,
      latitude: entry.latitude,
      longitude: entry.longitude,
      categories: entry.categories,
      status: 'active',
      streamUrl: entry.pageUrl,
    };
  }
}
