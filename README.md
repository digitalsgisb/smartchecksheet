# Production Digital

**Attendance tab:** see [ATTENDANCE-INTEGRATION.md](./ATTENDANCE-INTEGRATION.md) to connect the local Smart Attendance API and map each tablet's employee group.

## Update the existing AI PC Docker deployment

### Remove sample production data from the workspace

Set `APP_MODE=attendance` in the existing `.env.docker` for the full workspace without sample data. Every configured line has its own Smart Checksheet, Overview, Live Checksheet, 4M/Henkaten board, downtime timer and PDF reports. Operators enter actual shift names, models, lots, targets and standard cycles. Counts change only through recorded user actions; no values are simulated. Attendance continues reading the real AI PC service. Existing accounts and prior production state are preserved.

```bash
cd /srv/apps/smartchecksheet &&
git pull --ff-only origin main &&
sed -i 's/^APP_MODE=.*/APP_MODE=attendance/' .env.docker &&
docker compose --env-file .env.docker up -d --build checksheet
```

Confirm `.env.docker` contains `APP_MODE=attendance`. In the browser, choose **Update app** if shown, then sign out. The login password field has an eye icon and **Show** / **Hide** text. The new login screen also activates pending app updates automatically. If an older cached login remains, use a private browser window to check the deployed version. Git pull and Docker rebuild update the server; an existing browser can still be using an older service worker until its app update is accepted.

From Windows PowerShell, connect to the AI PC:

```powershell
ssh sugidigital@100.109.37.96
```

Inside the Linux SSH session, pull the latest source, rebuild the Checksheet image and recreate its container:

```bash
cd /srv/apps/smartchecksheet &&
git pull --ff-only origin main &&
docker compose --env-file .env.docker config --quiet &&
docker compose --env-file .env.docker up -d --build checksheet &&
docker compose --env-file .env.docker ps &&
docker compose --env-file .env.docker logs --tail=80 checksheet
```

Use the existing deployment folder if its path differs. The commands stop at the first failure. If Git refuses the pull, preserve and resolve the local changes before retrying.

Keep the existing `.env.docker` and Docker data volume; back up the database and private environment before updating. This rebuild preserves container accounts and records. The Windows test accounts and passwords are local to the Windows demo database and are not deployed by Git. All developer accounts automatically receive every configured account line, including existing accounts when the server starts after an update. Passwords and other roles' line assignments are preserved.

After the container becomes healthy, open `http://100.109.37.96:3700/#attendance` (or the existing configured URL) and refresh the app. If an app update prompt appears, choose **Update app**.

If an older app's **Update app** button does nothing, open `https://smartchecksheet.sugidigital.org/api/app-update` and press **Reload latest app**. For a different host, use its `/api/app-update` path. This recovery page bypasses the old cached app, releases only this app's service-worker registration and loads the latest version. It keeps login cookies and server records. New clients show **Updating…**, activate the waiting worker and fall back to this registration reset if activation stalls.

One account supports concurrent PC and tablet sessions. Temporary Wi-Fi loss or a server restart shows a reconnecting state. Only an HTTP 401 identified as this app's session rejection ends the client session; a gateway's unrelated 401 does not. Normal sessions last eight hours and display sessions last thirty days; disabling an account or signing out still revokes the corresponding sessions. Use the same HTTPS app hostname on each device.

If the tablet returns to sign-in immediately, open the HTTPS site directly in Chrome or Safari and allow cookies. Login now checks `/api/auth/me` before opening the workspace and displays an error if the browser did not return its session cookie. `COOKIE_SECURE=true` requires HTTPS; a private LAN HTTP test requires `COOKIE_SECURE=false` and a container restart. The HTTP-only cookie uses `SameSite=Lax` for navigation compatibility; cross-origin writes remain rejected. A service-worker refresh cannot repair a blocked cookie. Do not clear site storage as a first step.

## Separate production workspace for each line

ABB2, ABB3, ABB7 and ROLL MAKING are separate workspaces when configured in `ATTENDANCE_GROUPS`. A single-line account opens its own line. Accounts with several lines, including developers, can switch using **Production line** in the sidebar. All pages, forms, attendance portraits, live page updates and PDFs follow the selected line. Unsaved modals are closed only after confirmation when switching; each line's server timer continues independently.

In `APP_MODE=attendance`, all production pages are restored and use manually entered records with no sample people, catalogs, shifts, timers or auto-incrementing counts. Set a shift, enter actual model/lot/target/cycle values, then record rejects, parameters, downtime and 4M changes. Use **Correct count** for actual output. Management/developers verify records and generate PDFs. **End shift** is available under Shift details. Future shifts activate at their scheduled time; completed shifts save their report. Records persist separately under `manual:<line>` database keys and retain their line after restart. Old demo/live data is kept separately and is never copied into another line.

In `APP_MODE=live`, the existing commissioned ABB2 MQTT adapter remains ABB2-only. Other configured lines have their own manual workspaces until their individual machine integrations are commissioned. No other line's actions publish to ABB2's broker. The manual-workspace banner makes that status visible.

## Manual setup: attendance for all account lines on the Linux AI PC (Docker)

Target: `sugidigital@100.109.37.96`. One shared deployment shows each signed-in account its permitted production group, with photos, IN / OUT / Needs review counts, search, and status filters. Refresh is automatic every 15 seconds. Attendance credentials stay on the Checksheet backend. Attendance does not change Checksheet manpower selections or issue clock commands.

The commands below create one shared deployment at `/srv/apps/smartchecksheet`. Attendance data and uploaded photos are authorized on the backend using each account's line permissions:

| Account line | Attendance group |
| --- | --- |
| ABB2 | FC Line 1 (`FC`, `checksheet_group=fc1`) |
| ABB3 | FC Line 3 (`FC`, `checksheet_group=fc3`) |
| ABB7 | Mini Forming (`MF`) |
| ROLL MAKING | Whole Roll Making production section; configurable account label |
| ABB4 | Retired; not configured |
| FC Line 2 | Unassigned; not configured |

A developer account can inspect all configured groups. Other accounts see only groups mapped to their assigned lines. Changing a query parameter cannot grant another group's attendance or photos. Every account opens the production workspace for its assigned line. Each line has its own manual checksheet, Henkaten, downtime and reports. The commissioned MQTT machine adapter remains ABB2-only.

### 1. Get this updated Checksheet project from GitHub

Run in **Windows PowerShell**. Enter the AI PC SSH password locally when prompted. An SSH key is optional for these manual steps.

```powershell
ssh sugidigital@100.109.37.96
```

Run the remaining commands **inside the Linux SSH session**. For the first installation:

```bash
mkdir -p /srv/apps
cd /srv/apps
git clone https://github.com/digitalsgisb/smartchecksheet.git smartchecksheet
cd /srv/apps/smartchecksheet
```

If already cloned, use the actual existing repository folder instead:

```bash
cd /srv/apps/smartchecksheet
git status --short
git pull --ff-only origin main
```

If Git reports local changes or refuses the update, preserve and resolve them before continuing; do not force-reset the installation. Confirm that the photo support and Docker files are available after pulling:

```bash
test -f Dockerfile && test -f compose.yaml && test -f deploy/enable-attendance-photos.py
docker --version
docker compose version
docker compose ls
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Docker Engine and the Compose plugin must be installed, and your account must have Docker access. If this is an update to an existing installation, back up its database and private environment first. The new deployment uses a new named Docker volume; it does not import this PC's demo database or an existing installation's accounts/records.

### 2. Update Attendance to allow read-only employee photos

Find the existing Attendance project folder using `docker compose ls`. It is the folder containing Attendance's `compose.yaml`, `server.py`, and `runtime/`. Set the variable below to that actual folder; the path shown is an example:

```bash
ATTENDANCE_DIR="$HOME/facescanpk/ai-pc"
test -f "$ATTENDANCE_DIR/server.py" && test -f "$ATTENDANCE_DIR/compose.yaml"
```

If that check fails, correct the path before continuing. First use Attendance's backup feature to save its database and photos. Use an Attendance version containing `checksheet_group`, `connection_scope`, and read-only integration tokens. The reference is [digitalsgisb/facescanpk](https://github.com/digitalsgisb/facescanpk/tree/main/ai-pc).

Apply the included photo patch and rebuild the existing Attendance service:

```bash
cd /srv/apps/smartchecksheet
python3 deploy/enable-attendance-photos.py "$ATTENDANCE_DIR/server.py"
cd "$ATTENDANCE_DIR"
docker compose up -d --build attendance
docker compose ps
docker compose logs --tail=50 attendance
```

The patch saves `server.py.before-checksheet-photos`, validates the Python syntax, and refuses unexpected source. It is safe to rerun after a successful application. It allows integration tokens to read uploaded photos belonging to active employees, keeps uploads administrator-only, and continues denying kiosk photo access. No database migration is needed for the photo patch. The local Windows Attendance repository has already received this patch; the Linux copy still needs it.

### 3. Create the read-only token and assign employees

In Attendance, sign in as administrator, then open **System settings → Connected devices → Add connection**. Choose **Production app / checksheet (read only)** and name it `Smart Checksheet`. Copy the once-shown token privately for the next step.

For each FC employee, open **Employees → Profile** and set:

- Department: `PRODUCTION`
- Production line: `FC`
- Checksheet tablet assignment: `FC Line 1` (`fc1`) for ABB2, or `FC Line 3` (`fc3`) for ABB3
- Active: enabled
- Photo: upload the employee's portrait if missing

Keep the production line as FC so the Attendance TV board continues combining FC employees. FC employees with no assignment are excluded from FC groups. FC Line 2 is currently unassigned. For ABB7, keep employees in PRODUCTION with line MF; no FC assignment is needed.

### 4. Configure the Checksheet container

```bash
cd /srv/apps/smartchecksheet
# Copy only on the first setup. Preserve this file on later updates.
test -f .env.docker || cp .env.docker.example .env.docker
chmod 600 .env.docker
nano .env.docker
```

Enter your real token and a unique bootstrap password. For initial testing over the private LAN/Tailscale HTTP address, use:

```dotenv
APP_MODE=attendance
ADMIN_USERNAME=developer
ADMIN_PASSWORD=REPLACE_WITH_A_UNIQUE_PASSWORD_AT_LEAST_12_CHARACTERS
ATTENDANCE_TOKEN=PASTE_THE_READ_ONLY_INTEGRATION_TOKEN_HERE
COOKIE_SECURE=false
TRUST_PROXY=false
CHECKSHEET_BIND=0.0.0.0
CHECKSHEET_PORT=3700
```

Preserve the other settings from the example. Save in nano with **Ctrl+O**, Enter, then **Ctrl+X**. Do not put the token in React, a `VITE_` variable, a URL, or a chat message.

The supplied `.env.docker.example` configures all active groups. Keep its complete `ATTENDANCE_GROUPS` value when copying it; do not replace it with a single FC1 group. The connection address is:

```dotenv
ATTENDANCE_API_URL=http://host.docker.internal:3800
```

This matches the Attendance repository's default Docker mapping: host port **3800** → container port **8765**. Linux `host-gateway` lets the Checksheet container reach that published host port. Verify the actual port with `docker ps`; if it differs, edit `ATTENDANCE_API_URL` in `.env.docker`. If Attendance is published only on host loopback, connect both services to a shared private Docker network and use `http://attendance:8765` instead. `127.0.0.1:8765` inside Checksheet points to Checksheet's own container.

### 5. Build and start Checksheet

```bash
cd /srv/apps/smartchecksheet
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=80 checksheet
```

If port 3700 is already used by an existing app, choose another free `CHECKSHEET_PORT` in `.env.docker` before starting. On a device that can reach the AI PC's Tailscale address, open **http://100.109.37.96:3700/#attendance**. For a tablet without Tailscale, use the AI PC's plant LAN address instead. Sign in with the configured developer account. In User Management, create each tablet/operator/display account and select its actual account line: **ABB2**, **ABB3**, or **ABB7**. Do not grant ABB2 merely to let another line sign in. The line checkboxes come from the server configuration. If a shared account has several lines assigned, it can select those mapped groups. Existing accounts retain their current assignments; create replacement accounts with the correct assignments if needed. The ROLL MAKING account label is a configurable default; confirm your actual account label before granting it.

Attendance mode provides the complete per-line workspace with manually entered production records, no sample data, no simulated counts and no MQTT commands. The Attendance tab reads the real configured Attendance API. For production, configure a verified catalog at `deploy/config/catalog.json`, real private MQTT settings, and the other commissioning steps in [DEPLOYMENT-AI-PC.md](./DEPLOYMENT-AI-PC.md), then change `APP_MODE=live` and rebuild/recreate the container. Never use the example catalog as production master data.

For your final HTTPS tablet URL, set `COOKIE_SECURE=true`, point the existing HTTPS proxy/tunnel to this Checksheet host port, and recreate the container. Use that HTTPS URL for sign-in and PWA installation. Keep any existing Attendance/OEE routes intact. `TRUST_PROXY=true` currently trusts loopback only; Docker proxy setups need their actual proxy trust configuration reviewed separately. Attendance display and sign-in do not require enabling that setting.

### 6. Verify on each line account

1. Sign in with each account and open **Attendance**. ABB2 must show FC Line 1, ABB3 FC Line 3, and ABB7 Mini Forming. Confirm employee names, teams, portraits, and the Malaysia-time update stamp.
2. Confirm only active PRODUCTION employees matching the account group appear. An ABB2-only account requesting `?group=fc3` must get 403 for attendance and portrait endpoints. An ABB3/ABB7 account must not gain ABB2 machine access. FC Line 2 and retired ABB4 are not configured.
3. Clock an employee in/out using Attendance and wait for the next refresh (about 15 seconds). Check the displayed status and counts.
4. Confirm **IN + OUT + Needs review = Total**. An old open session must appear as Needs review. OUT means currently clocked out; it is not proof of shift absence.
5. Try the name/team search and status filters. Missing/unavailable portraits show initials and “No photo”. External HTTPS photo links load directly in the browser without the integration token; uploaded Attendance photos use the authenticated Checksheet proxy.
6. If the connection fails naturally or during a planned outage, confirm the warning appears and previously loaded counts/cards are marked outdated. Requests must not turn failures into zero counts. Restore the connection and confirm automatic recovery.
7. Confirm Attendance access and portrait URLs require Checksheet sign-in. Existing Checksheet manpower selections must remain unchanged.

If all photos show initials, confirm employees actually have photos and Attendance was rebuilt after the photo patch. If the tab reports unavailable, check the token's read-only scope, host port, container-to-host connectivity, and both services' logs. If the group has zero employees, check department, active state, FC line, and fc1 assignment. Do not print the private environment or expanded Docker configuration when sharing diagnostics.

For later source updates, preserve `.env.docker`, `deploy/config/`, and the named database volume, run `git pull --ff-only origin main` in the repository folder, then rerun `docker compose --env-file .env.docker up -d --build`. Avoid `docker compose down -v`, which deletes the named data volume.

Local validation: Checksheet regression tests and production/PWA build passed; Attendance **45 backend tests passed** using the bundled Python runtime. Docker build and Linux deployment have not been run from this PC. Remote SSH authentication was unavailable, so no Linux services or employee records were changed.

---

**AI PC deployment and MQTT guide:** [DEPLOYMENT-AI-PC.md](./DEPLOYMENT-AI-PC.md) includes installation, tablet access, MQTT/Python integration, Cloudflare Tunnel, automatic startup, backups and commissioning.

A React PWA with independent workspaces for configured production lines, responsive PC/tablet views and fullscreen TV layouts. The existing **Node-RED OEE flow is preserved**. This app replaces the Smart Checksheet, Live Checksheet, Henkaten and PDF dashboard responsibilities.

## Run on this PC

### Local ABB3 attendance test against the AI PC

This PC's ignored `.env` points Attendance at `http://100.109.37.96:3800`, with ABB2 / FC Line 1, ABB3 / FC Line 3, ABB7 / Mini Forming and Roll Making configured. Keep Tailscale connected. The Checksheet server runs in demo mode on localhost; Attendance reads real AI PC data after connecting.

Local accounts `abb3` (ABB3 only) and `admin` (all four configured lines, with the full `developer` administration role) are saved in the local demo database. Their generated passwords are in `data/local-test-accounts.txt`, which is ignored by Git. Existing accounts were preserved.

In Attendance on the AI PC, open **System settings → Connected devices → Add connection → Production app / checksheet (read only)**. Copy the once-shown integration token. In PowerShell run:

```powershell
Set-Location 'C:\Users\haffizol\Desktop\Project\Smart Checksheet\abb2 React'
.\Start-Local-Test.ps1
```

The launcher prompts for the token without displaying it, verifies read-only integration scope, and saves it only in the ignored backend `.env`. It starts the local app if needed. If a server started with `npm start` was already running, restart it once to load the new environment. Open `http://localhost:3700/#attendance` and sign in with a local account.

`abb3` opens the ABB3 production workspace and FC Line 3 attendance. `admin` can switch between all four attendance groups and inspect accounts under User Management. Ensure FC3 employees have `PRODUCTION`, line `FC`, and checksheet assignment `fc3` in Attendance. ABB3 machine controls have not been commissioned; its production records are entered manually.

Requires Node.js 24+. Dependencies are installed and the production build is in `dist/`.

```powershell
Set-Location 'C:\Users\haffizol\Desktop\Project\Smart Checksheet\abb2 React'
npm.cmd start
```

Open **http://localhost:3700** and sign in. Attendance mode starts each line with empty manual production records and never connects to production MQTT. Explicit demo mode remains available for development only. Edits, users and reports persist in `data/production-demo.sqlite`. For source development use `npm.cmd run dev` and open http://localhost:5173. If the operating-system sandbox prevents Vite realpath access, run the command in your normal terminal.

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
- Operator, executive, management, developer and read-only display roles. Per-account line permissions are enforced by the backend; each configured line has an independent manual workspace.
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
