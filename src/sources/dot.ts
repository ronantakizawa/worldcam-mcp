import { CameraSource } from './base.js';
import type { Camera, Category, SearchFilters } from '../types.js';
import { formatCameraId, CameraOfflineError } from '../types.js';
import { fetchImage } from '../screenshot.js';

interface DotCam {
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

// Curated list of verified working DOT traffic cameras (JPEG snapshot URLs)
const DOT_CAMS: DotCam[] = [
  // === Caltrans (California) ===
  { id: 'ca-i5-la', title: 'I-5 South of I-10, Los Angeles', imageUrl: 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i517southofi10/i517southofi10.jpg', country: 'US', city: 'Los Angeles', region: 'CA', latitude: 34.044, longitude: -118.235, categories: ['traffic'] },
  { id: 'ca-i280-sf', title: 'I-280 at US-101, San Francisco', imageUrl: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv322i280us101/tv322i280us101.jpg', country: 'US', city: 'San Francisco', region: 'CA', latitude: 37.778, longitude: -122.404, categories: ['traffic'] },
  { id: 'ca-hwy5-sac', title: 'Hwy 5 at Pocket, Sacramento', imageUrl: 'https://cwwp2.dot.ca.gov/data/d3/cctv/image/hwy5atpocket/hwy5atpocket.jpg', country: 'US', city: 'Sacramento', region: 'CA', latitude: 38.522, longitude: -121.519, categories: ['traffic'] },

  // === FDOT (Florida) ===
  { id: 'fl-i95-miami', title: 'I-95 NB at NW 125 St, Miami', imageUrl: 'https://fl511.com/map/Cctv/500', country: 'US', city: 'Miami', region: 'FL', latitude: 25.887, longitude: -80.206, categories: ['traffic'] },
  { id: 'fl-50', title: 'Florida Traffic Cam #50', imageUrl: 'https://fl511.com/map/Cctv/50', country: 'US', region: 'FL', latitude: 27.951, longitude: -82.459, categories: ['traffic'] },
  { id: 'fl-100', title: 'Florida Traffic Cam #100', imageUrl: 'https://fl511.com/map/Cctv/100', country: 'US', region: 'FL', latitude: 28.538, longitude: -81.379, categories: ['traffic'] },
  { id: 'fl-2000', title: 'Florida Traffic Cam #2000', imageUrl: 'https://fl511.com/map/Cctv/2000', country: 'US', region: 'FL', latitude: 26.122, longitude: -80.137, categories: ['traffic'] },

  // === NYSDOT (New York) ===
  { id: 'ny-4', title: 'NY 17 at Exit 126, Orange County', imageUrl: 'https://511ny.org/map/Cctv/4', country: 'US', city: 'Orange County', region: 'NY', latitude: 41.350, longitude: -74.363, categories: ['traffic'] },
  { id: 'ny-4435', title: 'NY 33 at Northampton St, Buffalo', imageUrl: 'https://511ny.org/map/Cctv/4435', country: 'US', city: 'Buffalo', region: 'NY', latitude: 42.886, longitude: -78.878, categories: ['traffic'] },

  // === GDOT (Georgia) ===
  { id: 'ga-100', title: 'SR 42/Moreland Ave, Atlanta', imageUrl: 'https://511ga.org/map/Cctv/100', country: 'US', city: 'Atlanta', region: 'GA', latitude: 33.749, longitude: -84.350, categories: ['traffic'] },
  { id: 'ga-300', title: 'Georgia Traffic Cam #300', imageUrl: 'https://511ga.org/map/Cctv/300', country: 'US', region: 'GA', latitude: 33.774, longitude: -84.393, categories: ['traffic'] },

  // === ADOT (Arizona) ===
  { id: 'az-200', title: 'I-10 Mini Stack South, Phoenix', imageUrl: 'https://az511.gov/map/Cctv/200', country: 'US', city: 'Phoenix', region: 'AZ', latitude: 33.436, longitude: -112.024, categories: ['traffic'] },
  { id: 'az-300', title: 'Arizona Traffic Cam #300', imageUrl: 'https://az511.gov/map/Cctv/300', country: 'US', region: 'AZ', latitude: 33.448, longitude: -112.074, categories: ['traffic'] },

  // === ODOT (Oregon) ===
  { id: 'or-astoria', title: 'US101 Megler Bridge, Astoria', imageUrl: 'https://tripcheck.com/RoadCams/cams/AstoriaUS101MeglerBrNB_pid392.jpg', country: 'US', city: 'Astoria', region: 'OR', latitude: 46.188, longitude: -123.831, categories: ['traffic'] },
  { id: 'or-217', title: 'OR 217 at Allen, Portland', imageUrl: 'https://tripcheck.com/RoadCams/cams/217allen_pid404.jpg', country: 'US', city: 'Portland', region: 'OR', latitude: 45.456, longitude: -122.787, categories: ['traffic'] },

  // === LADOTD (Louisiana) ===
  { id: 'la-400', title: 'I-12 at US 190 North', imageUrl: 'https://511la.org/map/Cctv/400', country: 'US', region: 'LA', latitude: 30.451, longitude: -91.188, categories: ['traffic'] },
  { id: 'la-500', title: 'I-210 at Nelson Rd', imageUrl: 'https://511la.org/map/Cctv/500', country: 'US', region: 'LA', latitude: 30.207, longitude: -93.281, categories: ['traffic'] },

  // === NDOT (Nevada) ===
  { id: 'nv-100', title: 'I-15 at St. Rose, Las Vegas', imageUrl: 'https://nvroads.com/map/Cctv/100', country: 'US', city: 'Las Vegas', region: 'NV', latitude: 36.009, longitude: -115.133, categories: ['traffic'] },

  // === Transport for London JamCams ===
  { id: 'tfl-piccadilly', title: 'Piccadilly Circus, London', imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07450.jpg', country: 'GB', city: 'London', latitude: 51.510, longitude: -0.135, categories: ['traffic', 'city'] },
  { id: 'tfl-oxford', title: 'Oxford St / Orchard St, London', imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.08858.jpg', country: 'GB', city: 'London', latitude: 51.514, longitude: -0.153, categories: ['traffic', 'city'] },
  { id: 'tfl-cromwell', title: 'Cromwell Rd / Earls Court, London', imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06600.jpg', country: 'GB', city: 'London', latitude: 51.493, longitude: -0.191, categories: ['traffic', 'city'] },
  { id: 'tfl-horseferry', title: 'Horseferry Rd / Marsham St, London', imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.04235.jpg', country: 'GB', city: 'London', latitude: 51.494, longitude: -0.129, categories: ['traffic', 'city'] },

  // === Ontario 511 (Canada) ===
  { id: 'on-100', title: 'NR-23 Burks Falls Northbound, Ontario', imageUrl: 'https://511on.ca/map/Cctv/100', country: 'CA', region: 'ON', latitude: 45.618, longitude: -79.404, categories: ['traffic'] },
];

// 511 platform placeholder PNGs are exactly 15,136 bytes
const PLACEHOLDER_SIZE = 15136;

export class DotSource extends CameraSource {
  readonly name = 'dot' as const;
  readonly displayName = 'DOT Traffic Cameras';
  readonly requiresApiKey = false;
  readonly requiresFfmpeg = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async searchCameras(filters: SearchFilters): Promise<Camera[]> {
    let results = DOT_CAMS.map((cam) => this.toCameraObj(cam));

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
    const cam = DOT_CAMS.find((c) => c.id === nativeId);
    return cam ? this.toCameraObj(cam) : null;
  }

  async captureScreenshot(nativeId: string): Promise<{
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> {
    const cam = DOT_CAMS.find((c) => c.id === nativeId);
    if (!cam) {
      throw new CameraOfflineError(formatCameraId('dot', nativeId));
    }

    try {
      const { buffer, mimeType } = await fetchImage(cam.imageUrl, { timeout: 10000 });
      // Filter out 511 platform "no feed" placeholder (exactly 15,136 bytes)
      if (buffer.length === 0 || buffer.length === PLACEHOLDER_SIZE) {
        throw new CameraOfflineError(formatCameraId('dot', nativeId));
      }
      return { buffer, mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' };
    } catch (err) {
      if (err instanceof CameraOfflineError) throw err;
      throw new CameraOfflineError(formatCameraId('dot', nativeId));
    }
  }

  async getCameraCount(): Promise<number> {
    return DOT_CAMS.length;
  }

  async getCountries(): Promise<string[]> {
    return [...new Set(DOT_CAMS.map((c) => c.country))].sort();
  }

  async getCategories(): Promise<Category[]> {
    const cats = new Set<Category>();
    for (const cam of DOT_CAMS) {
      for (const cat of cam.categories) cats.add(cat);
    }
    return [...cats].sort();
  }

  private toCameraObj(cam: DotCam): Camera {
    return {
      id: formatCameraId('dot', cam.id),
      source: 'dot',
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
