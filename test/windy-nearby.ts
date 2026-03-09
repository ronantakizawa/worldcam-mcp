import { SourceRegistry } from '../src/sources/registry.js';

const registry = new SourceRegistry();

// Test: does Windy's searchCameras return cameras with coordinates?
const cams = await registry.searchCameras({ source: 'windy', limit: 10 });
console.log('Windy search results:', cams.length);
for (const c of cams) {
  console.log(`  ${c.title} coords: ${c.latitude},${c.longitude} country: ${c.country}`);
}

// Now test searching near a gap city
console.log('\nSearching Windy for Nigeria...');
const ng = await registry.searchCameras({ source: 'windy', country: 'NG', limit: 5 });
console.log('Nigeria results:', ng.length);
for (const c of ng) {
  console.log(`  ${c.title} (${c.city}) coords: ${c.latitude},${c.longitude}`);
}

console.log('\nSearching Windy for India...');
const india = await registry.searchCameras({ source: 'windy', country: 'IN', limit: 5 });
console.log('India results:', india.length);
for (const c of india) {
  console.log(`  ${c.title} (${c.city}) coords: ${c.latitude},${c.longitude}`);
}

console.log('\nSearching Windy for Iran...');
const iran = await registry.searchCameras({ source: 'windy', country: 'IR', limit: 5 });
console.log('Iran results:', iran.length);
for (const c of iran) {
  console.log(`  ${c.title} (${c.city}) coords: ${c.latitude},${c.longitude}`);
}
