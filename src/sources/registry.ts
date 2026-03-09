import type { Camera, Category, SearchFilters, SourceName, SourceStatus, ScreenshotResult } from '../types.js';
import { parseCameraId, CameraNotFoundError, WorldcamError } from '../types.js';
import { haversineDistanceKm } from '../geo.js';
import { getWeatherForCamera } from '../weather.js';
import { CameraSource } from './base.js';
import { YouTubeSource } from './youtube.js';
import { InsecamSource } from './insecam.js';
import { CamHackerSource } from './camhacker.js';
import { WindySource } from './windy.js';
import { OpenWebcamDbSource } from './openwebcamdb.js';
import { HeliosSource } from './helios.js';
import { EarthCamSource } from './earthcam.js';
import { SkylineWebcamsSource } from './skylinewebcams.js';
import { DotSource } from './dot.js';
import { NpsSource } from './nps.js';
import { SkiCamsSource } from './skicams.js';
import { TourismSource } from './tourism.js';

export class SourceRegistry {
  private sources = new Map<SourceName, CameraSource>();
  private _warmupPromise: Promise<void> | null = null;

  constructor() {
    const allSources: CameraSource[] = [
      new YouTubeSource(),
      new InsecamSource(),
      new CamHackerSource(),
      new WindySource(),
      new OpenWebcamDbSource(),
      new HeliosSource(),
      new EarthCamSource(),
      new SkylineWebcamsSource(),
      new DotSource(),
      new NpsSource(),
      new SkiCamsSource(),
      new TourismSource(),
    ];

    for (const source of allSources) {
      this.sources.set(source.name, source);
    }
  }

  /**
   * Pre-warm the Skyline camera cache in the background.
   * Call once at startup — subsequent tool calls will hit the warm cache.
   */
  warmup(): void {
    if (this._warmupPromise) return;
    this._warmupPromise = (async () => {
      try {
        const skyline = this.sources.get('skyline');
        if (skyline) {
          const start = Date.now();
          await skyline.searchCameras({ limit: 1 }); // triggers full discovery + geocoding
          process.stderr.write(
            `[worldcam] Skyline pre-warm complete: ${Date.now() - start}ms\n`
          );
        }
      } catch {
        // Non-fatal — will retry on first real call
      }
    })();
  }

  getSource(name: SourceName): CameraSource {
    const source = this.sources.get(name);
    if (!source) {
      throw new Error(`Unknown source: ${name}`);
    }
    return source;
  }

  /** Aggregate search across all available sources */
  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const limit = filters.limit ?? 10;

    // If a specific source is requested, only search that one
    if (filters.source) {
      const source = this.getSource(filters.source);
      if (!(await source.isAvailable())) {
        return [];
      }
      return source.searchCameras({ ...filters, limit });
    }

    // Fan out to all available sources in parallel with early return.
    // As soon as we have enough results, resolve immediately.
    const sourceEntries = [...this.sources.values()];
    const availableChecks = await Promise.all(
      sourceEntries.map(async (s) => ({ source: s, available: await s.isAvailable() }))
    );
    const availableSources = availableChecks
      .filter((x) => x.available)
      .map((x) => x.source);

    const perSourceLimit = Math.ceil(limit / availableSources.length) + 2;
    const allCameras: Camera[] = [];
    const abort = new AbortController();

    await Promise.allSettled(
      availableSources.map(async (source) => {
        try {
          const cameras = await Promise.race([
            source.searchCameras({ ...filters, limit: perSourceLimit }),
            new Promise<Camera[]>((_, reject) => {
              const timer = setTimeout(() => reject(new Error('timeout')), 5000);
              abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('abort')); });
            }),
          ]);
          allCameras.push(...cameras);
          // Early return: once we have enough results, abort remaining slow sources
          if (allCameras.length >= limit) abort.abort();
        } catch {
          // Source failed or timed out — continue with others
        }
      })
    );

    return allCameras.slice(0, limit);
  }

  /** Get screenshot from a camera by its composite ID */
  async getScreenshot(cameraId: string): Promise<ScreenshotResult> {
    const { source: sourceName, nativeId } = parseCameraId(cameraId);
    const source = this.getSource(sourceName);

    if (!(await source.isAvailable())) {
      throw new WorldcamError(
        `Source '${sourceName}' is not available. Check required API keys or dependencies.`,
        'SOURCE_UNAVAILABLE'
      );
    }

    const camera = await source.getCamera(nativeId);
    if (!camera) {
      throw new CameraNotFoundError(cameraId);
    }

    // Capture screenshot and fetch weather in parallel
    const [screenshot, weather] = await Promise.all([
      source.captureScreenshot(nativeId),
      getWeatherForCamera({
        latitude: camera.latitude,
        longitude: camera.longitude,
        city: camera.city,
        country: camera.country,
      }).catch(() => null),
    ]);

    return {
      camera,
      imageBase64: screenshot.buffer.toString('base64'),
      mimeType: screenshot.mimeType,
      capturedAt: new Date(),
      weather: weather ?? undefined,
    };
  }

  /** Get a random camera screenshot, optionally filtered */
  async getRandomCamera(filters?: Partial<SearchFilters>): Promise<ScreenshotResult> {
    // Search with a larger limit to get variety
    const cameras = await this.searchCameras({
      ...filters,
      limit: 50,
    });

    if (cameras.length === 0) {
      throw new WorldcamError('No cameras found matching filters', 'NO_CAMERAS');
    }

    // Fisher-Yates shuffle for unbiased randomization
    const shuffled = [...cameras];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let lastError: Error | null = null;

    for (const camera of shuffled.slice(0, 5)) {
      try {
        return await this.getScreenshot(camera.id);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }

    throw new WorldcamError(
      `Failed to capture screenshot from any camera. Last error: ${lastError?.message}`,
      'ALL_CAMERAS_FAILED'
    );
  }

  /** Find cameras nearest to a GPS coordinate */
  async findNearestCameras(params: {
    latitude: number;
    longitude: number;
    category?: string;
    source?: SourceName;
    limit?: number;
  }): Promise<Array<Camera & { distanceKm: number }>> {
    const limit = params.limit ?? 5;

    // Gather cameras from all sources in parallel:
    // 1. Static sources: full inventory (cached after first call)
    // 2. Windy: nearby API search (250km radius, up to 50 results)
    const [staticCameras, windyCameras] = await Promise.all([
      this.getAllCamerasWithCoords(params.source, params.category),
      this.getWindyNearbyCameras(params.latitude, params.longitude, params.source),
    ]);

    // Merge, deduplicate by ID
    const seen = new Set<string>();
    const allCameras: Camera[] = [];
    for (const cam of [...staticCameras, ...windyCameras]) {
      if (seen.has(cam.id)) continue;
      seen.add(cam.id);
      allCameras.push(cam);
    }

    // Compute distance (all cameras already have coordinates)
    const withDistance = allCameras.map((c) => ({
      ...c,
      distanceKm: Math.round(
        haversineDistanceKm(params.latitude, params.longitude, c.latitude!, c.longitude!) * 10
      ) / 10,
    }));

    // Sort by distance and return top N
    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
    return withDistance.slice(0, limit);
  }

  /**
   * Get nearby cameras from Windy's API (if available).
   * Uses the nearby endpoint with 250km radius for global coverage.
   */
  private async getWindyNearbyCameras(
    lat: number,
    lon: number,
    sourceName?: SourceName,
  ): Promise<Camera[]> {
    // Skip if a non-windy source is specifically requested
    if (sourceName && sourceName !== 'windy') return [];

    const windy = this.sources.get('windy');
    if (!windy || !(await windy.isAvailable())) return [];

    try {
      return await (windy as WindySource).searchNearby(lat, lon, 250, 50);
    } catch {
      return [];
    }
  }

  /**
   * Get all cameras with coordinates from available sources.
   * Used by findNearestCameras to search the full inventory.
   */
  private async getAllCamerasWithCoords(
    sourceName?: SourceName,
    category?: string,
  ): Promise<Camera[]> {
    const sources = sourceName
      ? [this.getSource(sourceName)]
      : [...this.sources.values()];

    const availableChecks = await Promise.all(
      sources.map(async (s) => ({ source: s, available: await s.isAvailable() }))
    );
    const availableSources = availableChecks
      .filter((x) => x.available)
      .map((x) => x.source);

    // Ask each source for a large batch. First call may be slow (Skyline geocodes
    // ~500 cities on first discovery), but subsequent calls are instant from cache.
    const results = await Promise.allSettled(
      availableSources.map((source) =>
        Promise.race([
          source.searchCameras({ category, limit: 5000 }),
          new Promise<Camera[]>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 120000)
          ),
        ])
      )
    );

    const cameras: Camera[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const cam of result.value) {
          if (cam.latitude != null && cam.longitude != null) {
            cameras.push(cam);
          }
        }
      }
    }
    return cameras;
  }

  /** Get status of all sources */
  async getSourceStatuses(): Promise<SourceStatus[]> {
    const statuses: SourceStatus[] = [];

    for (const source of this.sources.values()) {
      let available = false;
      let lastError: string | undefined;
      try {
        available = await source.isAvailable();
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      let cameraCount = 0;
      try {
        cameraCount = await source.getCameraCount();
      } catch {
        // ignore
      }

      statuses.push({
        name: source.name,
        displayName: source.displayName,
        available,
        cameraCount,
        requiresApiKey: source.requiresApiKey,
        requiresFfmpeg: source.requiresFfmpeg,
        lastError,
      });
    }

    return statuses;
  }

  /** Get all countries across all sources */
  async getAllCountries(): Promise<string[]> {
    const countries = new Set<string>();

    const sourceEntries = [...this.sources.values()];
    const availableChecks = await Promise.all(
      sourceEntries.map(async (s) => ({ source: s, available: await s.isAvailable() }))
    );
    const availableSources = availableChecks
      .filter((x) => x.available)
      .map((x) => x.source);

    const results = await Promise.allSettled(
      availableSources.map((s) => s.getCountries())
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const c of result.value) {
          countries.add(c);
        }
      }
    }

    return [...countries].sort();
  }

  /** Get all categories */
  getAllCategories(): string[] {
    return [
      'beach', 'city', 'traffic', 'mountain', 'wildlife',
      'airport', 'harbor', 'ski', 'park', 'landmark',
      'weather', 'underwater', 'rural', 'construction', 'nature', 'other',
    ];
  }
}
