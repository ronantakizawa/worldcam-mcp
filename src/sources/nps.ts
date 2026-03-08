import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage } from '../screenshot.js';

interface NpsCam {
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

const NPS_CAMS: NpsCam[] = [
  // === Yellowstone National Park ===
  { id: 'yell-mammoth-arch', title: 'Mammoth Hot Springs Arch, Yellowstone', imageUrl: 'https://www.nps.gov/webcams-yell/mammoth_arch.jpg', country: 'US', region: 'WY', latitude: 44.977, longitude: -110.696, categories: ['park', 'nature'] },
  { id: 'yell-electric-peak', title: 'Electric Peak, Yellowstone', imageUrl: 'https://www.nps.gov/webcams-yell/mammoth_electric.jpg', country: 'US', region: 'WY', latitude: 45.000, longitude: -110.793, categories: ['park', 'nature', 'mountain'] },
  { id: 'yell-washburn-ne', title: 'Mt. Washburn NE, Yellowstone', imageUrl: 'https://www.nps.gov/webcams-yell/washburn_ne.jpg', country: 'US', region: 'WY', latitude: 44.798, longitude: -110.434, categories: ['park', 'nature', 'mountain'] },
  { id: 'yell-west-gate', title: 'West Entrance, Yellowstone', imageUrl: 'https://www.nps.gov/webcams-yell/west_gate.jpg', country: 'US', region: 'WY', latitude: 44.657, longitude: -111.094, categories: ['park'] },
  { id: 'yell-east-out', title: 'East Entrance, Yellowstone', imageUrl: 'https://www.nps.gov/webcams-yell/east_out.jpg', country: 'US', region: 'WY', latitude: 44.490, longitude: -109.995, categories: ['park'] },

  // === Glacier National Park ===
  { id: 'glac-apgar-lookout', title: 'Apgar Mountain Lookout, Glacier NP', imageUrl: 'https://www.nps.gov/webcams-glac/ApgarLookout-01.jpg', country: 'US', region: 'MT', latitude: 48.527, longitude: -113.990, categories: ['park', 'nature', 'mountain'] },
  { id: 'glac-lake-mcdonald', title: 'Lake McDonald, Glacier NP', imageUrl: 'https://www.nps.gov/webcams-glac/LakeMcDonald1.jpg', country: 'US', region: 'MT', latitude: 48.555, longitude: -113.916, categories: ['park', 'nature'] },
  { id: 'glac-west-entrance', title: 'West Entrance, Glacier NP', imageUrl: 'https://www.nps.gov/webcams-glac/WestEntrance.jpg', country: 'US', region: 'MT', latitude: 48.497, longitude: -114.015, categories: ['park'] },
  { id: 'glac-st-mary', title: 'St. Mary Visitor Center, Glacier NP', imageUrl: 'https://www.nps.gov/webcams-glac/StMaryPTZ.jpg', country: 'US', region: 'MT', latitude: 48.748, longitude: -113.435, categories: ['park', 'nature'] },
  { id: 'glac-logan-pass', title: 'Logan Pass Parking, Glacier NP', imageUrl: 'https://glacier.org/webcam/lpp_nps.jpg', country: 'US', region: 'MT', latitude: 48.696, longitude: -113.718, categories: ['park', 'mountain'] },
  { id: 'glac-many-glacier', title: 'Many Glacier, Swiftcurrent Lake', imageUrl: 'https://glacier.org/webcam/mg_nps.jpg', country: 'US', region: 'MT', latitude: 48.797, longitude: -113.655, categories: ['park', 'nature'] },

  // === Grand Canyon National Park ===
  { id: 'grca-yavapai', title: 'Yavapai Point, Grand Canyon', imageUrl: 'https://www.nps.gov/featurecontent/ard/webcams/images/grcalarge.jpg', country: 'US', region: 'AZ', latitude: 36.066, longitude: -112.117, categories: ['park', 'nature', 'landmark'] },
  { id: 'grca-south-entrance', title: 'South Entrance, Grand Canyon', imageUrl: 'https://www.nps.gov/webcams-grca/camera.jpg', country: 'US', region: 'AZ', latitude: 36.023, longitude: -112.121, categories: ['park'] },
  { id: 'grca-kolb', title: 'Kolb Studio View, Grand Canyon', imageUrl: 'https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/grandcanyon-2/latest.jpg', country: 'US', region: 'AZ', latitude: 36.058, longitude: -112.143, categories: ['park', 'nature', 'landmark'] },
  { id: 'grca-bright-angel', title: 'Bright Angel Trailhead, Grand Canyon', imageUrl: 'https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/grandcanyon-1/latest.jpg', country: 'US', region: 'AZ', latitude: 36.058, longitude: -112.144, categories: ['park', 'nature'] },

  // === Mt. Rainier National Park ===
  { id: 'mora-mountain', title: 'Mt. Rainier from Paradise', imageUrl: 'https://www.nps.gov/webcams-mora/mountain.jpg', country: 'US', region: 'WA', latitude: 46.786, longitude: -121.735, categories: ['park', 'nature', 'mountain'] },
  { id: 'mora-tatoosh', title: 'Tatoosh Range, Mt. Rainier', imageUrl: 'https://www.nps.gov/webcams-mora/tatoosh.jpg', country: 'US', region: 'WA', latitude: 46.786, longitude: -121.735, categories: ['park', 'nature', 'mountain'] },
  { id: 'mora-longmire', title: 'Longmire, Mt. Rainier', imageUrl: 'https://www.nps.gov/webcams-mora/longmire.jpg', country: 'US', region: 'WA', latitude: 46.750, longitude: -121.812, categories: ['park', 'nature'] },

  // === Olympic National Park ===
  { id: 'olym-hurricane', title: 'Hurricane Ridge, Olympic NP', imageUrl: 'https://www.nps.gov/webcams-olym/southcam.jpg', country: 'US', region: 'WA', latitude: 47.969, longitude: -123.499, categories: ['park', 'nature', 'mountain'] },

  // === Great Smoky Mountains ===
  { id: 'grsm-kuwohi', title: 'Kuwohi (Clingmans Dome), Smokies', imageUrl: 'https://www.nps.gov/featurecontent/ard/webcams/images/grcdlarge.jpg', country: 'US', region: 'TN', latitude: 35.563, longitude: -83.498, categories: ['park', 'nature', 'mountain'] },
  { id: 'grsm-look-rock', title: 'Look Rock, Great Smokies', imageUrl: 'https://www.nps.gov/featurecontent/ard/webcams/images/grsmlarge.jpg', country: 'US', region: 'TN', latitude: 35.633, longitude: -83.942, categories: ['park', 'nature'] },

  // === Yosemite National Park ===
  { id: 'yose-turtleback', title: 'Turtleback Dome, Yosemite', imageUrl: 'https://www.nps.gov/featurecontent/ard/webcams/images/yoselarge.jpg', country: 'US', region: 'CA', latitude: 37.717, longitude: -119.665, categories: ['park', 'nature'] },

  // === USGS Volcano Cams — Kilauea ===
  { id: 'usgs-kilauea-v1', title: 'Kilauea West Crater, Hawaii', imageUrl: 'https://volcanoes.usgs.gov/observatories/hvo/cams/V1cam/images/M.jpg', country: 'US', city: 'Hawaii', region: 'HI', latitude: 19.421, longitude: -155.287, categories: ['nature', 'landmark'] },
  { id: 'usgs-kilauea-kw', title: 'Kilauea from West Rim, Hawaii', imageUrl: 'https://volcanoes.usgs.gov/observatories/hvo/cams/KWcam/images/M.jpg', country: 'US', city: 'Hawaii', region: 'HI', latitude: 19.421, longitude: -155.291, categories: ['nature', 'landmark'] },
  { id: 'usgs-kilauea-k2', title: 'Kilauea Caldera, Uekahuna Bluff', imageUrl: 'https://volcanoes.usgs.gov/observatories/hvo/cams/K2cam/images/M.jpg', country: 'US', city: 'Hawaii', region: 'HI', latitude: 19.426, longitude: -155.291, categories: ['nature', 'landmark'] },

  // === USGS Mauna Loa ===
  { id: 'usgs-maunaloa', title: 'Mauna Loa Caldera, Hawaii', imageUrl: 'https://volcanoes.usgs.gov/observatories/hvo/cams/MLcam/images/M.jpg', country: 'US', city: 'Hawaii', region: 'HI', latitude: 19.475, longitude: -155.608, categories: ['nature', 'mountain'] },

  // === USGS Mt. St. Helens ===
  { id: 'usgs-st-helens', title: 'Mt. St. Helens, Johnston Ridge', imageUrl: 'https://volcanoes.usgs.gov/vsc/captures/st_helens/jro-webcam.jpg', country: 'US', region: 'WA', latitude: 46.275, longitude: -122.218, categories: ['nature', 'mountain'] },
];

export class NpsSource extends CameraSource {
  readonly name = 'nps' as const;
  readonly displayName = 'National Parks & USGS';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    let results = NPS_CAMS.map((cam) => this.toCameraObj(cam));

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
      results = results.filter((c) => c.title.toLowerCase().includes(q) || c.region?.toLowerCase().includes(q));
    }

    const limit = filters.limit ?? 10;
    return results.slice(0, limit);
  }

  async getCamera(nativeId: string): Promise<Camera | null> {
    const cam = NPS_CAMS.find((c) => c.id === nativeId);
    return cam ? this.toCameraObj(cam) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const cam = NPS_CAMS.find((c) => c.id === nativeId);
    if (!cam) {
      throw new CameraOfflineError(formatCameraId('nps', nativeId));
    }

    try {
      const { buffer, mimeType } = await fetchImage(cam.imageUrl, { timeout: 10000 });
      if (buffer.length < 1000) {
        throw new CameraOfflineError(formatCameraId('nps', nativeId));
      }
      return { buffer, mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' };
    } catch (err) {
      if (err instanceof CameraOfflineError) throw err;
      throw new CameraOfflineError(formatCameraId('nps', nativeId));
    }
  }

  async getCameraCount(): Promise<number> {
    return NPS_CAMS.length;
  }

  async getCountries(): Promise<string[]> {
    return ['US'];
  }

  async getCategories(): Promise<Category[]> {
    const cats = new Set<Category>();
    for (const cam of NPS_CAMS) {
      for (const cat of cam.categories) cats.add(cat);
    }
    return [...cats].sort();
  }

  private toCameraObj(cam: NpsCam): Camera {
    return {
      id: formatCameraId('nps', cam.id),
      source: 'nps',
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
