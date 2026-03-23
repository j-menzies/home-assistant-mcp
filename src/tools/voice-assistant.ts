import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  exposeEntity,
  getExposedEntities,
} from "../ha/websocket.js";
import { toolResponse, withErrorHandling } from "./helpers.js";

/** Known voice assistant keys in HA */
const ASSISTANT_KEYS = ["cloud.alexa", "cloud.google_assistant", "conversation"] as const;

export function registerVoiceAssistantTools(server: McpServer): void {
  // ── expose_entities ─────────────────────────────────────────

  server.tool(
    "expose_entities",
    "Expose or unexpose Home Assistant entities to voice assistants (Alexa, Google Assistant). " +
      "Use this to control which entities are available for voice control. " +
      "Common assistants: 'cloud.alexa', 'cloud.google_assistant', 'conversation' (local HA voice).",
    {
      entity_ids: z
        .array(z.string())
        .min(1)
        .describe(
          "Array of entity IDs to expose/unexpose (e.g. ['light.living_room', 'switch.fairy_lights'])",
        ),
      assistant: z
        .string()
        .default("cloud.alexa")
        .describe(
          "Voice assistant to expose to: 'cloud.alexa', 'cloud.google_assistant', or 'conversation'",
        ),
      expose: z
        .boolean()
        .default(true)
        .describe("true to expose, false to unexpose (default: true)"),
    },
    withErrorHandling(async (args) => {
      const entityIds = args["entity_ids"] as string[];
      const assistant = args["assistant"] as string;
      const expose = args["expose"] as boolean;

      await exposeEntity(entityIds, [assistant], expose);

      const action = expose ? "Exposed" : "Unexposed";
      return toolResponse(
        `${action} ${entityIds.length} entity/entities to ${assistant}:`,
        {
          entities: entityIds,
          assistant,
          exposed: expose,
        },
      );
    }),
  );

  // ── get_exposed_entities ────────────────────────────────────

  server.tool(
    "get_exposed_entities",
    "List all entities that have been explicitly exposed or unexposed to voice assistants. " +
      "Shows which entities are available to Alexa, Google Assistant, and local HA conversation.",
    {
      assistant: z
        .string()
        .optional()
        .describe(
          "Filter by assistant: 'cloud.alexa', 'cloud.google_assistant', or 'conversation'",
        ),
      exposed_only: z
        .boolean()
        .default(true)
        .describe(
          "If true, only show entities that are exposed (default: true)",
        ),
    },
    withErrorHandling(async (args) => {
      const assistantFilter = args["assistant"] as string | undefined;
      const exposedOnly = args["exposed_only"] as boolean;

      const rawResult = await getExposedEntities();

      // HA returns: { exposed_entities: { "entity.id": { "cloud.alexa": true, "conversation": true } } }
      // Values are flat booleans keyed by assistant name.
      const entities = (rawResult as Record<string, unknown>)
        ?.exposed_entities as Record<string, Record<string, boolean>> ?? {};

      // Parse into a structured list
      let entries = Object.entries(entities).map(([entityId, config]) => {
        const exposed: string[] = [];
        const unexposed: string[] = [];

        for (const key of ASSISTANT_KEYS) {
          if (key in (config ?? {})) {
            if (config[key]) {
              exposed.push(key);
            } else {
              unexposed.push(key);
            }
          }
        }

        return { entity_id: entityId, exposed_to: exposed, unexposed_from: unexposed };
      });

      // Filter by assistant
      if (assistantFilter) {
        entries = entries.filter((e) => {
          if (exposedOnly) {
            return e.exposed_to.includes(assistantFilter);
          }
          return e.exposed_to.includes(assistantFilter) || e.unexposed_from.includes(assistantFilter);
        });
      } else if (exposedOnly) {
        entries = entries.filter((e) => e.exposed_to.length > 0);
      }

      // Clean output -- only include unexposed_from if non-empty
      const output = entries.map((e) => ({
        entity_id: e.entity_id,
        exposed_to: e.exposed_to,
        ...(e.unexposed_from.length > 0 ? { unexposed_from: e.unexposed_from } : {}),
      }));

      return toolResponse(
        `Found ${output.length} entities with voice assistant configuration:`,
        output,
      );
    }),
  );
}
