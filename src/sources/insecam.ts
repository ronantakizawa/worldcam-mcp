import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage, fetchMjpegFrame } from '../screenshot.js';
import { Cache } from '../cache.js';
import { geocodeCity } from '../weather.js';

// Supported ISO alpha-2 country codes for insecam
const SUPPORTED_COUNTRIES = new Set([
  'US', 'JP', 'DE', 'IT', 'FR', 'RU', 'KR', 'GB', 'TW', 'NL',
  'CZ', 'ES', 'TR', 'AR', 'BR', 'IN', 'MX', 'CH', 'AT', 'SE',
  'NO', 'FI', 'IL', 'UA', 'PL', 'CA', 'AU', 'IE', 'BE', 'RO',
  'BG', 'DK', 'VN', 'TH', 'ID', 'SG', 'MY', 'PH', 'CL', 'CO',
  'ZA', 'NG', 'KE', 'EG', 'HU',
]);

interface InsecamCamera {
  id: string;
  imageUrl: string;
  country: string;
  city?: string;
  title?: string;
  latitude?: number;
  longitude?: number;
}

export class InsecamSource extends CameraSource {
  readonly name = 'insecam' as const;
  readonly displayName = 'Insecam (Public IP Cameras)';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  private cache = new Cache<InsecamCamera[]>(10 * 60 * 1000); // 10 min

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const country = filters.country?.toUpperCase() || 'US';
    const cameras = await this.scrapeCountryPage(country, 1);

    let results = cameras.map((c) => this.toCameraObj(c));

    if (filters.query) {
      const q = filters.query.toLowerCase();
      results = results.filter(
        (c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
      );
    }

    const limit = filters.limit ?? 10;
    return results.slice(0, limit);
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    if (!/^\d+$/.test(nativeId)) return null;

    try {
      const html = await this.fetchPage(
        `http://www.insecam.org/en/view/${nativeId}/`
      );
      const imgMatch = html.match(/img[^>]+id="image0"[^>]+src="([^"]+)"/);
      if (!imgMatch) return null;

      // Extract coordinates from Leaflet map: setView([lat, lon], zoom)
      const coordMatch = html.match(/setView\(\[([0-9.-]+),\s*([0-9.-]+)\]/);
      const latitude = coordMatch ? parseFloat(coordMatch[1]) : undefined;
      const longitude = coordMatch ? parseFloat(coordMatch[2]) : undefined;

      // Extract city from page title: "Live camera in {Country}, {City}"
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const cityMatch = titleMatch?.[1]?.match(/,\s*([^<]+?)(?:\s*-\s*Insecam)?$/);
      const city = cityMatch ? cityMatch[1].trim() : undefined;

      return {
        id: formatCameraId('insecam', nativeId),
        source: 'insecam',
        title: city ? `IP Camera — ${city}` : `Insecam Camera #${nativeId}`,
        country: 'unknown',
        city,
        latitude,
        longitude,
        categories: ['other'],
        status: 'active',
        streamUrl: imgMatch[1],
      };
    } catch {
      return null;
    }
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    if (!/^\d+$/.test(nativeId)) {
      throw new CameraOfflineError(formatCameraId('insecam', nativeId));
    }

    const camera = await this.getCamera(nativeId);
    if (!camera || !camera.streamUrl) {
      throw new CameraOfflineError(formatCameraId('insecam', nativeId));
    }

    try {
      // Try as static image first
      const result = await fetchImage(camera.streamUrl, { timeout: 5000 });
      return {
        buffer: result.buffer,
        mimeType: result.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
      };
    } catch {
      // Fall back to MJPEG frame extraction
      try {
        return await fetchMjpegFrame(camera.streamUrl, { timeout: 5000 });
      } catch {
        throw new CameraOfflineError(formatCameraId('insecam', nativeId));
      }
    }
  }

  async getCameraCount(): Promise<number> {
    return 100; // approximate
  }

  async getCountries(): Promise<string[]> {
    return [...SUPPORTED_COUNTRIES].sort();
  }

  async getCategories(): Promise<Category[]> {
    return ['city', 'traffic', 'other'];
  }

  private async scrapeCountryPage(
    countryCode: string,
    page: number
  ): Promise<InsecamCamera[]> {
    const cacheKey = `insecam:${countryCode}:${page}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const insecamCode = countryCode;
    const url = `http://www.insecam.org/en/bycountry/${insecamCode}/?page=${page}`;

    try {
      const html = await this.fetchPage(url);
      const cameras = this.parseCameraList(html, countryCode);

      // Batch geocode unique cities for coordinates
      const cityMap = new Map<string, { city: string; country: string }>();
      for (const cam of cameras) {
        if (cam.city) {
          const key = `${cam.city}:${cam.country}`;
          if (!cityMap.has(key)) cityMap.set(key, { city: cam.city, country: cam.country });
        }
      }
      const coordResults = new Map<string, { lat: number; lon: number }>();
      const entries = [...cityMap.entries()];
      await Promise.allSettled(
        entries.map(async ([key, { city, country }]) => {
          const coords = await geocodeCity(city, country);
          if (coords) coordResults.set(key, coords);
        })
      );
      for (const cam of cameras) {
        if (cam.city) {
          const coords = coordResults.get(`${cam.city}:${cam.country}`);
          if (coords) { cam.latitude = coords.lat; cam.longitude = coords.lon; }
        }
      }

      this.cache.set(cacheKey, cameras);
      return cameras;
    } catch {
      return [];
    }
  }

  private parseCameraList(html: string, country: string): InsecamCamera[] {
    const cameras: InsecamCamera[] = [];

    // Match camera entries: <a href="/en/view/{id}/" title="Live camera in {Country}, {City}">
    // followed by <img src="{imageUrl}">
    const entryRegex = /<a[^>]+href="\/en\/view\/(\d+)\/"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<img[^>]+class="[^"]*thumbnail-item__img[^"]*"[^>]+src="([^"]+)"[^>]*>/gi;

    let match;
    while ((match = entryRegex.exec(html)) !== null) {
      const id = match[1];
      const title = match[2];
      const imageUrl = match[3];

      // Extract city from title: "Live camera in {Country}, {City}"
      const cityMatch = title.match(/,\s*(.+)$/);
      const city = cityMatch ? cityMatch[1].trim() : undefined;

      cameras.push({
        id,
        imageUrl,
        country,
        city,
        title: city ? `IP Camera — ${city}` : `IP Camera #${id}`,
      });
    }

    // Fallback: separate regex if entry regex didn't match
    if (cameras.length === 0) {
      const linkRegex = /<a[^>]+href="\/en\/view\/(\d+)\/"[^>]*>/gi;
      const imgRegex = /<img[^>]+class="[^"]*thumbnail-item__img[^"]*"[^>]+src="([^"]+)"[^>]*>/gi;

      const ids: string[] = [];
      let linkMatch;
      while ((linkMatch = linkRegex.exec(html)) !== null) ids.push(linkMatch[1]);

      const imageUrls: string[] = [];
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) imageUrls.push(imgMatch[1]);

      const count = Math.min(ids.length, imageUrls.length);
      for (let i = 0; i < count; i++) {
        cameras.push({ id: ids[i], imageUrl: imageUrls[i], country, title: `IP Camera #${ids[i]}` });
      }
    }

    return cameras;
  }

  private async fetchPage(url: string): Promise<string> {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    return resp.text();
  }

  private toCameraObj(cam: InsecamCamera): Camera {
    return {
      id: formatCameraId('insecam', cam.id),
      source: 'insecam',
      title: cam.title || `IP Camera #${cam.id}`,
      country: cam.country,
      city: cam.city,
      latitude: cam.latitude,
      longitude: cam.longitude,
      categories: ['other'],
      status: 'active',
      streamUrl: cam.imageUrl,
    };
  }
}
