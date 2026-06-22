import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// ---- Config ----
const SCRAPEDO_BASE = "https://api.scrape.do/";
const MAX_CHARS = Number(process.env.MAX_RESPONSE_CHARS || 80000); // cap large pages
const PORT = process.env.PORT || 3000;

// Pull the user's Scrape.do token from the incoming request, with env fallback.
// - Apify-style per-user token:  Authorization: Bearer <token>   (or  x-scrapedo-token: <token>)
// - Testing / single-tenant:     falls back to the SCRAPEDO_TOKEN env var
function resolveToken(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (req.headers["x-scrapedo-token"]) return String(req.headers["x-scrapedo-token"]).trim();
  return process.env.SCRAPEDO_TOKEN || null;
}

// ---- Build a fresh MCP server instance (stateless: one per request) ----
function buildServer(token) {
  const server = new McpServer({ name: "scrapedo", version: "1.0.0" });

  server.registerTool(
    "scrape",
    {
      title: "Scrape a web page",
      description:
        "Fetch the live contents of any public web page through Scrape.do. " +
        "Automatically handles anti-bot systems (Cloudflare, DataDome, Akamai, PerimeterX), " +
        "rotating datacenter/residential/mobile proxies, CAPTCHA solving, and optional " +
        "JavaScript rendering. Returns the page as Markdown (best for reading and extraction) " +
        "or raw HTML. Use this whenever you need the current content of a URL.",
      inputSchema: {
        url: z
          .string()
          .url()
          .describe("Full URL of the page to scrape, e.g. https://example.com/products"),
        output: z
          .enum(["markdown", "raw"])
          .default("markdown")
          .describe("Response format. 'markdown' is cleaner and token-efficient for LLMs; 'raw' returns original HTML."),
        render: z
          .boolean()
          .default(false)
          .describe("Set true for JavaScript-heavy sites (React/Vue/Angular SPAs) that need a real browser. Costs more credits."),
        super_proxy: z
          .boolean()
          .default(false)
          .describe("Set true to route through residential & mobile proxies for tougher targets. Higher success rate, costs more credits."),
        geoCode: z
          .string()
          .optional()
          .describe("Two-letter country code to scrape from a specific country, e.g. 'us', 'uk', 'de'. Leave empty for default."),
        device: z
          .enum(["desktop", "mobile", "tablet"])
          .optional()
          .describe("Device profile to emulate. Optional."),
      },
      annotations: {
        title: "Scrape a web page",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, output, render, super_proxy, geoCode, device }) => {
      if (!token) {
        return {
          isError: true,
          content: [{ type: "text", text: "No Scrape.do token provided. Connect with your API token, or set SCRAPEDO_TOKEN on the server." }],
        };
      }

      // Build the Scrape.do request. URLSearchParams handles URL-encoding of the target url.
      const api = new URL(SCRAPEDO_BASE);
      api.searchParams.set("token", token);
      api.searchParams.set("url", url);
      api.searchParams.set("output", output);
      if (render) api.searchParams.set("render", "true");
      if (super_proxy) api.searchParams.set("super", "true");
      if (geoCode) api.searchParams.set("geoCode", geoCode);
      if (device) api.searchParams.set("device", device);

      try {
        const resp = await fetch(api.toString(), { headers: { accept: "*/*" } });
        const text = await resp.text();

        const truncated = text.length > MAX_CHARS;
        const body = truncated
          ? text.slice(0, MAX_CHARS) + `\n\n…[truncated ${text.length - MAX_CHARS} more characters]`
          : text;

        const flags = [
          render ? "render" : null,
          super_proxy ? "super" : null,
          geoCode ? `geo:${geoCode}` : null,
          device ? `device:${device}` : null,
        ].filter(Boolean).join(" | ");

        const header =
          `Scrape.do → status ${resp.status} ${resp.statusText} | format: ${output}` +
          (flags ? ` | ${flags}` : "") +
          `\nURL: ${url}\n\n`;

        return {
          isError: !resp.ok,
          content: [{ type: "text", text: header + body }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Request failed: ${err?.message || String(err)}` }],
        };
      }
    }
  );

  return server;
}

// ---- HTTP layer ----
const app = express();
app.use(express.json({ limit: "4mb" }));

// Simple health check (handy for Render + sanity in a browser)
app.get("/", (_req, res) => {
  res.json({ ok: true, server: "scrapedo-mcp", transport: "streamable-http", endpoint: "/mcp" });
});

// Streamable HTTP — stateless: a fresh server + transport per request
app.post("/mcp", async (req, res) => {
  try {
    const token = resolveToken(req);
    const server = buildServer(token);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Stateless mode doesn't use server-initiated GET streams or DELETE
const methodNotAllowed = (_req, res) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.log(`Scrape.do MCP server listening on :${PORT}  (POST /mcp)`);
});
