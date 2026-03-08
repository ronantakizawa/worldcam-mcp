export type SourceName =
  | 'windy'
  | 'openwebcamdb'
  | 'helios'
  | 'youtube'
  | 'earthcam'
  | 'skyline'
  | 'insecam'
  | 'camhacker'
  | 'dot'
  | 'nps'
  | 'ski'
  | 'tourism';

export const SOURCE_NAMES: SourceName[] = [
  'windy', 'openwebcamdb', 'helios', 'youtube',
  'earthcam', 'skyline', 'insecam', 'camhacker',
  'dot', 'nps', 'ski', 'tourism',
];

export const CATEGORIES = [
  'beach', 'city', 'traffic', 'mountain', 'wildlife',
  'airport', 'harbor', 'ski', 'park', 'landmark',
  'weather', 'underwater', 'rural', 'construction', 'nature', 'other',
] as const;

export type Category = typeof CATEGORIES[number];

export interface Camera {
  id: string;
  source: SourceName;
  title: string;
  country: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  categories: string[];
  status: 'active' | 'inactive' | 'unknown';
  thumbnailUrl?: string;
  streamUrl?: string;
}

export interface ScreenshotResult {
  camera: Camera;
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  capturedAt: Date;
  savedPath?: string;
  weather?: import('./weather.js').WeatherContext;
}

export interface SourceStatus {
  name: SourceName;
  displayName: string;
  available: boolean;
  cameraCount: number;
  requiresApiKey: boolean;
  requiresFfmpeg: boolean;
  lastError?: string;
}

export interface SearchFilters {
  country?: string;
  city?: string;
  category?: string;
  source?: SourceName;
  query?: string;
  limit?: number;
}

export function parseCameraId(id: string): { source: SourceName; nativeId: string } {
  const colonIdx = id.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid camera ID format: "${id}". Expected "source:nativeId".`);
  }
  const source = id.substring(0, colonIdx) as SourceName;
  const nativeId = id.substring(colonIdx + 1);
  if (!SOURCE_NAMES.includes(source)) {
    throw new Error(`Unknown source: "${source}". Valid sources: ${SOURCE_NAMES.join(', ')}`);
  }
  return { source, nativeId };
}

export function formatCameraId(source: SourceName, nativeId: string): string {
  return `${source}:${nativeId}`;
}

// Errors
export class WorldcamError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'WorldcamError';
  }
}

export class SourceUnavailableError extends WorldcamError {
  constructor(source: SourceName, reason: string) {
    super(`Source '${source}' is unavailable: ${reason}`, 'SOURCE_UNAVAILABLE');
  }
}

export class CameraNotFoundError extends WorldcamError {
  constructor(cameraId: string) {
    super(`Camera '${cameraId}' not found`, 'CAMERA_NOT_FOUND');
  }
}

export class CameraOfflineError extends WorldcamError {
  constructor(cameraId: string) {
    super(`Camera '${cameraId}' appears to be offline or unreachable`, 'CAMERA_OFFLINE');
  }
}

export class ScreenshotFailedError extends WorldcamError {
  constructor(cameraId: string, reason: string) {
    super(`Failed to capture screenshot from '${cameraId}': ${reason}`, 'SCREENSHOT_FAILED');
  }
}
