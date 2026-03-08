import { detectLocation } from '../src/geo.js';
import { SourceRegistry } from '../src/sources/registry.js';

const registry = new SourceRegistry();

console.log('=== Detecting location ===');
const loc = await detectLocation();
console.log(`  ${loc.method}: ${loc.latitude}, ${loc.longitude} (accuracy: ${loc.accuracy ?? 'n/a'}m)`);
if (loc.city) console.log(`  ${loc.city}, ${loc.region}, ${loc.country}`);

console.log('\n=== Finding nearest cameras ===');
const nearest = await registry.findNearestCameras({
  latitude: loc.latitude,
  longitude: loc.longitude,
  limit: 5,
});

for (const cam of nearest) {
  console.log(`  ${cam.distanceKm} km — ${cam.title} (${cam.city}, ${cam.country}) [${cam.source}]`);
}

if (nearest.length > 0) {
  console.log(`\n=== Capturing: ${nearest[0].title} ===`);
  try {
    const result = await registry.getScreenshot(nearest[0].id);
    const kb = Math.round(Buffer.from(result.imageBase64, 'base64').length / 1024);
    console.log(`  ${kb} KB image captured`);
    if (result.weather) {
      console.log(`  Local time: ${result.weather.localTime} (${result.weather.timezone})`);
      console.log(`  ${result.weather.temperature}°C — ${result.weather.condition} (${result.weather.isDay ? 'Day' : 'Night'})`);
    }
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : err}`);
  }
}

console.log('\nDone.');
