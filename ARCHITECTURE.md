# Home Assistant MCP Server - Architecture Document

## 1. Overview

An MCP (Model Context Protocol) server that exposes Home Assistant functionality to AI assistants via the standardised MCP protocol. The server runs on a Raspberry Pi alongside Home Assistant, communicating with HA via its REST API and authenticated using Long-Lived Access Tokens.

MCP clients (such as Claude Desktop) connect to this server over HTTP with Server-Sent Events (SSE) for streaming responses, secured by a pre-shared API key over HTTPS.

---

## 2. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (LTS) | Stable, well-supported on ARM/Pi |
| Language | TypeScript | Type safety, excellent MCP SDK support |
| MCP SDK | `@modelcontextprotocol/sdk` v1.x | Official Tier 1 SDK, production-ready |
| HTTP Framework | Express (via `@modelcontextprotocol/express`) | DNS rebinding protection built-in, mature middleware ecosystem |
| HA Communication | REST API via `fetch` | Simpler than WebSocket for request/response patterns, no persistent connection management |
| Schema Validation | Zod v4 | Required peer dependency of MCP SDK |
| Process Manager | systemd | Auto-restart, log management, native to Pi OS |
| TLS Termination | nginx reverse proxy | Handles HTTPS, SSE proxying, access logging |
| Certificate Authority | Local private CA | Trusted certs with no browser warnings, 2-year server cert lifecycle |

### Why REST over WebSocket for HA Communication?

The WebSocket API offers real-time event subscriptions, but for an MCP server that responds to tool invocations (request/response pattern), REST is the better fit. It avoids connection management complexity, reconnection logic, and message correlation. If we later need real-time subscriptions (e.g. for MCP resources that stream state changes), we can add a WebSocket layer selectively.

---

## 3. Architecture Diagram

```
+------------------+      HTTPS + SSE       +--------------+       HTTP        +-------------------+
|                  | (Bearer API Key auth)  |              | (reverse proxy)   |                   |
|   MCP Client     |<=====================>|    nginx      |<=================>| MCP Server        |
|  (Claude Desktop |    Port 443 /mcp      |  TLS termn.  |  127.0.0.1:3000   | (Node.js/Express) |
|   or other)      |                        |              |                   |                   |
+------------------+                        +--------------+                   +--------+----------+
                                                                                        |
                                                                                        | HTTP REST API
                                                                                        | (Bearer HA Token)
                                                                                        |
                                                                               +--------v----------+
                                                                               |                   |
                                                                               |  Home Assistant    |
                                                                               |  localhost:8123    |
                                                                               |                   |
                                                                               +-------------------+
```

**Key points:**
- nginx handles TLS termination using certs signed by a local private CA
- Node.js binds to `127.0.0.1:3000` only (not network-accessible directly)
- All external traffic flows through nginx on port 443
- SSE streaming is supported via nginx with buffering disabled
- See `docs/LOCAL-CA-SETUP.md` for the full CA and nginx configuration guide

---

## 4. Authentication & Security

### 4.1 MCP Server Authentication (Client -> MCP Server)

**Mechanism:** Pre-shared API key transmitted as a Bearer token in the `Authorization` header, over HTTPS.

**Flow:**
1. On first run, the server generates a cryptographically random API key (256-bit) and stores it in the server's `.env` file
2. The operator copies this key into their MCP client configuration (e.g. `.mcp.json`)
3. Every incoming HTTP request is validated against this key before any MCP processing occurs
4. Requests with missing or invalid keys receive a `401 Unauthorized` response

**Key Rotation:** The operator can regenerate the key via a CLI command (`npm run rotate-key`), which updates the `.env` and requires updating the client configuration.

**MCP Client Configuration Example:**
```json
{
  "mcpServers": {
    "home-assistant": {
      "type": "http",
      "url": "https://192.168.1.x:3000/mcp",
      "headers": {
        "Authorization": "Bearer ${HA_MCP_API_KEY}"
      }
    }
  }
}
```

### 4.2 Home Assistant Authentication (MCP Server -> HA)

**Mechanism:** Long-Lived Access Token passed as a Bearer token to the HA REST API.

**Storage:** The HA token is stored in the server's `.env` file, never exposed to MCP clients.

**Principle of Least Privilege:** Consider creating a dedicated HA user with appropriate permissions for the MCP server, rather than using your admin account's token.

### 4.3 TLS via nginx and Local CA

TLS is terminated at nginx, not in the Node.js process. Certificates are issued by a local private Certificate Authority:

- A private CA is created once on the Pi (4096-bit RSA key, 10-year root cert)
- The CA root certificate is installed and trusted on each client device (one-time setup per device)
- Server certificates are signed by this CA (2-year validity, renewable without re-trusting clients)
- nginx handles all TLS negotiation -- the Node.js process only speaks plain HTTP on localhost
- Full setup guide: `docs/LOCAL-CA-SETUP.md`

### 4.4 Network Security

- Node.js binds to `127.0.0.1:3000` -- not reachable from the network directly
- nginx exposes port 443 on `192.168.1.33` and proxies to localhost
- nginx can optionally restrict access by subnet (`allow 192.168.1.0/24; deny all;`)
- No port forwarding or public internet exposure required
- Firewall rules (via `ufw`) should restrict port 443 to the local subnet as belt-and-braces

---

## 5. Project Structure

```
home-assistant-mcp/
  src/
    index.ts                  # Entry point, Express server setup
    config.ts                 # Environment configuration with validation
    auth/
      middleware.ts           # API key validation middleware
    ha/
      client.ts              # Home Assistant REST API client
      types.ts               # HA API response types
    tools/
      index.ts               # Tool registry (aggregates all tool modules)
      entity-control.ts      # Light, switch, fan, cover, lock, etc.
      climate.ts             # Thermostat and climate control
      media.ts               # Media player control
      automation.ts          # Automations, scripts, and scenes
      sensors.ts             # Sensor data retrieval
      system.ts              # HA system info, config, error log
      history.ts             # Historical state data
      notifications.ts       # Send notifications via HA
      templates.ts           # Render Jinja2 templates
    resources/
      index.ts               # Resource registry
      entities.ts            # Entity state resources
      areas.ts               # Area/room resources
  scripts/
    rotate-key.ts             # API key rotation utility
  docs/
    LOCAL-CA-SETUP.md         # CA creation, nginx config, and client trust guide
  .env.example                # Template for environment variables
  tsconfig.json
  package.json
  README.md
```

---

## 6. MCP Tools Catalogue

Tools are the primary mechanism for MCP clients to interact with Home Assistant. Each tool maps to one or more HA REST API calls.

### 6.1 Entity Control Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `get_entities` | List all entities, optionally filtered by domain | `GET /api/states` |
| `get_entity_state` | Get current state and attributes of a specific entity | `GET /api/states/{entity_id}` |
| `turn_on` | Turn on an entity (light, switch, fan, etc.) with optional attributes | `POST /api/services/{domain}/turn_on` |
| `turn_off` | Turn off an entity | `POST /api/services/{domain}/turn_off` |
| `toggle` | Toggle an entity's state | `POST /api/services/{domain}/toggle` |

### 6.2 Light-Specific Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `set_light` | Control light brightness, colour temp, RGB, transition | `POST /api/services/light/turn_on` |

### 6.3 Climate Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `set_climate` | Set target temperature, HVAC mode, fan mode, preset | `POST /api/services/climate/set_temperature`, `set_hvac_mode`, `set_fan_mode`, `set_preset_mode` |
| `get_climate_state` | Get thermostat state with all attributes | `GET /api/states/{climate.entity_id}` |

### 6.4 Media Player Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `media_control` | Play, pause, stop, next, previous, volume control | `POST /api/services/media_player/{action}` |
| `media_play_content` | Play specific media content | `POST /api/services/media_player/play_media` |

### 6.5 Cover & Lock Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `set_cover` | Open, close, stop, or set cover position | `POST /api/services/cover/{action}` |
| `set_lock` | Lock or unlock | `POST /api/services/lock/{action}` |

### 6.6 Automation & Scene Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `trigger_automation` | Trigger an automation | `POST /api/services/automation/trigger` |
| `toggle_automation` | Enable or disable an automation | `POST /api/services/automation/turn_on` or `turn_off` |
| `run_script` | Execute a script | `POST /api/services/script/turn_on` |
| `activate_scene` | Activate a scene | `POST /api/services/scene/turn_on` |

### 6.7 Sensor & History Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `get_sensor_history` | Get historical state changes for a sensor | `GET /api/history/period/{timestamp}` |
| `get_logbook` | Get logbook entries for an entity or time range | `GET /api/logbook/{timestamp}` |

### 6.8 System & Utility Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `get_config` | Get HA system configuration | `GET /api/config` |
| `get_services` | List all available services and their fields | `GET /api/services` |
| `render_template` | Render a Jinja2 template string | `POST /api/template` |
| `check_config` | Validate HA configuration | `POST /api/config/core/check_config` |
| `fire_event` | Fire a custom event | `POST /api/events/{event_type}` |
| `send_notification` | Send a notification via HA's notify services | `POST /api/services/notify/{target}` |
| `call_service` | Generic service call for any domain/service not covered above | `POST /api/services/{domain}/{service}` |

### 6.9 Calendar Tools

| Tool Name | Description | HA API Endpoint |
|-----------|-------------|-----------------|
| `get_calendars` | List available calendar entities | `GET /api/calendars` |
| `get_calendar_events` | Get events from a calendar within a time range | `GET /api/calendars/{entity_id}` |

---

## 7. MCP Resources

Resources provide read-only reference data that MCP clients can browse and subscribe to.

| Resource URI | Description | Source |
|-------------|-------------|--------|
| `ha://entities` | Full entity list with current states | `GET /api/states` |
| `ha://entities/{entity_id}` | Individual entity state and attributes | `GET /api/states/{entity_id}` |
| `ha://services` | Available services by domain | `GET /api/services` |
| `ha://config` | Home Assistant configuration | `GET /api/config` |
| `ha://areas` | Areas/rooms (via services API) | `GET /api/config` |
| `ha://error-log` | Current error log | `GET /api/error_log` |

Resources use URI templates for dynamic entity lookup, with completions to help clients discover valid entity IDs.

---

## 8. Configuration

### Environment Variables (.env)

```
# MCP Server Configuration
MCP_API_KEY=<generated-256-bit-key>
MCP_PORT=3000
MCP_HOST=127.0.0.1            # Localhost in both dev and prod
NODE_ENV=development           # "development" or "production"

# Home Assistant Configuration
HA_BASE_URL=http://localhost:8123       # Production (on Pi, HA is local)
# HA_BASE_URL=http://192.168.1.33:8123  # Development (Mac, pointing at Pi)
HA_TOKEN=<long-lived-access-token>
```

### Development vs Production

| Concern | Development (Mac) | Production (Pi) |
|---------|------------------|-----------------|
| MCP endpoint | `http://localhost:3000/mcp` | `https://192.168.1.33/mcp` (via nginx) |
| HA base URL | `http://192.168.1.33:8123` (remote Pi) | `http://localhost:8123` (local) |
| TLS | None (direct to Node.js) | nginx terminates HTTPS |
| API key auth | Still enforced | Still enforced |
| Auth bypass | Optional `MCP_SKIP_AUTH=true` for early testing | Never |

In development mode (`NODE_ENV=development`), the server logs more verbosely and optionally allows skipping API key auth for rapid iteration. The application code is identical in both environments.

---

## 9. Error Handling Strategy

### Two-Tier Approach

1. **Domain Errors** (recoverable): Returned as `{ isError: true, content: [...] }` in tool responses. These include HA API errors (entity not found, service unavailable, invalid parameters). The AI client can interpret these and adjust its approach.

2. **Protocol Errors** (fatal): Thrown as `McpError` for fundamental issues (authentication failure, malformed requests). These terminate the request.

### HA API Error Mapping

| HA Status | MCP Response |
|-----------|-------------|
| 200/201 | Success with state data |
| 400 | Domain error: invalid parameters |
| 401 | Protocol error: HA token invalid (server misconfiguration) |
| 404 | Domain error: entity/service not found |
| 500+ | Domain error: HA unavailable |

### Timeout Policy

All HA API calls have a 30-second timeout. Long-running operations (e.g. history queries over large date ranges) will return partial results with a warning if they approach the limit.

---

## 10. Deployment on Raspberry Pi

### Prerequisites

- Raspberry Pi 3B+ or newer (4+ recommended for comfortable headroom)
- Node.js 20 LTS installed (via NodeSource or nvm)
- nginx installed and running
- Home Assistant running and accessible at `localhost:8123`
- Long-Lived Access Token generated from HA profile page
- Local CA and server certificate set up (see `docs/LOCAL-CA-SETUP.md`)
- nginx configured with the MCP reverse proxy (see `docs/LOCAL-CA-SETUP.md`)

### Process Management (systemd)

```ini
[Unit]
Description=Home Assistant MCP Server
After=network.target nginx.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/home-assistant-mcp
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/home/pi/home-assistant-mcp/.env

[Install]
WantedBy=multi-user.target
```

### Resource Considerations

The server should be lightweight. Expected memory usage is under 100MB. The main cost is the Node.js runtime itself. If memory is tight on a Pi 3B+, consider using `--max-old-space-size=128` to cap the V8 heap, or running in stateless mode to avoid session accumulation.

---

## 11. Future Considerations

These are out of scope for the initial build but worth noting:

- **WebSocket subscription layer**: For real-time entity state streaming via MCP resources
- **Tailscale integration**: For secure remote access without port forwarding
- **Entity area mapping**: Grouping tools/resources by room/area for more intuitive AI interaction
- **Rate limiting**: Request throttling if the server is opened to multiple clients
- **Caching layer**: Cache entity states with short TTL to reduce HA API calls during conversational bursts
- **Prompts**: Pre-built MCP prompts for common workflows (e.g. "bedtime routine", "energy report")

---

## 12. Design Decisions (Resolved)

### 12.1 Stateful Sessions with Staleness Protection

Sessions are **stateful** (the SDK default). This supports multi-turn conversations where the AI builds up context about the home's current state.

To guard against destructive operations acting on stale state, tools that modify entity state (turn_on, turn_off, toggle, set_light, set_climate, set_cover, set_lock, media_control) will implement a **freshness check**:

- Before executing a state-changing operation, the tool fetches the entity's current state from HA
- The tool response includes the entity's state both before and after the operation, so the AI (and the user) can confirm what changed
- For operations where the entity is already in the requested state (e.g. turning on a light that's already on), the tool returns a notification rather than re-calling the service, to avoid unintended side effects (e.g. toggling back off)

This pattern ensures the AI is always working with current information when making changes, even if its session context has drifted.

### 12.2 Domain-Specific Tools with Consistent Implementation

Tools are **domain-specific** (e.g. `set_light`, `set_climate`) rather than generic. This gives AI clients detailed, per-domain input schemas that improve tool selection accuracy and parameter completeness.

To ensure consistent implementation across all tool modules, every tool follows a **standard pattern**:

1. **Input validation** via Zod schemas with descriptive field descriptions
2. **Entity resolution** -- validate the entity_id exists and belongs to the expected domain
3. **Freshness check** -- fetch current state before any mutation (see 12.1)
4. **Service call** -- invoke the HA REST API
5. **Response formatting** -- return a structured response with before/after state
6. **Error handling** -- domain errors returned as `isError: true` with actionable messages

The generic `call_service` tool remains as an escape hatch for domains not explicitly covered, following the same validation and response patterns.

### 12.3 Entity Filtering from Day One

`get_entities` supports filtering by:

- **Domain** (e.g. `light`, `sensor`, `climate`) -- filters by entity_id prefix
- **Area** (e.g. `living_room`, `kitchen`) -- filters by HA area assignment
- **State** (e.g. `on`, `off`, `unavailable`) -- filters by current state value
- **Search** -- free-text search across entity_id, friendly_name, and area

Without any filters, the tool returns a summary (entity counts by domain) rather than dumping hundreds of entities, with guidance on how to narrow the query.
