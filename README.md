# Scrape.do MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives
AI assistants the ability to scrape any public web page through
[Scrape.do](https://scrape.do) — with automatic anti-bot bypass (Cloudflare, DataDome,
Akamai, PerimeterX), rotating datacenter / residential / mobile proxies, CAPTCHA solving,
JavaScript rendering, and geo-targeting.

Transport: **Streamable HTTP** (stateless). Endpoint: `POST /mcp`.

## Tool

### `scrape`
Fetch the live contents of a URL.

| Parameter     | Type                              | Default    | Description |
|---------------|-----------------------------------|------------|-------------|
| `url`         | string (required)                 | —          | Full URL to scrape |
| `output`      | `markdown` \| `raw`               | `markdown` | Markdown is token-efficient for LLMs; raw returns HTML |
| `render`      | boolean                           | `false`    | Real-browser rendering for JS-heavy sites (costs more credits) |
| `super_proxy` | boolean                           | `false`    | Residential & mobile proxies for tough targets (costs more credits) |
| `geoCode`     | string                            | —          | Country code, e.g. `us`, `uk`, `de` |
| `device`      | `desktop` \| `mobile` \| `tablet` | —          | Device profile to emulate |

Annotated as read-only / non-destructive.

## Configuration

| Env var               | Required | Description |
|-----------------------|----------|-------------|
| `SCRAPEDO_TOKEN`      | yes      | Your Scrape.do API token (from `dashboard.scrape.do`) |
| `MAX_RESPONSE_CHARS`  | no       | Cap on returned characters (default `80000`) |
| `PORT`                | no       | Set automatically by most hosts |

## Run locally

```bash
npm install
SCRAPEDO_TOKEN=your_token_here npm start
# Health check:  http://localhost:3000/
# MCP endpoint:  http://localhost:3000/mcp
```

## Deploy

Any Node.js host works (Render, Railway, Fly, Koyeb, etc.). Build command `npm install`,
start command `npm start`, and set `SCRAPEDO_TOKEN` as an environment variable. The public
HTTPS URL plus `/mcp` is your connector endpoint.

## Connect in Claude

Settings → Connectors → **Add custom connector** → paste `https://YOUR-URL/mcp`.
