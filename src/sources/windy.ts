import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, SourceUnavailableError, CameraOfflineError } from '../types.js';
import { fetchImage } from '../screenshot.js';
import { Cache } from '../cache.js';

const WINDY_CATEGORY_MAP: Record<string, Category> = {
  airport: 'airport',
  beach: 'beach',
  building: 'city',
  city: 'city',
  coast: 'beach',
  forest: 'nature',
  harbour: 'harbor',
  indoor: 'other',
  lake: 'nature',
  landscape: 'nature',
  mountain: 'mountain',
  pool: 'other',
  public: 'city',
  resort: 'other',
  street: 'city',
  traffic: 'traffic',
  underwater: 'underwater',
  volcano: 'nature',
  other: 'other',
};

interface WindyWebcam {
  webcamId: number;
  title: string;
  status: string;
  images?: { current?: { preview?: string; thumbnail?: string } };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  };
  categories?: Array<{ id: string }>;
}

export class WindySource extends CameraSource {
  readonly name = 'windy' as const;
  readonly displayName = 'Windy Webcams';
  readonly requiresApiKey = true;
  readonly requiresFfmpeg = false;

  private apiKey: string | undefined;
  private cache = new Cache<unknown>(5 * 60 * 1000); // 5 min

  constructor() {
    super();
    this.apiKey = process.env.WINDY_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    if (!this.apiKey) throw new SourceUnavailableError('windy', 'WINDY_API_KEY not set');

    const params = new URLSearchParams();
    params.set('limit', String(filters.limit ?? 10));
    params.set('include', 'images,location,categories');

    if (filters.country) {
      params.set('countries', filters.country.toUpperCase());
    }
    if (filters.category) {
      const windyCats = Object.entries(WINDY_CATEGORY_MAP)
        .filter(([_, v]) => v === filters.category)
        .map(([k]) => k);
      if (windyCats.length > 0) {
        params.set('categories', windyCats.join(','));
      }
    }

    const cacheKey = `windy:search:${params.toString()}`;
    const cached = this.cache.get(cacheKey) as Camera[] | undefined;
    if (cached) return cached;

    const webcams = await this.apiFetch(`webcams?${params}`);
    const cameras = webcams.map((wc) => this.toCamera(wc));

    if (filters.query) {
      const q = filters.query.toLowerCase();
      const filtered = cameras.filter((c) => c.title.toLowerCase().includes(q));
      this.cache.set(cacheKey, filtered);
      return filtered;
    }

    this.cache.set(cacheKey, cameras);
    return cameras;
  }

  /**
   * Search for webcams near a GPS coordinate. Uses Windy's nearby API
   * (max 250km radius). This enables findNearestCameras to leverage
   * Windy's 75K+ camera network for global coverage.
   */
  async searchNearby(
    lat: number,
    lon: number,
    radiusKm: number,
    limit: number,
  ): Promise<Camera[]> {
    if (!this.apiKey) return [];

    const r = Math.min(radiusKm, 250); // API max is 250km
    const cacheKey = `windy:nearby:${lat.toFixed(2)},${lon.toFixed(2)},${r},${limit}`;
    const cached = this.cache.get(cacheKey) as Camera[] | undefined;
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('nearby', `${lat},${lon},${r}`);
    params.set('limit', String(limit));
    params.set('include', 'images,location,categories');

    const webcams = await this.apiFetch(`webcams?${params}`);
    const cameras = webcams.map((wc) => this.toCamera(wc));

    this.cache.set(cacheKey, cameras);
    return cameras;
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    if (!this.apiKey) return null;

    try {
      const resp = await fetch(
        `https://api.windy.com/webcams/api/v3/webcams/${nativeId}?include=images,location,categories`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { 'x-windy-api-key': this.apiKey },
        }
      );

      if (!resp.ok) return null;
      const wc = await resp.json() as WindyWebcam;
      return this.toCamera(wc);
    } catch {
      return null;
    }
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    if (!this.apiKey) throw new SourceUnavailableError('windy', 'WINDY_API_KEY not set');

    const resp = await fetch(
      `https://api.windy.com/webcams/api/v3/webcams/${nativeId}?include=images`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'x-windy-api-key': this.apiKey },
      }
    );

    if (!resp.ok) {
      throw new CameraOfflineError(formatCameraId('windy', nativeId));
    }

    const data = await resp.json() as WindyWebcam;
    const imageUrl = data.images?.current?.preview || data.images?.current?.thumbnail;
    if (!imageUrl) {
      throw new CameraOfflineError(formatCameraId('windy', nativeId));
    }

    const result = await fetchImage(imageUrl, { timeout: 10000 });
    return {
      buffer: result.buffer,
      mimeType: result.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    };
  }

  async getCameraCount(): Promise<number> {
    return 75000;
  }

  async getCountries(): Promise<string[]> {
    return [
      'US', 'JP', 'DE', 'IT', 'FR', 'ES', 'GB', 'NL', 'AT', 'CH',
      'SE', 'NO', 'CZ', 'PL', 'HR', 'GR', 'PT', 'BE', 'DK', 'FI',
    ];
  }

  async getCategories(): Promise<Category[]> {
    return ['beach', 'city', 'traffic', 'mountain', 'harbor', 'airport', 'nature', 'underwater', 'other'];
  }

  private async apiFetch(path: string): Promise<WindyWebcam[]> {
    const resp = await fetch(
      `https://api.windy.com/webcams/api/v3/${path}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'x-windy-api-key': this.apiKey! },
      }
    );

    if (!resp.ok) {
      throw new Error(`Windy API error: HTTP ${resp.status}`);
    }

    const data = await resp.json() as { webcams?: WindyWebcam[] };
    return data.webcams || [];
  }

  private toCamera(wc: WindyWebcam): Camera {
    return {
      id: formatCameraId('windy', String(wc.webcamId)),
      source: 'windy',
      title: wc.title,
      country: wc.location?.country_code?.toUpperCase() || 'unknown',
      city: wc.location?.city,
      region: wc.location?.region,
      latitude: wc.location?.latitude,
      longitude: wc.location?.longitude,
      categories: (wc.categories || [])
        .map((cat) => WINDY_CATEGORY_MAP[cat.id] || 'other'),
      status: wc.status === 'active' ? 'active' : 'inactive',
      thumbnailUrl: wc.images?.current?.preview || wc.images?.current?.thumbnail,
    };
  }
}
