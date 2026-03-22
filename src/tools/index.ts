import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEntityControlTools } from "./entity-control.js";
import { registerLightTools } from "./lights.js";
import { registerClimateTools } from "./climate.js";
import { registerMediaTools } from "./media.js";
import { registerAutomationTools } from "./automation.js";
import { registerCoverLockTools } from "./covers-locks.js";
import { registerSensorTools } from "./sensors.js";
import { registerSystemTools } from "./system.js";

/**
 * Register all tool modules with the MCP server.
 * Each module follows the consistent pattern defined in the architecture:
 * input validation -> entity resolution -> freshness check -> service call -> response formatting -> error handling
 */
export function registerAllTools(server: McpServer): void {
  registerEntityControlTools(server);
  registerLightTools(server);
  registerClimateTools(server);
  registerMediaTools(server);
  registerAutomationTools(server);
  registerCoverLockTools(server);
  registerSensorTools(server);
  registerSystemTools(server);
}
