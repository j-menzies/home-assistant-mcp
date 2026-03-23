/**
 * Home Assistant WebSocket client.
 *
 * Some HA APIs (voice assistant exposure, entity registry updates) are only
 * available via WebSocket. This module provides a minimal client that
 * authenticates once and allows sending commands.
 */

import WebSocket from "ws";
import { appConfig } from "../config.js";

// ── Types ──────────────────────────────────────────────────────

interface HAWebSocketMessage {
  type: string;
  id?: number;
  [key: string]: unknown;
}

interface HAWebSocketResult {
  id: number;
  type: "result";
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

// ── Connection Management ──────────────────────────────────────

let ws: WebSocket | null = null;
let msgId = 1;
let authenticated = false;
const pendingRequests = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const WS_TIMEOUT_MS = 15_000;

function getWsUrl(): string {
  const baseUrl = appConfig.HA_BASE_URL;
  // Convert http(s) to ws(s)
  const wsUrl = baseUrl
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://");
  return `${wsUrl}/api/websocket`;
}

function cleanup(): void {
  authenticated = false;
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("WebSocket connection closed"));
    pendingRequests.delete(id);
  }
  ws = null;
}

/**
 * Get an authenticated WebSocket connection to Home Assistant.
 * Reuses existing connection if available.
 */
async function getConnection(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN && authenticated) {
    return ws;
  }

  // Close stale connection
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    cleanup();
  }

  return new Promise<WebSocket>((resolve, reject) => {
    const url = getWsUrl();
    process.stderr.write(`[HA-WS] Connecting to ${url}\n`);

    const socket = new WebSocket(url);
    let authResolved = false;

    const timeout = setTimeout(() => {
      if (!authResolved) {
        authResolved = true;
        socket.close();
        reject(new Error("WebSocket authentication timed out"));
      }
    }, WS_TIMEOUT_MS);

    socket.on("open", () => {
      process.stderr.write("[HA-WS] Connected, waiting for auth_required\n");
    });

    socket.on("message", (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString()) as HAWebSocketMessage;

      if (msg.type === "auth_required") {
        socket.send(
          JSON.stringify({
            type: "auth",
            access_token: appConfig.HA_TOKEN,
          }),
        );
        return;
      }

      if (msg.type === "auth_ok") {
        clearTimeout(timeout);
        authResolved = true;
        authenticated = true;
        ws = socket;
        process.stderr.write("[HA-WS] Authenticated\n");
        resolve(socket);
        return;
      }

      if (msg.type === "auth_invalid") {
        clearTimeout(timeout);
        authResolved = true;
        socket.close();
        reject(new Error("WebSocket authentication failed - invalid token"));
        return;
      }

      // Handle command results
      if (msg.type === "result" && msg.id !== undefined) {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(msg.id);
          const result = msg as unknown as HAWebSocketResult;
          if (result.success) {
            pending.resolve(result.result);
          } else {
            pending.reject(
              new Error(
                `HA WebSocket error: ${result.error?.code} - ${result.error?.message}`,
              ),
            );
          }
        }
      }
    });

    socket.on("error", (err: Error) => {
      process.stderr.write(`[HA-WS] Error: ${err.message}\n`);
      if (!authResolved) {
        clearTimeout(timeout);
        authResolved = true;
        reject(err);
      }
    });

    socket.on("close", () => {
      process.stderr.write("[HA-WS] Connection closed\n");
      cleanup();
      if (!authResolved) {
        clearTimeout(timeout);
        authResolved = true;
        reject(new Error("WebSocket closed before authentication"));
      }
    });
  });
}

/**
 * Send a command to Home Assistant via WebSocket and wait for the result.
 */
export async function sendCommand<T = unknown>(
  type: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const socket = await getConnection();
  const id = msgId++;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`WebSocket command timed out: ${type}`));
    }, WS_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    socket.send(
      JSON.stringify({
        id,
        type,
        ...data,
      }),
    );
  });
}

// ── Voice Assistant Exposure ──────────────────────────────────

export interface ExposedEntity {
  entity_id: string;
  assistants: Record<string, { should_expose: boolean }>;
}

/**
 * Expose or unexpose entities to a voice assistant.
 */
export async function exposeEntity(
  entityIds: string[],
  assistants: string[],
  shouldExpose: boolean,
): Promise<void> {
  await sendCommand("homeassistant/expose_entity", {
    assistants,
    entity_ids: entityIds,
    should_expose: shouldExpose,
  });
}

/**
 * Get the current voice assistant exposure configuration.
 */
export async function getExposedEntities(): Promise<{
  exposed_entities: Record<
    string,
    { assistants: Record<string, { should_expose: boolean }> }
  >;
}> {
  return sendCommand("homeassistant/expose_entity/list");
}

// ── Entity Registry (WebSocket version) ───────────────────────

export interface WSEntityRegistryEntry {
  entity_id: string;
  name: string | null;
  original_name: string | null;
  platform: string;
  device_id: string | null;
  area_id: string | null;
  disabled_by: string | null;
  hidden_by: string | null;
  entity_category: string | null;
  options: Record<string, unknown> | null;
}

/**
 * List all entities from the entity registry via WebSocket.
 * More reliable than the REST endpoint in newer HA versions.
 */
export async function getEntityRegistryWS(): Promise<
  WSEntityRegistryEntry[]
> {
  return sendCommand<WSEntityRegistryEntry[]>(
    "config/entity_registry/list",
  );
}

/**
 * Close the WebSocket connection gracefully.
 */
export function disconnect(): void {
  if (ws) {
    ws.close();
    cleanup();
  }
}
