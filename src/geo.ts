import { execFile } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const R = 6371; // Earth radius in km

export function haversineDistanceKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  city?: string;
  region?: string;
  country?: string;
  method: 'corelocation' | 'windows' | 'ip';
}

/**
 * Try macOS CoreLocation via the bundled .app helper.
 * Returns accurate WiFi-based coordinates (~35m accuracy).
 */
async function detectViaCoreLocation(): Promise<GeoLocation> {
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const appPath = join(srcDir, 'helpers', 'locate.app');
  const tmpFile = join(tmpdir(), `worldcam-location-${Date.now()}.json`);

  return new Promise((resolve, reject) => {
    execFile('open', ['-W', appPath, '--args', tmpFile], { timeout: 15000 }, async (error) => {
      try {
        if (error) {
          reject(new Error(`CoreLocation app failed: ${error.message}`));
          return;
        }
        const raw = await readFile(tmpFile, 'utf-8');
        const data = JSON.parse(raw);
        // Clean up temp file
        unlink(tmpFile).catch(() => {});

        if (data.error) {
          reject(new Error(`CoreLocation error: ${data.error}`));
          return;
        }

        resolve({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
          method: 'corelocation',
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

/**
 * Try Windows Location API via PowerShell (Windows 10+).
 * Uses WiFi/cell/GPS positioning through the WinRT Geolocator.
 */
async function detectViaWindows(): Promise<GeoLocation> {
  const script = `
try {
  [Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
  $gl = New-Object Windows.Devices.Geolocation.Geolocator
  $gl.DesiredAccuracyInMeters = 10
  $task = $gl.GetGeopositionAsync().AsTask()
  if (-not $task.Wait(10000)) {
    Write-Output '{"error":"timeout"}'
    exit 1
  }
  $p = $task.Result.Coordinate
  $lat = $p.Point.Position.Latitude
  $lon = $p.Point.Position.Longitude
  $acc = $p.Accuracy
  Write-Output "{\`"latitude\`":$lat,\`"longitude\`":$lon,\`"accuracy\`":$acc}"
} catch {
  Write-Output "{\`"error\`":\`"$($_.Exception.Message)\`"}"
  exit 1
}
`.trim();

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000 },
      (error, stdout) => {
        try {
          if (error) {
            reject(new Error(`Windows Location failed: ${error.message}`));
            return;
          }
          const data = JSON.parse(String(stdout).trim());
          if (data.error) {
            reject(new Error(`Windows Location error: ${data.error}`));
            return;
          }
          resolve({
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy,
            method: 'windows',
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    );
  });
}

/**
 * Fallback: detect location via IP geolocation.
 * Uses ip-api.com (free, no key required, 45 req/min).
 */
async function detectViaIp(): Promise<GeoLocation> {
  const resp = await fetch('http://ip-api.com/json/?fields=lat,lon,city,regionName,countryCode', {
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    throw new Error(`IP geolocation failed: HTTP ${resp.status}`);
  }

  const data = await resp.json() as {
    lat: number;
    lon: number;
    city: string;
    regionName: string;
    countryCode: string;
  };

  return {
    latitude: data.lat,
    longitude: data.lon,
    city: data.city,
    region: data.regionName,
    country: data.countryCode,
    method: 'ip',
  };
}

/**
 * Detect the current location.
 * On macOS: uses CoreLocation (WiFi-based, ~35m accuracy).
 * On Windows: uses WinRT Geolocator via PowerShell (WiFi/cell/GPS).
 * Fallback: IP geolocation (city-level, may be wrong with VPN).
 */
export async function detectLocation(): Promise<GeoLocation> {
  if (process.platform === 'darwin') {
    try {
      return await detectViaCoreLocation();
    } catch {
      // Fall through to IP
    }
  }
  if (process.platform === 'win32') {
    try {
      return await detectViaWindows();
    } catch {
      // Fall through to IP
    }
  }
  return detectViaIp();
}
