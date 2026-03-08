import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage } from '../screenshot.js';

interface SkiCam {
  id: string;
  title: string;
  imageUrl: string;
  country: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  categories: Category[];
}

const SKI_CAMS: SkiCam[] = [
  // === Chamonix, France ===
  { id: 'cham-montblanc', title: 'Mont Blanc View, Chamonix', imageUrl: 'https://images.chamonix.net/webcams/tam2vuemontblancHD.jpg', country: 'FR', city: 'Chamonix', latitude: 45.879, longitude: 6.887, categories: ['ski', 'mountain'] },
  { id: 'cham-aiguille', title: 'Aiguille du Midi Summit', imageUrl: 'https://images.chamonix.net/webcams/AiguilleHD.jpg', country: 'FR', city: 'Chamonix', latitude: 45.878, longitude: 6.887, categories: ['ski', 'mountain', 'landmark'] },
  { id: 'cham-merdeglace', title: 'Mer de Glace Glacier', imageUrl: 'https://images.chamonix.net/webcams/CMM1MERDEGLACE.jpg', country: 'FR', city: 'Chamonix', latitude: 45.916, longitude: 6.931, categories: ['ski', 'nature'] },
  { id: 'cham-flegere', title: 'La Flegere, Chamonix', imageUrl: 'https://images.chamonix.net/webcams/FlegereHD.jpg', country: 'FR', city: 'Chamonix', latitude: 45.960, longitude: 6.885, categories: ['ski', 'mountain'] },
  { id: 'cham-bochard', title: 'Grands Montets Bochard Gondola', imageUrl: 'https://images.chamonix.net/webcams/AGM-VueBochardHD.jpg', country: 'FR', city: 'Chamonix', latitude: 45.959, longitude: 6.962, categories: ['ski', 'mountain'] },
  { id: 'cham-brevent', title: 'Brevent Arrival 2000m', imageUrl: 'https://images.chamonix.net/webcams/bvt1A2000HD.jpg', country: 'FR', city: 'Chamonix', latitude: 45.931, longitude: 6.838, categories: ['ski', 'mountain'] },
  { id: 'cham-town', title: 'Chamonix Town Center', imageUrl: 'https://webcams.chamonix.net/resized/chamcentral.jpg', country: 'FR', city: 'Chamonix', latitude: 45.924, longitude: 6.870, categories: ['ski', 'city'] },
  { id: 'cham-emosson', title: 'Emosson Dam, Mont Blanc View', imageUrl: 'https://images.chamonix.net/webcams/emosson_MtBlanc.jpg', country: 'FR', city: 'Chamonix', latitude: 46.068, longitude: 6.918, categories: ['mountain', 'nature'] },

  // === Austrian Alps (Feratel CDN) ===
  { id: 'kitz-hahnenkamm', title: 'Hahnenkamm, Kitzbuhel', imageUrl: 'https://wtvpict.feratel.com/picture/38/5604.jpeg', country: 'AT', city: 'Kitzbuhel', latitude: 47.437, longitude: 12.379, categories: ['ski', 'mountain'] },
  { id: 'kitz-steinberg', title: 'Steinbergkogel, Kitzbuhel', imageUrl: 'https://wtvpict.feratel.com/picture/38/5599.jpeg', country: 'AT', city: 'Kitzbuhel', latitude: 47.437, longitude: 12.379, categories: ['ski', 'mountain'] },
  { id: 'ischgl-idalp', title: 'Idalp, Ischgl', imageUrl: 'https://wtvpict.feratel.com/picture/37/5575.jpeg', country: 'AT', city: 'Ischgl', latitude: 46.972, longitude: 10.293, categories: ['ski', 'mountain'] },
  { id: 'ischgl-pardatsch', title: 'Pardatschgrat, Ischgl', imageUrl: 'https://wtvpict.feratel.com/picture/42/5576.jpeg', country: 'AT', city: 'Ischgl', latitude: 46.972, longitude: 10.293, categories: ['ski', 'mountain'] },
  { id: 'stanton-galzig', title: 'Galzig FlyingCam, St. Anton', imageUrl: 'https://wtvpict.feratel.com/picture/37/75690.jpeg', country: 'AT', city: 'St. Anton', latitude: 47.129, longitude: 10.268, categories: ['ski', 'mountain'] },
  { id: 'stanton-valluga', title: 'Valluga, St. Anton', imageUrl: 'https://wtvpict.feratel.com/picture/42/5690.jpeg', country: 'AT', city: 'St. Anton', latitude: 47.157, longitude: 10.216, categories: ['ski', 'mountain'] },
  { id: 'stanton-rendl', title: 'Rendl, St. Anton', imageUrl: 'https://wtvpict.feratel.com/picture/42/5694.jpeg', country: 'AT', city: 'St. Anton', latitude: 47.116, longitude: 10.250, categories: ['ski', 'mountain'] },
  { id: 'ibk-hungerburg', title: 'Hungerburg, Innsbruck', imageUrl: 'https://wtvpict.feratel.com/picture/42/5646.jpeg', country: 'AT', city: 'Innsbruck', latitude: 47.278, longitude: 11.403, categories: ['ski', 'mountain', 'city'] },
  { id: 'ibk-seegrube', title: 'Seegrube, Innsbruck', imageUrl: 'https://wtvpict.feratel.com/picture/42/5645.jpeg', country: 'AT', city: 'Innsbruck', latitude: 47.305, longitude: 11.383, categories: ['ski', 'mountain'] },
  { id: 'ibk-hafelekar', title: 'Hafelekar, Innsbruck', imageUrl: 'https://wtvpict.feratel.com/picture/42/5647.jpeg', country: 'AT', city: 'Innsbruck', latitude: 47.313, longitude: 11.383, categories: ['ski', 'mountain'] },
  { id: 'lech-fluhen', title: 'Fluhen, Lech', imageUrl: 'https://wtvpict.feratel.com/picture/42/5810.jpeg', country: 'AT', city: 'Lech', latitude: 47.209, longitude: 10.141, categories: ['ski', 'mountain'] },
  { id: 'zurs-trittkopf', title: 'Trittkopf, Zurs', imageUrl: 'https://wtvpict.feratel.com/picture/42/5811.jpeg', country: 'AT', city: 'Zurs', latitude: 47.170, longitude: 10.161, categories: ['ski', 'mountain'] },

  // === Swiss Alps (Roundshot) ===
  { id: 'grind-first', title: 'Grindelwald-First, Jungfrau', imageUrl: 'https://backend.roundshot.com/cams/c7f0edeec13d52b6c3cf91485d982548/oneeighth', country: 'CH', city: 'Grindelwald', latitude: 46.661, longitude: 8.080, categories: ['ski', 'mountain'] },
  { id: 'kleine-scheidegg', title: 'Kleine Scheidegg, Jungfrau', imageUrl: 'https://backend.roundshot.com/cams/527f953c3776c0552355d4a154c2b4e8/oneeighth', country: 'CH', city: 'Interlaken', latitude: 46.585, longitude: 7.961, categories: ['ski', 'mountain'] },
  { id: 'mannlichen', title: 'Mannlichen, Jungfrau', imageUrl: 'https://backend.roundshot.com/cams/877919abdb23eb59f63908ab8b300f1f/oneeighth', country: 'CH', city: 'Interlaken', latitude: 46.612, longitude: 7.939, categories: ['ski', 'mountain'] },
  { id: 'jungfraujoch', title: 'Jungfraujoch Top of Europe', imageUrl: 'https://backend.roundshot.com/cams/584c8f65bd7b360eed6ffd43226cca8a/oneeighth', country: 'CH', city: 'Interlaken', latitude: 46.547, longitude: 7.985, categories: ['ski', 'mountain', 'landmark'] },
  { id: 'harder-kulm', title: 'Harder Kulm, Interlaken', imageUrl: 'https://backend.roundshot.com/cams/8acf8be16f88a36a1646ea3208f4fbea/oneeighth', country: 'CH', city: 'Interlaken', latitude: 46.699, longitude: 7.866, categories: ['ski', 'mountain'] },

  // === Megeve, France ===
  { id: 'megeve-arbois', title: "Mont d'Arbois, Megeve", imageUrl: 'https://www.trinum.com/ibox/ftpcam/mega_arbois.jpg', country: 'FR', city: 'Megeve', latitude: 45.857, longitude: 6.621, categories: ['ski', 'mountain'] },

  // === US Ski Resorts ===
  { id: 'jackson-rendezvous', title: 'Rendezvous Bowl, Jackson Hole', imageUrl: 'https://backend.roundshot.com/cams/6f7dc91857e22fe329e8bdeef5ee5750/oneeighth', country: 'US', city: 'Jackson', region: 'WY', latitude: 43.588, longitude: -110.849, categories: ['ski', 'mountain'] },
  { id: 'jackson-summit', title: 'Summit, Jackson Hole', imageUrl: 'https://backend.roundshot.com/cams/12a4b2c24cd515e0a115d4a0f59ef7f8/oneeighth', country: 'US', city: 'Jackson', region: 'WY', latitude: 43.588, longitude: -110.849, categories: ['ski', 'mountain'] },
];

export class SkiCamsSource extends CameraSource {
  readonly name = 'ski' as const;
  readonly displayName = 'Ski Resort Cameras';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    let results = SKI_CAMS.map((cam) => this.toCameraObj(cam));

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
    const cam = SKI_CAMS.find((c) => c.id === nativeId);
    return cam ? this.toCameraObj(cam) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const cam = SKI_CAMS.find((c) => c.id === nativeId);
    if (!cam) {
      throw new CameraOfflineError(formatCameraId('ski', nativeId));
    }

    try {
      const { buffer, mimeType } = await fetchImage(cam.imageUrl, { timeout: 10000 });
      if (buffer.length < 1000) {
        throw new CameraOfflineError(formatCameraId('ski', nativeId));
      }
      return { buffer, mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' };
    } catch (err) {
      if (err instanceof CameraOfflineError) throw err;
      throw new CameraOfflineError(formatCameraId('ski', nativeId));
    }
  }

  async getCameraCount(): Promise<number> {
    return SKI_CAMS.length;
  }

  async getCountries(): Promise<string[]> {
    return [...new Set(SKI_CAMS.map((c) => c.country))].sort();
  }

  async getCategories(): Promise<Category[]> {
    const cats = new Set<Category>();
    for (const cam of SKI_CAMS) {
      for (const cat of cam.categories) cats.add(cat);
    }
    return [...cats].sort();
  }

  private toCameraObj(cam: SkiCam): Camera {
    return {
      id: formatCameraId('ski', cam.id),
      source: 'ski',
      title: cam.title,
      country: cam.country,
      city: cam.city,
      region: cam.region,
      latitude: cam.latitude,
      longitude: cam.longitude,
      categories: cam.categories,
      status: 'active',
      streamUrl: cam.imageUrl,
    };
  }
}
