#!/usr/bin/env bash
# Connect one line's Raspberry Pi to Smart Checksheet. Run ON THE PI, from the
# folder that "site.sh add-line" produced on the AI PC:
#
#   sudo bash /tmp/pi-ABB7/install.sh
#
# Options (only needed when automatic detection is wrong):
#   --user NAME   the Pi account that runs the line's Python tracker
#   --db PATH     the tracker's live SQLite database
#
# It installs only the small event relay. It does not touch the sensor program,
# GPIO, Node-RED, Google Sheets, the analytics sender or the MQTT broker.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '%s\n' "$*"; }
ok()  { printf '  [ OK ] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
die() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
value() { grep -E "^$1=" "$here/relay.env" | tail -n 1 | cut -d= -f2- || true; }

main() {
  local user='' db='' line lower unit workdir url host port existing
  while test $# -gt 0; do
    case "$1" in
      --user) user="${2:-}"; shift 2;;
      --db) db="${2:-}"; shift 2;;
      *) die "Unknown option $1";;
    esac
  done
  test "$(id -u)" -eq 0 || die 'Run this with sudo:  sudo bash install.sh'
  for file in relay.env checksheet_event_relay.py checksheet-relay@.service; do
    test -f "$here/$file" || die "$file is missing. Copy the whole pi-LINE folder from the AI PC again."
  done
  command -v python3 >/dev/null 2>&1 || die 'python3 is not installed on this Pi.'

  line="$(value CHECKSHEET_LINE)"
  [[ "$line" =~ ^[A-Z][A-Z0-9]{1,7}$ ]] || die 'relay.env does not name a valid line code.'
  lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  url="$(value CHECKSHEET_EVENTS_URL)"
  test -n "$(value CHECKSHEET_TOKEN)" && test -n "$url" || die 'relay.env is incomplete. Run add-line on the AI PC again.'
  say "Connecting this Pi to Smart Checksheet as $line"

  # 1. Find the tracker service, its account and its folder.
  unit="$(systemctl list-units --all --plain --no-legend "$lower@*.service" 2>/dev/null | awk 'NR==1 { print $1 }')"
  if test -z "$user" && test -n "$unit"; then user="${unit#*@}"; user="${user%.service}"; fi
  if test -z "$user"; then user="${SUDO_USER:-}"; fi
  test -n "$user" && id "$user" >/dev/null 2>&1 || die "Could not tell which account runs the $line tracker. Add: --user NAME"
  workdir=''
  if test -n "$unit"; then workdir="$(systemctl show -p WorkingDirectory --value "$unit" 2>/dev/null || true)"; fi
  test -n "$workdir" || workdir="$(getent passwd "$user" | cut -d: -f6)/$lower"
  if test -n "$unit"; then ok "Tracker service: $unit (account $user)"; else warn "No $lower@ service found; using account $user and folder $workdir."; fi

  # 2. Find the live database the tracker writes to.
  if test -z "$db"; then
    existing="$(grep -E '^CHECKSHEET_SQLITE_PATH=.' /etc/smartchecksheet-relay.env 2>/dev/null | cut -d= -f2- || true)"
    if test -n "$existing" && test -f "$existing"; then db="$existing"
    elif test -f "$workdir/.env" && grep -Eq "^${line}_SQLITE_PATH=." "$workdir/.env"; then db="$(grep -E "^${line}_SQLITE_PATH=" "$workdir/.env" | tail -n 1 | cut -d= -f2-)"
    else db="$workdir/runtime/${lower}_state.db"; fi
  fi
  test -f "$db" || die "The tracker database was not found at $db. Add: --db /actual/path/${lower}_state.db"
  sudo -u "$user" python3 - "$db" <<'PY' || die "Account $user cannot read the outbox in $db. Check --user and --db."
import sqlite3, sys, pathlib
db = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
db.execute('SELECT event_id, line_code, payload_json FROM outbox_events LIMIT 1')
PY
  ok "Tracker database: $db"

  # 3. The tablet controls need the tracker to label its live data with the line.
  if test -f "$workdir/$lower.py" && ! grep -q '"line_code": LINE_CODE' "$workdir/$lower.py"; then
    warn "The tracker in $workdir is an older version. Tablet controls stay disabled until you update it:"
    say  "         cd $workdir && git pull --ff-only && sudo systemctl restart ${unit:-$lower@$user.service}"
  fi

  # 4. Can this Pi reach the AI PC?
  host="$(printf '%s' "$url" | sed -E 's#^https?://([^/:]+).*#\1#')"
  port="$(printf '%s' "$url" | sed -nE 's#^https?://[^/:]+:([0-9]+).*#\1#p')"
  case "$url" in https://*) port="${port:-443}";; *) port="${port:-80}";; esac
  if timeout 4 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then ok "The AI PC answers at $host:$port."
  else warn "The AI PC does not answer at $host:$port right now. The relay keeps retrying, so this is safe; check the network/firewall."; fi

  # 5. Install the relay.
  install -d /opt/smartchecksheet
  install -m 644 "$here/checksheet_event_relay.py" /opt/smartchecksheet/checksheet_event_relay.py
  install -m 644 "$here/checksheet-relay@.service" /etc/systemd/system/checksheet-relay@.service
  if test -f /etc/smartchecksheet-relay.env; then cp -p /etc/smartchecksheet-relay.env "/etc/smartchecksheet-relay.env.before-$(date +%Y%m%d-%H%M%S)"; fi
  ( umask 077
    printf 'CHECKSHEET_LINE=%s\nCHECKSHEET_SQLITE_PATH=%s\nCHECKSHEET_EVENTS_URL=%s\nCHECKSHEET_TOKEN=%s\n' \
      "$line" "$db" "$url" "$(value CHECKSHEET_TOKEN)" > /etc/smartchecksheet-relay.env )
  chmod 600 /etc/smartchecksheet-relay.env
  systemctl daemon-reload
  systemctl enable "checksheet-relay@$user" >/dev/null 2>&1
  systemctl restart "checksheet-relay@$user"
  sleep 3
  if systemctl is-active --quiet "checksheet-relay@$user"; then ok 'Event relay installed and running (it starts by itself after a reboot).'
  else journalctl -u "checksheet-relay@$user" -n 20 --no-pager || true; die 'The relay did not stay running. The messages above say why.'; fi
  rm -f -- "$here/relay.env"   # the token now lives only in /etc, readable by root

  # 6. The one thing this installer deliberately leaves alone: the broker.
  if command -v ss >/dev/null 2>&1 && ! ss -ltnH 2>/dev/null | awk '$4 ~ /:1883$/ && $4 !~ /^(127\.|\[::1\])/ { found = 1 } END { exit !found }'; then
    say ''
    warn "This Pi's MQTT broker only accepts connections from the Pi itself."
    say  '         Live counts and tablet commands need the AI PC to reach port 1883.'
    say  "         Follow \"Open the broker\" in DEPLOY.md, in a planned stop: it restarts Mosquitto."
  else
    ok 'The MQTT broker accepts network connections.'
  fi
  say ''
  say "Done. On the AI PC run:  bash deploy/site.sh doctor"
  say "Relay log on this Pi:    sudo journalctl -u checksheet-relay@$user -n 40 --no-pager"
}
main "$@"; exit
