#!/usr/bin/env bash
set -euo pipefail

app="${1:?Pass the existing application directory}"
service="${2:?Pass checksheet or attendance}"
env_file="${3:-}"
case "$service" in checksheet|attendance) ;; *) echo 'Unknown application'; exit 1;; esac
cd "$app"
test -f compose.yaml
compose=()
if test -n "$env_file"; then test -f "$env_file"; compose+=(--env-file "$env_file"); fi
# Lines connected from the app keep their Pi login encrypted with this key. Create it once; never print it.
if test "$service" = checksheet && test -n "$env_file" && ! grep -Eq '^CHECKSHEET_SECRET_KEY=[A-Za-z0-9]{32,}$' "$env_file"; then
  sed -i '/^CHECKSHEET_SECRET_KEY=/d' "$env_file"
  if test -s "$env_file" && test -n "$(tail -c 1 "$env_file")"; then printf '\n' >> "$env_file"; fi
  printf 'CHECKSHEET_SECRET_KEY=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$env_file"
  echo 'Created CHECKSHEET_SECRET_KEY in the settings file (keep a copy of that file with your backups).'
fi
compose+=(-f compose.yaml)
if test -f compose.override.yaml; then compose+=(-f compose.override.yaml)
elif test -f compose.override.yml; then compose+=(-f compose.override.yml); fi
if test -f compose.shift-link.yaml; then compose+=(-f compose.shift-link.yaml); fi

# Both repositories serialize Docker replacements on the same AI PC.
mkdir -p "$HOME/.local/state/production-digital"
exec 9>"$HOME/.local/state/production-digital/deploy.lock"
flock -w 1200 9
docker compose "${compose[@]}" config --quiet
old_container="$(docker compose "${compose[@]}" ps -q "$service")"
old_image=''
if test -n "$old_container"; then old_image="$(docker inspect --format '{{.Image}}' "$old_container")"; fi
replaced=0

rollback() {
  result=$?
  if test "$result" -ne 0 && test "$replaced" -eq 1 && test -n "$old_image"; then
    echo 'New container did not become healthy. Restoring the previous application image.'
    rollback_file="$(mktemp --suffix=.yaml)"
    docker image tag "$old_image" "production-digital-rollback:$service"
    printf 'services:\n  %s:\n    image: production-digital-rollback:%s\n' "$service" "$service" > "$rollback_file"
    docker compose "${compose[@]}" -f "$rollback_file" up -d --no-deps --no-build "$service" || true
    rm -f -- "$rollback_file"
  fi
  exit "$result"
}
trap rollback EXIT

# Build first, keeping the current container available until its replacement is ready.
docker compose "${compose[@]}" build --build-arg "APP_BUILD_REVISION=$(git rev-parse HEAD)" "$service"
replaced=1
docker compose "${compose[@]}" up -d --no-deps --no-build "$service"
container="$(docker compose "${compose[@]}" ps -q "$service")"
test -n "$container"
for attempt in $(seq 1 60); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  if test "$health" = healthy; then
    echo "$service deployed successfully: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done
echo "$service failed its health check."
exit 1
