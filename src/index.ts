#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'path';
import { homedir } from 'os';
import { SourceRegistry } from './sources/registry.js';
import { CATEGORIES, SOURCE_NAMES, WorldcamError, type SourceName } from './types.js';
import { saveToDisk } from './screenshot.js';
import { detectLocation } from './geo.js';

function validateSource(source: string | undefined): SourceName | undefined {
  if (!source) return undefined;
  if (SOURCE_NAMES.includes(source as SourceName)) return source as SourceName;
  throw new WorldcamError(`Unknown source: "${source}". Valid sources: ${SOURCE_NAMES.join(', ')}`, 'INVALID_SOURCE');
}

/** Sanitize save_path to prevent path traversal. Only allows writing under cwd or home. */
function validateSavePath(savePath: string): string {
  const resolved = resolve(savePath);
  const cwd = process.cwd();
  const home = homedir();
  if (!resolved.startsWith(cwd) && !resolved.startsWith(home)) {
    throw new WorldcamError(
      `save_path must be under the current directory or home directory. Got: ${resolved}`,
      'INVALID_PATH'
    );
  }
  return resolved;
}

const registry = new SourceRegistry();
registry.warmup(); // Pre-warm Skyline cache in background before any tool calls

const server = new McpServer({
  name: 'worldcam-mcp',
  version: '1.0.0',
});

// === Tool: get_current_location ===
server.tool(
  'get_current_location',
  'Detect the current geographic location. On macOS uses CoreLocation (WiFi-based, ~35m accuracy). Falls back to IP geolocation on other platforms. Use the returned coordinates with find_nearest_camera.',
  {},
  async () => {
    try {
      const location = await detectLocation();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(location, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error detecting location: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// === Tool: search_cameras ===
server.tool(
  'search_cameras',
  'Search for live cameras around the world by location, category, or source. Returns a list of cameras with metadata (no screenshots).',
  {
    country: z.string().max(5).optional().describe('ISO 3166-1 alpha-2 country code (e.g., "US", "JP", "FR")'),
    city: z.string().optional().describe('City name to filter by'),
    category: z.string().optional().describe(`Camera category: ${CATEGORIES.join(', ')}`),
    source: z.string().optional().describe(`Data source: ${SOURCE_NAMES.join(', ')}`),
    query: z.string().optional().describe('Free-text search against camera titles'),
    limit: z.number().min(1).max(50).default(10).describe('Max results (default 10)'),
  },
  async (args) => {
    try {
      const cameras = await registry.searchCameras({
        country: args.country,
        city: args.city,
        category: args.category,
        source: validateSource(args.source),
        query: args.query,
        limit: args.limit,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                count: cameras.length,
                cameras: cameras.map((c) => ({
                  id: c.id,
                  title: c.title,
                  country: c.country,
                  city: c.city,
                  categories: c.categories,
                  source: c.source,
                  status: c.status,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// === Tool: find_nearest_camera ===
server.tool(
  'find_nearest_camera',
  'Find the closest live cameras to a GPS coordinate. Returns cameras sorted by distance. Only cameras with known coordinates are included.',
  {
    latitude: z.number().min(-90).max(90).describe('Latitude of the target location'),
    longitude: z.number().min(-180).max(180).describe('Longitude of the target location'),
    category: z.string().optional().describe(`Category filter: ${CATEGORIES.join(', ')}`),
    source: z.string().optional().describe(`Source filter: ${SOURCE_NAMES.join(', ')}`),
    limit: z.number().min(1).max(50).default(5).describe('Max results (default 5)'),
  },
  async (args) => {
    try {
      const cameras = await registry.findNearestCameras({
        latitude: args.latitude,
        longitude: args.longitude,
        category: args.category,
        source: validateSource(args.source),
        limit: args.limit,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                count: cameras.length,
                cameras: cameras.map((c) => ({
                  id: c.id,
                  title: c.title,
                  country: c.country,
                  city: c.city,
                  categories: c.categories,
                  source: c.source,
                  distanceKm: c.distanceKm,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// === Tool: get_camera_screenshot ===
server.tool(
  'get_camera_screenshot',
  'Capture a live screenshot from a specific camera. Returns the image as base64 with weather context (temperature, conditions, day/night, local time). Use search_cameras first to find camera IDs.',
  {
    camera_id: z.string().describe('Camera ID in format "source:nativeId" (e.g., "youtube:1-iS7LArMPA", "windy:1179853135")'),
    save_path: z.string().optional().describe('Optional file path to save the screenshot to disk'),
  },
  async (args) => {
    try {
      const result = await registry.getScreenshot(args.camera_id);

      if (args.save_path) {
        const safePath = validateSavePath(args.save_path);
        result.savedPath = await saveToDisk(
          Buffer.from(result.imageBase64, 'base64'),
          safePath
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                camera: {
                  id: result.camera.id,
                  title: result.camera.title,
                  country: result.camera.country,
                  city: result.camera.city,
                  source: result.camera.source,
                },
                capturedAt: result.capturedAt.toISOString(),
                mimeType: result.mimeType,
                ...(result.weather ? { weather: result.weather } : {}),
                ...(result.savedPath ? { savedTo: result.savedPath } : {}),
              },
              null,
              2
            ),
          },
          {
            type: 'image' as const,
            data: result.imageBase64,
            mimeType: result.mimeType,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// === Tool: get_random_camera ===
server.tool(
  'get_random_camera',
  'Get a live screenshot from a random camera with weather context. Optionally filter by country or category.',
  {
    country: z.string().max(5).optional().describe('ISO country code to filter'),
    category: z.string().optional().describe(`Category filter: ${CATEGORIES.join(', ')}`),
    save_path: z.string().optional().describe('Optional path to save screenshot'),
  },
  async (args) => {
    try {
      const result = await registry.getRandomCamera({
        country: args.country,
        category: args.category,
      });

      if (args.save_path) {
        const safePath = validateSavePath(args.save_path);
        result.savedPath = await saveToDisk(
          Buffer.from(result.imageBase64, 'base64'),
          safePath
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                camera: {
                  id: result.camera.id,
                  title: result.camera.title,
                  country: result.camera.country,
                  city: result.camera.city,
                  source: result.camera.source,
                },
                capturedAt: result.capturedAt.toISOString(),
                mimeType: result.mimeType,
                ...(result.weather ? { weather: result.weather } : {}),
                ...(result.savedPath ? { savedTo: result.savedPath } : {}),
              },
              null,
              2
            ),
          },
          {
            type: 'image' as const,
            data: result.imageBase64,
            mimeType: result.mimeType,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// === Tool: list_sources ===
server.tool(
  'list_sources',
  'List all camera data sources and their availability status.',
  {},
  async () => {
    try {
      const statuses = await registry.getSourceStatuses();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(statuses, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// === Tool: list_categories ===
server.tool(
  'list_categories',
  'List all available camera categories.',
  {},
  async () => {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(CATEGORIES, null, 2),
        },
      ],
    };
  }
);

// === Tool: list_countries ===
server.tool(
  'list_countries',
  'List all countries with available cameras.',
  {
    source: z.string().optional().describe(`Filter countries to a specific source: ${SOURCE_NAMES.join(', ')}`),
  },
  async (args) => {
    try {
      let countries: string[];
      if (args.source) {
        const source = registry.getSource(args.source as any);
        countries = await source.getCountries();
      } else {
        countries = await registry.getAllCountries();
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(countries.sort(), null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
