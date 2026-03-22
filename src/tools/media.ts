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

export function registerMediaTools(server: McpServer): void {
  server.tool(
    "media_control",
    "Control a media player: play, pause, stop, next/previous track, or set volume. Fetches current state before and after.",
    {
      entity_id: z.string().describe("Media player entity ID (e.g. 'media_player.living_room')"),
      action: z
        .enum([
          "play",
          "pause",
          "stop",
          "next",
          "previous",
          "volume_up",
          "volume_down",
          "volume_mute",
          "volume_set",
        ])
        .describe("The media player action to perform"),
      volume_level: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Volume level (0.0 to 1.0). Required when action is 'volume_set'."),
      is_volume_muted: z
        .boolean()
        .optional()
        .describe("Mute state. Used when action is 'volume_mute'."),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "media_player");
      if (domainError) throw new ToolError(domainError);

      const action = args["action"] as string;
      const before = await fetchEntityState(entityId);

      // Map action names to HA service names
      const serviceMap: Record<string, string> = {
        play: "media_play",
        pause: "media_pause",
        stop: "media_stop",
        next: "media_next_track",
        previous: "media_previous_track",
        volume_up: "volume_up",
        volume_down: "volume_down",
        volume_mute: "volume_mute",
        volume_set: "volume_set",
      };

      const service = serviceMap[action];
      if (!service) throw new ToolError(`Unknown media action: ${action}`);

      const data: Record<string, unknown> = { entity_id: entityId };

      if (action === "volume_set") {
        const volumeLevel = args["volume_level"] as number | undefined;
        if (volumeLevel === undefined) {
          throw new ToolError("volume_level is required when action is 'volume_set'");
        }
        data["volume_level"] = volumeLevel;
      }

      if (action === "volume_mute") {
        const isMuted = args["is_volume_muted"] as boolean | undefined;
        data["is_volume_muted"] = isMuted ?? true;
      }

      await ha.callService("media_player", service, data);
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `Media player ${entityId}: ${action}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );

  server.tool(
    "media_play_content",
    "Play specific media content on a media player.",
    {
      entity_id: z.string().describe("Media player entity ID"),
      media_content_id: z.string().describe("The media content ID or URL to play"),
      media_content_type: z
        .string()
        .describe("Content type (e.g. 'music', 'video', 'playlist', 'channel')"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "media_player");
      if (domainError) throw new ToolError(domainError);

      const before = await fetchEntityState(entityId);

      await ha.callService("media_player", "play_media", {
        entity_id: entityId,
        media_content_id: args["media_content_id"],
        media_content_type: args["media_content_type"],
      });

      const after = await fetchEntityState(entityId);

      return toolResponse(
        `Playing ${args["media_content_type"]} on ${entityId}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );
}
