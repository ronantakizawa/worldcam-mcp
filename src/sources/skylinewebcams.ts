import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage, captureHlsFrame, isFfmpegAvailable } from '../screenshot.js';
import { Cache } from '../cache.js';
import { geocodeCity } from '../weather.js';

interface DiscoveredCam {
  slug: string;
  title: string;
  country: string;
  nkey?: string;
  latitude?: number;
  longitude?: number;
}

export class SkylineWebcamsSource extends CameraSource {
  readonly name = 'skyline' as const;
  readonly displayName = 'SkylineWebcams';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  private camListCache = new Cache<DiscoveredCam[]>(60 * 60 * 1000); // 1 hour
  private nkeyCache = new Cache<string>(30 * 60 * 1000); // 30 min

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    const allCams = await this.discoverCameras();
    let results = allCams.map((c) => this.toCameraObj(c));

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
    // nativeId is the slug (e.g., "italia/lazio/roma/fontana-di-trevi")
    if (!/^[a-zA-Z0-9/_-]+$/.test(nativeId)) return null;

    const allCams = await this.discoverCameras();
    const cam = allCams.find((c) => c.slug === nativeId);
    return cam ? this.toCameraObj(cam) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    if (!/^[a-zA-Z0-9/_-]+$/.test(nativeId)) {
      throw new CameraOfflineError(formatCameraId('skyline', nativeId));
    }

    try {
      // Get the numeric camera ID (nkey) by scraping the page
      const numericId = await this.getNkey(nativeId);
      if (numericId) {
        // Fetch live still from CDN
        const liveUrl = `https://cdn.skylinewebcams.com/live${numericId}.jpg`;
        try {
          const result = await fetchImage(liveUrl, { timeout: 10000 });
          if (result.buffer.length > 1000) {
            return {
              buffer: result.buffer,
              mimeType: result.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
            };
          }
        } catch {
          // Fall through to HLS
        }
      }

      // Fallback: try HLS stream via ffmpeg
      const pageUrl = `https://www.skylinewebcams.com/en/webcam/${nativeId}.html`;
      const resp = await fetch(pageUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();

      const hlsMatch = html.match(/source\s*:\s*['"](livee\.m3u8\?[^'"]+)['"]/);
      if (hlsMatch && await isFfmpegAvailable()) {
        const hlsUrl = `https://hd-auth.skylinewebcams.com/${hlsMatch[1]}`;
        return await captureHlsFrame(hlsUrl, { timeout: 15000 });
      }

      throw new Error('No image source found');
    } catch (err) {
      throw new CameraOfflineError(formatCameraId('skyline', nativeId));
    }
  }

  async getCameraCount(): Promise<number> {
    const cams = await this.discoverCameras();
    return cams.length;
  }

  async getCountries(): Promise<string[]> {
    const cams = await this.discoverCameras();
    return [...new Set(cams.map((c) => c.country))].sort();
  }

  async getCategories(): Promise<Category[]> {
    return ['city', 'landmark', 'beach', 'nature', 'mountain', 'underwater', 'wildlife'];
  }

  /** All listing pages to scrape for comprehensive camera discovery. */
  private static readonly LISTING_PAGES = [
    'https://www.skylinewebcams.com/en/top-live-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/live-web-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/city-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/beach-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/nature-mountain-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/seaport-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/unesco-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/ski-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/animals-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/volcanoes-cams.html',
    'https://www.skylinewebcams.com/en/live-cams-category/lake-cams.html',
    'https://www.skylinewebcams.com/en/new-livecams.html',
  ];

  /**
   * Discover cameras by scraping all listing + category pages in parallel.
   * Returns slug + title + inferred country. Cached for 1 hour.
   */
  private async discoverCameras(): Promise<DiscoveredCam[]> {
    const cached = this.camListCache.get('all');
    if (cached) return cached;

    const seen = new Set<string>();
    const cams: DiscoveredCam[] = [];

    // Fetch all listing pages in parallel (with individual timeouts)
    const results = await Promise.allSettled(
      SkylineWebcamsSource.LISTING_PAGES.map((url) => this.scrapePage(url))
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const cam of result.value) {
        if (seen.has(cam.slug)) continue;
        seen.add(cam.slug);
        if (cam.nkey) this.nkeyCache.set(cam.slug, cam.nkey);
        cams.push(cam);
      }
    }

    // Enrich cameras with coordinates via batch geocoding
    await this.enrichWithCoordinates(cams);

    this.camListCache.set('all', cams);
    return cams;
  }

  /**
   * Scrape a single listing page for camera entries.
   * Handles two HTML patterns:
   *   1. <a href="en/webcam/{slug}.html"><img src="...live{nkey}.jpg" alt="{title}">
   *   2. <a href="en/webcam/{slug}.html"><img src="...live{nkey}.jpg">{title}</a>
   */
  private async scrapePage(url: string): Promise<DiscoveredCam[]> {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!resp.ok) return [];
      const html = await resp.text();
      return this.extractCamerasFromHtml(html);
    } catch {
      return [];
    }
  }

  /**
   * Extract camera entries from HTML. Uses two strategies:
   *   1. Primary: match anchor+img pairs with nkey from CDN URL
   *   2. Fallback: match any webcam href and derive title from slug
   */
  private extractCamerasFromHtml(html: string): DiscoveredCam[] {
    const cams: DiscoveredCam[] = [];
    const seen = new Set<string>();

    // Strategy 1: Match <a href="...webcam/{slug}.html">...<img src="...live{nkey}.jpg"...>...
    // This regex captures each anchor block containing a CDN thumbnail.
    // It handles both alt="title" and bare text after the img.
    const anchorRegex = /<a\s[^>]*href="(?:\/)?en\/webcam\/([a-z0-9\/_-]+)\.html"[^>]*>[\s\S]*?<\/a>/gi;
    const nkeyImgRegex = /src="https?:\/\/cdn\.skylinewebcams\.com\/live(\d+)\.jpg"/i;
    const altRegex = /alt="([^"]+)"/i;
    // Text after the last > before </a>
    const trailingTextRegex = />([^<]{2,})<\/a>\s*$/i;

    let anchorMatch;
    while ((anchorMatch = anchorRegex.exec(html)) !== null) {
      const slug = anchorMatch[1];
      if (seen.has(slug)) continue;

      const block = anchorMatch[0];
      const imgMatch = block.match(nkeyImgRegex);
      if (!imgMatch) continue;

      const nkey = imgMatch[1];
      // Try alt attribute first, then trailing text
      const altMatch = block.match(altRegex);
      const textMatch = block.match(trailingTextRegex);
      const title = (altMatch?.[1] || textMatch?.[1] || '').trim();

      if (!title) {
        // Derive title from slug
        const parts = slug.split('/');
        const derived = parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        seen.add(slug);
        cams.push({ slug, title: derived, nkey, country: this.inferCountry(slug) });
      } else {
        seen.add(slug);
        cams.push({ slug, title, nkey, country: this.inferCountry(slug) });
      }
    }

    // Strategy 2: Fallback — pick up any webcam hrefs not yet captured
    const hrefRegex = /href="(?:\/)?en\/webcam\/([a-z0-9\/_-]+)\.html"/gi;
    let hrefMatch;
    while ((hrefMatch = hrefRegex.exec(html)) !== null) {
      const slug = hrefMatch[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const parts = slug.split('/');
      const title = parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      cams.push({ slug, title, country: this.inferCountry(slug) });
    }

    return cams;
  }

  /**
   * Get the numeric camera ID (nkey) by scraping the camera page.
   * Cached for 30 minutes.
   */
  private async getNkey(slug: string): Promise<string | null> {
    const cached = this.nkeyCache.get(slug);
    if (cached) return cached;

    try {
      const pageUrl = `https://www.skylinewebcams.com/en/webcam/${slug}.html`;
      const resp = await fetch(pageUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!resp.ok) return null;

      const html = await resp.text();
      const nkeyMatch = html.match(/nkey\s*:\s*['"](\d+)\.jpg['"]/);
      if (nkeyMatch) {
        this.nkeyCache.set(slug, nkeyMatch[1]);
        return nkeyMatch[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Batch geocode unique (city, country) pairs and assign coordinates to cameras.
   * Uses parallel requests with concurrency limit to stay fast.
   * Geocode results are cached 24 hours, so subsequent calls are near-instant.
   *
   * Strategy:
   *   1. Geocode slug-derived city name (e.g., "Roma" from slug)
   *   2. If that fails, try extracting a location from the camera title (e.g., "Trevi Fountain - Rome")
   *   3. If slug has <3 parts (no city), try region name (parts[1])
   */
  private async enrichWithCoordinates(cams: DiscoveredCam[]): Promise<void> {
    // Phase 1: Collect unique (city, country) pairs from slugs
    const cityMap = new Map<string, { city: string; country: string }>();
    for (const cam of cams) {
      const parts = cam.slug.split('/');
      // Try city (parts[2]) first, fallback to region (parts[1])
      const citySlug = parts.length >= 3 ? parts[2] : (parts.length >= 2 ? parts[1] : null);
      if (!citySlug) continue;
      const city = citySlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const key = `${city}:${cam.country}`;
      if (!cityMap.has(key)) {
        cityMap.set(key, { city, country: cam.country });
      }
    }

    // Geocode in parallel batches of 25
    const entries = [...cityMap.entries()];
    const coordResults = new Map<string, { lat: number; lon: number }>();
    const BATCH_SIZE = 25;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async ([key, { city, country }]) => {
          const coords = await geocodeCity(city, country);
          if (coords) coordResults.set(key, coords);
        })
      );
    }

    // Assign coordinates to cameras
    for (const cam of cams) {
      const parts = cam.slug.split('/');
      const citySlug = parts.length >= 3 ? parts[2] : (parts.length >= 2 ? parts[1] : null);
      if (!citySlug) continue;
      const city = citySlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const key = `${city}:${cam.country}`;
      const coords = coordResults.get(key);
      if (coords) {
        cam.latitude = coords.lat;
        cam.longitude = coords.lon;
      }
    }

    // Phase 2: For cameras still missing coords, try extracting location from title
    const missing = cams.filter((c) => c.latitude == null);
    if (missing.length === 0) return;

    const titleMap = new Map<string, { city: string; country: string }>();
    for (const cam of missing) {
      // Title patterns: "City Name - Landmark", "Landmark - City", "Landmark, City"
      const titleCity = this.extractCityFromTitle(cam.title);
      if (titleCity) {
        const key = `title:${titleCity}:${cam.country}`;
        if (!titleMap.has(key)) {
          titleMap.set(key, { city: titleCity, country: cam.country });
        }
      }
    }

    const titleEntries = [...titleMap.entries()];
    const titleCoords = new Map<string, { lat: number; lon: number }>();

    for (let i = 0; i < titleEntries.length; i += BATCH_SIZE) {
      const batch = titleEntries.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async ([key, { city, country }]) => {
          const coords = await geocodeCity(city, country);
          if (coords) titleCoords.set(key, coords);
        })
      );
    }

    for (const cam of missing) {
      const titleCity = this.extractCityFromTitle(cam.title);
      if (!titleCity) continue;
      const key = `title:${titleCity}:${cam.country}`;
      const coords = titleCoords.get(key);
      if (coords) {
        cam.latitude = coords.lat;
        cam.longitude = coords.lon;
      }
    }
  }

  /**
   * Try to extract a city/location name from a camera title.
   * Handles: "Landmark - City", "City - Landmark", "View of City"
   */
  private extractCityFromTitle(title: string): string | null {
    // "Trevi Fountain - Rome" → "Rome"
    // "Tokyo - Shinjuku Kabukicho" → "Tokyo"
    const dashParts = title.split(/\s*[-–—]\s*/);
    if (dashParts.length >= 2) {
      // Return the shorter part (likely the city, not the landmark description)
      const sorted = [...dashParts].sort((a, b) => a.length - b.length);
      return sorted[0].trim();
    }
    return null;
  }

  /**
   * Infer ISO country code from slug path.
   * Slug format: "country/region/city/cam-name"
   */
  private inferCountry(slug: string): string {
    const country = slug.split('/')[0];
    return SLUG_TO_ISO[country] || country.substring(0, 2).toUpperCase();
  }

  private toCameraObj(cam: DiscoveredCam): Camera {
    // Infer city from slug
    const parts = cam.slug.split('/');
    const city = parts.length >= 3
      ? parts[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    // Infer categories from title/slug
    const categories = this.inferCategories(cam.title, cam.slug);

    return {
      id: formatCameraId('skyline', cam.slug),
      source: 'skyline',
      title: cam.title,
      country: cam.country,
      city,
      latitude: cam.latitude,
      longitude: cam.longitude,
      categories,
      status: 'active',
      streamUrl: `https://www.skylinewebcams.com/en/webcam/${cam.slug}.html`,
    };
  }

  private inferCategories(title: string, slug: string): string[] {
    const t = `${title} ${slug}`.toLowerCase();
    const cats: string[] = [];
    if (/beach|playa|spiaggia|praia/.test(t)) cats.push('beach');
    if (/volcano|vulcano|etna|stromboli|crater/.test(t)) cats.push('nature');
    if (/piazza|square|plaza|cathedral|duomo|basilica|church|temple|wall|fountain|arena|bridge|tower|castle|pyramid|pantheon/.test(t)) cats.push('landmark');
    if (/skyline|city|harbour|harbor|port/.test(t)) cats.push('city');
    if (/mountain|ski|snow|alp|cortina|dolomit/.test(t)) cats.push('mountain');
    if (/underwater|reef|diving/.test(t)) cats.push('underwater');
    if (/safari|wildlife|park/.test(t)) cats.push('wildlife');
    if (cats.length === 0) cats.push('other');
    return cats;
  }
}

/** Map SkylineWebcams country slugs to ISO codes */
const SLUG_TO_ISO: Record<string, string> = {
  'italia': 'IT', 'espana': 'ES', 'ellada': 'GR', 'united-states': 'US',
  'united-kingdom': 'GB', 'egypt': 'EG', 'china': 'CN', 'kenya': 'KE',
  'maldives': 'MV', 'israel': 'IL', 'australia': 'AU', 'iceland': 'IS',
  'norge': 'NO', 'jordan': 'JO', 'zanzibar': 'TZ', 'malta': 'MT',
  'portugal': 'PT', 'turkey': 'TR', 'czech-republic': 'CZ', 'brasil': 'BR',
  'mexico': 'MX', 'peru': 'PE', 'south-africa': 'ZA', 'slovenia': 'SI',
  'slovenija': 'SI', 'philippines': 'PH', 'argentina': 'AR', 'chile': 'CL',
  'albania': 'AL', 'seychelles': 'SC', 'venezuela': 'VE',
  'us-virgin-islands': 'VI', 'finland': 'FI', 'united-arab-emirates': 'AE',
  'thailand': 'TH', 'japan': 'JP', 'deutschland': 'DE', 'france': 'FR',
  'nederland': 'NL', 'hrvatska': 'HR', 'schweiz': 'CH', 'osterreich': 'AT',
  'polska': 'PL', 'romania': 'RO', 'srbija': 'RS', 'belgique': 'BE',
  'magyarorszag': 'HU', 'ireland': 'IE', 'danmark': 'DK', 'sverige': 'SE',
  'suomi': 'FI', 'lietuva': 'LT', 'latvija': 'LV', 'eesti': 'EE',
  'cyprus': 'CY', 'india': 'IN', 'indonesia': 'ID', 'malaysia': 'MY',
  'singapore': 'SG', 'south-korea': 'KR', 'taiwan': 'TW', 'vietnam': 'VN',
  'colombia': 'CO', 'ecuador': 'EC', 'costa-rica': 'CR', 'panama': 'PA',
  'jamaica': 'JM', 'dominican-republic': 'DO', 'cuba': 'CU', 'canada': 'CA',
  'new-zealand': 'NZ', 'morocco': 'MA', 'tunisia': 'TN', 'tanzania': 'TZ',
  'madagascar': 'MG', 'mauritius': 'MU', 'cabo-verde': 'CV', 'ghana': 'GH',
  'nigeria': 'NG', 'montenegro': 'ME', 'bosna-i-hercegovina': 'BA',
  'north-macedonia': 'MK', 'bulgaria': 'BG', 'slovakia': 'SK',
  'luxemburg': 'LU', 'monaco': 'MC', 'andorra': 'AD', 'san-marino': 'SM',
  'faroe-islands': 'FO', 'guatemala': 'GT', 'honduras': 'HN',
  'uruguay': 'UY', 'suriname': 'SR', 'curacao': 'CW',
  'citta-del-vaticano': 'VA', 'cayman-islands': 'KY',
  'repubblica-di-san-marino': 'SM', 'sri-lanka': 'LK',
  'hong-kong': 'HK', 'bermuda': 'BM', 'barbados': 'BB',
  'trinidad-and-tobago': 'TT', 'bahamas': 'BS', 'nepal': 'NP',
  'pakistan': 'PK', 'bangladesh': 'BD', 'cambodia': 'KH',
  'myanmar': 'MM', 'laos': 'LA', 'oman': 'OM', 'qatar': 'QA',
  'kuwait': 'KW', 'bahrain': 'BH', 'georgia': 'GE',
  'armenia': 'AM', 'azerbaijan': 'AZ', 'uzbekistan': 'UZ',
  'kazahstan': 'KZ', 'liechtenstein': 'LI',
};
