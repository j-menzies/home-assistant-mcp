/**
 * Home Assistant REST API type definitions.
 * These represent the response shapes from the HA API.
 */

export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

export interface HAServiceField {
  name?: string;
  description?: string;
  required?: boolean;
  example?: unknown;
  selector?: Record<string, unknown>;
}

export interface HAService {
  name?: string;
  description?: string;
  fields: Record<string, HAServiceField>;
  target?: {
    entity?: Array<{ domain?: string }>;
    device?: Array<Record<string, unknown>>;
    area?: Array<Record<string, unknown>>;
  };
}

export interface HAServiceDomain {
  domain: string;
  services: Record<string, HAService>;
}

export interface HAConfig {
  latitude: number;
  longitude: number;
  elevation: number;
  unit_system: Record<string, string>;
  location_name: string;
  time_zone: string;
  components: string[];
  version: string;
  state: string;
}

export interface HACalendar {
  entity_id: string;
  name: string;
}

export interface HACalendarEvent {
  summary: string;
  start: string | { dateTime: string; date?: string };
  end: string | { dateTime: string; date?: string };
  description?: string;
  location?: string;
}

export interface HALogbookEntry {
  when: string;
  name: string;
  state?: string;
  entity_id?: string;
  message?: string;
}

export interface HAArea {
  area_id: string;
  name: string;
  picture?: string | null;
}

export interface HADevice {
  id: string;
  name: string | null;
  area_id: string | null;
}

export interface HAEntityRegistryEntry {
  entity_id: string;
  name: string | null;
  platform: string;
  device_id: string | null;
  area_id: string | null;
  disabled_by: string | null;
}

/** Result shape returned by service calls */
export interface HAServiceCallResult {
  /** HA returns an array of affected entity states on service calls */
  states?: HAEntityState[];
}

/** Describes a before/after state pair for tool responses */
export interface StateChange {
  entity_id: string;
  before: {
    state: string;
    attributes: Record<string, unknown>;
  };
  after: {
    state: string;
    attributes: Record<string, unknown>;
  };
}
