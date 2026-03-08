/**
 * Test dynamic YouTube search — no hardcoded IDs.
 */
import { SourceRegistry } from '../src/sources/registry.js';
import { saveToDisk } from '../src/screenshot.js';
import { join } from 'path';

const OUT_DIR = join(import.meta.dirname, '..', 'test-screenshots');

async function main() {
  const registry = new SourceRegistry();

  // Test 1: Search for live webcams in Tokyo
  console.log('=== Search: Tokyo live webcams ===');
  const tokyo = await registry.searchCameras({ source: 'youtube', city: 'Tokyo', limit: 5 });
  for (const cam of tokyo) {
    console.log(`  ${cam.id} — ${cam.title}`);
  }

  // Test 2: Search for wildlife webcams
  console.log('\n=== Search: wildlife webcams ===');
  const wildlife = await registry.searchCameras({ source: 'youtube', category: 'wildlife', limit: 5 });
  for (const cam of wildlife) {
    console.log(`  ${cam.id} — ${cam.title}`);
  }

  // Test 3: Search for beach webcams
  console.log('\n=== Search: beach webcams ===');
  const beach = await registry.searchCameras({ source: 'youtube', category: 'beach', limit: 5 });
  for (const cam of beach) {
    console.log(`  ${cam.id} — ${cam.title}`);
  }

  // Test 4: Capture screenshot from first Tokyo result
  if (tokyo.length > 0) {
    console.log(`\n=== Capturing: ${tokyo[0].title} ===`);
    try {
      const result = await registry.getScreenshot(tokyo[0].id);
      const buf = Buffer.from(result.imageBase64, 'base64');
      const path = join(OUT_DIR, 'dynamic_tokyo.jpg');
      await saveToDisk(buf, path);
      console.log(`  ✓ ${Math.round(buf.length / 1024)} KB → ${path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${msg}`);
    }
  }

  // Test 5: Capture from first wildlife result
  if (wildlife.length > 0) {
    console.log(`\n=== Capturing: ${wildlife[0].title} ===`);
    try {
      const result = await registry.getScreenshot(wildlife[0].id);
      const buf = Buffer.from(result.imageBase64, 'base64');
      const path = join(OUT_DIR, 'dynamic_wildlife.jpg');
      await saveToDisk(buf, path);
      console.log(`  ✓ ${Math.round(buf.length / 1024)} KB → ${path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${msg}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
