import express from "express";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { appConfig, isDev } from "./config.js";
import { apiKeyAuth } from "./auth/middleware.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { checkConnection } from "./ha/client.js";
import { randomUUID } from "node:crypto";

// ── MCP Server Factory ────────────────────────────────────────
// Each session needs its own McpServer instance, as the SDK binds
// one server to one transport. This factory creates a fresh,
// fully-configured server for each new session.

function createMcpServer(): McpServer {
  const server = new McpServer(
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

  registerAllTools(server);
  registerAllResources(server);

  return server;
}

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

    // Create a fresh server instance for this session and connect
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    // handleRequest processes the initialize message and assigns the session ID
    await transport.handleRequest(req, res, req.body);

    // Store the transport AFTER handleRequest, when the session ID has been assigned
    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
      if (isDev) {
        console.log(`[MCP] New session: ${transport.sessionId}`);
      }
    }
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

  // Check if TLS certs are available (dev HTTPS or production with Node-native TLS)
  const certPath = resolve(process.cwd(), "certs/dev.crt");
  const keyPath = resolve(process.cwd(), "certs/dev.key");
  const useTls = existsSync(certPath) && existsSync(keyPath);

  if (useTls) {
    const httpsServer = createHttpsServer(
      {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      },
      app,
    );

    httpsServer.listen(appConfig.MCP_PORT, appConfig.MCP_HOST, () => {
      console.log(
        `[MCP] Server listening on https://${appConfig.MCP_HOST}:${appConfig.MCP_PORT}/mcp`,
      );
      if (isDev) {
        console.log("[MCP] Running in development mode (HTTPS)");
        if (appConfig.MCP_SKIP_AUTH) {
          console.warn("[MCP] API key authentication is DISABLED");
        }
      }
    });
  } else {
    app.listen(appConfig.MCP_PORT, appConfig.MCP_HOST, () => {
      console.log(
        `[MCP] Server listening on http://${appConfig.MCP_HOST}:${appConfig.MCP_PORT}/mcp`,
      );
      if (isDev) {
        console.log("[MCP] Running in development mode (HTTP -- no certs found)");
        if (appConfig.MCP_SKIP_AUTH) {
          console.warn("[MCP] API key authentication is DISABLED");
        }
      }
    });
  }
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
