import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ha from "../ha/client.js";
import { toolResponse, withErrorHandling } from "./helpers.js";

export function registerSensorTools(server: McpServer): void {
  // ── get_sensor_history ────────────────────────────────────────

  server.tool(
    "get_sensor_history",
    "Get historical state changes for an entity over a time period. Defaults to the last 24 hours.",
    {
      entity_id: z.string().describe("Entity ID to get history for"),
      start_time: z
        .string()
        .optional()
        .describe("Start time in ISO 8601 format (e.g. '2024-01-15T10:00:00Z'). Defaults to 24 hours ago."),
      end_time: z
        .string()
        .optional()
        .describe("End time in ISO 8601 format. Defaults to now."),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const startTime = args["start_time"] as string | undefined;
      const endTime = args["end_time"] as string | undefined;

      const history = await ha.getHistory(entityId, startTime, endTime);

      if (!history || history.length === 0 || !history[0] || history[0].length === 0) {
        return toolResponse(`No history found for ${entityId} in the specified time range.`);
      }

      const entries = history[0];
      const summary = entries.map((entry) => ({
        state: entry.state,
        last_changed: entry.last_changed,
        attributes: {
          friendly_name: entry.attributes["friendly_name"] ?? null,
          unit_of_measurement: entry.attributes["unit_of_measurement"] ?? null,
        },
      }));

      return toolResponse(
        `History for ${entityId}: ${entries.length} state changes found.`,
        summary,
      );
    }),
  );

  // ── get_logbook ───────────────────────────────────────────────

  server.tool(
    "get_logbook",
    "Get logbook entries for an entity or time range. Shows human-readable activity log.",
    {
      entity_id: z
        .string()
        .optional()
        .describe("Filter logbook to a specific entity"),
      start_time: z
        .string()
        .optional()
        .describe("Start time in ISO 8601 format. Defaults to 24 hours ago."),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string | undefined;
      const startTime = args["start_time"] as string | undefined;

      const entries = await ha.getLogbook(startTime, entityId);

      if (entries.length === 0) {
        return toolResponse("No logbook entries found for the specified criteria.");
      }

      const formatted = entries.slice(0, 100).map((entry) => ({
        when: entry.when,
        name: entry.name,
        state: entry.state ?? null,
        entity_id: entry.entity_id ?? null,
        message: entry.message ?? null,
      }));

      return toolResponse(
        `Logbook: ${entries.length} entries found${entries.length > 100 ? " (showing first 100)" : ""}.`,
        formatted,
      );
    }),
  );
}
