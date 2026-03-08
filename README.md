# worldcam-mcp

An MCP server that gives AI agents access to live camera screenshots from around the world. Aggregates 12 camera sources and returns real base64-encoded images that agents can see and analyze.

## Features

- **3,300+ cameras** dynamically discovered across 90+ countries
- **Live screenshots** with weather context (temperature, conditions, day/night, local time)
- **Zero config** — all dependencies are npm packages, no system installs needed
- **Dynamic discovery** — SkylineWebcams and YouTube cameras are discovered at runtime, never go stale
- **GPS-aware** — find nearest cameras to any coordinate, with 96% geocoded coverage
- **Location detection** — native WiFi-based positioning on macOS and Windows, IP fallback elsewhere
- **8 MCP tools** — search, screenshot, nearest camera, random camera, current location, and more

## Prerequisites

- **Node.js 20+** (uses native `fetch`)

That's it. All other dependencies (ffmpeg, YouTube search) are bundled as npm packages.

## Installation

```bash
git clone https://github.com/ronantakizawa/worldcam-mcp.git
cd worldcam-mcp
npm install
npm run build
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "worldcam": {
      "command": "node",
      "args": ["/path/to/worldcam-mcp/dist/index.js"]
    }
  }
}
```

Optional API keys for additional sources:

```json
{
  "mcpServers": {
    "worldcam": {
      "command": "node",
      "args": ["/path/to/worldcam-mcp/dist/index.js"],
      "env": {
        "WINDY_API_KEY": "your-key-here",
        "OPENWEBCAMDB_API_KEY": "your-key-here",
        "HELIOS_CLIENT_ID": "your-id-here",
        "HELIOS_CLIENT_SECRET": "your-secret-here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add worldcam node /path/to/worldcam-mcp/dist/index.js
```

## Tools

### `get_current_location`

Detect the current geographic location. Uses native WiFi-based positioning on macOS (CoreLocation) and Windows (WinRT Geolocator). Falls back to IP geolocation on other platforms.

### `search_cameras`

Search for live cameras by location, category, or source.

| Parameter | Type | Description |
|-----------|------|-------------|
| `country` | string | ISO 3166-1 alpha-2 code (e.g., "US", "JP") |
| `city` | string | City name |
| `category` | string | Camera category (see below) |
| `source` | string | Data source name |
| `query` | string | Free-text search against titles |
| `limit` | number | Max results (default 10, max 50) |

### `find_nearest_camera`

Find the closest cameras to a GPS coordinate. Searches across all 3,300+ geocoded cameras.

| Parameter | Type | Description |
|-----------|------|-------------|
| `latitude` | number | Target latitude |
| `longitude` | number | Target longitude |
| `category` | string | Optional category filter |
| `source` | string | Optional source filter |
| `limit` | number | Max results (default 5) |

### `get_camera_screenshot`

Capture a live screenshot from a specific camera. Returns base64 image with weather context.

| Parameter | Type | Description |
|-----------|------|-------------|
| `camera_id` | string | Camera ID from search results (e.g., `skyline:japan/kanto/tokyo/shinjuku-kabukicho`) |
| `save_path` | string | Optional file path to save the image |

Response includes weather data when available:

```json
{
  "camera": { "id": "...", "title": "...", "country": "JP", "city": "Tokyo" },
  "capturedAt": "2026-03-08T16:30:00.000Z",
  "weather": {
    "localTime": "2026-03-08T16:30",
    "timezone": "Asia/Tokyo",
    "temperature": 8.9,
    "feelsLike": 6.2,
    "condition": "Clear sky",
    "isDay": true,
    "humidity": 42,
    "windSpeed": 12.3,
    "sunrise": "2026-03-08T06:04",
    "sunset": "2026-03-08T17:42"
  }
}
```

### `get_random_camera`

Get a screenshot from a random camera with weather context. Optionally filtered by country or category.

### `list_sources`

List all camera sources and their availability status.

### `list_categories`

List all available camera categories.

### `list_countries`

List countries with available cameras, optionally filtered by source.

## Categories

`beach`, `city`, `traffic`, `mountain`, `wildlife`, `airport`, `harbor`, `ski`, `park`, `landmark`, `weather`, `underwater`, `rural`, `construction`, `nature`, `other`

## Data Sources

| Source | API Key | Cameras | Screenshot Method |
|--------|---------|---------|-------------------|
| SkylineWebcams | No | 3,300+ | Dynamic discovery, CDN live stills |
| YouTube Live | No | Dynamic | youtube-sr search + ytdl-core + ffmpeg-static |
| DOT Traffic Cams | No | 17 | Direct JPEG (Caltrans, FL, NY, GA, TfL London) |
| National Parks & USGS | No | 30 | Direct JPEG (Yellowstone, Glacier, Kilauea) |
| Ski Resort Cameras | No | 27 | Direct JPEG (Chamonix, Kitzbuhel, Jackson Hole) |
| Tourism & City Cams | No | 9 | Direct JPEG (Dubai, Prague, Singapore) |
| Insecam | No | 100+ | Direct IP camera fetch |
| CamHacker | No | Dynamic | MJPEG frame extraction |
| EarthCam | No | 5 | HLS frame capture via ffmpeg-static |
| Windy Webcams | Yes | 75,000+ | API image URL |
| OpenWebcamDB | Yes | 1,700+ | API + YouTube thumbnail |
| Helios | Yes | 5,000+ | OAuth + direct JPEG endpoint |

## Optional API Keys

- **Windy Webcams**: Free key at [api.windy.com](https://api.windy.com) → `WINDY_API_KEY`
- **OpenWebcamDB**: Register at [openwebcamdb.com](https://openwebcamdb.com) → `OPENWEBCAMDB_API_KEY`
- **Helios**: Register at [helios.earth](https://helios.earth) → `HELIOS_CLIENT_ID` and `HELIOS_CLIENT_SECRET`

## Example Usage

Ask Claude:

> "Show me a live view of Tokyo right now"

> "What's the weather like at the Trevi Fountain?"

> "Find the nearest camera to my location"

> "Take a screenshot from a random beach camera"

> "Search for ski cameras in the Alps"

## License

MIT
