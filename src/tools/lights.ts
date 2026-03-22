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

export function registerLightTools(server: McpServer): void {
  server.tool(
    "set_light",
    "Control a light entity with detailed parameters: brightness, colour temperature, RGB colour, effect, and transition time. Fetches current state before and after.",
    {
      entity_id: z.string().describe("Light entity ID (e.g. 'light.living_room')"),
      brightness_pct: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Brightness percentage (0-100). 0 turns the light off."),
      color_temp_kelvin: z
        .number()
        .optional()
        .describe("Colour temperature in Kelvin (e.g. 2700 for warm, 6500 for cool)"),
      rgb_color: z
        .tuple([z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255)])
        .optional()
        .describe("RGB colour as [r, g, b] array (each 0-255)"),
      effect: z
        .string()
        .optional()
        .describe("Light effect name (device-specific, e.g. 'colorloop', 'random')"),
      transition: z
        .number()
        .min(0)
        .optional()
        .describe("Transition time in seconds"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "light");
      if (domainError) throw new ToolError(domainError);

      const before = await fetchEntityState(entityId);
      const brightnessPct = args["brightness_pct"] as number | undefined;

      // If brightness is 0, turn off the light
      if (brightnessPct === 0) {
        if (before.state === "off") {
          return toolResponse(`${entityId} is already off. No action taken.`);
        }
        await ha.callService("light", "turn_off", { entity_id: entityId });
        const after = await fetchEntityState(entityId);
        return toolResponse(
          `Turned off ${entityId}.`,
          buildStateChange(entityId, before, after),
        );
      }

      // Build service data for turn_on
      const data: Record<string, unknown> = { entity_id: entityId };

      if (brightnessPct !== undefined) {
        data["brightness_pct"] = brightnessPct;
      }

      const colorTempKelvin = args["color_temp_kelvin"] as number | undefined;
      if (colorTempKelvin !== undefined) {
        data["color_temp_kelvin"] = colorTempKelvin;
      }

      const rgbColor = args["rgb_color"] as [number, number, number] | undefined;
      if (rgbColor !== undefined) {
        data["rgb_color"] = rgbColor;
      }

      const effect = args["effect"] as string | undefined;
      if (effect !== undefined) {
        data["effect"] = effect;
      }

      const transition = args["transition"] as number | undefined;
      if (transition !== undefined) {
        data["transition"] = transition;
      }

      await ha.callService("light", "turn_on", data);
      const after = await fetchEntityState(entityId);

      const changes: string[] = [];
      if (brightnessPct !== undefined) changes.push(`brightness to ${brightnessPct}%`);
      if (colorTempKelvin !== undefined) changes.push(`colour temp to ${colorTempKelvin}K`);
      if (rgbColor !== undefined) changes.push(`colour to RGB(${rgbColor.join(", ")})`);
      if (effect !== undefined) changes.push(`effect to '${effect}'`);
      if (transition !== undefined) changes.push(`transition ${transition}s`);

      const description = changes.length > 0
        ? `Set ${entityId}: ${changes.join(", ")}.`
        : `Turned on ${entityId}.`;

      return toolResponse(description, buildStateChange(entityId, before, after));
    }),
  );
}
