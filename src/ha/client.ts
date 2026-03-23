import { appConfig, isDev } from "../config.js";
import type {
  HAEntityState,
  HAServiceDomain,
  HAConfig,
  HACalendar,
  HACalendarEvent,
  HALogbookEntry,
  HAArea,
  HAEntityRegistryEntry,
  HAAutomationConfig,
  HADeviceRegistryEntry,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;

export class HAClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "HAClientError";
  }

  /** Whether this is a recoverable domain error (vs. a server misconfiguration) */
  get isRecoverable(): boolean {
    return this.statusCode !== 401;
  }
}

async function haFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${appConfig.HA_BASE_URL}${path}`;

  if (isDev) {
    process.stderr.write(`[HA] ${options.method ?? "GET"} ${path}\n`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${appConfig.HA_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "No response body");
      throw new HAClientError(
        `HA API error: ${response.status} ${response.statusText} - ${body}`,
        response.status,
        path,
      );
    }

    // Some HA endpoints return empty responses on success (e.g. service calls)
    const text = await response.text();
    if (text.length === 0) {
      return [] as unknown as T;
    }

    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof HAClientError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new HAClientError(
        `HA API request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        408,
        path,
      );
    }

    throw new HAClientError(
      `Failed to connect to Home Assistant: ${error instanceof Error ? error.message : String(error)}`,
      503,
      path,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ── Entity State ──────────────────────────────────────────────

export async function getStates(): Promise<HAEntityState[]> {
  return haFetch<HAEntityState[]>("/api/states");
}

export async function getState(entityId: string): Promise<HAEntityState> {
  return haFetch<HAEntityState>(`/api/states/${entityId}`);
}

// ── Services ──────────────────────────────────────────────────

export async function getServices(): Promise<HAServiceDomain[]> {
  return haFetch<HAServiceDomain[]>("/api/services");
}

export async function callService(
  domain: string,
  service: string,
  data?: Record<string, unknown>,
): Promise<HAEntityState[]> {
  return haFetch<HAEntityState[]>(`/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify(data ?? {}),
  });
}

// ── Config ────────────────────────────────────────────────────

export async function getConfig(): Promise<HAConfig> {
  return haFetch<HAConfig>("/api/config");
}

// ── History & Logbook ─────────────────────────────────────────

export async function getHistory(
  entityId: string,
  startTime?: string,
  endTime?: string,
): Promise<HAEntityState[][]> {
  const params = new URLSearchParams();
  params.set("filter_entity_id", entityId);
  if (endTime) params.set("end_time", endTime);

  const timestamp = startTime ?? new Date(Date.now() - 86_400_000).toISOString();
  return haFetch<HAEntityState[][]>(
    `/api/history/period/${timestamp}?${params.toString()}`,
  );
}

export async function getLogbook(
  startTime?: string,
  entityId?: string,
): Promise<HALogbookEntry[]> {
  const params = new URLSearchParams();
  if (entityId) params.set("entity", entityId);

  const timestamp = startTime ?? new Date(Date.now() - 86_400_000).toISOString();
  return haFetch<HALogbookEntry[]>(
    `/api/logbook/${timestamp}?${params.toString()}`,
  );
}

// ── Calendars ─────────────────────────────────────────────────

export async function getCalendars(): Promise<HACalendar[]> {
  return haFetch<HACalendar[]>("/api/calendars");
}

export async function getCalendarEvents(
  entityId: string,
  start: string,
  end: string,
): Promise<HACalendarEvent[]> {
  const params = new URLSearchParams({ start, end });
  return haFetch<HACalendarEvent[]>(
    `/api/calendars/${entityId}?${params.toString()}`,
  );
}

// ── Templates ─────────────────────────────────────────────────

export async function renderTemplate(template: string): Promise<string> {
  const response = await fetch(`${appConfig.HA_BASE_URL}/api/template`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appConfig.HA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ template }),
  });

  if (!response.ok) {
    throw new HAClientError(
      `Template render failed: ${response.status}`,
      response.status,
      "/api/template",
    );
  }

  return response.text();
}

// ── Error Log ─────────────────────────────────────────────────

export async function getErrorLog(): Promise<string> {
  const response = await fetch(`${appConfig.HA_BASE_URL}/api/error_log`, {
    headers: {
      Authorization: `Bearer ${appConfig.HA_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new HAClientError(
      `Error log fetch failed: ${response.status}`,
      response.status,
      "/api/error_log",
    );
  }

  return response.text();
}

// ── Events ────────────────────────────────────────────────────

export async function fireEvent(
  eventType: string,
  eventData?: Record<string, unknown>,
): Promise<string> {
  const result = await haFetch<{ message: string }>(
    `/api/events/${eventType}`,
    {
      method: "POST",
      body: JSON.stringify(eventData ?? {}),
    },
  );
  return result.message;
}

// ── Areas & Entity Registry (via WebSocket-like REST endpoints) ──

export async function getAreas(): Promise<HAArea[]> {
  // The areas endpoint is available in newer HA versions
  // Falls back gracefully if not available
  try {
    return await haFetch<HAArea[]>("/api/config/area_registry/list");
  } catch {
    return [];
  }
}

export async function getEntityRegistry(): Promise<HAEntityRegistryEntry[]> {
  try {
    // Newer HA versions require POST for config registry endpoints
    return await haFetch<HAEntityRegistryEntry[]>(
      "/api/config/entity_registry/list",
      { method: "POST" },
    );
  } catch {
    return [];
  }
}

// ── Automation Config CRUD ────────────────────────────────────

export async function getAutomationConfig(
  automationId: string,
): Promise<HAAutomationConfig> {
  return haFetch<HAAutomationConfig>(
    `/api/config/automation/config/${automationId}`,
  );
}

export async function createAutomation(
  automationId: string,
  config: HAAutomationConfig,
): Promise<{ result: string }> {
  return haFetch<{ result: string }>(
    `/api/config/automation/config/${automationId}`,
    {
      method: "POST",
      body: JSON.stringify(config),
    },
  );
}

export async function updateAutomation(
  automationId: string,
  config: HAAutomationConfig,
): Promise<{ result: string }> {
  // HA uses POST for both create and update on this endpoint
  return createAutomation(automationId, config);
}

export async function deleteAutomation(
  automationId: string,
): Promise<{ result: string }> {
  return haFetch<{ result: string }>(
    `/api/config/automation/config/${automationId}`,
    { method: "DELETE" },
  );
}

export async function listAutomations(): Promise<HAEntityState[]> {
  const states = await getStates();
  return states.filter((s) => s.entity_id.startsWith("automation."));
}

// ── Device Registry ──────────────────────────────────────────

export async function getDeviceRegistry(): Promise<HADeviceRegistryEntry[]> {
  try {
    return await haFetch<HADeviceRegistryEntry[]>(
      "/api/config/device_registry/list",
    );
  } catch {
    return [];
  }
}

// ── Health Check ──────────────────────────────────────────────

export async function checkConnection(): Promise<boolean> {
  try {
    await haFetch("/api/");
    return true;
  } catch {
    return false;
  }
}

// ── Config Check ──────────────────────────────────────────────

export async function checkConfig(): Promise<{ result: string; errors: string | null }> {
  return haFetch<{ result: string; errors: string | null }>(
    "/api/config/core/check_config",
    { method: "POST" },
  );
}
