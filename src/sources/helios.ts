import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, SourceUnavailableError, CameraOfflineError } from '../types.js';
import { Cache } from '../cache.js';

export class HeliosSource extends CameraSource {
  readonly name = 'helios' as const;
  readonly displayName = 'Helios Cameras';
  readonly requiresApiKey = true;
  readonly requiresFfmpeg = false;

  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private tokenCache = new Cache<string>(6 * 24 * 60 * 60 * 1000); // 6 days
  private cache = new Cache<unknown>(5 * 60 * 1000);

  constructor() {
    super();
    this.clientId = process.env.HELIOS_CLIENT_ID;
    this.clientSecret = process.env.HELIOS_CLIENT_SECRET;
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.clientId && this.clientSecret);
  }

  private async getToken(): Promise<string> {
    const cached = this.tokenCache.get('token');
    if (cached) return cached;

    if (!this.clientId || !this.clientSecret) {
      throw new SourceUnavailableError('helios', 'HELIOS_CLIENT_ID and HELIOS_CLIENT_SECRET not set');
    }

    const resp = await fetch('https://api.helios.earth/v1/oauth/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!resp.ok) {
      throw new Error(`Helios auth failed: HTTP ${resp.status}`);
    }

    const data = await resp.json() as { access_token: string };
    this.tokenCache.set('token', data.access_token);
    return data.access_token;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const token = await this.getToken();

    const params = new URLSearchParams();
    params.set('limit', String(filters.limit ?? 10));

    if (filters.country) {
      params.set('country', filters.country.toUpperCase());
    }
    if (filters.city) {
      params.set('city', filters.city);
    }

    const cacheKey = `helios:search:${params.toString()}`;
    const cached = this.cache.get(cacheKey) as Camera[] | undefined;
    if (cached) return cached;

    const resp = await fetch(
      `https://api.helios.earth/v1/cameras?${params}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!resp.ok) {
      throw new Error(`Helios API error: HTTP ${resp.status}`);
    }

    const data = await resp.json() as {
      features?: Array<{
        id: string;
        properties?: {
          title?: string;
          city?: string;
          state?: string;
          country?: string;
        };
        geometry?: { coordinates?: [number, number] };
      }>;
    };

    const cameras: Camera[] = (data.features || []).map((f) => ({
      id: formatCameraId('helios', f.id),
      source: 'helios' as const,
      title: f.properties?.title || `Helios Camera ${f.id}`,
      country: f.properties?.country || 'US',
      city: f.properties?.city,
      region: f.properties?.state,
      latitude: f.geometry?.coordinates?.[1],
      longitude: f.geometry?.coordinates?.[0],
      categories: ['traffic'] as string[],
      status: 'active' as const,
    }));

    this.cache.set(cacheKey, cameras);
    return cameras;
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    const token = await this.getToken();

    try {
      const resp = await fetch(
        `https://api.helios.earth/v1/cameras/${nativeId}`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!resp.ok) return null;

      const f = await resp.json() as {
        id: string;
        properties?: {
          title?: string;
          city?: string;
          state?: string;
          country?: string;
        };
        geometry?: { coordinates?: [number, number] };
      };

      return {
        id: formatCameraId('helios', f.id),
        source: 'helios',
        title: f.properties?.title || `Helios Camera ${f.id}`,
        country: f.properties?.country || 'US',
        city: f.properties?.city,
        region: f.properties?.state,
        latitude: f.geometry?.coordinates?.[1],
        longitude: f.geometry?.coordinates?.[0],
        categories: ['traffic'],
        status: 'active',
      };
    } catch {
      return null;
    }
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const token = await this.getToken();

    const resp = await fetch(
      `https://api.helios.earth/v1/cameras/${nativeId}/live?random=${Date.now()}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      }
    );

    if (!resp.ok) {
      throw new CameraOfflineError(formatCameraId('helios', nativeId));
    }

    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';

    return {
      buffer,
      mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    };
  }

  async getCameraCount(): Promise<number> {
    return 5000; // approximate
  }

  async getCountries(): Promise<string[]> {
    return ['US']; // Helios is primarily US-focused
  }

  async getCategories(): Promise<Category[]> {
    return ['traffic', 'weather'];
  }
}
