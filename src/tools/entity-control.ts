import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ha from "../ha/client.js";
import {
  fetchEntityState,
  buildStateChange,
  toolResponse,
  toolError,
  withErrorHandling,
  entityDomain,
} from "./helpers.js";

export function registerEntityControlTools(server: McpServer): void {
  // ── get_entities ──────────────────────────────────────────────

  server.tool(
    "get_entities",
    "List entities in Home Assistant. Without filters, returns a summary of entity counts by domain. Use filters to narrow results.",
    {
      domain: z
        .string()
        .optional()
        .describe("Filter by domain (e.g. 'light', 'switch', 'sensor', 'climate')"),
      area: z
        .string()
        .optional()
        .describe("Filter by area/room name (e.g. 'living_room', 'kitchen')"),
      state: z
        .string()
        .optional()
        .describe("Filter by current state value (e.g. 'on', 'off', 'unavailable')"),
      search: z
        .string()
        .optional()
        .describe("Free-text search across entity_id, friendly_name, and area"),
    },
    withErrorHandling(async (args) => {
      const states = await ha.getStates();
      let filtered = states;

      const domain = args["domain"] as string | undefined;
      const area = args["area"] as string | undefined;
      const stateFilter = args["state"] as string | undefined;
      const search = args["search"] as string | undefined;

      const hasFilters = domain || area || stateFilter || search;

      if (domain) {
        filtered = filtered.filter((e) => entityDomain(e.entity_id) === domain);
      }

      if (stateFilter) {
        filtered = filtered.filter((e) => e.state === stateFilter);
      }

      if (search) {
        const term = search.toLowerCase();
        filtered = filtered.filter((e) => {
          const friendlyName = String(e.attributes["friendly_name"] ?? "").toLowerCase();
          return (
            e.entity_id.toLowerCase().includes(term) ||
            friendlyName.includes(term)
          );
        });
      }

      // Area filtering requires the entity registry
      if (area) {
        const areas = await ha.getAreas();
        const matchingArea = areas.find(
          (a) => a.name.toLowerCase() === area.toLowerCase() || a.area_id === area,
        );
        if (matchingArea) {
          const registry = await ha.getEntityRegistry();
          const areaEntityIds = new Set(
            registry
              .filter((e) => e.area_id === matchingArea.area_id)
              .map((e) => e.entity_id),
          );
          filtered = filtered.filter((e) => areaEntityIds.has(e.entity_id));
        } else {
          return toolError(`Area '${area}' not found. Use get_entities without area filter to discover available areas.`);
        }
      }

      if (!hasFilters) {
        // Return a summary rather than dumping all entities
        const domainCounts: Record<string, number> = {};
        for (const entity of states) {
          const d = entityDomain(entity.entity_id);
          domainCounts[d] = (domainCounts[d] ?? 0) + 1;
        }

        const summary = Object.entries(domainCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([d, count]) => `  ${d}: ${count}`)
          .join("\n");

        return toolResponse(
          `Home Assistant has ${states.length} entities across ${Object.keys(domainCounts).length} domains:\n\n${summary}\n\nUse the 'domain', 'area', 'state', or 'search' parameters to filter results.`,
        );
      }

      // Return filtered results
      const results = filtered.map((e) => ({
        entity_id: e.entity_id,
        state: e.state,
        friendly_name: e.attributes["friendly_name"] ?? null,
        last_changed: e.last_changed,
      }));

      return toolResponse(
        `Found ${results.length} entities matching your filters:`,
        results,
      );
    }),
  );

  // ── get_entity_state ──────────────────────────────────────────

  server.tool(
    "get_entity_state",
    "Get the current state and all attributes of a specific entity.",
    {
      entity_id: z
        .string()
        .describe("The entity ID (e.g. 'light.living_room', 'sensor.temperature')"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const state = await fetchEntityState(entityId);

      return toolResponse(
        `Entity: ${entityId}\nState: ${state.state}\nLast changed: ${state.last_changed}`,
        {
          entity_id: state.entity_id,
          state: state.state,
          attributes: state.attributes,
          last_changed: state.last_changed,
          last_updated: state.last_updated,
        },
      );
    }),
  );

  // ── turn_on ───────────────────────────────────────────────────

  server.tool(
    "turn_on",
    "Turn on an entity (light, switch, fan, input_boolean, etc.). Fetches current state first to avoid redundant calls.",
    {
      entity_id: z.string().describe("The entity ID to turn on"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domain = entityDomain(entityId);

      const before = await fetchEntityState(entityId);

      if (before.state === "on") {
        return toolResponse(
          `${entityId} is already on. No action taken.`,
          {
            entity_id: entityId,
            state: before.state,
            friendly_name: before.attributes["friendly_name"] ?? null,
          },
        );
      }

      await ha.callService(domain, "turn_on", { entity_id: entityId });
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `Turned on ${entityId}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );

  // ── turn_off ──────────────────────────────────────────────────

  server.tool(
    "turn_off",
    "Turn off an entity (light, switch, fan, input_boolean, etc.). Fetches current state first to avoid redundant calls.",
    {
      entity_id: z.string().describe("The entity ID to turn off"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domain = entityDomain(entityId);

      const before = await fetchEntityState(entityId);

      if (before.state === "off") {
        return toolResponse(
          `${entityId} is already off. No action taken.`,
          {
            entity_id: entityId,
            state: before.state,
            friendly_name: before.attributes["friendly_name"] ?? null,
          },
        );
      }

      await ha.callService(domain, "turn_off", { entity_id: entityId });
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `Turned off ${entityId}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );

  // ── toggle ────────────────────────────────────────────────────

  server.tool(
    "toggle",
    "Toggle an entity's state between on and off. Returns the before and after state.",
    {
      entity_id: z.string().describe("The entity ID to toggle"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domain = entityDomain(entityId);

      const before = await fetchEntityState(entityId);
      await ha.callService(domain, "toggle", { entity_id: entityId });
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `Toggled ${entityId} from ${before.state} to ${after.state}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );
}
