import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ha from "../ha/client.js";
import { entityDomain } from "../tools/helpers.js";

/**
 * Register all MCP resources.
 * Resources provide read-only reference data that clients can browse.
 */
export function registerAllResources(server: McpServer): void {
  // ── ha://entities ─────────────────────────────────────────────

  server.resource(
    "entities",
    "ha://entities",
    {
      description: "List all Home Assistant entities with current states",
      mimeType: "application/json",
    },
    async (uri) => {
      const states = await ha.getStates();
      const summary = states.map((s) => ({
        entity_id: s.entity_id,
        state: s.state,
        friendly_name: s.attributes["friendly_name"] ?? null,
        domain: entityDomain(s.entity_id),
        last_changed: s.last_changed,
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // ── ha://entities/{entity_id} ─────────────────────────────────

  server.resource(
    "entity",
    new ResourceTemplate("ha://entities/{entity_id}", {
      list: async () => ({
        resources: (await ha.getStates()).map((s) => ({
          uri: `ha://entities/${s.entity_id}`,
          name: String(s.attributes["friendly_name"] ?? s.entity_id),
          description: `${entityDomain(s.entity_id)} - ${s.state}`,
        })),
      }),
    }),
    {
      description: "Individual entity state and attributes",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const entityId = params["entity_id"] as string;
      const state = await ha.getState(entityId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(state, null, 2),
          },
        ],
      };
    },
  );

  // ── ha://services ─────────────────────────────────────────────

  server.resource(
    "services",
    "ha://services",
    {
      description: "Available Home Assistant services by domain",
      mimeType: "application/json",
    },
    async (uri) => {
      const services = await ha.getServices();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(services, null, 2),
          },
        ],
      };
    },
  );

  // ── ha://config ───────────────────────────────────────────────

  server.resource(
    "config",
    "ha://config",
    {
      description: "Home Assistant system configuration",
      mimeType: "application/json",
    },
    async (uri) => {
      const config = await ha.getConfig();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(config, null, 2),
          },
        ],
      };
    },
  );

  // ── ha://areas ────────────────────────────────────────────────

  server.resource(
    "areas",
    "ha://areas",
    {
      description: "Home Assistant areas/rooms",
      mimeType: "application/json",
    },
    async (uri) => {
      const areas = await ha.getAreas();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(areas, null, 2),
          },
        ],
      };
    },
  );

  // ── ha://error-log ────────────────────────────────────────────

  server.resource(
    "error-log",
    "ha://error-log",
    {
      description: "Home Assistant error log",
      mimeType: "text/plain",
    },
    async (uri) => {
      const log = await ha.getErrorLog();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: log,
          },
        ],
      };
    },
  );
}
