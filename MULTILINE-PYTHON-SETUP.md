# Connect ABB2, ABB3 and ABB7 Python to the tablet

The code supports a separate Python/MQTT connection for every commissioned line.
Actual deployment still needs each Pi's private address, its existing service path,
broker access and verified model/manpower catalog. No machine has been changed remotely.

```text
ABB2 sensor -> ABB2 Python -> ABB2 Pi MQTT broker ---+
ABB3 sensor -> ABB3 Python -> ABB3 Pi MQTT broker ---+-> AI PC Checksheet -> tablets
ABB7 sensor -> ABB7 Python -> ABB7 Pi MQTT broker ---+
```

Tablet commands return through the selected line's broker. Python owns counts,
shift scheduling, machine modes and downtime timers. Each line has independent
state, commands, reports and credentials. Existing attendance remains available.
Lines absent from the machine config remain manual; `APP_MODE=attendance` keeps
all lines manual. ROLL MAKING stays manual because no Python service was provided.

## 1. Prepare each existing Pi Python service

Use the ABB3 source from [ffarahhq33/abb3](https://github.com/ffarahhq33/abb3)
and ABB7 from [digitalsgisb/abb7](https://github.com/digitalsgisb/abb7).
The local workspace also contains the existing ABB2 source and a prepared ABB3
folder. ABB7 was checked against upstream blob
`e5ffaaec74afd3acdee43b2ec88333de4fe87e0b`.

Back up the existing service source and runtime SQLite DB. During the deployment
window, stop the existing production service, apply the patch, then restart the
same service with its existing working directory and environment. Avoid running
a second sensor process alongside it. Copy `deploy/prepare-python-service.py`
to each Pi, then run the matching command with the actual source path:

```bash
python3 prepare-python-service.py /actual/path/abb2/abb2.py
python3 prepare-python-service.py /actual/path/abb3/abb3.py
python3 prepare-python-service.py /actual/path/abb7/abb7.py
```

Run one command on each corresponding Pi. The script adds `line_code` to live
snapshots, validates syntax and keeps `.before-checksheet` source backups.
For ABB3 it also creates the prefixed modules that `abb3.py` imports and fixes
the upstream `ABB7SQLiteStore` class name to `ABB3SQLiteStore`. It is safe to rerun.
The checked local Python copies already contain these changes.

The broker remains local to each Pi. Configure an authenticated private listener
that the AI PC can reach, keeping existing local Python/Node-RED access working.
Allow the Checksheet account to publish `nodered/newshift`, `nodered/modeltarget`,
`nodered/mode`, `nodered/adjust_count`, `nodered/reject`,
`noderedparam/condition` and `nodered/downtime_session`; allow it to subscribe to
`smartchecksheet/live`, `smartchecksheet/hourly` and the matching
`abb2/#`, `abb3/#` or `abb7/#` result/status topics. Tablets only need the web URL.

Every line must use its own broker. The existing generic command topics are
identical across lines; a shared broker would send a command to several machines.
The configuration rejects duplicate broker host/port pairs. Different DNS aliases
must not point to the same broker. Synchronize each Pi's clock: live snapshots
older than eight seconds, retained snapshots and snapshots for another line do
not enable machine controls. Use private LAN/VPN MQTT or verified TLS (`mqtts:`).

## 2. Configure the AI PC

In `/srv/apps/smartchecksheet` (or the existing deployment folder):

```bash
cp deploy/machines.example.json deploy/config/machines.json
```

Edit `deploy/config/machines.json`. Replace all three `*_PI_PRIVATE_IP` values.
Set each `productionLine` to the exact value already used by that Pi's Node-RED
shift form, preserving its existing shift ID convention. The example labels
`Line 1`, `Line 3` and `Line 7` must be checked against the actual installation.
Remove entries for lines that are not ready for commissioning.

Create `abb2-catalog.json`, `abb3-catalog.json` and `abb7-catalog.json` alongside
`machines.json`, following `catalog.example.json` but using verified production
models and people. Every model requires `name`, `cycle` (minutes/piece), `pcsHr`,
`slabWidth` and `slabLength`; manpower requires `supervisors`, `leaders`,
`operators` and `quality` lists. No demo catalog is loaded in live mode.
Relative catalog paths resolve beside `machines.json`.

Preserve the existing private `.env.docker`, database volume and attendance
settings. Add/update:

```dotenv
APP_MODE=live
MACHINE_CONNECTIONS_PATH=/app/config/machines.json
ABB2_MQTT_USERNAME=checksheet
ABB2_MQTT_PASSWORD=REPLACE_WITH_ABB2_BROKER_PASSWORD
ABB2_INGEST_TOKEN=REPLACE_WITH_A_UNIQUE_ABB2_TOKEN
ABB3_MQTT_USERNAME=checksheet
ABB3_MQTT_PASSWORD=REPLACE_WITH_ABB3_BROKER_PASSWORD
ABB3_INGEST_TOKEN=REPLACE_WITH_A_UNIQUE_ABB3_TOKEN
ABB7_MQTT_USERNAME=checksheet
ABB7_MQTT_PASSWORD=REPLACE_WITH_ABB7_BROKER_PASSWORD
ABB7_INGEST_TOKEN=REPLACE_WITH_A_UNIQUE_ABB7_TOKEN
```

Use a different long random ingestion token for each line. Keep broker passwords
and tokens in private environment files, never React/VITE variables or Git.
The existing Docker config mount exposes `deploy/config` at `/app/config`.
Without `MACHINE_CONNECTIONS_PATH`, the legacy single ABB2 `MQTT_URL`,
`CATALOG_PATH`, `MQTT_USERNAME`, `MQTT_PASSWORD` and `INGEST_TOKEN` still work.

## 3. Deliver Python's durable events independently

Counts and modes stream over MQTT. Rejects, parameters, count confirmations,
finalized hours and downtime records also need durable delivery. Copy
`deploy/checksheet_event_relay.py` to `/opt/smartchecksheet/` on each Pi.
It reads that Pi's existing `outbox_events` table and maintains a separate
`checksheet_deliveries` ledger in the same SQLite DB. Existing analytics delivery
statuses, Google Sheets and GPIO counting remain independent. It retries after
network outages/restarts and the receiver deduplicates by line/event ID.

Create `/etc/smartchecksheet-relay.env` privately on each Pi. Example for ABB3:

```dotenv
CHECKSHEET_LINE=ABB3
CHECKSHEET_SQLITE_PATH=/actual/path/abb3/runtime/abb3_state.db
CHECKSHEET_EVENTS_URL=http://AI_PC_PRIVATE_IP:3700/api/integrations/events
CHECKSHEET_TOKEN=THE_SAME_VALUE_AS_ABB3_INGEST_TOKEN_ON_THE_AI_PC
```

For ABB2/ABB7, substitute that line, its existing DB path and its own token.
Use the exact live DB path from the existing Python service environment, including
any `ABB*_SQLITE_PATH` override. The relay refuses to create a missing source DB.
Use private LAN/VPN or your HTTPS endpoint for HTTP delivery. The AI PC's published
port must be reachable from the Pis; a loopback-only Docker bind cannot accept
their private LAN connections. Bind to the intended private interface or configure
an accessible HTTPS route, preserving the existing attendance routes.

Install `deploy/checksheet-relay@.service` in `/etc/systemd/system/`. The instance
name is the existing Pi service user who owns the database. Protect the env file:

```bash
sudo chmod 600 /etc/smartchecksheet-relay.env
sudo systemctl daemon-reload
sudo systemctl enable --now checksheet-relay@YOUR_PI_SERVICE_USER
sudo journalctl -u checksheet-relay@YOUR_PI_SERVICE_USER -n 40 --no-pager
```

Systemd reads the protected environment file; the process runs as the specified
user. Run only one relay per Pi DB. Historical events are retained in the server's
`machine_events` table. Late events for a known shift update that shift's saved
reports; they never enter another line or a different current shift. Events that
arrive before live recovery are applied when Python identifies the current shift.

## 4. Rebuild and verify

```bash
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build checksheet
docker compose --env-file .env.docker logs --tail=80 checksheet
```

Open the existing HTTPS tablet URL and accept **Update app** if shown. Assign
accounts their correct line. `/api/health` reports connection state separately
for ABB2, ABB3 and ABB7 without exposing credentials.

For each line, confirm its real sensor count appears only on its own page, then
verify a shift/setup command, mode change, reject, parameter record and downtime
timer against Python. Production writes stay pending until Python confirms them.
Disconnecting one Pi must show that line as disconnected while others keep working.
Reconnection must not replay rejects or count commands. Existing manual records
remain under their `manual:<line>` keys; live records never overwrite them.

The web app leaves production shift endings to Python. No public MQTT port,
automatic command replay, simulated output or sensor changes are required.
