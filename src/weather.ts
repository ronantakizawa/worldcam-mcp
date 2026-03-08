import { Cache } from './cache.js';
import { haversineDistanceKm } from './geo.js';

export interface WeatherContext {
  localTime: string;
  timezone: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  precipitation: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  isDay: boolean;
  condition: string;
  sunrise: string;
  sunset: string;
}

// Cache weather by rounded coords for 15 min
const weatherCache = new Cache<WeatherContext>(15 * 60 * 1000);
// Cache geocode results for 24 hours
const geocodeCache = new Cache<{ lat: number; lon: number } | null>(24 * 60 * 60 * 1000);

/**
 * Fetch current weather for a location using Open-Meteo (free, no API key).
 * Returns null on failure — weather should never block screenshots.
 */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherContext | null> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day`
      + `&daily=sunrise,sunset&forecast_days=1&timezone=auto`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const data = await resp.json() as OpenMeteoResponse;
    const c = data.current;

    const weather: WeatherContext = {
      localTime: c.time,
      timezone: data.timezone,
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precipitation: c.precipitation,
      cloudCover: c.cloud_cover,
      windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      isDay: c.is_day === 1,
      condition: wmoCodeToCondition(c.weather_code),
      sunrise: data.daily.sunrise[0],
      sunset: data.daily.sunset[0],
    };

    weatherCache.set(cacheKey, weather);
    return weather;
  } catch {
    return null;
  }
}

/**
 * Geocode a city name to coordinates using Open-Meteo geocoding API.
 * Uses the country's native language for accurate local name matching (e.g. "Roma" → Rome, Italy).
 * Falls back to English if no country-specific match found.
 * Returns null if not found.
 */
export async function geocodeCity(city: string, country?: string): Promise<{ lat: number; lon: number } | null> {
  const cacheKey = `${city.toLowerCase()}:${(country || '').toLowerCase()}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  try {
    // Use country's language for accurate local name matching
    const lang = country ? (COUNTRY_TO_LANG[country.toUpperCase()] || 'en') : 'en';
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=${lang}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const data = await resp.json() as {
      results?: Array<{ latitude: number; longitude: number; country_code: string; population?: number }>;
    };
    if (!data.results || data.results.length === 0) {
      geocodeCache.set(cacheKey, null);
      return null;
    }

    // Filter by country code, sort by population (largest first)
    let best = data.results[0];
    if (country) {
      const cc = country.toUpperCase();
      const countryMatches = data.results
        .filter((r) => r.country_code === cc)
        .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
      if (countryMatches.length > 0) {
        best = countryMatches[0];
      }
    } else {
      // No country filter — pick largest population
      best = data.results.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
    }

    const result = { lat: best.latitude, lon: best.longitude };
    geocodeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Geocode a place name with proximity bias — pick the result closest to a
 * known reference point (e.g. the parent city center). This solves the problem
 * of neighborhood names like "Shibuya" matching random rural villages instead
 * of the Tokyo ward, by preferring the result nearest the parent city.
 * Returns null if no result is within maxDistanceKm of the reference point.
 */
export async function geocodeCityNear(
  name: string,
  country: string,
  nearLat: number,
  nearLon: number,
  maxDistanceKm = 80,
): Promise<{ lat: number; lon: number } | null> {
  const cacheKey = `near:${name.toLowerCase()}:${country.toLowerCase()}:${nearLat.toFixed(2)},${nearLon.toFixed(2)}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  try {
    const lang = COUNTRY_TO_LANG[country.toUpperCase()] || 'en';
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=${lang}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const data = await resp.json() as {
      results?: Array<{ latitude: number; longitude: number; country_code: string; population?: number }>;
    };
    if (!data.results || data.results.length === 0) {
      geocodeCache.set(cacheKey, null);
      return null;
    }

    // Filter to same country, then pick the result closest to the reference point
    const cc = country.toUpperCase();
    const candidates = data.results
      .filter((r) => r.country_code === cc)
      .map((r) => ({
        lat: r.latitude,
        lon: r.longitude,
        dist: haversineDistanceKm(nearLat, nearLon, r.latitude, r.longitude),
      }))
      .sort((a, b) => a.dist - b.dist);

    if (candidates.length === 0 || candidates[0].dist > maxDistanceKm) {
      geocodeCache.set(cacheKey, null);
      return null;
    }

    const result = { lat: candidates[0].lat, lon: candidates[0].lon };
    geocodeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/** Map ISO country codes to Open-Meteo language codes for accurate geocoding. */
const COUNTRY_TO_LANG: Record<string, string> = {
  IT: 'it', ES: 'es', FR: 'fr', DE: 'de', PT: 'pt', NL: 'nl',
  GR: 'el', JP: 'ja', CN: 'zh', KR: 'ko', RU: 'ru', PL: 'pl',
  CZ: 'cs', HR: 'hr', RO: 'ro', HU: 'hu', SE: 'sv', NO: 'no',
  DK: 'da', FI: 'fi', TR: 'tr', IL: 'he', BR: 'pt', MX: 'es',
  AR: 'es', CL: 'es', CO: 'es', PE: 'es', VE: 'es', EC: 'es',
  AT: 'de', CH: 'de', BE: 'fr', SI: 'sl', SK: 'sk', BG: 'bg',
  RS: 'sr', BA: 'bs', MK: 'mk', AL: 'sq', EE: 'et', LV: 'lv',
  LT: 'lt', IN: 'hi', TH: 'th', VN: 'vi', ID: 'id', MY: 'ms',
  EG: 'ar', MA: 'ar', TN: 'ar', JO: 'ar', AE: 'ar', SA: 'ar',
};

/**
 * Get weather for a camera, geocoding from city if coordinates are missing.
 */
export async function getWeatherForCamera(params: {
  latitude?: number;
  longitude?: number;
  city?: string;
  country?: string;
}): Promise<WeatherContext | null> {
  let lat = params.latitude;
  let lon = params.longitude;

  if (lat == null || lon == null) {
    if (!params.city) return null;
    const coords = await geocodeCity(params.city, params.country);
    if (!coords) return null;
    lat = coords.lat;
    lon = coords.lon;
  }

  return fetchWeather(lat, lon);
}

// --- Open-Meteo response types ---

interface OpenMeteoResponse {
  timezone: string;
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    weather_code: number;
    cloud_cover: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    is_day: number;
  };
  daily: {
    sunrise: string[];
    sunset: string[];
  };
}

/** Convert WMO weather code to human-readable condition string. */
function wmoCodeToCondition(code: number): string {
  const map: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snowfall',
    73: 'Moderate snowfall',
    75: 'Heavy snowfall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return map[code] || `Unknown (${code})`;
}
