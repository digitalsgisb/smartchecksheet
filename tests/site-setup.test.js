import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercises deploy/site.sh against stubbed docker/git, in a throwaway copy of the deployment files.
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const source = name => fileURLToPath(new URL('../' + name, import.meta.url));
const shellPath = value => value.replaceAll('\\', '/');
const python = ['python3', 'python'].find(name => spawnSync(name, ['-c', 'import json'], { timeout: 15000 }).status === 0);
const env = text => Object.fromEntries(text.split('\n').filter(row => /^[A-Z0-9_]+=/.test(row)).map(row => [row.slice(0, row.indexOf('=')), row.slice(row.indexOf('=') + 1)]));

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'checksheet-site-')), bin = join(dir, 'bin');
  mkdirSync(bin); mkdirSync(join(dir, 'deploy', 'config'), { recursive: true });
  for (const name of ['deploy/site.sh', 'deploy/auto-deploy.sh', 'deploy/install-pi.sh', 'deploy/checksheet_event_relay.py', 'deploy/checksheet-relay@.service', '.env.docker.example', 'compose.yaml']) copyFileSync(source(name), join(dir, name));
  const executable = (name, body) => writeFileSync(join(bin, name), '#!/usr/bin/env bash\n' + body + '\n', { mode: 0o755 });
  executable('flock', 'exit 0'); executable('sleep', 'exit 0'); executable('seq', "printf '1\\n2\\n'"); executable('timeout', 'exit 1');
  executable('git', 'echo tested-commit'); executable('hostname', 'echo 192.168.9.2');
  // Git Bash's df scans every Windows drive (20 s or more); report plenty of free space instead.
  executable('df', "printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\ntest 99999999 1 99999998 1%% /\\n'");
  executable('docker', `echo "$*" >> "$SITE_TEST_LOG"
case "$1" in
  inspect) if [[ "$*" == *'.Image'* ]]; then echo sha256:previous; else echo healthy; fi;;
  compose)
    if [[ "$*" == *' run '* ]] && test "\${SITE_TEST_REJECT:-}" = 1; then echo 'ABB7: catalogPath is required.' >&2; exit 1; fi
    if [[ "$*" == *' ps -q '* ]]; then echo container; fi;;
esac`);
  function run(args, input, extra = {}) {
    return spawnSync(bash, ['--noprofile', '--norc', '-c', 'mock_bin="$SITE_TEST_BIN"; if command -v cygpath >/dev/null; then mock_bin="$(cygpath -u "$mock_bin")"; fi; export PATH="$mock_bin:$PATH"; exec bash "$@"', 'site-test', shellPath(join(dir, 'deploy', 'site.sh')), ...args], {
      encoding: 'utf8', timeout: 55000, input,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, HOME: shellPath(dir), SITE_TEST_BIN: shellPath(bin), SITE_TEST_LOG: shellPath(join(dir, 'calls.log')), ...extra }
    });
  }
  return { dir, run, read: name => readFileSync(join(dir, name), 'utf8') };
}
const skip = !existsSync(bash);
// One answer per prompt; an empty string accepts the prompt's default.
const answers = (...items) => items.join('\n') + '\n';

test('setup creates private settings once and never replaces an existing password', { skip, timeout: 120000 }, () => {
  const { dir, run, read } = site();
  try {
    const first = run(['setup'], answers('', '1', ''));
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const settings = env(read('.env.docker'));
    assert.ok(settings.ADMIN_PASSWORD.length >= 12);
    assert.equal(settings.COOKIE_SECURE, 'false');
    assert.equal(settings.CHECKSHEET_BIND, '0.0.0.0');
    assert.equal(settings.PRODUCTION_LINES, 'ABB2,ABB3,ABB7');
    assert.match(settings.ATTENDANCE_GROUPS, /"accountLines":\["ABB7"\]/);
    assert.match(first.stdout, new RegExp('Password:\\s+' + settings.ADMIN_PASSWORD));
    assert.match(first.stdout, /http:\/\/192\.168\.9\.2:3700/);
    assert.match(read('calls.log'), /compose .* build /);

    const second = run(['setup'], answers('', '2', ''));
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const again = env(read('.env.docker'));
    assert.equal(again.ADMIN_PASSWORD, settings.ADMIN_PASSWORD);
    assert.equal(again.COOKIE_SECURE, 'true');
    assert.doesNotMatch(second.stdout, /Password:/);

    const doctor = run(['doctor'], '');
    assert.equal(doctor.status, 0, doctor.stderr + doctor.stdout);
    assert.match(doctor.stdout, /Running and healthy/);
    assert.match(doctor.stdout, /no problems found/);
    assert.doesNotMatch(doctor.stdout, new RegExp(settings.ADMIN_PASSWORD));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('add-line writes the machine list, switches to live mode and builds the Pi bundle', { skip: skip || !python, timeout: 120000 }, () => {
  const { dir, run, read } = site();
  try {
    assert.equal(run(['setup'], answers('', '1', '')).status, 0);
    writeFileSync(join(dir, 'deploy/config/abb7-catalog.json'), '{"models":[],"people":{}}');
    const added = run(['add-line', 'abb7'], '192.168.9.9\nMF\nchecksheet\nbroker-pass-1\n192.168.9.2\n');
    assert.equal(added.status, 0, added.stderr + added.stdout);
    assert.deepEqual(JSON.parse(read('deploy/config/machines.json')), [{ line: 'ABB7', mqttUrl: 'mqtt://192.168.9.9:1883', catalogPath: 'abb7-catalog.json', productionLine: 'MF' }]);
    const settings = env(read('.env.docker'));
    assert.equal(settings.APP_MODE, 'live');
    assert.equal(settings.MACHINE_CONNECTIONS_PATH, '/app/config/machines.json');
    assert.equal(settings.ABB7_MQTT_PASSWORD, 'broker-pass-1');
    assert.ok(settings.ABB7_INGEST_TOKEN.length >= 32);
    const relay = env(read('deploy/config/pi-ABB7/relay.env'));
    assert.deepEqual(relay, { CHECKSHEET_LINE: 'ABB7', CHECKSHEET_SQLITE_PATH: '', CHECKSHEET_EVENTS_URL: 'http://192.168.9.2:3700/api/integrations/events', CHECKSHEET_TOKEN: settings.ABB7_INGEST_TOKEN });
    assert.ok(existsSync(join(dir, 'deploy/config/pi-ABB7/install.sh')));
    assert.doesNotMatch(added.stdout, new RegExp(settings.ABB7_INGEST_TOKEN));
    assert.doesNotMatch(added.stdout, /broker-pass-1/);

    // A second line on the same Pi address is refused and leaves everything as it was.
    writeFileSync(join(dir, 'deploy/config/abb3-catalog.json'), '{"models":[],"people":{}}');
    const before = read('.env.docker');
    const duplicate = run(['add-line', 'ABB3'], '192.168.9.9\nLine 3\n\n\n192.168.9.2\n');
    assert.equal(duplicate.status, 1);
    assert.equal(read('.env.docker'), before);
    assert.equal(JSON.parse(read('deploy/config/machines.json')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('add-line restores the previous settings when the new configuration is rejected', { skip: skip || !python, timeout: 120000 }, () => {
  const { dir, run, read } = site();
  try {
    assert.equal(run(['setup'], answers('', '1', '')).status, 0);
    writeFileSync(join(dir, 'deploy/config/abb7-catalog.json'), '{}');
    const before = read('.env.docker');
    const rejected = run(['add-line', 'ABB7'], '192.168.9.9\nMF\n\n\n192.168.9.2\n', { SITE_TEST_REJECT: '1' });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /put back/);
    assert.equal(read('.env.docker'), before);
    assert.equal(existsSync(join(dir, 'deploy/config/machines.json')), false);
    assert.equal(existsSync(join(dir, 'deploy/config/pi-ABB7')), false);
    assert.doesNotMatch(read('calls.log'), / up -d --no-deps --no-build checksheet\n[\s\S]* up -d --no-deps --no-build checksheet/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Sendayan site defines its own lines, drops the ABB attendance groups and connects SDY1', { skip: skip || !python, timeout: 120000 }, () => {
  const { dir, run, read } = site();
  try {
    const started = run(['setup'], answers('sdy1, sdy2', '1', ''));
    assert.equal(started.status, 0, started.stderr + started.stdout);
    let settings = env(read('.env.docker'));
    assert.equal(settings.PRODUCTION_LINES, 'SDY1,SDY2');
    assert.equal(settings.ATTENDANCE_GROUPS, "'[]'");
    const invalid = run(['setup'], answers('SDY-1', '1', ''));
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /not a line code/);

    writeFileSync(join(dir, 'deploy/config/sdy1-catalog.json'), '{"models":[],"people":{}}');
    const added = run(['add-line', 'sdy1'], answers('192.168.9.20', '', 'checksheet', 'broker-pass-2', '192.168.9.2'));
    assert.equal(added.status, 0, added.stderr + added.stdout);
    assert.deepEqual(JSON.parse(read('deploy/config/machines.json')), [{ line: 'SDY1', mqttUrl: 'mqtt://192.168.9.20:1883', catalogPath: 'sdy1-catalog.json', productionLine: 'SDY1' }]);
    settings = env(read('.env.docker'));
    assert.equal(settings.PRODUCTION_LINES, 'SDY1,SDY2');
    assert.ok(settings.SDY1_INGEST_TOKEN.length >= 32);
    assert.equal(env(read('deploy/config/pi-SDY1/relay.env')).CHECKSHEET_LINE, 'SDY1');
    assert.match(added.stdout, /pi-SDY1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('drive-backup saves the Apps Script link and token privately, and can turn Drive off again', { skip, timeout: 120000 }, () => {
  const { dir, run, read } = site();
  try {
    assert.equal(run(['setup'], answers('', '1', '')).status, 0);
    const link = 'https://script.google.com/macros/s/AKfy_Test-1/exec', token = 'driveToken' + 'z'.repeat(20);
    const bad = run(['drive-backup'], answers('https://example.com/exec', token));
    assert.notEqual(bad.status, 0); assert.match(bad.stderr, /not an Apps Script web app link/);
    const short = run(['drive-backup'], answers(link, 'short'));
    assert.notEqual(short.status, 0); assert.match(short.stderr, /at least 24 characters/);
    const saved = run(['drive-backup'], answers(link, token));
    assert.equal(saved.status, 0, saved.stderr + saved.stdout);
    assert.deepEqual([env(read('.env.docker')).BACKUP_DRIVE_URL, env(read('.env.docker')).BACKUP_DRIVE_TOKEN], [link, token]);
    assert.doesNotMatch(saved.stdout + saved.stderr, new RegExp(token));
    assert.match(read('calls.log'), /compose .* up -d checksheet/);
    const keep = run(['drive-backup'], answers('', ''));
    assert.equal(keep.status, 0, keep.stderr + keep.stdout); assert.equal(env(read('.env.docker')).BACKUP_DRIVE_TOKEN, token, 'Enter keeps the saved link and token');
    const off = run(['drive-backup'], answers('-'));
    assert.equal(off.status, 0, off.stderr + off.stdout); assert.equal(env(read('.env.docker')).BACKUP_DRIVE_URL, '');
    const doctor = run(['doctor'], '');
    assert.match(doctor.stdout, /stay on this PC only/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
