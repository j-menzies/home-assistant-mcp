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

export function registerCoverLockTools(server: McpServer): void {
  // ── set_cover ─────────────────────────────────────────────────

  server.tool(
    "set_cover",
    "Control a cover entity (blinds, garage door, curtains). Open, close, stop, or set position.",
    {
      entity_id: z.string().describe("Cover entity ID (e.g. 'cover.garage_door')"),
      action: z
        .enum(["open", "close", "stop", "set_position"])
        .describe("The cover action to perform"),
      position: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Cover position (0 = closed, 100 = open). Required when action is 'set_position'."),
      tilt_position: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Tilt position (0-100). Optional, for covers that support tilt."),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "cover");
      if (domainError) throw new ToolError(domainError);

      const action = args["action"] as string;
      const before = await fetchEntityState(entityId);

      // Staleness check for open/close
      if (action === "open" && before.state === "open") {
        return toolResponse(`${entityId} is already open. No action taken.`);
      }
      if (action === "close" && before.state === "closed") {
        return toolResponse(`${entityId} is already closed. No action taken.`);
      }

      const serviceMap: Record<string, string> = {
        open: "open_cover",
        close: "close_cover",
        stop: "stop_cover",
        set_position: "set_cover_position",
      };

      const data: Record<string, unknown> = { entity_id: entityId };

      if (action === "set_position") {
        const position = args["position"] as number | undefined;
        if (position === undefined) {
          throw new ToolError("position is required when action is 'set_position'");
        }
        data["position"] = position;
      }

      const tiltPosition = args["tilt_position"] as number | undefined;
      if (tiltPosition !== undefined) {
        data["tilt_position"] = tiltPosition;
      }

      await ha.callService("cover", serviceMap[action]!, data);
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `Cover ${entityId}: ${action}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );

  // ── set_lock ──────────────────────────────────────────────────

  server.tool(
    "set_lock",
    "Lock or unlock a lock entity. Fetches current state first to avoid redundant calls.",
    {
      entity_id: z.string().describe("Lock entity ID (e.g. 'lock.front_door')"),
      action: z.enum(["lock", "unlock"]).describe("Whether to lock or unlock"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const domainError = validateDomain(entityId, "lock");
      if (domainError) throw new ToolError(domainError);

      const action = args["action"] as string;
      const before = await fetchEntityState(entityId);

      // Staleness check
      if (action === "lock" && before.state === "locked") {
        return toolResponse(`${entityId} is already locked. No action taken.`);
      }
      if (action === "unlock" && before.state === "unlocked") {
        return toolResponse(`${entityId} is already unlocked. No action taken.`);
      }

      await ha.callService("lock", action, { entity_id: entityId });
      const after = await fetchEntityState(entityId);

      return toolResponse(
        `${action === "lock" ? "Locked" : "Unlocked"} ${entityId}.`,
        buildStateChange(entityId, before, after),
      );
    }),
  );
}
