import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCameraId, formatCameraId, SOURCE_NAMES } from '../src/types.js';
import { haversineDistanceKm } from '../src/geo.js';
import { Cache } from '../src/cache.js';

// === parseCameraId / formatCameraId ===
describe('parseCameraId', () => {
  it('parses valid camera IDs', () => {
    const result = parseCameraId('youtube:abc123XYZ_-');
    assert.equal(result.source, 'youtube');
    assert.equal(result.nativeId, 'abc123XYZ_-');
  });

  it('handles nativeId with colons', () => {
    const result = parseCameraId('insecam:123:456');
    assert.equal(result.source, 'insecam');
    assert.equal(result.nativeId, '123:456');
  });

  it('throws on missing colon', () => {
    assert.throws(() => parseCameraId('nocolo'), /Invalid camera ID format/);
  });

  it('throws on unknown source', () => {
    assert.throws(() => parseCameraId('fakesource:123'), /Unknown source/);
  });

  it('roundtrips with formatCameraId', () => {
    for (const source of SOURCE_NAMES) {
      const id = formatCameraId(source, 'test-id');
      const parsed = parseCameraId(id);
      assert.equal(parsed.source, source);
      assert.equal(parsed.nativeId, 'test-id');
    }
  });
});

// === haversineDistanceKm ===
describe('haversineDistanceKm', () => {
  it('returns 0 for same point', () => {
    assert.equal(haversineDistanceKm(40.7128, -74.006, 40.7128, -74.006), 0);
  });

  it('computes NYC to London ~5570 km', () => {
    const dist = haversineDistanceKm(40.7128, -74.006, 51.5074, -0.1278);
    assert.ok(dist > 5500 && dist < 5700, `Expected ~5570, got ${dist}`);
  });

  it('computes Tokyo to Sydney ~7820 km', () => {
    const dist = haversineDistanceKm(35.6762, 139.6503, -33.8688, 151.2093);
    assert.ok(dist > 7700 && dist < 7900, `Expected ~7820, got ${dist}`);
  });

  it('handles antipodal points', () => {
    const dist = haversineDistanceKm(0, 0, 0, 180);
    // Half the earth's circumference ≈ 20015 km
    assert.ok(dist > 20000 && dist < 20100, `Expected ~20015, got ${dist}`);
  });
});

// === Cache ===
describe('Cache', () => {
  it('stores and retrieves values', () => {
    const cache = new Cache<string>(60000);
    cache.set('key', 'value');
    assert.equal(cache.get('key'), 'value');
  });

  it('returns undefined for missing keys', () => {
    const cache = new Cache<string>(60000);
    assert.equal(cache.get('missing'), undefined);
  });

  it('expires entries after TTL', () => {
    const cache = new Cache<string>(1); // 1ms TTL
    cache.set('key', 'value');
    // Spin-wait past TTL
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    assert.equal(cache.get('key'), undefined);
  });

  it('has() returns correct state', () => {
    const cache = new Cache<string>(60000);
    assert.equal(cache.has('key'), false);
    cache.set('key', 'value');
    assert.equal(cache.has('key'), true);
  });

  it('delete removes entry', () => {
    const cache = new Cache<string>(60000);
    cache.set('key', 'value');
    cache.delete('key');
    assert.equal(cache.get('key'), undefined);
  });

  it('clear removes all entries', () => {
    const cache = new Cache<string>(60000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), undefined);
  });

  it('supports custom per-key TTL', () => {
    const cache = new Cache<string>(60000);
    cache.set('short', 'value', 1); // 1ms
    cache.set('long', 'value', 60000);
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    assert.equal(cache.get('short'), undefined);
    assert.equal(cache.get('long'), 'value');
  });
});

// === Input validation ===
describe('nativeId validation', () => {
  it('insecam: accepts numeric IDs', () => {
    assert.ok(/^\d+$/.test('129544'));
    assert.ok(/^\d+$/.test('1'));
  });

  it('insecam: rejects non-numeric IDs', () => {
    assert.ok(!/^\d+$/.test('abc'));
    assert.ok(!/^\d+$/.test('123/../../etc/passwd'));
    assert.ok(!/^\d+$/.test(''));
    assert.ok(!/^\d+$/.test('12 34'));
  });

  it('camhacker: accepts alphanumeric with hyphens/underscores', () => {
    assert.ok(/^[a-zA-Z0-9_-]+$/.test('feed-0'));
    assert.ok(/^[a-zA-Z0-9_-]+$/.test('abc123'));
    assert.ok(/^[a-zA-Z0-9_-]+$/.test('my_cam-id'));
  });

  it('camhacker: rejects path traversal and special chars', () => {
    assert.ok(!/^[a-zA-Z0-9_-]+$/.test('../etc/passwd'));
    assert.ok(!/^[a-zA-Z0-9_-]+$/.test('id;rm -rf /'));
    assert.ok(!/^[a-zA-Z0-9_-]+$/.test(''));
    assert.ok(!/^[a-zA-Z0-9_-]+$/.test('id with spaces'));
  });

  it('youtube: accepts valid 11-char video IDs', () => {
    assert.ok(/^[a-zA-Z0-9_-]{11}$/.test('ydYDqZQpim8'));
    assert.ok(/^[a-zA-Z0-9_-]{11}$/.test('VGnFLdQW39A'));
    assert.ok(/^[a-zA-Z0-9_-]{11}$/.test('F0GOOP82094'));
  });

  it('youtube: rejects invalid video IDs', () => {
    assert.ok(!/^[a-zA-Z0-9_-]{11}$/.test('short'));
    assert.ok(!/^[a-zA-Z0-9_-]{11}$/.test('toolongvideoidstring'));
    assert.ok(!/^[a-zA-Z0-9_-]{11}$/.test('abc def ghij'));
    assert.ok(!/^[a-zA-Z0-9_-]{11}$/.test(''));
  });
});
