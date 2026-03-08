# worldcam-mcp

An MCP server that gives AI agents access to live camera screenshots from around the world. Aggregates 12 camera sources and returns real base64-encoded images that agents can see and analyze.

## Features

- **Live screenshots** — actual frames captured from live video streams and JPEG snapshots
- **12 data sources** — YouTube, DOT traffic cams, National Parks, ski resorts, tourism cams, Insecam, EarthCam, SkylineWebcams, and more
- **No API keys required** for basic use — 9 sources work out of the box
- **220+ cameras** across 56 countries available without any API keys
- **6 MCP tools** — search, screenshot, random camera, list sources/categories/countries
- **Save to disk** — optionally save screenshots as files

## Prerequisites

- **Node.js 20+** (uses native `fetch`)
- **ffmpeg** — required for YouTube and EarthCam sources (HLS frame capture)
- **yt-dlp** — required for YouTube source (extracts live stream URLs)

```bash
# macOS
brew install ffmpeg yt-dlp

# Ubuntu/Debian
sudo apt install ffmpeg
pip install yt-dlp
```

## Installation

```bash
npm install worldcam-mcp
```

Or clone and build from source:

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

All environment variables are optional. The server works without any API keys using 9 built-in sources.

### Claude Code

```bash
claude mcp add worldcam node /path/to/worldcam-mcp/dist/index.js
```

## Tools

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

### `get_camera_screenshot`

Capture a live screenshot from a specific camera. Returns base64 image.

| Parameter | Type | Description |
|-----------|------|-------------|
| `camera_id` | string | Camera ID from search results (e.g., `youtube:ydYDqZQpim8`) |
| `save_path` | string | Optional file path to save the image |

### `get_random_camera`

Get a screenshot from a random camera, optionally filtered.

| Parameter | Type | Description |
|-----------|------|-------------|
| `country` | string | ISO country code filter |
| `category` | string | Category filter |
| `save_path` | string | Optional save path |

### `list_sources`

List all camera sources and their availability status. No parameters.

### `list_categories`

List all available camera categories. No parameters.

### `list_countries`

List countries with available cameras.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | string | Optional source filter |

## Categories

`beach`, `city`, `traffic`, `mountain`, `wildlife`, `airport`, `harbor`, `ski`, `park`, `landmark`, `weather`, `underwater`, `rural`, `construction`, `nature`, `other`

## Data Sources

| Source | API Key | Cameras | Screenshot Method |
|--------|---------|---------|-------------------|
| YouTube Live | No | 23 | yt-dlp + ffmpeg (live frame) |
| DOT Traffic Cams | No | 23 | Direct JPEG (Caltrans, FL, NY, GA, TfL London) |
| National Parks & USGS | No | 27 | Direct JPEG (Yellowstone, Glacier, Grand Canyon, Kilauea) |
| Ski Resort Cameras | No | 28 | Direct JPEG (Chamonix, Kitzbuhel, Jungfrau, Jackson Hole) |
| Tourism & City Cams | No | 10 | Direct JPEG (Dubai, Prague, Singapore, Rotterdam) |
| Insecam | No | 100+ | Direct IP camera fetch |
| CamHacker | No | varies | MJPEG frame extraction |
| EarthCam | No | 5 | Page scrape + HLS + ffmpeg |
| SkylineWebcams | No | 8 | Page scrape for image/HLS |
| Windy Webcams | Yes | 75,000+ | API image URL |
| OpenWebcamDB | Yes | 1,700+ | YouTube video → yt-dlp + ffmpeg |
| Helios | Yes | 5,000+ | OAuth + direct JPEG endpoint |

## API Keys (Optional)

- **Windy Webcams**: Get a free key at [api.windy.com](https://api.windy.com) → set `WINDY_API_KEY`
- **OpenWebcamDB**: Register at [openwebcamdb.com](https://openwebcamdb.com) → set `OPENWEBCAMDB_API_KEY`
- **Helios**: Register at [helios.earth](https://helios.earth) → set `HELIOS_CLIENT_ID` and `HELIOS_CLIENT_SECRET`

## Example Usage

Ask Claude:

> "Show me a live view of Tokyo right now"

> "Take a screenshot from a random wildlife camera"

> "What does Times Square look like right now?"

> "Search for beach cameras in the US"

## License

MIT
