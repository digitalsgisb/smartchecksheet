# Production Digital

**AI PC deployment and MQTT guide:** [DEPLOYMENT-AI-PC.md](./DEPLOYMENT-AI-PC.md) includes installation, tablet access, MQTT/Python integration, Cloudflare Tunnel, automatic startup, backups and commissioning.

A React PWA for ABB2, with responsive PC/tablet views and fullscreen TV layouts. The existing **Node-RED OEE flow is preserved**. This app replaces the Smart Checksheet, Live Checksheet, Henkaten and PDF dashboard responsibilities.

## Run on this PC

Requires Node.js 24+. Dependencies are installed and the production build is in `dist/`.

```powershell
Set-Location 'C:\Users\haffizol\Desktop\Project\Smart Checksheet\abb2 React'
npm.cmd start
```

Open **http://localhost:3700** and choose **Open demo**. The demo has sample people/models and simulated machine counts; it never connects to production MQTT. Edits, users and reports persist in `data/production-demo.sqlite`. For source development use `npm.cmd run dev` and open http://localhost:5173. If the operating-system sandbox prevents Vite realpath access, run the command in your normal terminal.

```powershell
npm.cmd run build
npm.cmd test
```

## What works

- Shift/manpower entry, model/lot setup, parameter condition, reject records with length/piece units, machine rest mode and audited count correction.
- Python-compatible MQTT adapter for the ABB2 Pi; live commands have pending/confirmed/rejected status. Demo actions use local simulated state.
- Shared downtime stopwatch/countdown, revision checks across devices, stop/log/cancel controls. Demo countdown stops at zero and waits for logging; live countdown completion stays owned by Python.
- Live production record with hourly model/lot segments, rejects, downtime, parameters and **saved management verification**.
- Four-M Henkaten board, attributable actions and issue history. Open issues remain until manually resolved, including across shifts.
- Server-generated A3 landscape PDF snapshots, report versions, embedded preview and open/download. This is a new readable layout; it does not reproduce the original Google Sheets PRS form exactly.
- Operator, executive, management, developer and read-only display roles. Per-account line permissions are enforced by the backend; ABB2 is enabled and ABB7 is reserved for later integration.
- Password hashing, HTTP-only session cookies, account disabling, login throttling, same-origin writes, session revocation and SQLite persistence.
- App manifest, regular and maskable icons, static-shell service worker, install prompt and update prompt. API responses are network-only. Offline records/actions are not queued or represented as saved.

## PC, tablet and TV

The desktop uses a permanent sidebar; tablet widths use a slide-out menu and touch-friendly forms. Install the PWA from Chrome/Edge's install menu. On iPad use Safari → Share → Add to Home Screen. Installation on a remote host requires HTTPS; localhost is allowed for development.

- Live TV: `/#tv/live`
- Henkaten TV: `/#tv/henkaten`

Create a `display` account for each TV. Display sessions last 30 days; other sessions last 8 hours. The fullscreen button uses the browser fullscreen API. The app opens in the last URL selected on that device.

## Production setup on the AI PC

The current checked-in defaults are **demo**, not a completed factory cutover. No existing Node-RED/Python files were changed and no public tunnel was configured.

1. Copy this folder to the AI PC, install Node.js 24, run `npm ci` and `npm run build`.
2. Copy `.env.example` to `.env`. Set `APP_MODE=live`, `DATABASE_PATH=./data/production-live.sqlite`, a unique `ADMIN_PASSWORD` of at least 12 characters, `COOKIE_SECURE=true`, and `TRUST_PROXY=true` when using a local HTTPS tunnel. Leave `HOST=127.0.0.1` for the tunnel origin.
3. Supply `CATALOG_PATH=./catalog.json` with **verified** ABB2 model cycles (minutes/piece), hourly capacities, slab dimensions and manpower. `catalog.example.json` shows the shape but contains reference data, not production master data. The live process refuses to start without a catalog.
4. Set `MQTT_URL` to a private-network connection to **ABB2's existing broker**, with credentials if required. The broker is currently local to the Pi, so connecting from the AI PC needs a private bridge/VPN/SSH forwarding or broker listener configuration. Generic legacy topics must never be combined with ABB7's broker.
5. Set `OEE_DASHBOARD_URL` to the existing Node-RED/Grafana OEE page. OEE calculation, InfluxDB writes and existing API forwarding stay in Node-RED.
6. For reject, parameter and count confirmation, forward ABB2 events from the existing central ingestion service to `POST /api/integrations/events`, with `Authorization: Bearer <INGEST_TOKEN>`. Set a long private `INGEST_TOKEN`. Preserve the Pi's existing durable-outbox destination. Do not redirect it away from the existing production analytics service. These production write controls refuse to send until the receiver is configured.
7. Run `npm start` under the AI PC's process supervisor. Connect a new Cloudflare Tunnel hostname to `http://localhost:3700`; do not repoint the existing OEE hostname. Suggested hostname: `production.sugidigital.org`, subject to your DNS availability. The backend serves the React build and same-origin API on one port, including SSE synchronization.
8. Sign in using `ADMIN_USERNAME` / the configured bootstrap password and create the operator, management, executive and display accounts. The bootstrap password creates a new account on first startup; changing the environment variable later does not reset an existing account.

## Cutover while keeping OEE

Keep the existing `OEE` Node-RED tab and all referenced MQTT/InfluxDB configuration nodes. Back up the deployed flow first. Only after live validation, disable the other four dashboard tabs; do not delete shared configuration used by OEE. React publishes model setup on `nodered/modeltarget`, the topic OEE already consumes, and Python continues publishing `sensor2/data`.

React never publishes `nodered/endshift`, because Python also subscribes to it and could reset twice. The original export's OEE model-memory cleanup depends on this legacy topic, while current automatic Python shift endings use `abb2/shift_form_result`. That existing cleanup gap needs a narrowly scoped integration decision before cutover; it is deliberately not "fixed" by changing your preserved OEE flow or sending an extra reset command.

Also verify original Node-RED external session/model/mode/reject forwarding before disabling its other tabs. That API's implementation is not in this workspace; it may still feed other applications. React does not silently duplicate those external HTTP requests. The preserved OEE tab's existing `quality_pct` forwarding typo also remains unchanged.

## Live adapter behavior and remaining integration work

The adapter subscribes to `smartchecksheet/live`, `smartchecksheet/hourly`, `abb2/shift_form_result`, `abb2/downtime_result` and `abb2/status`. It does not treat an unaccepted `nodered/newshift` request as an activated shift. Setup/mode changes are confirmed from telemetry, shift/downtime from Python results, and rejects/parameters/count corrections from durable events.

Commands are published once, without retention or automatic retry, because the existing Python reject/count handlers are not idempotent. A 30-second timeout means **unconfirmed**, not failed: check the actual line before resubmitting. Multi-line live write routing, production master-data import from Google, historical shift import/backfill, forwarding from the AI PC ingest service, and actual broker/tunnel connectivity need the corresponding server configuration and live commissioning. The app does not claim that connecting MQTT alone recovers all old checksheet history.

The event receiver accepts:

```json
{
  "event_id": "stable-event-id",
  "event_type": "reject.recorded",
  "line_code": "ABB2",
  "shift_id": "20261009-Day-Line1",
  "occurred_at": "2026-10-09T10:00:00+08:00",
  "payload": { "shift_id": "20261009-Day-Line1", "hour_slot": "10.00-11.00", "ng_quantity": 1 }
}
```

Receiver duplicates are deduplicated by `event_id`. Current-shift reject/parameter data is applied; historical events are acknowledged without being added to the current shift. Archive/backfill is a separate migration task. Production records currently use the authoritative legacy shift ID received from Python (which can still say `Line1`); the workspace line scope is always `ABB2`.

Back up the production SQLite database using SQLite's online backup method or with the service stopped, including WAL handling. Store `.env`, catalog, database and reports securely. Do not commit populated credentials or the original unsanitized flow. Dependency versions are locked in `package-lock.json`.

## Verification

Automated tests cover session/line/role access, account revocation, two-client live synchronization, stale timer commands, duplicate-log prevention, reject validation, verification persistence, PDF output, model/lot segments, Malaysia shift boundaries and password hashing. Before commissioning, additionally test actual Python shift acknowledgements, durable-event forwarding, model change during an hour, network outage/recovery, shift-end PDF completeness and side-by-side tablet/TV behavior against the production system.

The build follows the [React Vite guidance](https://react.dev/learn/build-a-react-app-from-scratch); the backend uses [Node.js SQLite](https://nodejs.org/api/sqlite.html). OEE formulas were not ported or reimplemented.

## Operator buttons and downtime page

- **HOME** returns operators to the Smart Checksheet. The header shows the company logo and current page name.
- **Report 4M change** opens the **4M Board**. Tap anywhere on a Man, Machine, Material or Method card to update that category. TV and read-only accounts cannot change cards.
- **Record downtime** opens a full page. Select the category, enter the reason and press **START TIMER**. The large timer stays visible with **STOP TIMER** underneath.
- Press **STOP TIMER** when the machine runs again. Enter the action taken, then press **SAVE DOWNTIME**.
- You may press HOME while timing. Leaving the page does not stop the shared server timer. Open Record downtime again to return to it.
- **Enter minutes** records an already completed stop without starting the timer.
- Machine Running is bright green; Machine Rest is yellow. 4M OK is green and NG is red. Status words remain visible so operators do not need to rely only on colour.
- Subtle gradients and button motion respect the device's reduced-motion setting.
The active downtime timer also appears beside machine status on the main Smart Checksheet. Tap OPEN DOWNTIME to stop or save it. A stopped timer stays visible until saved or discarded.
Enter minutes uses touch scroll wheels for hours and minutes (1 minute to 24 hours). The selected duration is also shown as total minutes. Desktop users can click a number or use arrow keys on either wheel.

### Tablet installation
The built app includes a standalone PWA manifest, 192/512 icons, a maskable icon and service worker. Open the configured **HTTPS tunnel hostname** on the tablet. A plain HTTP LAN IP is for browser testing and does not qualify for PWA installation.
- Android Chrome: menu → Install app (or Add to Home screen, then Install).
- iPad Safari: Share → Add to Home Screen.
The installed app opens the Smart Checksheet. Production actions still need a live connection. An HTTPS tunnel route must be configured on the AI PC before tablet installation can be verified.
Model selection and manual lot entry are now on the main checksheet. Press SAVE MODEL / LOT to send the change; typing alone does not send commands.
A SHIFT FINISHED notification appears when shared server state ends a shift or replaces it with the next shift. It can be dismissed and offers the next-shift action.
