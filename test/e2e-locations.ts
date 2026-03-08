/**
 * End-to-end test: detect location, find nearest cameras at multiple
 * locations around the world, capture screenshots, save to disk.
 */
import { SourceRegistry } from '../src/sources/registry.js';
import { detectLocation } from '../src/geo.js';
import { saveToDisk } from '../src/screenshot.js';
import { join } from 'path';

const OUT_DIR = join(import.meta.dirname, '..', 'test-screenshots');

interface TestLocation {
  label: string;
  latitude: number;
  longitude: number;
}

const WORLD_LOCATIONS: TestLocation[] = [
  { label: 'Rome, Italy',       latitude: 41.9028,  longitude: 12.4964  },
  { label: 'Tokyo, Japan',      latitude: 35.6762,  longitude: 139.6503 },
  { label: 'New York, USA',     latitude: 40.7128,  longitude: -74.006  },
  { label: 'Cape Town, SA',     latitude: -33.9249, longitude: 18.4241  },
  { label: 'Chamonix, France',  latitude: 45.9237,  longitude: 6.8694   },
];

async function main() {
  const registry = new SourceRegistry();

  // 1. Detect current location
  console.log('=== Detecting current location via IP ===');
  let myLocation: TestLocation;
  try {
    const geo = await detectLocation();
    myLocation = {
      label: `${geo.city || 'Unknown'}, ${geo.region || ''} (${geo.country || '??'}) [YOUR LOCATION]`,
      latitude: geo.latitude,
      longitude: geo.longitude,
    };
    console.log(`  Detected: ${myLocation.label} (${myLocation.latitude}, ${myLocation.longitude})\n`);
  } catch (err) {
    console.log(`  Failed to detect location: ${err}. Using fallback.\n`);
    myLocation = { label: 'Fallback: San Francisco [YOUR LOCATION]', latitude: 37.7749, longitude: -122.4194 };
  }

  // Put user's location first
  const allLocations = [myLocation, ...WORLD_LOCATIONS];

  // 2. For each location, find nearest cameras and try to screenshot
  const results: Array<{
    location: string;
    cameraId: string;
    cameraTitle: string;
    distanceKm: number;
    savedPath?: string;
    error?: string;
  }> = [];

  for (const loc of allLocations) {
    console.log(`=== ${loc.label} (${loc.latitude}, ${loc.longitude}) ===`);

    try {
      const cameras = await registry.findNearestCameras({
        latitude: loc.latitude,
        longitude: loc.longitude,
        limit: 3,
      });

      if (cameras.length === 0) {
        console.log('  No cameras found near this location.\n');
        results.push({
          location: loc.label,
          cameraId: 'N/A',
          cameraTitle: 'N/A',
          distanceKm: 0,
          error: 'No cameras found',
        });
        continue;
      }

      console.log(`  Found ${cameras.length} nearby cameras:`);
      for (const cam of cameras) {
        console.log(`    - ${cam.title} (${cam.source}) — ${cam.distanceKm} km away`);
      }

      // Try to screenshot the nearest camera
      let captured = false;
      for (const cam of cameras) {
        const safeLabel = loc.label.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        const safeCam = cam.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${safeLabel}__${safeCam}.jpg`;
        const savePath = join(OUT_DIR, filename);

        try {
          console.log(`  Capturing screenshot from: ${cam.title}...`);
          const screenshot = await registry.getScreenshot(cam.id);
          const buf = Buffer.from(screenshot.imageBase64, 'base64');
          await saveToDisk(buf, savePath);
          console.log(`  ✓ Saved to ${savePath} (${Math.round(buf.length / 1024)} KB)\n`);
          results.push({
            location: loc.label,
            cameraId: cam.id,
            cameraTitle: cam.title,
            distanceKm: cam.distanceKm,
            savedPath: savePath,
          });
          captured = true;
          break; // one screenshot per location is enough
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ✗ Failed: ${msg}`);
          // Try next camera
        }
      }

      if (!captured) {
        console.log(`  All cameras failed for ${loc.label}\n`);
        results.push({
          location: loc.label,
          cameraId: cameras[0].id,
          cameraTitle: cameras[0].title,
          distanceKm: cameras[0].distanceKm,
          error: 'All screenshot attempts failed',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Error: ${msg}\n`);
      results.push({
        location: loc.label,
        cameraId: 'N/A',
        cameraTitle: 'N/A',
        distanceKm: 0,
        error: msg,
      });
    }
  }

  // 3. Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`Tested ${allLocations.length} locations\n`);
  for (const r of results) {
    const status = r.savedPath ? '✓' : '✗';
    console.log(`${status} ${r.location}`);
    console.log(`  Camera: ${r.cameraTitle} (${r.cameraId})`);
    console.log(`  Distance: ${r.distanceKm} km`);
    if (r.savedPath) {
      console.log(`  Screenshot: ${r.savedPath}`);
    }
    if (r.error) {
      console.log(`  Error: ${r.error}`);
    }
    console.log();
  }
}

main().catch(console.error);
