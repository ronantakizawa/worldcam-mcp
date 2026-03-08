import { SourceRegistry } from '../src/sources/registry.js';
import { saveToDisk } from '../src/screenshot.js';
import { join } from 'path';

const OUT_DIR = join(import.meta.dirname, '..', 'test-screenshots');
const registry = new SourceRegistry();

// Test dynamic discovery
console.log('=== Skyline: search Rome ===');
const rome = await registry.searchCameras({ source: 'skyline', city: 'Roma', limit: 5 });
for (const cam of rome) console.log(`  ${cam.id} — ${cam.title}`);

console.log('\n=== Skyline: search beach ===');
const beach = await registry.searchCameras({ source: 'skyline', category: 'beach', limit: 5 });
for (const cam of beach) console.log(`  ${cam.id} — ${cam.title}`);

// Capture Trevi Fountain
if (rome.length > 0) {
  console.log(`\n=== Capturing: ${rome[0].title} ===`);
  try {
    const result = await registry.getScreenshot(rome[0].id);
    const buf = Buffer.from(result.imageBase64, 'base64');
    const path = join(OUT_DIR, 'dynamic_skyline_rome.jpg');
    await saveToDisk(buf, path);
    console.log(`  ✓ ${Math.round(buf.length / 1024)} KB → ${path}`);
  } catch (err) {
    console.log(`  ✗ ${err instanceof Error ? err.message : err}`);
  }
}

console.log('\nDone.');
