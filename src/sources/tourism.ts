import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage } from '../screenshot.js';

interface TourismCam {
  id: string;
  title: string;
  imageUrl: string;
  country: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  categories: Category[];
}

const TOURISM_CAMS: TourismCam[] = [
  // === Dubai, UAE ===
  { id: 'dubai-skyline', title: 'Dubai Skyline / Burj Khalifa', imageUrl: 'https://images.webcamgalore.com/29600-current-webcam-Dubai.jpg', country: 'AE', city: 'Dubai', latitude: 25.197, longitude: 55.274, categories: ['city', 'landmark'] },
  { id: 'dubai-marina', title: 'Dubai Marina', imageUrl: 'https://images.webcamgalore.com/23639-current-webcam-Dubai.jpg', country: 'AE', city: 'Dubai', latitude: 25.080, longitude: 55.141, categories: ['city', 'harbor'] },

  // === Prague, Czech Republic ===
  { id: 'prague-oldtown', title: 'Old Town Square, Prague', imageUrl: 'https://www.oknodosveta.cz/data/webkamery/1000/500/486/webcam-prague-old-town-square_v280.jpg', country: 'CZ', city: 'Prague', latitude: 50.087, longitude: 14.421, categories: ['city', 'landmark'] },

  // === Singapore ===
  { id: 'singapore-cbd', title: 'Singapore CBD Skyline', imageUrl: 'https://images.webcamgalore.com/38289-current-webcam-Singapore.jpg', country: 'SG', city: 'Singapore', latitude: 1.280, longitude: 103.851, categories: ['city'] },

  // === Innsbruck, Austria ===
  { id: 'innsbruck-city', title: 'Innsbruck Cityscape', imageUrl: 'https://wtvpict.feratel.com/picture/37/8000004.jpeg', country: 'AT', city: 'Innsbruck', latitude: 47.260, longitude: 11.395, categories: ['city', 'mountain'] },

  // === Ports & Harbors ===
  { id: 'rotterdam-port', title: 'Rotterdam Port, Amazonehaven', imageUrl: 'https://images.webcamgalore.com/36652-current-webcam-Rotterdam.jpg', country: 'NL', city: 'Rotterdam', latitude: 51.893, longitude: 4.318, categories: ['harbor', 'city'] },
  { id: 'hamburg-port', title: 'Hamburg Port', imageUrl: 'https://images.webcamgalore.com/3674-current-webcam-Hamburg.jpg', country: 'DE', city: 'Hamburg', latitude: 53.543, longitude: 9.967, categories: ['harbor', 'city'] },
  { id: 'hamburg-port-hd', title: 'Hamburg Port (HD)', imageUrl: 'https://images.webcamgalore.com/27268-current-webcam-Hamburg.jpg', country: 'DE', city: 'Hamburg', latitude: 53.543, longitude: 9.967, categories: ['harbor', 'city'] },
  { id: 'barbados-port', title: 'Bridgetown Port, Barbados', imageUrl: 'https://images.webcamgalore.com/35068-current-webcam-Bridgetown.jpg', country: 'BB', city: 'Bridgetown', latitude: 13.095, longitude: -59.613, categories: ['harbor', 'beach'] },
  { id: 'stmaarten-maho', title: 'Maho Beach / Airport, St. Maarten', imageUrl: 'https://images.webcamgalore.com/2726-current-webcam-Philipsburg-Sint-Maarten.jpg', country: 'SX', city: 'Philipsburg', latitude: 18.041, longitude: -63.119, categories: ['beach', 'airport'] },
];

export class TourismSource extends CameraSource {
  readonly name = 'tourism' as const;
  readonly displayName = 'Tourism & City Cameras';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    let results = TOURISM_CAMS.map((cam) => this.toCameraObj(cam));

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
    const cam = TOURISM_CAMS.find((c) => c.id === nativeId);
    return cam ? this.toCameraObj(cam) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const cam = TOURISM_CAMS.find((c) => c.id === nativeId);
    if (!cam) {
      throw new CameraOfflineError(formatCameraId('tourism', nativeId));
    }

    try {
      const { buffer, mimeType } = await fetchImage(cam.imageUrl, { timeout: 10000 });
      if (buffer.length < 1000) {
        throw new CameraOfflineError(formatCameraId('tourism', nativeId));
      }
      return { buffer, mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' };
    } catch (err) {
      if (err instanceof CameraOfflineError) throw err;
      throw new CameraOfflineError(formatCameraId('tourism', nativeId));
    }
  }

  async getCameraCount(): Promise<number> {
    return TOURISM_CAMS.length;
  }

  async getCountries(): Promise<string[]> {
    return [...new Set(TOURISM_CAMS.map((c) => c.country))].sort();
  }

  async getCategories(): Promise<Category[]> {
    const cats = new Set<Category>();
    for (const cam of TOURISM_CAMS) {
      for (const cat of cam.categories) cats.add(cat);
    }
    return [...cats].sort();
  }

  private toCameraObj(cam: TourismCam): Camera {
    return {
      id: formatCameraId('tourism', cam.id),
      source: 'tourism',
      title: cam.title,
      country: cam.country,
      city: cam.city,
      latitude: cam.latitude,
      longitude: cam.longitude,
      categories: cam.categories,
      status: 'active',
      streamUrl: cam.imageUrl,
    };
  }
}
