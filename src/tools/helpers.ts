import { getState } from "../ha/client.js";
import { HAClientError } from "../ha/client.js";
import type { HAEntityState, StateChange } from "../ha/types.js";

/**
 * Shared helpers used by all tool modules to ensure consistent implementation.
 * Every state-changing tool follows: validate -> fetch before -> call service -> fetch after -> respond.
 */

/** Extract the domain from an entity_id (e.g. "light" from "light.living_room") */
export function entityDomain(entityId: string): string {
  const dot = entityId.indexOf(".");
  if (dot === -1) return "";
  return entityId.substring(0, dot);
}

/** Validate that an entity_id matches the expected domain(s) */
export function validateDomain(entityId: string, ...expectedDomains: string[]): string | null {
  const domain = entityDomain(entityId);
  if (expectedDomains.length > 0 && !expectedDomains.includes(domain)) {
    return `Entity '${entityId}' belongs to domain '${domain}', expected one of: ${expectedDomains.join(", ")}`;
  }
  return null;
}

/** Fetch entity state, returning a friendly error message if not found */
export async function fetchEntityState(entityId: string): Promise<HAEntityState> {
  try {
    return await getState(entityId);
  } catch (error) {
    if (error instanceof HAClientError && error.statusCode === 404) {
      throw new ToolError(`Entity '${entityId}' not found in Home Assistant`);
    }
    throw error;
  }
}

/** Build a before/after state change record */
export function buildStateChange(
  entityId: string,
  before: HAEntityState,
  after: HAEntityState,
): StateChange {
  return {
    entity_id: entityId,
    before: {
      state: before.state,
      attributes: before.attributes,
    },
    after: {
      state: after.state,
      attributes: after.attributes,
    },
  };
}

/** Format a successful tool response with text content */
export function toolResponse(text: string, data?: unknown) {
  const parts = [text];
  if (data !== undefined) {
    parts.push("\n```json\n" + JSON.stringify(data, null, 2) + "\n```");
  }
  return {
    content: [{ type: "text" as const, text: parts.join("") }],
  };
}

/** Format an error tool response (recoverable domain error) */
export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** Custom error class for tool-level validation errors */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Wraps a tool handler to provide consistent error handling.
 * Catches HAClientError and ToolError and returns appropriate MCP error responses.
 */
export function withErrorHandling(
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>,
) {
  return async (args: Record<string, unknown>) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof ToolError) {
        return toolError(error.message);
      }
      if (error instanceof HAClientError) {
        if (error.isRecoverable) {
          return toolError(`Home Assistant error: ${error.message}`);
        }
        // Non-recoverable (401) -- this is a server misconfiguration
        return toolError(
          "Home Assistant authentication failed. Check the HA_TOKEN in your server configuration.",
        );
      }
      const msg = error instanceof Error ? error.message : String(error);
      return toolError(`Unexpected error: ${msg}`);
    }
  };
}
