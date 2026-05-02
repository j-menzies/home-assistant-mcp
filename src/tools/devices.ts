import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ha from "../ha/client.js";
import { sendCommand } from "../ha/websocket.js";
import { toolResponse, withErrorHandling } from "./helpers.js";

export function registerDeviceTools(server: McpServer): void {
  // ── get_devices ─────────────────────────────────────────────

  server.tool(
    "get_devices",
    "List devices from the Home Assistant device registry. Returns manufacturer, model, area, firmware version, and connection info. Useful for auditing the network.",
    {
      area: z
        .string()
        .optional()
        .describe("Filter by area name (matches area_id)"),
      manufacturer: z
        .string()
        .optional()
        .describe("Filter by manufacturer name (case-insensitive partial match)"),
      model: z
        .string()
        .optional()
        .describe("Filter by model name (case-insensitive partial match)"),
      search: z
        .string()
        .optional()
        .describe("Free-text search across device name, manufacturer, and model"),
    },
    withErrorHandling(async (args) => {
      const area = args["area"] as string | undefined;
      const manufacturer = args["manufacturer"] as string | undefined;
      const model = args["model"] as string | undefined;
      const search = args["search"] as string | undefined;

      let devices = await ha.getDeviceRegistry();

      // Resolve area names to area_ids for filtering
      let areaIdFilter: string | undefined;
      if (area) {
        const areas = await ha.getAreas();
        const match = areas.find(
          (a) =>
            a.area_id.toLowerCase() === area.toLowerCase() ||
            a.name.toLowerCase() === area.toLowerCase(),
        );
        areaIdFilter = match?.area_id;
        if (!areaIdFilter) {
          // Try partial match
          const partial = areas.find(
            (a) =>
              a.name.toLowerCase().includes(area.toLowerCase()) ||
              a.area_id.toLowerCase().includes(area.toLowerCase()),
          );
          areaIdFilter = partial?.area_id;
        }
      }

      if (areaIdFilter) {
        devices = devices.filter((d) => d.area_id === areaIdFilter);
      }

      if (manufacturer) {
        const lc = manufacturer.toLowerCase();
        devices = devices.filter(
          (d) => d.manufacturer?.toLowerCase().includes(lc),
        );
      }

      if (model) {
        const lc = model.toLowerCase();
        devices = devices.filter((d) => d.model?.toLowerCase().includes(lc));
      }

      if (search) {
        const lc = search.toLowerCase();
        devices = devices.filter(
          (d) =>
            (d.name?.toLowerCase().includes(lc)) ||
            (d.name_by_user?.toLowerCase().includes(lc)) ||
            (d.manufacturer?.toLowerCase().includes(lc)) ||
            (d.model?.toLowerCase().includes(lc)),
        );
      }

      // If no filters, return a summary by manufacturer
      if (!area && !manufacturer && !model && !search) {
        const byManufacturer: Record<string, number> = {};
        for (const d of devices) {
          const mfr = d.manufacturer ?? "Unknown";
          byManufacturer[mfr] = (byManufacturer[mfr] ?? 0) + 1;
        }

        const summary = {
          total_devices: devices.length,
          by_manufacturer: Object.entries(byManufacturer)
            .sort(([, a], [, b]) => b - a)
            .map(([name, count]) => ({ manufacturer: name, count })),
        };

        return toolResponse(
          `Found ${devices.length} devices. Use filters (area, manufacturer, model, search) to see details.`,
          summary,
        );
      }

      // With filters, return full details
      const result = devices.map((d) => ({
        id: d.id,
        name: d.name_by_user ?? d.name,
        manufacturer: d.manufacturer,
        model: d.model,
        sw_version: d.sw_version,
        hw_version: d.hw_version,
        area_id: d.area_id,
        disabled_by: d.disabled_by,
        via_device_id: d.via_device_id,
      }));

      return toolResponse(
        `Found ${result.length} devices matching your filters:`,
        result,
      );
    }),
  );

  // ── get_entity_registry ─────────────────────────────────────

  server.tool(
    "get_entity_registry",
    "List entities from the HA entity registry with their platform, device, and area assignments. More detailed than get_entities - shows the underlying platform and device relationships.",
    {
      domain: z
        .string()
        .optional()
        .describe("Filter by entity domain (e.g. 'light', 'sensor')"),
      platform: z
        .string()
        .optional()
        .describe("Filter by integration platform (e.g. 'hue', 'zha', 'mqtt')"),
      search: z
        .string()
        .optional()
        .describe("Free-text search across entity_id and name"),
      include_disabled: z
        .boolean()
        .default(false)
        .describe("Include disabled entities (default: false)"),
    },
    withErrorHandling(async (args) => {
      const domain = args["domain"] as string | undefined;
      const platform = args["platform"] as string | undefined;
      const search = args["search"] as string | undefined;
      const includeDisabled = args["include_disabled"] as boolean;

      let entries = await ha.getEntityRegistry();

      if (!includeDisabled) {
        entries = entries.filter((e) => !e.disabled_by);
      }

      if (domain) {
        entries = entries.filter((e) => e.entity_id.startsWith(`${domain}.`));
      }

      if (platform) {
        const lc = platform.toLowerCase();
        entries = entries.filter((e) => e.platform.toLowerCase() === lc);
      }

      if (search) {
        const lc = search.toLowerCase();
        entries = entries.filter(
          (e) =>
            e.entity_id.toLowerCase().includes(lc) ||
            (e.name?.toLowerCase().includes(lc)),
        );
      }

      // Without filters, return a summary by platform
      if (!domain && !platform && !search) {
        const byPlatform: Record<string, number> = {};
        for (const e of entries) {
          byPlatform[e.platform] = (byPlatform[e.platform] ?? 0) + 1;
        }

        return toolResponse(
          `Found ${entries.length} entities in registry. Use filters to see details.`,
          {
            total_entities: entries.length,
            by_platform: Object.entries(byPlatform)
              .sort(([, a], [, b]) => b - a)
              .map(([name, count]) => ({ platform: name, count })),
          },
        );
      }

      const result = entries.map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        platform: e.platform,
        device_id: e.device_id,
        area_id: e.area_id,
        disabled_by: e.disabled_by,
      }));

      return toolResponse(
        `Found ${result.length} entities matching your filters:`,
        result,
      );
    }),
  );

  // ── get_areas ───────────────────────────────────────────────

  server.tool(
    "get_areas",
    "List all areas/rooms configured in Home Assistant.",
    {},
    withErrorHandling(async () => {
      const areas = await ha.getAreas();
      return toolResponse(
        `Found ${areas.length} areas:`,
        areas.map((a) => ({ area_id: a.area_id, name: a.name })),
      );
    }),
  );

  // ── set_device_area ─────────────────────────────────────────

  server.tool(
    "set_device_area",
    "Assign a device to an area/room in Home Assistant. Use get_devices to find device IDs and get_areas to find area IDs.",
    {
      device_id: z.string().describe("The device ID to update"),
      area_id: z
        .string()
        .describe("The area ID to assign (e.g. 'living_room', 'kitchen'). Use empty string to unassign."),
    },
    withErrorHandling(async (args) => {
      const deviceId = args["device_id"] as string;
      const areaId = args["area_id"] as string;

      const result = await sendCommand<Record<string, unknown>>(
        "config/device_registry/update",
        {
          device_id: deviceId,
          area_id: areaId || null,
        },
      );

      const name = (result?.name as string) ?? (result?.name_by_user as string) ?? deviceId;
      return toolResponse(
        `Updated device "${name}" area to "${areaId || "unassigned"}":`,
        { device_id: deviceId, area_id: areaId || null, name },
      );
    }),
  );
}
