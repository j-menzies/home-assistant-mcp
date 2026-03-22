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

export function registerClimateTools(server: McpServer): void {
  server.tool(
    "set_climate",
    "Control a climate/thermostat entity. Set temperature, HVAC mode, fan mode, or preset. Fetches current state before and after to confirm changes.",
    {
      entity_id: z.string().describe("Climate entity ID (e.g. 'climate.living_room')"),
      temperature: z.number().optional().describe("Target temperature"),
      target_temp_high: z.number().optional().describe("Upper target temperature (for range mode)"),
      target_temp_low: z.number().optional().describe("Lower target temperature (for range mode)"),
      hvac_mode: z
        .enum(["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"])
        .optional()
        .describe("HVAC operation mode"),
      fan_mode: z.string().optional().describe("Fan mode (e.g. 'auto', 'low', 'medium', 'high')"),
      preset_mode: z
        .string()
        .optional()
        .describe("Preset mode (e.g. 'eco', 'away', 'boost', 'comfort', 'home', 'sleep')"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "climate");
      if (domainError) throw new ToolError(domainError);

      const before = await fetchEntityState(entityId);
      const calls: Array<Promise<unknown>> = [];

      // Set temperature
      const temperature = args["temperature"] as number | undefined;
      const tempHigh = args["target_temp_high"] as number | undefined;
      const tempLow = args["target_temp_low"] as number | undefined;

      if (temperature !== undefined || tempHigh !== undefined || tempLow !== undefined) {
        const data: Record<string, unknown> = { entity_id: entityId };
        if (temperature !== undefined) data["temperature"] = temperature;
        if (tempHigh !== undefined) data["target_temp_high"] = tempHigh;
        if (tempLow !== undefined) data["target_temp_low"] = tempLow;
        calls.push(ha.callService("climate", "set_temperature", data));
      }

      // Set HVAC mode
      const hvacMode = args["hvac_mode"] as string | undefined;
      if (hvacMode !== undefined) {
        calls.push(
          ha.callService("climate", "set_hvac_mode", {
            entity_id: entityId,
            hvac_mode: hvacMode,
          }),
        );
      }

      // Set fan mode
      const fanMode = args["fan_mode"] as string | undefined;
      if (fanMode !== undefined) {
        calls.push(
          ha.callService("climate", "set_fan_mode", {
            entity_id: entityId,
            fan_mode: fanMode,
          }),
        );
      }

      // Set preset mode
      const presetMode = args["preset_mode"] as string | undefined;
      if (presetMode !== undefined) {
        calls.push(
          ha.callService("climate", "set_preset_mode", {
            entity_id: entityId,
            preset_mode: presetMode,
          }),
        );
      }

      if (calls.length === 0) {
        // No changes requested -- just return current state
        return toolResponse(
          `Current state of ${entityId}:`,
          {
            state: before.state,
            attributes: before.attributes,
          },
        );
      }

      await Promise.all(calls);
      const after = await fetchEntityState(entityId);

      const changes: string[] = [];
      if (temperature !== undefined) changes.push(`temperature to ${temperature}`);
      if (tempHigh !== undefined) changes.push(`target high to ${tempHigh}`);
      if (tempLow !== undefined) changes.push(`target low to ${tempLow}`);
      if (hvacMode !== undefined) changes.push(`HVAC mode to ${hvacMode}`);
      if (fanMode !== undefined) changes.push(`fan mode to ${fanMode}`);
      if (presetMode !== undefined) changes.push(`preset to ${presetMode}`);

      return toolResponse(
        `Updated ${entityId}: set ${changes.join(", ")}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );
}
