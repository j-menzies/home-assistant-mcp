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

  // ── get_automation_config ─────────────────────────────────────

  server.tool(
    "get_automation_config",
    "Get the full configuration (triggers, conditions, actions) of an automation.",
    {
      automation_id: z
        .string()
        .describe(
          "The automation ID (not the entity_id). This is the ID portion after 'automation.' in the entity_id, or the 'id' field in the automation config. For entity_id 'automation.morning_lights', try 'morning_lights' or check the automation's attributes for the actual ID.",
        ),
    },
    withErrorHandling(async (args) => {
      const automationId = args["automation_id"] as string;
      const config = await ha.getAutomationConfig(automationId);
      return toolResponse(
        `Configuration for automation '${automationId}':`,
        config,
      );
    }),
  );

  // ── create_automation ───────────────────────────────────────

  server.tool(
    "create_automation",
    "Create a new automation in Home Assistant. Provide the full automation configuration including triggers, conditions, and actions.",
    {
      id: z
        .string()
        .describe("Unique ID for the automation (e.g. 'daily_battery_check')"),
      alias: z.string().describe("Human-readable name for the automation"),
      description: z
        .string()
        .optional()
        .describe("Description of what the automation does"),
      mode: z
        .enum(["single", "restart", "queued", "parallel"])
        .default("single")
        .describe("Automation mode (default: single)"),
      triggers: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of trigger configurations"),
      conditions: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Array of condition configurations"),
      actions: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of action configurations"),
    },
    withErrorHandling(async (args) => {
      const id = args["id"] as string;
      const config: import("../ha/types.js").HAAutomationConfig = {
        alias: args["alias"] as string,
        description: (args["description"] as string) ?? "",
        mode: (args["mode"] as "single" | "restart" | "queued" | "parallel") ?? "single",
        triggers: args["triggers"] as Record<string, unknown>[],
        conditions: (args["conditions"] as Record<string, unknown>[]) ?? [],
        actions: args["actions"] as Record<string, unknown>[],
      };

      const result = await ha.createAutomation(id, config);

      // Reload automations so the new one is available
      await ha.callService("automation", "reload");

      return toolResponse(
        `Created automation '${config.alias}' (id: ${id}). Result: ${result.result ?? "ok"}`,
        { id, ...config },
      );
    }),
  );

  // ── update_automation ───────────────────────────────────────

  server.tool(
    "update_automation",
    "Update an existing automation's configuration. Provide the complete updated configuration - this replaces the entire automation config.",
    {
      id: z.string().describe("The automation ID to update"),
      alias: z.string().describe("Human-readable name for the automation"),
      description: z
        .string()
        .optional()
        .describe("Description of what the automation does"),
      mode: z
        .enum(["single", "restart", "queued", "parallel"])
        .default("single")
        .describe("Automation mode"),
      triggers: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of trigger configurations"),
      conditions: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Array of condition configurations"),
      actions: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of action configurations"),
    },
    withErrorHandling(async (args) => {
      const id = args["id"] as string;

      // Verify it exists first
      await ha.getAutomationConfig(id);

      const config: import("../ha/types.js").HAAutomationConfig = {
        alias: args["alias"] as string,
        description: (args["description"] as string) ?? "",
        mode: (args["mode"] as "single" | "restart" | "queued" | "parallel") ?? "single",
        triggers: args["triggers"] as Record<string, unknown>[],
        conditions: (args["conditions"] as Record<string, unknown>[]) ?? [],
        actions: args["actions"] as Record<string, unknown>[],
      };

      const result = await ha.updateAutomation(id, config);
      await ha.callService("automation", "reload");

      return toolResponse(
        `Updated automation '${config.alias}' (id: ${id}). Result: ${result.result ?? "ok"}`,
        { id, ...config },
      );
    }),
  );

  // ── delete_automation ───────────────────────────────────────

  server.tool(
    "delete_automation",
    "Delete an automation from Home Assistant. This is irreversible.",
    {
      id: z.string().describe("The automation ID to delete"),
    },
    withErrorHandling(async (args) => {
      const id = args["id"] as string;

      // Verify it exists first
      const config = await ha.getAutomationConfig(id);
      const result = await ha.deleteAutomation(id);
      await ha.callService("automation", "reload");

      return toolResponse(
        `Deleted automation '${config.alias ?? id}' (id: ${id}). Result: ${result.result ?? "ok"}`,
      );
    }),
  );

  // ── list_automations ────────────────────────────────────────

  server.tool(
    "list_automations",
    "List all automations with their current state, last triggered time, and ID.",
    {},
    withErrorHandling(async () => {
      const automations = await ha.listAutomations();

      const summary = automations.map((a) => ({
        entity_id: a.entity_id,
        friendly_name: a.attributes["friendly_name"] ?? null,
        state: a.state,
        last_triggered: a.attributes["last_triggered"] ?? null,
        current_state: a.state === "on" ? "enabled" : "disabled",
        id: a.attributes["id"] ?? a.entity_id.replace("automation.", ""),
      }));

      return toolResponse(
        `Found ${automations.length} automations:`,
        summary,
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
