# Local deployment without authentication (and how to put phones on it)

RetailEdge has **no authentication, by design, for this phase**. Nothing in the UI or API can tell one person from another. Everything below
narrows *where* the API can be reached from; it does not make any request trustworthy.

## Default: this machine only

* The API binds to `127.0.0.1:8000` and refuses to start on another host unless `RETAILEDGE_ALLOW_LAN=true`.
* The vision worker binds to `127.0.0.1:8100`. Camera/RTSP secrets stay in the backend process; browsers only receive MJPEG frames and metadata.
* The admin console (`npm run dev` / `npm run build`) talks to `http://127.0.0.1:8000` (`VITE_API_URL` overrides it).
* Browsers on other machines cannot reach any of it.

## Optional: staff and customer phones on a controlled network (demo)

1. Find the PC's LAN address (e.g. `192.168.1.20`) and make sure the network is one you control (a private router / hotspot, not a shared or public Wi-Fi).
2. Backend (`backend/.env` or environment):
   ```
   RETAILEDGE_HOST=0.0.0.0
   RETAILEDGE_ALLOW_LAN=true
   RETAILEDGE_CORS_ORIGINS=["http://192.168.1.20:5173"]
   # optional, defaults to the RFC1918 / link-local ranges:
   # RETAILEDGE_LAN_ALLOWED_CIDRS=["192.168.1.0/24"]
   ```
3. Frontend: `VITE_API_URL=http://192.168.1.20:8000 npm run dev -- --host` (or serve the built `dist/` from the same machine).
4. Phones open `http://192.168.1.20:5173/staff?store=<store-id>` and `http://192.168.1.20:5173/customer?store=<store-id>`.
5. Windows Firewall: allow inbound TCP 8000 and 5173 for the **Private** profile only.

### What the LAN guard does (`core/network.py`)

When `ALLOW_LAN` is on, a request from a non-loopback address is accepted **only if** it comes from an allowed private network **and** matches the
Staff/Customer PWA allowlist:

| Reachable from a phone | Not reachable (403 `lan_restricted`) |
|---|---|
| `GET /api/public/*`, `/api/customer/*` | camera / analytics configuration, ingest, vision control |
| `GET /api/staff/me*`, `POST /api/staff/me/check-in|check-out`, `GET /api/stores/{id}/staff` (roster picker) | employee / shift / attendance administration |
| `GET /api/stores/{id}/tasks`, `GET /api/tasks/{id}[/history]`, `POST /api/tasks/{id}/accept|start|complete|report-issue` | task create / assign / cancel / delete, alerts, queue & counter controls, reports, copilot |
| `GET /api/health`, WebSocket `/ws/stores/{id}/events?audience=staff|customer` | everything else, including `/docs` |

WebSocket clients from the network must declare `audience=staff` or `audience=customer` and only receive that audience's event types
(customers get queue estimates and their own assistance updates, no operational counters).

### Honest limits

* Anyone on an allowed network can open the staff app, pick any employee and complete that employee's tasks; anyone can read the roster list
  (names, roles) and submit customer requests. The employee picker is a *demo context*, recorded for audit, not an identity.
* Task actions from the network are applied as the employee the phone says it is.
* There is no TLS. Do not expose this to the internet or to untrusted networks. Use a VPN/reverse proxy with real access control if you ever need that.
* The admin console, reports, camera video and every management endpoint remain loopback-only.
