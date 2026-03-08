import { YouTube } from 'youtube-sr';
import ytdl from '@distube/ytdl-core';
import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId } from '../types.js';
import { captureYouTubeFrame, fetchImage } from '../screenshot.js';
import { Cache } from '../cache.js';

export class YouTubeSource extends CameraSource {
  readonly name = 'youtube' as const;
  readonly displayName = 'YouTube Live Streams';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  private searchCache = new Cache<Camera[]>(30 * 60 * 1000); // 30 min

  async isAvailable(): Promise<boolean> {
    return true; // All deps are npm packages — always available
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const query = this.buildSearchQuery(filters);
    const limit = filters.limit ?? 10;
    const cacheKey = `yt:${query}:${limit}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const searchCount = Math.min(limit * 2, 30);
    const cameras = await this.ytSearch(query, searchCount);

    const results = cameras.slice(0, limit);
    this.searchCache.set(cacheKey, results);
    return results;
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(nativeId)) return null;

    try {
      const info = await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${nativeId}`);
      const title = info.videoDetails?.title;
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
          `YouTube stream ${nativeId} appears to be offline. Stream capture and thumbnail fallback both failed.`
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

  private buildSearchQuery(filters: SearchFilters): string {
    const parts: string[] = ['live webcam'];
    if (filters.query) parts.push(filters.query);
    if (filters.city) parts.push(filters.city);
    if (filters.country) parts.push(filters.country);
    if (filters.category && filters.category !== 'other') parts.push(filters.category);
    return parts.join(' ');
  }

  /**
   * Search YouTube for live streams using youtube-sr (npm package).
   */
  private async ytSearch(query: string, count: number): Promise<Camera[]> {
    try {
      const results = await YouTube.search(query, { type: 'video', limit: count });

      return results
        .filter((v: any) => v.id && v.title)
        .map((v: any) => ({
          id: formatCameraId('youtube', v.id!),
          source: 'youtube' as const,
          title: v.title || `YouTube Live ${v.id}`,
          country: 'unknown',
          categories: ['other'] as string[],
          status: 'active' as const,
          streamUrl: `https://www.youtube.com/watch?v=${v.id}`,
        }));
    } catch {
      return [];
    }
  }
}
