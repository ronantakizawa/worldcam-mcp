/**
 * Verify fixes: Skyline CDN live stills + YouTube --match-filter is_live
 */
import { SourceRegistry } from '../src/sources/registry.js';
import { saveToDisk } from '../src/screenshot.js';
import { join } from 'path';

const OUT_DIR = join(import.meta.dirname, '..', 'test-screenshots');

async function testCamera(registry: SourceRegistry, label: string, cameraId: string) {
  console.log(`\n=== ${label} (${cameraId}) ===`);
  try {
    const result = await registry.getScreenshot(cameraId);
    const buf = Buffer.from(result.imageBase64, 'base64');
    const safeName = label.replace(/[^a-zA-Z0-9]/g, '_');
    const path = join(OUT_DIR, `fix_${safeName}.jpg`);
    await saveToDisk(buf, path);
    console.log(`  ✓ ${Math.round(buf.length / 1024)} KB → ${path}`);
    return path;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${msg}`);
    return null;
  }
}

async function main() {
  const registry = new SourceRegistry();

  // Test Skyline fix (should return live Trevi Fountain image, not logo)
  await testCamera(registry, 'Skyline_Trevi', 'skyline:trevi-fountain');
  await testCamera(registry, 'Skyline_Venice', 'skyline:venice-st-marks');
  await testCamera(registry, 'Skyline_Colosseum', 'skyline:rome-colosseum');

  // Test YouTube fix (should return actual Tokyo Tower, not random stream)
  await testCamera(registry, 'YouTube_TokyoTower', 'youtube:ydYDqZQpim8');
  await testCamera(registry, 'YouTube_Shinjuku', 'youtube:gFRtAAmiFbE');

  console.log('\nDone.');
}

main().catch(console.error);
