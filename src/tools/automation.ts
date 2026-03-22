import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ha from "../ha/client.js";
import {
  validateDomain,
  fetchEntityState,
  buildStateChange,
  toolResponse,
  ToolError,
  withErrorHandling,
} from "./helpers.js";

export function registerAutomationTools(server: McpServer): void {
  // ── trigger_automation ────────────────────────────────────────

  server.tool(
    "trigger_automation",
    "Trigger an automation to run immediately, regardless of its conditions.",
    {
      entity_id: z.string().describe("Automation entity ID (e.g. 'automation.morning_lights')"),
      skip_condition: z
        .boolean()
        .default(true)
        .describe("Skip the automation's conditions and force execution (default: true)"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "automation");
      if (domainError) throw new ToolError(domainError);

      const before = await fetchEntityState(entityId);

      if (before.state === "off") {
        return toolResponse(
          `Automation ${entityId} is disabled. Enable it first with toggle_automation, or it cannot be triggered.`,
          { entity_id: entityId, state: before.state },
        );
      }

      await ha.callService("automation", "trigger", {
        entity_id: entityId,
        skip_condition: args["skip_condition"] ?? true,
      });

      return toolResponse(
        `Triggered automation ${entityId}.`,
        {
          entity_id: entityId,
          friendly_name: before.attributes["friendly_name"] ?? null,
          last_triggered: before.attributes["last_triggered"] ?? null,
        },
      );
    }),
  );

  // ── toggle_automation ─────────────────────────────────────────

  server.tool(
    "toggle_automation",
    "Enable or disable an automation.",
    {
      entity_id: z.string().describe("Automation entity ID"),
      enable: z.boolean().describe("true to enable, false to disable"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "automation");
      if (domainError) throw new ToolError(domainError);

      const enable = args["enable"] as boolean;
      const before = await fetchEntityState(entityId);

      const targetState = enable ? "on" : "off";
      if (before.state === targetState) {
        return toolResponse(
          `Automation ${entityId} is already ${enable ? "enabled" : "disabled"}. No action taken.`,
        );
      }

      const service = enable ? "turn_on" : "turn_off";
      await ha.callService("automation", service, { entity_id: entityId });
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `${enable ? "Enabled" : "Disabled"} automation ${entityId}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );

  // ── run_script ────────────────────────────────────────────────

  server.tool(
    "run_script",
    "Execute a Home Assistant script.",
    {
      entity_id: z.string().describe("Script entity ID (e.g. 'script.bedtime_routine')"),
      variables: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional variables to pass to the script"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "script");
      if (domainError) throw new ToolError(domainError);

      await fetchEntityState(entityId); // Validate it exists

      const data: Record<string, unknown> = { entity_id: entityId };
      const variables = args["variables"] as Record<string, unknown> | undefined;
      if (variables) {
        Object.assign(data, variables);
      }

      await ha.callService("script", "turn_on", data);

      return toolResponse(`Executed script ${entityId}.`);
    }),
  );

  // ── activate_scene ────────────────────────────────────────────

  server.tool(
    "activate_scene",
    "Activate a Home Assistant scene.",
    {
      entity_id: z.string().describe("Scene entity ID (e.g. 'scene.movie_time')"),
      transition: z
        .number()
        .min(0)
        .optional()
        .describe("Transition time in seconds"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "scene");
      if (domainError) throw new ToolError(domainError);

      await fetchEntityState(entityId); // Validate it exists

      const data: Record<string, unknown> = { entity_id: entityId };
      const transition = args["transition"] as number | undefined;
      if (transition !== undefined) {
        data["transition"] = transition;
      }

      await ha.callService("scene", "turn_on", data);

      return toolResponse(`Activated scene ${entityId}.`);
    }),
  );
}
