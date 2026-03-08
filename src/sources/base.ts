import type { Camera, Category, SearchFilters, SourceName } from '../types.js';

export abstract class CameraSource {
  abstract readonly name: SourceName;
  abstract readonly displayName: string;
  abstract readonly requiresApiKey: boolean;
  abstract readonly requiresFfmpeg: boolean;

  /** Check if this source is configured and available */
  abstract isAvailable(): Promise<boolean>;

  /** Search cameras matching filters */
  abstract searchCameras(filters: SearchFilters): Promise<Camera[]>;

  /** Get a single camera by its native ID */
  abstract getCamera(nativeId: string): Promise<Camera | null>;

  /** Capture a screenshot — returns raw image buffer + MIME type */
  abstract captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }>;

  /** Approximate camera count */
  abstract getCameraCount(): Promise<number>;

  /** Countries this source covers */
  abstract getCountries(): Promise<string[]>;

  /** Categories this source covers */
  abstract getCategories(): Promise<Category[]>;
}
