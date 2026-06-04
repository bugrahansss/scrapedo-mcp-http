import express from "express"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

const SCRAPEDO_ENDPOINT = "https://api.scrape.do/"

const TOOL_DESCRIPTION =
  "Fetch the contents of any URL through Scrape.do — rotating residential/datacenter " +
  "proxies, anti-bot bypass, and optional JavaScript rendering. Returns clean Markdown " +
  "by default (ideal for LLMs, lower token usage) or raw HTML. Use this whenever you " +
  "need live web content that a plain HTTP fetch would get blocked on (Cloudflare, " +
  "DataDome, rate limits, geo-restrictions, JS-rendered pages, etc.)."

// Read the user's Scrape.do token from the request.
// Smithery (URL publishing) forwards config as query params by default,
// so the token arrives as ?scrapedo_token=... . We also accept a base64
// `config` JSON param, and fall back to an env var for local testing.
function getToken(req) {
  if (req.query.scrapedo_token) return String(req.query.scrapedo_token)
  if (req.query.config) {
    try {
      const decoded = Buffer.from(String(req.query.config), "base64").toString("utf8")
      const cfg = JSON.parse(decoded)
      if (cfg && cfg.scrapedo_token) return String(cfg.scrapedo_token)
    } catch {
      // ignore malformed config
    }
  }
  return process.env.SCRAPEDO_TOKEN || ""
}

function buildServer(token) {
  const server = new McpServer({ name: "scrapedo", version: "1.0.0" })

  server.registerTool(
    "scrape",
    {
      title: "Scrape a web page",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        url: z.string().url().describe("The full URL to scrape, e.g. https://example.com/page"),
        output: z
          .enum(["markdown", "raw"])
          .default("markdown")
          .describe("markdown = clean, LLM-friendly text (default); raw = the full HTML of the page"),
        render: z
          .boolean()
          .default(false)
          .describe("Set true for JavaScript-heavy / dynamically rendered pages"),
        residential: z
          .boolean()
          .default(false)
          .describe("Set true to route through residential & mobile proxies (maps to Scrape.do `super`)"),
        geoCode: z
          .string()
          .optional()
          .describe("Two-letter country code for the proxy location, e.g. us, uk, de. Defaults to us."),
      },
    },
    async ({ url, output, render, residential, geoCode }) => {
      if (!token) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "No Scrape.do token configured. Add your token in the connector settings. " +
                "Don't have one? Get 1,000 free credits at https://dashboard.scrape.do/sign-up",
            },
          ],
        }
      }

      const params = new URLSearchParams({
        token,
        url,
        output,
        render: String(render),
        super: String(residential),
      })
      if (geoCode) params.set("geoCode", geoCode)

      try {
        const apiRes = await fetch(`${SCRAPEDO_ENDPOINT}?${params.toString()}`)
        const body = await apiRes.text()
        if (!apiRes.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `Scrape.do request failed (HTTP ${apiRes.status}). ` +
                  `Tip: try render=true and/or residential=true for protected sites. ` +
                  `Response: ${body.slice(0, 500)}`,
              },
            ],
          }
        }
        return { content: [{ type: "text", text: body }] }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Network error calling Scrape.do: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }
      }
    },
  )

  return server
}

const app = express()
app.use(express.json())

// MCP endpoint (stateless: a fresh server/transport per request)
app.post("/mcp", async (req, res) => {
  try {
    const token = getToken(req)
    const server = buildServer(token)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on("close", () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error("MCP request error:", err)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      })
    }
  }
})

const methodNotAllowed = (_req, res) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST." },
    id: null,
  })
app.get("/mcp", methodNotAllowed)
app.delete("/mcp", methodNotAllowed)

// Static server card — lets Smithery read metadata even if a live scan times out
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
  res.json({
    serverInfo: { name: "scrapedo", version: "1.0.0" },
    tools: [
      {
        name: "scrape",
        description: TOOL_DESCRIPTION,
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
            output: { type: "string", enum: ["markdown", "raw"] },
            render: { type: "boolean" },
            residential: { type: "boolean" },
            geoCode: { type: "string" },
          },
        },
      },
    ],
    resources: [],
    prompts: [],
  })
})

// Health check / friendly root
app.get("/", (_req, res) =>
  res.type("text").send("Scrape.do MCP server is running. MCP endpoint: POST /mcp"),
)

const port = process.env.PORT || 8080
app.listen(port, () => console.log(`Scrape.do MCP server listening on port ${port}`))
