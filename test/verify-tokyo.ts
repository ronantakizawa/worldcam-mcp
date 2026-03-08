import { SourceRegistry } from '../src/sources/registry.js';
import { saveToDisk } from '../src/screenshot.js';

const r = new SourceRegistry();
const s = await r.getScreenshot('youtube:nu6NE55_X7A');
const buf = Buffer.from(s.imageBase64, 'base64');
await saveToDisk(buf, 'test-screenshots/fix_TokyoTower_NEW.jpg');
console.log('Saved', Math.round(buf.length / 1024), 'KB');
