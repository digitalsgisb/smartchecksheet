# Production Digital — AI PC deployment and MQTT guide

This guide covers Windows installation, tablet/TV access, MQTT, Python, Cloudflare Tunnel, startup, accounts, backups and cutover. The current app is a **local demo**. Production broker access, the tunnel route and event forwarding still require commissioning. Original Node-RED OEE and Python files are preserved.

## 1. System connections

```text
Tablet / PC / TV → HTTPS Cloudflare Tunnel → AI PC React + Node server :3700
                                                │              ▲
                                           MQTT commands   MQTT updates
                                                ▼              │
                                            ABB2 broker ← ABB2 Python / sensors
                                                              │ HTTP durable events
                                                              ▼
                                                 Existing ingestion service
                                                              │ forward original event
                                                              ▼
                                              /api/integrations/events on AI PC
```

The browser never connects to MQTT and never receives MQTT credentials. The server sends shared state to signed-in screens using Server-Sent Events (SSE). Python owns machine counts/status, scheduled shifts and the live downtime timer. SQLite stores the web app's accounts, records, 4M issues and saved report snapshots. Node-RED continues calculating OEE.

## 2. Install on the AI PC

Use a stable folder such as `C:\ProductionDigital`. Install Node.js **24 or newer** from [Node.js](https://nodejs.org/en/download); the backend needs `node:sqlite`. Copy this project to the AI PC, including source, server, public assets, scripts, tests, `package.json` and `package-lock.json`. Keep original flow/Python backups separately. Do not copy this PC's populated `.env` or demo database into production.

```powershell
Set-Location 'C:\ProductionDigital'
npm.cmd ci
npm.cmd run build
npm.cmd test
# Only when .env does not already exist:
Copy-Item -LiteralPath '.env.example' -Destination '.env'
```

Preserve the existing `.env`, catalog and database when updating an installation.

## 3. LAN demo and tablet testing

Edit `.env`:

```dotenv
APP_MODE=demo
HOST=0.0.0.0
PORT=3700
DATABASE_PATH=./data/production-demo.sqlite
COOKIE_SECURE=false
TRUST_PROXY=false
```

Run `npm.cmd start`. On the AI PC open `http://localhost:3700`. On the same Wi-Fi/LAN, open `http://AI_PC_LAN_IP:3700/#checksheet` on the tablet and select **Open demo**. Find the address with `ipconfig`; use a DHCP reservation for a stable AI PC address.

Allow inbound TCP 3700 only from the plant subnet. The supplied `Enable-Tablet-Access.ps1` is configured for the **development PC** (`192.168.100.72`, subnet `192.168.100.0/24`): edit these values for the AI PC, then run it once in PowerShell as Administrator. Guest Wi-Fi/client isolation can still block communication. Do not use router port forwarding.

HTTP over a LAN IP is for testing. PWA installation/service workers on the tablet require HTTPS; use the tunnel hostname for the installed app.

## 4. Live configuration

Stop the demo server. Replace placeholders in `.env`:

```dotenv
APP_MODE=live
HOST=127.0.0.1
PORT=3700
DATABASE_PATH=./data/production-live.sqlite
ADMIN_USERNAME=developer
ADMIN_PASSWORD=REPLACE_WITH_UNIQUE_PASSWORD_12_OR_MORE_CHARACTERS
CATALOG_PATH=./catalog.json
MQTT_URL=mqtt://ABB2_BROKER_PRIVATE_IP:1883
MQTT_USERNAME=production-react
MQTT_PASSWORD=REPLACE_WITH_BROKER_PASSWORD
INGEST_TOKEN=REPLACE_WITH_LONG_RANDOM_PRIVATE_TOKEN
OEE_DASHBOARD_URL=REPLACE_WITH_EXISTING_OEE_URL
COOKIE_SECURE=true
TRUST_PROXY=true
```

Use `127.0.0.1` when the Cloudflare connector and ingestion forwarder run on this AI PC. If another private host needs to reach the server, use an appropriate private listener (`0.0.0.0` if required) and restrict firewall access. Secure cookies cannot sign in over a plain LAN HTTP address; use the HTTPS hostname in live operation.

Create `catalog.json` using `catalog.example.json` as a structure reference, replacing all sample data with verified ABB2 data. Required lists: `models`, `people.supervisors`, `people.leaders`, `people.operators`, `people.quality`. Model fields include `name`, `cycle` (minutes/piece), `pcsHr`, `slabWidth`, `slabLength`. Verify slab dimensions/units against Python.

Live mode refuses startup without a valid catalog, MQTT URL and strong bootstrap password, or when the configured database name contains `demo`. Keep demo and production databases separate. `ADMIN_PASSWORD` creates the developer account on the first startup of a new database; changing it later does not reset an existing account. A self-service password reset screen is not implemented.

Keep `.env`, catalogs and SQLite data private. Do not commit credentials or put them in browser code. For ABB2, ABB3 and ABB7 live routing, follow [MULTILINE-PYTHON-SETUP.md](./MULTILINE-PYTHON-SETUP.md). The single ABB2 settings here remain supported.

## 5. MQTT broker setup

### Use the existing ABB2 broker

Connect to the broker used by ABB2 Python and OEE. If it is bound only to `127.0.0.1` on the Pi, it needs a private listener or private forwarding/VPN before the AI PC can reach it. Inspect and back up the deployed broker configuration, password file and ACL first.

Do not relocate the broker or change existing credentials without coordinating Python and Node-RED. Either can stop OEE. Keep ABB7 separate: legacy topics such as `nodered/*` and `smartchecksheet/*` are not safe to share across line brokers without a routing migration.

Example for **Mosquitto 2.x**; substitute actual private addresses/paths and merge with the existing configuration:

```conf
listener 1883 ABB2_PI_PRIVATE_IP
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/acl
persistence true
persistence_location /var/lib/mosquitto/
```

Add an account to an existing password file without `-c`:

```bash
sudo mosquitto_passwd /etc/mosquitto/passwd production-react
```

`-c` creates/replaces a password file: use it only for a new file, never over existing production users. Newer Mosquitto versions may use authentication plugins; follow the installed version's documentation. See [authentication methods](https://mosquitto.org/documentation/authentication-methods/) and [listener configuration changes](https://mosquitto.org/documentation/listeners/per-listener-settings/).

Append this bridge ACL while retaining existing Python/Node-RED permissions:

```conf
user production-react
topic write nodered/newshift
topic write nodered/modeltarget
topic write nodered/mode
topic write nodered/adjust_count
topic write nodered/reject
topic write noderedparam/condition
topic write nodered/downtime_session
topic read smartchecksheet/live
topic read smartchecksheet/hourly
topic read abb2/shift_form_result
topic read abb2/downtime_result
topic read abb2/status
```

Reload/restart the installed broker during an agreed commissioning window. Permit broker access only from authorised production hosts. Tablets need the website, not port 1883. For a TLS listener, use `mqtts://BROKER_HOST:8883` and a certificate trusted by Node; do not disable certificate verification. The website tunnel does not replace the private MQTT connection.

Read-only network check from the AI PC:

```powershell
Test-NetConnection -ComputerName 'ABB2_BROKER_PRIVATE_IP' -Port 1883
```

The app needs both broker connectivity and fresh `smartchecksheet/live` telemetry. Machine actions are blocked once telemetry is over 8 seconds old. Do not test by publishing fabricated commands to an operating line.

## 6. MQTT topics and command confirmation

| UI action | MQTT command | Confirmation |
|---|---|---|
| Shift | `nodered/newshift` | `abb2/shift_form_result` |
| Model / lot | `nodered/modeltarget` | Matching live telemetry |
| Normal / rest | `nodered/mode` | Matching live telemetry |
| Downtime start / stop / save / discard | `nodered/downtime_session` | `abb2/downtime_result` |
| Reject | `nodered/reject` | Durable reject event |
| Parameters | `noderedparam/condition` | Durable parameter event |
| Count correction | `nodered/adjust_count` | Durable event / matching telemetry |

The server reads `smartchecksheet/live`, `smartchecksheet/hourly`, `abb2/shift_form_result`, `abb2/downtime_result`, `abb2/status`. Python still publishes `sensor2/data` for OEE. Topic names retain `nodered` for compatibility even when React supplies the UI.

For START TIMER, the server sends `action: "start"`, a unique `command_id`, session ID and current timer revision. Python changes the shared timer and publishes its confirmed state. All tablets then display the same timer. Stale revisions are rejected instead of overwriting another tablet's action.

Commands use **QoS 0, no retain and no automatic replay**, because existing Python count/reject handlers are not idempotent. After 30 seconds a command becomes **unconfirmed**, not necessarily failed. Check the line before retrying. Retained state is useful for display recovery; retained machine commands are unsafe.

## 7. Python durable event forwarding — required

Preserve Python's existing durable-outbox destination. Configure the existing central ingestion service to additionally forward the **original ABB2 event envelope** to:

```text
POST http://AI_PC_PRIVATE_ADDRESS:3700/api/integrations/events
Authorization: Bearer <same INGEST_TOKEN as the AI PC>
Content-Type: application/json
```

Use `127.0.0.1` when forwarding on the same AI PC. For a separate host, configure private server reachability and firewall access. This forwarding component is external to this repository and still needs implementation/configuration. Keep a durable retry queue there and retry the same `event_id` after transient failures. Do not put the token in the browser or remove delivery to existing analytics consumers.

```json
{
  "event_id": "original-event-id",
  "event_type": "reject.recorded",
  "line_code": "ABB2",
  "shift_id": "20261009-Day-Line1",
  "occurred_at": "2026-10-09T10:00:00+08:00",
  "payload": {
    "shift_id": "20261009-Day-Line1",
    "hour_slot": "10.00-11.00",
    "ng_quantity": 1,
    "ng_code": "surface_defect"
  }
}
```

Recognised record events include `reject.recorded`, `parameter.recorded`, `model.configured`. Duplicate IDs are ignored. Current-shift events update current records; historical events are acknowledged without being imported into the current shift. Historical backfill is not implemented. Legacy shift IDs may still contain `Line1`; workspace scope remains ABB2.

Setting `INGEST_TOKEN` removes the production-write configuration block, but does not prove forwarding works. Test that an original Python event arrives once and confirms its command before commissioning reject/parameter/count entry.

## 8. Preserve OEE during cutover

Back up the deployed flow. Keep its OEE tab, sensor/MQTT configuration, InfluxDB writes and external OEE forwarding running. Set `OEE_DASHBOARD_URL` to the existing page.

Other Node-RED tabs may include external API forwarding used by other systems. Identify dependencies before disabling them. Once React is commissioned, disable the old command-producing checksheet controls so only one UI sends machine commands.

The exported OEE model-memory cleanup listens for `nodered/endshift`, while automatic Python shift endings use `abb2/shift_form_result`. React does not emit an extra endshift command because Python also subscribes and could reset twice. Resolve this existing integration gap before cutover without changing OEE calculations. The preserved OEE `quality_pct` forwarding typo also remains unchanged.

## 9. Cloudflare Tunnel and PWA

Reuse the AI PC's existing Cloudflare connector. Add a **new** published application route for your chosen hostname, for example `production.sugidigital.org` if available. Select HTTP and service URL `localhost:3700`. Leave existing OEE and other application routes unchanged.

Cloudflare maps the public hostname to the private service; see [published application routing](https://developers.cloudflare.com/tunnel/concepts/routing/) and [Windows tunnel service setup](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/windows/). Reuse an existing service instead of installing another; protect its token.

Use `COOKIE_SECURE=true`, `TRUST_PROXY=true` with a local loopback connector. Keep browser API calls on the same hostname. Do not cache `/api/*` in Cloudflare rules. Test that SSE remains connected and two tablets see each other's changes; dropped streams reconnect.

Install using Chrome/Edge's Install app menu, or Safari → Share → Add to Home Screen on iPad. Use the **HTTPS hostname**. Routes: `/#checksheet`, `/#tv/henkaten`, `/#tv/live`. Use read-only display accounts for TVs.

The PWA caches only the shell; offline machine actions are disabled, with no offline queue. Finish/close the form before using Update app.

## 10. Automatic Windows startup

First prove manual `npm.cmd start` works. `Start-Production.ps1` runs Node in the project directory and appends output to `logs/server-YYYY-MM.log`.

Create a task in **Task Scheduler**:

1. Name: Production Digital. Use a dedicated Windows account with read access to code and write access to data/logs; select Run whether user is logged on or not.
2. Trigger: At startup, delayed 30 seconds.
3. Program: `powershell.exe`; arguments: `-NoProfile -File "C:\ProductionDigital\Start-Production.ps1"`; Start in: `C:\ProductionDigital`.
4. Node must be on that account's PATH. If script policy blocks the wrapper, follow your organisation's policy or run the absolute `node.exe` directly with `--env-file-if-exists=.env server/index.js` and the same Start in folder, arranging log capture separately. Do not change script policy globally.
5. Restart on failure after 1 minute, up to 3 times. Disable a fixed multi-day stop limit. Choose Do not start a new instance when already running.
6. Run and test the task, then reboot and test again. Keep the AI PC awake during production.

Do not use the Vite development server in production or run two server instances against this database/port.

## 11. Accounts and operator guide

Create accounts in User Management and assign ABB2. Operators enter production records; management additionally verifies records and manages permitted accounts; executives view records; display accounts view TVs; developers manage all roles. Display sessions last 30 days; other sessions last 8 hours. ABB7 live write routing is not enabled.

- **Downtime:** Use timer → category/reason → START TIMER → STOP TIMER → action taken → SAVE DOWNTIME. For a completed stop, choose Enter minutes. Discard timer asks again and removes time without saving.
- **Reject:** choose one type → metres/pieces → reason/code → SAVE REJECT. Return roll also requires OHT. Save one type at a time.
- **4M:** category → NG · Problem or OK · Fixed → problem/action → save. OK closes **all open problems in that category**, as the form states.
- **Verification/PDF:** management saves the verification result; generated PDFs are snapshots of data at creation time.

## 12. Backups, updates and rollback

Stop the app before copying SQLite files, or use SQLite's online backup method. With a stopped app, back up the entire `data` folder consistently, including any WAL/SHM files. Also back up `.env`, verified catalog, package lock, startup scripts and original Python/Node-RED configuration. Store securely and test restoration. Review old logs under the plant's retention policy.

Update procedure: back up → stop task/server → replace source while preserving config/data/logs → `npm ci` → `npm run build` → `npm test` → start → verify on two devices → apply PWA update after forms are closed.

Rollback: stop React machine entry before restoring backups or re-enabling old controls. Keep OEE running. Never leave both checksheet UIs sending commands.

## 13. Commissioning checks

Verify catalogs/permissions; compare counts and all six states against Python; test shared timer conflicts on two tablets; test each reject type and durable event; test parameters/count confirmation; test model changes within an hour, day/night boundaries and shift-end PDFs; confirm OEE cleanup/API dependencies; test Wi-Fi/broker/tunnel/server restart and PWA updates; confirm one command publisher and a restore-tested backup before go-live.

## 14. Troubleshooting

| Problem | Check |
|---|---|
| Tablet cannot open LAN URL | AI PC IP, listener, firewall, same Wi-Fi, client isolation |
| Login loops over HTTPS | Secure cookies, same hostname, tunnel/proxy settings |
| Machine disconnected | Broker route, credentials, ACL, fresh live telemetry |
| Command unconfirmed | Python result / durable forwarding; check the line before retrying |
| Timer revision rejected | Another tablet changed the timer; use the latest shared state |
| Reject missing | Token/forwarder, original event ID, line and shift IDs |
| Live startup fails | Node version, password, catalog, MQTT URL, separate database |
| Port already used | Stop the previous app instance before starting another |
| Old tablet layout | Finish the form, Update app, reopen the installed app |
| PWA cannot install at LAN IP | Use the HTTPS tunnel hostname |

Implementation references: `server/index.js`, `server/store.js`, `src/OperatorForms.jsx`, `src/HenkatenBoard.jsx`. This guide does not claim the external forwarding service or production tunnel is already deployed.
