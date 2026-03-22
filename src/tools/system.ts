import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ha from "../ha/client.js";
import { toolResponse, toolError, withErrorHandling } from "./helpers.js";

export function registerSystemTools(server: McpServer): void {
  // ── get_config ────────────────────────────────────────────────

  server.tool(
    "get_config",
    "Get Home Assistant system configuration including location, version, and installed components.",
    {},
    withErrorHandling(async () => {
      const config = await ha.getConfig();
      return toolResponse("Home Assistant configuration:", config);
    }),
  );

  // ── get_services ──────────────────────────────────────────────

  server.tool(
    "get_services",
    "List all available services in Home Assistant, optionally filtered by domain.",
    {
      domain: z
        .string()
        .optional()
        .describe("Filter to a specific domain (e.g. 'light', 'climate')"),
    },
    withErrorHandling(async (args) => {
      const services = await ha.getServices();
      const domain = args["domain"] as string | undefined;

      if (domain) {
        const match = services.find((s) => s.domain === domain);
        if (!match) {
          return toolError(`Domain '${domain}' not found. Use get_services without a domain to see all available domains.`);
        }
        return toolResponse(
          `Services for domain '${domain}':`,
          {
            domain: match.domain,
            services: Object.entries(match.services).map(([name, svc]) => ({
              name,
              description: svc.description ?? null,
              fields: Object.entries(svc.fields).map(([fieldName, field]) => ({
                name: fieldName,
                description: field.description ?? null,
                required: field.required ?? false,
              })),
            })),
          },
        );
      }

      // Without domain filter, return a summary
      const summary = services.map((s) => ({
        domain: s.domain,
        service_count: Object.keys(s.services).length,
        services: Object.keys(s.services),
      }));

      return toolResponse(
        `${services.length} domains with services available:`,
        summary,
      );
    }),
  );

  // ── render_template ───────────────────────────────────────────

  server.tool(
    "render_template",
    "Render a Jinja2 template string using Home Assistant's template engine. Useful for complex state calculations.",
    {
      template: z
        .string()
        .describe("Jinja2 template string (e.g. '{{ states(\"sensor.temperature\") }}')"),
    },
    withErrorHandling(async (args) => {
      const template = args["template"] as string;
      const result = await ha.renderTemplate(template);
      return toolResponse(`Template result: ${result}`);
    }),
  );

  // ── check_config ──────────────────────────────────────────────

  server.tool(
    "check_config",
    "Validate the Home Assistant configuration files for errors.",
    {},
    withErrorHandling(async () => {
      const result = await ha.checkConfig();
      if (result.result === "valid") {
        return toolResponse("Configuration is valid. No errors found.");
      }
      return toolError(`Configuration errors found: ${result.errors ?? "Unknown error"}`);
    }),
  );

  // ── fire_event ────────────────────────────────────────────────

  server.tool(
    "fire_event",
    "Fire a custom event on the Home Assistant event bus.",
    {
      event_type: z.string().describe("Event type name (e.g. 'custom_event')"),
      event_data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional event data payload"),
    },
    withErrorHandling(async (args) => {
      const eventType = args["event_type"] as string;
      const eventData = args["event_data"] as Record<string, unknown> | undefined;

      const message = await ha.fireEvent(eventType, eventData);
      return toolResponse(`Event fired: ${message}`);
    }),
  );

  // ── send_notification ─────────────────────────────────────────

  server.tool(
    "send_notification",
    "Send a notification via Home Assistant's notification services.",
    {
      message: z.string().describe("Notification message text"),
      title: z.string().optional().describe("Notification title"),
      target: z
        .string()
        .default("notify")
        .describe("Notification service target (e.g. 'notify', 'mobile_app_phone'). Defaults to 'notify'."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Additional notification data (platform-specific)"),
    },
    withErrorHandling(async (args) => {
      const target = args["target"] as string;
      const serviceData: Record<string, unknown> = {
        message: args["message"],
      };

      const title = args["title"] as string | undefined;
      if (title) serviceData["title"] = title;

      const data = args["data"] as Record<string, unknown> | undefined;
      if (data) serviceData["data"] = data;

      await ha.callService("notify", target, serviceData);
      return toolResponse(`Notification sent via ${target}.`);
    }),
  );

  // ── call_service (generic escape hatch) ───────────────────────

  server.tool(
    "call_service",
    "Call any Home Assistant service directly. Use this for domains or services not covered by other tools.",
    {
      domain: z.string().describe("Service domain (e.g. 'light', 'switch', 'input_boolean')"),
      service: z.string().describe("Service name (e.g. 'turn_on', 'set_value')"),
      service_data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Service call data (entity_id and other parameters)"),
    },
    withErrorHandling(async (args) => {
      const domain = args["domain"] as string;
      const service = args["service"] as string;
      const data = args["service_data"] as Record<string, unknown> | undefined;

      const result = await ha.callService(domain, service, data);

      return toolResponse(
        `Called ${domain}.${service} successfully.`,
        result.length > 0
          ? result.map((s) => ({
              entity_id: s.entity_id,
              state: s.state,
            }))
          : undefined,
      );
    }),
  );

  // ── get_calendars ─────────────────────────────────────────────

  server.tool(
    "get_calendars",
    "List all calendar entities available in Home Assistant.",
    {},
    withErrorHandling(async () => {
      const calendars = await ha.getCalendars();
      return toolResponse(`Found ${calendars.length} calendars:`, calendars);
    }),
  );

  // ── get_calendar_events ───────────────────────────────────────

  server.tool(
    "get_calendar_events",
    "Get events from a calendar entity within a time range.",
    {
      entity_id: z.string().describe("Calendar entity ID (e.g. 'calendar.personal')"),
      start: z.string().describe("Start date/time in ISO 8601 format"),
      end: z.string().describe("End date/time in ISO 8601 format"),
    },
    withErrorHandling(async (args) => {
      const entityId = args["entity_id"] as string;
      const events = await ha.getCalendarEvents(
        entityId,
        args["start"] as string,
        args["end"] as string,
      );
      return toolResponse(`Found ${events.length} events:`, events);
    }),
  );
}
