#!/usr/bin/env bash
# One command for a Smart Checksheet site (the AI PC that hosts the Docker app).
#
#   bash deploy/site.sh setup            First install, or change the basic settings
#   bash deploy/site.sh update           Back up, pull the latest version and redeploy
#   bash deploy/site.sh add-line ABB7    Connect a machine line and build its Pi installer
#   bash deploy/site.sh doctor           Check that everything is working
#   bash deploy/site.sh backup           Save a copy of the database
#   bash deploy/site.sh drive-backup     Send the nightly backup to Google Drive
#   bash deploy/site.sh pi-address       Let the Pis reach this PC over Tailscale
#
# Nothing here is specific to one plant: addresses and passwords are asked for
# or generated, and stored only in the private .env.docker and deploy/config/.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CHECKSHEET_ENV_FILE:-.env.docker}"
SERVICE=checksheet
CONFIG_DIR=deploy/config
LINE_PATTERN='^[A-Z][A-Z0-9]{1,7}$'
DEFAULT_LINES='ABB2,ABB3,ABB7'

# ---------- output ----------
say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '  [ OK ] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; warnings=$((warnings + 1)); }
bad()  { printf '  [FAIL] %s\n' "$*"; failures=$((failures + 1)); }
die()  { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
warnings=0; failures=0

# ---------- questions ----------
ask() { # ask VAR "Question" [default]
  local __var="$1" prompt="$2" default="${3:-}" reply=''
  if test -n "$default"; then printf '%s [%s]: ' "$prompt" "$default" >&2; else printf '%s: ' "$prompt" >&2; fi
  IFS= read -r reply || true
  printf -v "$__var" '%s' "${reply:-$default}"
}
ask_secret() { # ask_secret VAR "Question"  (typing is hidden)
  local __var="$1" reply=''
  printf '%s: ' "$2" >&2
  IFS= read -rs reply || true
  printf '\n' >&2
  printf -v "$__var" '%s' "$reply"
}
confirm() { # confirm "Question" [Y|N]
  local reply=''
  ask reply "$1 (y/n)" "${2:-y}"
  case "$reply" in y|Y|yes|YES|Yes) return 0;; *) return 1;; esac
}
# Docker env files treat quotes, spaces, # and $ specially; keep secrets simple.
valid_secret() { [[ "$1" =~ ^[A-Za-z0-9._~!@%^*+=:,/-]+$ ]]; }
random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-24}"
  else head -c "${1:-24}" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# ---------- private environment file ----------
get_env() { test -f "$ENV_FILE" && grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }
set_env() { # set_env KEY VALUE  (replaces the existing line or appends)
  local tmp
  tmp="$(mktemp)"
  K="$1" V="$2" awk 'BEGIN { FS = "="; done = 0 }
    $1 == ENVIRON["K"] && !done { print ENVIRON["K"] "=" ENVIRON["V"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["K"] "=" ENVIRON["V"] }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f -- "$tmp"
}

# ---------- docker ----------
compose() {
  local args=(--env-file "$ENV_FILE" -f compose.yaml)
  if test -f compose.override.yaml; then args+=(-f compose.override.yaml)
  elif test -f compose.override.yml; then args+=(-f compose.override.yml); fi
  if test -f compose.shift-link.yaml; then args+=(-f compose.shift-link.yaml); fi
  docker compose "${args[@]}" "$@"
}
need_docker() {
  command -v docker >/dev/null 2>&1 || die 'Docker is not installed on this PC. Install Docker Engine with the Compose plugin first.'
  docker compose version >/dev/null 2>&1 || die 'The Docker Compose plugin is missing. Install docker-compose-plugin.'
  docker info >/dev/null 2>&1 || die "Docker is installed but this account cannot use it. Run: sudo usermod -aG docker $USER   then sign out and back in."
}
need_env() { test -f "$ENV_FILE" || die "This site is not set up yet. Run: bash deploy/site.sh setup"; }
container_id() { compose ps -q "$SERVICE" 2>/dev/null || true; }
container_health() {
  local id
  id="$(container_id)"
  test -n "$id" || { echo missing; return; }
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing
}
wait_healthy() {
  local attempt
  for attempt in $(seq 1 60); do
    if test "$(container_health)" = healthy; then return 0; fi
    sleep 2
  done
  return 1
}
python_cmd() {
  local candidate
  for candidate in python3 python; do
    if "$candidate" -c 'import json' >/dev/null 2>&1; then echo "$candidate"; return 0; fi
  done
  return 1
}
host_addresses() { (hostname -I 2>/dev/null || true) | tr ' ' '\n' | grep -E '^[0-9]+\.' || true; }
# Pis at every plant reach this PC over Tailscale; the public HTTPS address is for browsers only.
tailscale_address() { if command -v tailscale >/dev/null 2>&1; then tailscale ip -4 2>/dev/null | head -n 1 || true; fi; }
print_urls() {
  local port address
  port="$(get_env CHECKSHEET_PORT)"; port="${port:-3700}"
  say ''
  say 'Open the app:'
  if test "$(get_env COOKIE_SECURE)" = true; then
    say "  Your HTTPS address (point the tunnel/proxy at http://localhost:$port)"
  else
    for address in $(host_addresses); do say "  http://$address:$port"; done
    say "  http://localhost:$port  (on this PC)"
  fi
}

# Keep PRODUCTION_LINES (the site's line list) in step with the lines that are connected.
add_site_line() {
  local current
  current="$(get_env PRODUCTION_LINES)"
  case ",$current," in *",$1,"*) return;; esac
  if test -z "$current"; then set_env PRODUCTION_LINES "$1"; else set_env PRODUCTION_LINES "$current,$1"; fi
}

# ---------- setup ----------
cmd_setup() {
  need_docker
  local created=0 generated_password='' choice token url probe site_lines current_lines line

  step '1 of 5  Private settings file'
  if test -f "$ENV_FILE"; then
    ok "Keeping your existing $ENV_FILE (nothing is overwritten unless you answer below)."
  else
    test -f .env.docker.example || die 'Run this from the Smart Checksheet folder (the one containing compose.yaml).'
    cp .env.docker.example "$ENV_FILE"
    created=1
    ok "Created $ENV_FILE from the example."
  fi
  chmod 600 "$ENV_FILE"

  step '2 of 5  Administrator account'
  if test "$(get_env ADMIN_PASSWORD | wc -c)" -ge 13; then
    ok "Administrator '$(get_env ADMIN_USERNAME)' already has a password."
  else
    generated_password="$(random_secret 10)"
    set_env ADMIN_PASSWORD "$generated_password"
    test -n "$(get_env ADMIN_USERNAME)" || set_env ADMIN_USERNAME developer
    ok 'Generated a strong administrator password (shown once at the end).'
  fi

  step '3 of 5  Which production lines does this site have?'
  say '  Write each line code, separated by commas (for example ABB2,ABB3,ABB7 or SDY1,SDY2).'
  current_lines="$(get_env PRODUCTION_LINES)"
  ask site_lines '  Lines' "${current_lines:-$DEFAULT_LINES}"
  site_lines="$(printf '%s' "$site_lines" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
  for line in ${site_lines//,/ }; do
    [[ "$line" =~ $LINE_PATTERN ]] || die "'$line' is not a line code. Use 2-8 capital letters or digits, such as ABB7 or SDY1."
  done
  test -n "$site_lines" || die 'List at least one line.'
  set_env PRODUCTION_LINES "$site_lines"
  if test "$created" -eq 1 && test "$site_lines" != "$DEFAULT_LINES"; then
    # The example Attendance groups belong to the ABB lines; another site sets its own.
    set_env ATTENDANCE_GROUPS "'[]'"
    ok 'Attendance groups cleared for this site; add its groups in .env.docker (see ATTENDANCE-INTEGRATION.md).'
  fi
  ok "Lines: $site_lines"

  step '4 of 5  How will tablets open the app?'
  say '  1) Plant Wi-Fi / LAN / Tailscale address (http://...)   - simplest'
  say '  2) HTTPS address through Cloudflare Tunnel or a proxy   - needed to install the tablet app'
  # Default to what an existing site already uses; a new site starts on the plant network.
  if test "$created" -eq 0 && test "$(get_env COOKIE_SECURE)" = true; then choice=2; else choice=1; fi
  ask choice '  Choose 1 or 2' "$choice"
  case "$choice" in
    1) set_env COOKIE_SECURE false; set_env CHECKSHEET_BIND 0.0.0.0; ok 'Tablets sign in using the plant network address.';;
    2) set_env COOKIE_SECURE true
       test -n "$(get_env CHECKSHEET_BIND)" || set_env CHECKSHEET_BIND 127.0.0.1
       ok 'Sign-in works only through the HTTPS address.';;
    *) die 'Choose 1 or 2.';;
  esac
  test -n "$(get_env CHECKSHEET_PORT)" || set_env CHECKSHEET_PORT 3700

  step '5 of 5  Attendance connection (optional)'
  if test -n "$(get_env ATTENDANCE_TOKEN)"; then
    ok 'An Attendance token is already saved.'
  else
    say '  In Attendance: System settings > Connected devices > Add connection >'
    say '  "Production app / checksheet (read only)". Copy the token it shows once.'
    ask_secret token '  Paste the token here, or press Enter to skip for now'
    if test -n "$token"; then
      valid_secret "$token" || die 'That token contains unexpected characters. Copy it again from Attendance.'
      url="$(get_env ATTENDANCE_API_URL)"; probe="${url/host.docker.internal/127.0.0.1}"
      if command -v curl >/dev/null 2>&1 && test -n "$probe"; then
        if printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -fsS -m 8 -K - "$probe/api/employees" 2>/dev/null | grep -Eq '"connection_scope"[[:space:]]*:[[:space:]]*"integration"'; then
          ok 'Attendance accepted the token (read-only connection).'
        else
          warn "Could not confirm the token at $probe. It is saved; check it later with: bash deploy/site.sh doctor"
        fi
      fi
      set_env ATTENDANCE_TOKEN "$token"
    else
      say '  Skipped. The Attendance tab stays empty until a token is added (run setup again).'
    fi
  fi
  mkdir -p "$CONFIG_DIR"

  step 'Building and starting Smart Checksheet (the first build takes a few minutes)'
  bash deploy/auto-deploy.sh "$root" "$SERVICE" "$ENV_FILE"

  say ''
  say '================  Smart Checksheet is running  ================'
  print_urls
  if test -n "$generated_password"; then
    say ''
    say "Sign in as:  $(get_env ADMIN_USERNAME)"
    say "Password:    $generated_password"
    say 'Write this password down now. It is not shown again.'
  fi
  say ''
  say 'Next: sign in, open User Management and create one account per tablet/line.'
  say 'To add a line or connect its Pi later: open Lines & machines in the app.'
}

# ---------- backup ----------
cmd_backup() {
  need_docker; need_env
  test -n "$(container_id)" || die 'Smart Checksheet is not running, so there is nothing to back up yet.'
  local stamp file old
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="checksheet-$stamp.sqlite"
  # VACUUM INTO writes a consistent copy while the app keeps running.
  compose exec -T "$SERVICE" node -e "
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const fs = process.getBuiltinModule('node:fs');
    fs.mkdirSync('/app/data/backups', { recursive: true });
    const db = new DatabaseSync(process.env.DATABASE_PATH);
    db.exec(\"VACUUM INTO '/app/data/backups/$file'\");
    db.close();
    for (const name of fs.readdirSync('/app/data/backups').sort().slice(0, -14)) fs.rmSync('/app/data/backups/' + name);
  "
  mkdir -p backups
  chmod 700 backups
  compose cp "$SERVICE:/app/data/backups/$file" "backups/$file" >/dev/null
  chmod 600 "backups/$file"
  for old in $(ls -1 backups/checksheet-*.sqlite 2>/dev/null | sort | head -n -14); do rm -f -- "$old"; done
  ok "Database saved to backups/$file (the newest 14 are kept)."
}

# ---------- Google Drive backup ----------
cmd_drive_backup() {
  local url token
  need_docker; need_env
  say 'The app copies its database every night at 02:00. To also keep that copy in Google Drive:'
  say '  1. Open the app > Backups > "Download the Drive backup Apps Script" and paste it into a new project at script.google.com.'
  say '  2. In Project Settings > Script properties add BACKUP_TOKEN = a long random password (24+ letters and numbers).'
  say '  3. Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone. Copy the /exec link.'
  say ''
  ask url 'Web app /exec link (type - to turn Drive backup off)' "$(get_env BACKUP_DRIVE_URL)"
  if test "$url" = - || test -z "$url"; then url=''; set_env BACKUP_DRIVE_URL ''; set_env BACKUP_DRIVE_TOKEN ''
  else
    [[ "$url" =~ ^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]+/exec$ ]] || die 'That is not an Apps Script web app link (https://script.google.com/macros/s/.../exec).'
    ask_secret token 'BACKUP_TOKEN (the same value as in Script properties; typing is hidden; Enter keeps the saved one)'
    if test -z "$token"; then token="$(get_env BACKUP_DRIVE_TOKEN)"; fi
    test "${#token}" -ge 24 || die 'The token must be at least 24 characters.'
    valid_secret "$token" || die 'Use only letters, numbers and . _ ~ ! @ % ^ * + = : , / - in the token.'
    set_env BACKUP_DRIVE_URL "$url"; set_env BACKUP_DRIVE_TOKEN "$token"
  fi
  step 'Restarting with the new setting'
  compose up -d "$SERVICE" >/dev/null
  if test -n "$url"; then ok 'Saved. Open the app > Backups > Back up now to test the link.'; else ok 'Drive backup is off; the nightly copy stays on this PC only.'; fi
}

# ---------- update ----------
cmd_update() {
  need_docker; need_env
  test -d .git || die 'This folder was not installed with git clone, so it cannot update itself.'
  test -z "$(git status --porcelain --untracked-files=no)" || die 'Program files were edited on this PC. Run "git status" and undo or save those edits first (your settings files are safe).'
  step 'Saving a database backup'
  if test -n "$(container_id)"; then cmd_backup; else say '  Not running yet; no backup needed.'; fi
  step 'Downloading the latest version'
  git pull --ff-only origin "$(git branch --show-current)"
  step 'Rebuilding (the current version keeps running until the new one is ready)'
  bash deploy/auto-deploy.sh "$root" "$SERVICE" "$ENV_FILE"
  say ''
  say 'Updated. Tablets pick up the new version by themselves within about a minute of being idle.'
}

# ---------- add-line ----------
cmd_add_line() {
  need_docker; need_env
  local line="${1:-}" lower py pi_ip label default_label mqtt_user mqtt_pass token pc_ip port catalog models_url people_url bundle stamp backup_dir
  line="$(printf '%s' "$line" | tr '[:lower:]' '[:upper:]')"
  [[ "$line" =~ $LINE_PATTERN ]] || die "Say which line to connect, for example: bash deploy/site.sh add-line ABB7  (2-8 capital letters or digits, such as SDY1)"
  lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  py="$(python_cmd)" || die 'python3 is needed for this step. Install it with: sudo apt install -y python3'
  test "$(get_env ADMIN_PASSWORD | wc -c)" -ge 13 || die 'Machine mode needs an administrator password of 12+ characters. Run: bash deploy/site.sh setup'
  test -n "$(container_id)" || die 'Start Smart Checksheet first: bash deploy/site.sh setup'
  mkdir -p "$CONFIG_DIR"

  step "Connect $line  -  1 of 4  Where is the $line Raspberry Pi?"
  ask pi_ip "  $line Pi address on the plant network (for example 192.168.1.50)"
  [[ "$pi_ip" =~ ^[A-Za-z0-9.-]+$ ]] || die 'Enter an IP address or host name, without http:// or a port.'
  if timeout 3 bash -c "exec 3<>/dev/tcp/$pi_ip/1883" 2>/dev/null; then ok "The MQTT broker on $pi_ip answers."
  else warn "Nothing answers on $pi_ip port 1883 yet. The Pi's broker must accept connections from this PC (see DEPLOY.md, 'Open the broker')."; fi

  case "$line" in ABB2) default_label='Line 1';; ABB3) default_label='Line 3';; ABB7) default_label='MF';; *) default_label="$line";; esac
  say "  The line label must match what this Pi already writes in its shift IDs"
  say "  (for example 20261106-Day-MF means the label is MF)."
  ask label '  Line label' "$default_label"
  test -n "$label" || die 'A line label is required.'

  step "2 of 4  Broker sign-in for $line (leave the password empty if the broker has none)"
  ask mqtt_user '  Broker username' "$(get_env "${line}_MQTT_USERNAME")"
  ask_secret mqtt_pass '  Broker password (hidden; Enter keeps the saved one)'
  if test -n "$mqtt_pass"; then valid_secret "$mqtt_pass" || die 'Use a broker password made of letters, numbers and . _ - ! @ % + = : , /'; fi
  if test -n "$mqtt_user"; then valid_secret "$mqtt_user" || die 'Use a simple broker username (letters, numbers, . _ -).'; fi

  step '3 of 4  Models and manpower list'
  catalog="$CONFIG_DIR/$lower-catalog.json"
  if test -f "$catalog"; then
    ok "Using the existing $catalog."
  else
    say "  $line needs its verified model and manpower list. It can be read from the"
    say '  Google Apps Script links this line already uses (nothing is written to the sheet).'
    ask models_url '  Models Apps Script URL (ends with /exec), or Enter to stop'
    test -n "$models_url" || die "Create $catalog (see catalog.example.json) and run this command again."
    ask people_url '  Manpower (Names) Apps Script URL (ends with /exec)'
    "$py" deploy/import_google_catalog.py --models-url "$models_url" --people-url "$people_url" --output "$catalog" \
      || die 'The catalog could not be imported. Nothing was changed. Check the two links and try again.'
    ok "Saved $catalog."
  fi

  step '4 of 4  How does the Pi reach this PC?'
  pc_ip="$(get_env CHECKSHEET_PI_URL | sed -E 's#^https?://([^/:]+).*#\1#')"
  test -n "$pc_ip" || pc_ip="$(tailscale_address)"
  test -n "$pc_ip" || pc_ip="$(host_addresses | head -n 1)"
  say '  Use this PC'"'"'s Tailscale address (100.x.x.x): it works from every plant. Not the public HTTPS address.'
  ask pc_ip '  This PC address as seen from the Pi' "$pc_ip"
  [[ "$pc_ip" =~ ^[A-Za-z0-9.-]+$ ]] || die 'Enter an IP address or host name.'
  port="$(get_env CHECKSHEET_PORT)"; port="${port:-3700}"

  # Keep a copy of everything this step changes, so a bad answer cannot take the site down.
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="$CONFIG_DIR/.before-add-line-$stamp"
  mkdir -p "$backup_dir"
  cp -p "$ENV_FILE" "$backup_dir/env"
  if test -f "$CONFIG_DIR/machines.json"; then cp -p "$CONFIG_DIR/machines.json" "$backup_dir/machines.json"; fi
  restore() {
    cat "$backup_dir/env" > "$ENV_FILE"
    if test -f "$backup_dir/machines.json"; then cp -p "$backup_dir/machines.json" "$CONFIG_DIR/machines.json"; else rm -f -- "$CONFIG_DIR/machines.json"; fi
  }

  "$py" - "$CONFIG_DIR/machines.json" "$line" "mqtt://$pi_ip:1883" "$lower-catalog.json" "$label" <<'PY' || { restore; die 'The machine list was not changed.'; }
import json, os, sys
path, line, url, catalog, label = sys.argv[1:6]
items = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else []
items = [item for item in items if item.get('line') != line]
if any(item.get('mqttUrl', '').lower() == url.lower() for item in items):
    sys.exit('Another line already uses that Pi address. Every line needs its own Pi broker.')
items.append({'line': line, 'mqttUrl': url, 'catalogPath': catalog, 'productionLine': label})
items.sort(key=lambda item: item['line'])
with open(path, 'w', encoding='utf-8') as handle:
    json.dump(items, handle, indent=2)
    handle.write('\n')
PY

  token="$(get_env "${line}_INGEST_TOKEN")"
  test -n "$token" || token="$(random_secret 24)"
  set_env "${line}_INGEST_TOKEN" "$token"
  set_env "${line}_MQTT_USERNAME" "$mqtt_user"
  if test -n "$mqtt_pass"; then set_env "${line}_MQTT_PASSWORD" "$mqtt_pass"; fi
  set_env APP_MODE live
  add_site_line "$line"
  set_env MACHINE_CONNECTIONS_PATH /app/config/machines.json
  set_env CHECKSHEET_BIND 0.0.0.0   # the Pi delivers its records to this PC over the plant network

  step 'Checking the new settings before touching the running app'
  if ! compose run --rm --no-deps -T "$SERVICE" node -e "import('./server/machineConfig.js').then(m => { m.liveConfigs(); console.log('Settings are valid.'); }).catch(e => { console.error(e.message); process.exit(1); })"; then
    restore
    die 'The settings were rejected (message above). Everything was put back; the app was not restarted.'
  fi

  step 'Restarting Smart Checksheet with the new line (tablets reconnect by themselves)'
  compose up -d --no-deps --no-build "$SERVICE"
  if ! wait_healthy; then
    say '  The app did not come back healthy. Restoring the previous settings.'
    restore
    compose up -d --no-deps --no-build "$SERVICE" || true
    wait_healthy || true
    die "The previous settings were restored. See: docker compose --env-file $ENV_FILE logs --tail=60 $SERVICE"
  fi
  ok "$line is configured on this PC."

  # Everything the Pi needs, in one folder: copy it over and run one command.
  bundle="$CONFIG_DIR/pi-$line"
  rm -rf -- "$bundle"
  mkdir -p "$bundle"
  cp deploy/install-pi.sh "$bundle/install.sh"
  cp deploy/checksheet_event_relay.py deploy/checksheet-relay@.service "$bundle/"
  ( umask 077
    printf 'CHECKSHEET_LINE=%s\nCHECKSHEET_SQLITE_PATH=\nCHECKSHEET_EVENTS_URL=http://%s:%s/api/integrations/events\nCHECKSHEET_TOKEN=%s\n' \
      "$line" "$pc_ip" "$port" "$token" > "$bundle/relay.env" )

  say ''
  say "================  Last step: run these two commands for the $line Pi  ================"
  say "  scp -r $root/$bundle  PI_USER@$pi_ip:/tmp/"
  say "  ssh -t PI_USER@$pi_ip 'sudo bash /tmp/pi-$line/install.sh'"
  say ''
  say "Replace PI_USER with the Pi's login name. Then check with: bash deploy/site.sh doctor"
  say "In the app, give the $line tablets an account with the $line line."
}

# ---------- pi-address ----------
# The address every Pi relay posts its records to: this PC's Tailscale address.
cmd_pi_address() {
  need_docker; need_env
  local address port
  port="$(get_env CHECKSHEET_PORT)"; port="${port:-3700}"
  address="$(tailscale_address)"
  if test -n "$address"; then ok "This PC's Tailscale address is $address."; else warn 'Tailscale is not running on this PC (tailscale ip -4 gave nothing).'; fi
  ask address '  Address the Pis use to reach this PC' "$address"
  [[ "$address" =~ ^[A-Za-z0-9.-]+$ ]] || die 'Enter an IP address or host name, without http:// or a port.'
  set_env CHECKSHEET_PI_URL "http://$address:$port"
  # Listen on every address (loopback for the HTTPS tunnel, Tailscale for the Pis). Works even if Tailscale starts after Docker.
  set_env CHECKSHEET_BIND 0.0.0.0
  step 'Restarting Smart Checksheet (tablets reconnect by themselves)'
  compose up -d --no-deps --no-build "$SERVICE" >/dev/null
  wait_healthy || die "The app did not come back healthy. See: docker compose --env-file $ENV_FILE logs --tail=60 $SERVICE"
  ok "Pis will send their records to http://$address:$port"
  say ''
  say 'Next, for every line: Lines & machines > the line > Pi relay installer > Download installer,'
  say 'copy it to that Pi and run: sudo bash install-pi-LINE.sh   (lines from machines.json: run add-line LINE again).'
}

# ---------- doctor ----------
cmd_doctor() {
  local mode health port line host hostport py ago newest backup
  warnings=0; failures=0
  step 'This PC'
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then ok 'Docker is working.'; else bad 'Docker is not available to this account.'; fi
  if test -f "$ENV_FILE"; then ok "Settings file $ENV_FILE exists."; else bad "No $ENV_FILE. Run: bash deploy/site.sh setup"; say ''; return 1; fi
  if test "$(stat -c %a "$ENV_FILE" 2>/dev/null || echo 600)" != 600; then warn "$ENV_FILE can be read by other users. Run: chmod 600 $ENV_FILE"; fi
  if test "$(get_env ADMIN_PASSWORD | wc -c)" -lt 13; then bad 'ADMIN_PASSWORD is missing or shorter than 12 characters.'; fi
  if test -d .git; then
    if test -n "$(git status --porcelain --untracked-files=no 2>/dev/null)"; then warn 'Program files were edited on this PC; automatic updates will refuse to run.'; fi
    if test "$(git branch --show-current 2>/dev/null)" != main; then warn 'This checkout is not on the main branch.'; fi
  fi
  if test "$(df -Pk . | awk 'NR==2 { print $4 }')" -lt 2097152; then warn 'Less than 2 GB of free disk space.'; fi
  newest="$(ls -1 backups/checksheet-*.sqlite 2>/dev/null | sort | tail -n 1 || true)"
  if test -n "$newest"; then say "  Latest copy on this PC: $newest"; fi

  if test -z "$(get_env BACKUP_DRIVE_URL)"; then warn 'Nightly backups stay on this PC only. To keep a copy in Google Drive run: bash deploy/site.sh drive-backup'; fi

  step 'Smart Checksheet app'
  mode="$(get_env APP_MODE)"; port="$(get_env CHECKSHEET_PORT)"; port="${port:-3700}"
  health="$(container_health)"
  case "$health" in
    healthy) ok "Running and healthy (mode: ${mode:-attendance}, port $port).";;
    missing) bad 'Not running. Start it with: bash deploy/site.sh setup';;
    *) bad "Container state is '$health'. See: docker compose --env-file $ENV_FILE logs --tail=60 $SERVICE";;
  esac
  if test "$health" = healthy; then
    # Nightly backup result, read from the app's own log of backups (no secrets are printed).
    backup="$(compose exec -T "$SERVICE" node -e "const { DatabaseSync } = process.getBuiltinModule('node:sqlite'); try { const db = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true }); const r = db.prepare('SELECT started_at, drive, error FROM backup_runs ORDER BY id DESC LIMIT 1').get(); console.log(r ? [Math.floor((Date.now() - Date.parse(r.started_at)) / 3600000), r.error ? 'failed' : r.drive ? 'drive' : 'local'].join(' ') : 'none'); } catch { console.log('none'); }" 2>/dev/null || echo none)"
    [[ "$backup" =~ ^[0-9]+\ (drive|local|failed)$ ]] || backup=none
    case "$backup" in
      none) warn 'No nightly backup has run yet (the first runs at 02:00). Run now in the app: Backups > Back up now';;
      *' failed') bad 'The last nightly backup failed. Open the app > Backups to see why.';;
      *) if test "${backup%% *}" -gt 36; then warn "The newest nightly backup is ${backup%% *} hours old."; else ok "Nightly backup ran ${backup%% *} h ago ($([ "${backup#* }" = drive ] && echo 'saved on this PC and in Google Drive' || echo 'saved on this PC'))."; fi;;
    esac
  fi

  step 'Attendance'
  if test -z "$(get_env ATTENDANCE_TOKEN)"; then warn 'No Attendance token saved; the Attendance tab will be empty. Run setup again to add one.'
  elif test "$health" = healthy; then
    if compose exec -T "$SERVICE" node -e "fetch(process.env.ATTENDANCE_API_URL + '/api/employees', { headers: { Authorization: 'Bearer ' + process.env.ATTENDANCE_TOKEN }, signal: AbortSignal.timeout(6000) }).then(r => process.exit(r.ok ? 0 : r.status === 401 || r.status === 403 ? 3 : 4)).catch(() => process.exit(5))" >/dev/null 2>&1; then ok 'Attendance answers and accepts the token.'
    else case $? in
      3) bad 'Attendance rejected the token. Create a new read-only connection in Attendance and run setup again.';;
      5) bad "Attendance cannot be reached at $(get_env ATTENDANCE_API_URL). Is the Attendance container running on that port?";;
      *) bad 'Attendance answered with an error. Check the Attendance logs.';;
    esac; fi
  fi

  step 'Machine lines'
  if test "$mode" = live; then
    case "$(get_env CHECKSHEET_BIND)" in ''|127.*|localhost) bad 'The app only listens on this PC itself, so the Pis cannot deliver their records. Run: bash deploy/site.sh pi-address';; esac
    if test -z "$(get_env CHECKSHEET_PI_URL)"; then warn 'No Pi address saved. Run: bash deploy/site.sh pi-address'; else ok "Pis deliver their records to $(get_env CHECKSHEET_PI_URL)"; fi
  fi
  if test "$mode" != live || ! test -f "$CONFIG_DIR/machines.json"; then
    say '  No machine lines connected (all lines are manual entry). Add one with: bash deploy/site.sh add-line ABB7'
  else
    py="$(python_cmd || true)"
    if test -n "$py"; then
      while read -r line hostport; do
        test -n "$line" || continue
        host="${hostport%:*}"
        if timeout 3 bash -c "exec 3<>/dev/tcp/$host/${hostport##*:}" 2>/dev/null; then ok "$line: broker $hostport is reachable from this PC."
        else bad "$line: cannot reach the Pi broker at $hostport (Pi off, wrong address, or broker only listens on the Pi itself)."; fi
        test -n "$(get_env "${line}_INGEST_TOKEN")" || bad "$line: no ${line}_INGEST_TOKEN saved; run add-line $line again."
      done < <("$py" -c "
import json, sys
from urllib.parse import urlsplit
for item in json.load(open(sys.argv[1], encoding='utf-8')):
    url = urlsplit(item['mqttUrl'])
    print(item['line'], '%s:%s' % (url.hostname, url.port or (8883 if url.scheme == 'mqtts' else 1883)))
" "$CONFIG_DIR/machines.json")
    fi
    if test "$health" = healthy; then
      compose exec -T "$SERVICE" node -e "fetch('http://127.0.0.1:3700/api/health').then(r => r.json()).then(h => { for (const [line, m] of Object.entries(h.machines || {})) console.log((m.connected ? '  [ OK ] ' : '  [WARN] ') + line + (m.connected ? ': receiving live data from the machine.' : ': no fresh machine data (Pi program stopped, broker sign-in wrong, or Pi clock off).')); })" || true
    fi
  fi

  say ''
  if test "$failures" -gt 0; then say "Result: $failures problem(s) to fix, $warnings warning(s)."; return 1; fi
  say "Result: no problems found ($warnings warning(s))."
}

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

main() {
  cd "$root"
  local command="${1:-}"
  shift || true
  case "$command" in
    setup) cmd_setup "$@";;
    update) cmd_update "$@";;
    add-line) cmd_add_line "$@";;
    doctor) cmd_doctor "$@";;
    backup) cmd_backup "$@";;
    drive-backup) cmd_drive_backup "$@";;
    pi-address) cmd_pi_address "$@";;
    *) usage; exit 1;;
  esac
}
# The whole file is parsed before anything runs, so "update" can safely replace it.
main "$@"; exit
