# Scrape.do MCP Server (HTTP)

A Streamable HTTP MCP server wrapping Scrape.do. Host it anywhere (e.g. Render),
then publish the public `/mcp` URL to Smithery.

## Run locally

```bash
npm install
SCRAPEDO_TOKEN=your_token npm start
# MCP endpoint: http://localhost:8080/mcp
```

## Deploy on Render

1. Push this repo to GitHub.
2. Render dashboard → New → Web Service → connect this repo.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Deploy → you get a URL like `https://your-app.onrender.com`.
   Your MCP endpoint is `https://your-app.onrender.com/mcp`.

## Publish to Smithery

```bash
npx smithery@latest mcp publish https://your-app.onrender.com/mcp \
  -n <namespace>/scrapedo \
  --config-schema '{"type":"object","required":["scrapedo_token"],"properties":{"scrapedo_token":{"type":"string","title":"Scrape.do API Token","description":"Get 1,000 free credits at https://dashboard.scrape.do/sign-up"}}}'
```

Each user enters their own Scrape.do token, which Smithery forwards to the server
as the `scrapedo_token` query parameter.
