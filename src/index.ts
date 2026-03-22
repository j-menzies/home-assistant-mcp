import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { appConfig, isDev } from "./config.js";
import { apiKeyAuth } from "./auth/middleware.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { checkConnection } from "./ha/client.js";
import { randomUUID } from "node:crypto";

// ── MCP Server Setup ──────────────────────────────────────────

const mcpServer = new McpServer(
  {
    name: "home-assistant-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      logging: {},
    },
  },
);

// Register all tools and resources
registerAllTools(mcpServer);
registerAllResources(mcpServer);

// ── Transport & Session Management ────────────────────────────

const transports = new Map<string, StreamableHTTPServerTransport>();

// ── Express App ───────────────────────────────────────────────

const app = express();

// Parse JSON bodies
app.use(express.json());

// API key authentication (applied to all /mcp routes)
app.use("/mcp", apiKeyAuth);

// Health check (no auth required -- handled by middleware)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Streamable HTTP MCP Endpoint ──────────────────────────────

// POST /mcp -- handles MCP requests (initialize, tool calls, etc.)
app.post("/mcp", async (req, res) => {
  try {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session -- create transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Store session when we get the ID
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        transports.delete(sid);
        if (isDev) {
          console.log(`[MCP] Session closed: ${sid}`);
        }
      }
    };

    // Connect server to transport
    await mcpServer.connect(transport);

    if (isDev && transport.sessionId) {
      console.log(`[MCP] New session: ${transport.sessionId}`);
    }

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP] Error handling POST:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// GET /mcp -- SSE stream for server-to-client notifications
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }

  const transport = transports.get(sessionId)!;

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("[MCP] Error handling GET:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// DELETE /mcp -- terminate session
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }

  const transport = transports.get(sessionId)!;

  try {
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  } catch (error) {
    console.error("[MCP] Error handling DELETE:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ── Start Server ──────────────────────────────────────────────

async function start(): Promise<void> {
  // Verify HA connection
  const haConnected = await checkConnection();
  if (!haConnected) {
    console.warn(
      `[HA] Cannot connect to Home Assistant at ${appConfig.HA_BASE_URL}. ` +
        "The server will start, but tool calls will fail until HA is reachable.",
    );
  } else {
    console.log(`[HA] Connected to Home Assistant at ${appConfig.HA_BASE_URL}`);
  }

  app.listen(appConfig.MCP_PORT, appConfig.MCP_HOST, () => {
    console.log(
      `[MCP] Server listening on http://${appConfig.MCP_HOST}:${appConfig.MCP_PORT}/mcp`,
    );
    if (isDev) {
      console.log("[MCP] Running in development mode");
      if (appConfig.MCP_SKIP_AUTH) {
        console.warn("[MCP] API key authentication is DISABLED");
      }
    }
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
