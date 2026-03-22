/**
 * stdio transport entry point for Claude Desktop Developer config.
 * Claude Desktop launches this as a subprocess and communicates via stdin/stdout.
 *
 * Usage in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "home-assistant": {
 *       "command": "npx",
 *       "args": ["tsx", "src/stdio.ts"],
 *       "cwd": "/path/to/home-assistant-mcp"
 *     }
 *   }
 * }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { checkConnection } from "./ha/client.js";

// Import config to validate env vars and load .env
import "./config.js";

// IMPORTANT: In stdio mode, never write to stdout -- it's reserved for JSON-RPC.
// All logging goes to stderr.
function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
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

  // Verify HA connection
  const haConnected = await checkConnection();
  if (!haConnected) {
    log("[HA] Cannot connect to Home Assistant. Tool calls will fail until HA is reachable.");
  } else {
    log("[HA] Connected to Home Assistant.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("[MCP] stdio transport connected.");
}

main().catch((error) => {
  process.stderr.write(`Failed to start: ${error}\n`);
  process.exit(1);
});
