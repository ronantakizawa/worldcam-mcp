import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, SourceUnavailableError, CameraOfflineError } from '../types.js';
import { captureYouTubeFrame } from '../screenshot.js';
import { Cache } from '../cache.js';

export class OpenWebcamDbSource extends CameraSource {
  readonly name = 'openwebcamdb' as const;
  readonly displayName = 'OpenWebcamDB';
  readonly requiresApiKey = true;
  readonly requiresFfmpeg = true; // uses yt-dlp + ffmpeg for YouTube streams

  private apiKey: string | undefined;
  private cache = new Cache<unknown>(5 * 60 * 1000);

  constructor() {
    super();
    this.apiKey = process.env.OPENWEBCAMDB_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    if (!this.apiKey) throw new SourceUnavailableError('openwebcamdb', 'OPENWEBCAMDB_API_KEY not set');

    const params = new URLSearchParams();
    params.set('per_page', String(filters.limit ?? 10));

    if (filters.country) {
      // OpenWebcamDB uses full country names in slug format
      params.set('country', filters.country.toLowerCase());
    }

    const cacheKey = `openwebcamdb:search:${params.toString()}`;
    const cached = this.cache.get(cacheKey) as Camera[] | undefined;
    if (cached) return cached;

    const resp = await fetch(
      `https://openwebcamdb.com/api/v1/webcams?${params}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
      }
    );

    if (!resp.ok) {
      throw new Error(`OpenWebcamDB API error: HTTP ${resp.status}`);
    }

    const data = await resp.json() as {
      data?: Array<{
        id: number;
        title: string;
        slug: string;
        country?: string;
        city?: string;
        youtube_id?: string;
        category?: string;
        latitude?: number;
        longitude?: number;
      }>;
    };

    const cameras: Camera[] = (data.data || []).map((wc) => ({
      id: formatCameraId('openwebcamdb', String(wc.id)),
      source: 'openwebcamdb' as const,
      title: wc.title,
      country: wc.country || 'unknown',
      city: wc.city,
      latitude: wc.latitude,
      longitude: wc.longitude,
      categories: wc.category ? [wc.category] : ['other'],
      status: 'active' as const,
      streamUrl: wc.youtube_id
        ? `https://www.youtube.com/watch?v=${wc.youtube_id}`
        : undefined,
    }));

    this.cache.set(cacheKey, cameras);
    return cameras;
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    if (!this.apiKey) return null;

    try {
      const resp = await fetch(
        `https://openwebcamdb.com/api/v1/webcams/${nativeId}`,
        {
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        }
      );

      if (!resp.ok) return null;
      const wc = await resp.json() as {
        id: number;
        title: string;
        country?: string;
        city?: string;
        youtube_id?: string;
        category?: string;
      };

      return {
        id: formatCameraId('openwebcamdb', String(wc.id)),
        source: 'openwebcamdb',
        title: wc.title,
        country: wc.country || 'unknown',
        city: wc.city,
        categories: wc.category ? [wc.category] : ['other'],
        status: 'active',
        streamUrl: wc.youtube_id
          ? `https://www.youtube.com/watch?v=${wc.youtube_id}`
          : undefined,
      };
    } catch {
      return null;
    }
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const camera = await this.getCamera(nativeId);
    if (!camera) {
      throw new CameraOfflineError(formatCameraId('openwebcamdb', nativeId));
    }

    // Extract YouTube video ID from stream URL
    const ytMatch = camera.streamUrl?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
    if (!ytMatch) {
      throw new CameraOfflineError(formatCameraId('openwebcamdb', nativeId));
    }

    return captureYouTubeFrame(ytMatch[1]);
  }

  async getCameraCount(): Promise<number> {
    return 1771;
  }

  async getCountries(): Promise<string[]> {
    return ['US', 'GB', 'DE', 'JP', 'FR', 'IT', 'ES', 'NL', 'KR', 'ZA'];
  }

  async getCategories(): Promise<Category[]> {
    return ['city', 'beach', 'nature', 'wildlife', 'landmark', 'traffic', 'other'];
  }
}
