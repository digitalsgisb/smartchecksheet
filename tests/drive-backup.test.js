import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createDriveBackup, validDriveUrl } from '../server/driveBackup.js';

const url = 'https://script.google.com/macros/s/AKfy_test-123/exec', token = 'x'.repeat(32);
function setup(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'checksheet-backup-')), dbPath = join(dir, 'production.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE sessions (token TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('secret-session'); CREATE TABLE reports (id TEXT); INSERT INTO reports VALUES ('r1');");
  const sent = [];
  const fetchImpl = async (to, init) => { sent.push({ to, body: JSON.parse(init.body) }); return new Response(JSON.stringify(options.reply || { ok: true, folder: 'Smart Checksheet backups', name: JSON.parse(init.body).name }), { status: 200 }); };
  let clock = options.clock || new Date('2026-11-23T18:30:00Z'); // 02:30 on 24 Nov in Malaysia
  const backups = createDriveBackup({ db, dbPath, url: options.url ?? url, token: options.token ?? token, fetchImpl, now: () => clock });
  return { dir, db, backups, sent, setClock: value => { clock = value; }, done: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('only an Apps Script /exec link is accepted', () => {
  assert.equal(validDriveUrl(url), true);
  for (const bad of ['http://script.google.com/macros/s/a/exec', 'https://evil.example/macros/s/a/exec', 'https://script.google.com/macros/s/a/dev']) assert.equal(validDriveUrl(bad), false);
  const s = setup({ url: 'https://example.com/upload' });
  try { assert.match(s.backups.status().setupError, /Apps Script/); assert.equal(s.backups.status().drive, false); } finally { s.done(); }
});

test('a backup keeps a local copy without sign-in sessions and sends the gzipped copy to Drive', async () => {
  const s = setup();
  try {
    const status = await s.backups.run('Manager');
    assert.equal(status.runs[0].error, null);
    assert.equal(status.lastDrive.drive, 'Smart Checksheet backups/checksheet-20261124-023000.sqlite.gz');
    assert.deepEqual(readdirSync(s.backups.dir), ['checksheet-20261124-023000.sqlite']);
    assert.equal(s.sent.length, 1); assert.equal(s.sent[0].to, url); assert.equal(s.sent[0].body.token, token); assert.equal(s.sent[0].body.keep, 30);
    const restored = join(s.dir, 'restored.sqlite'); writeFileSync(restored, gunzipSync(Buffer.from(s.sent[0].body.data, 'base64')));
    const copy = new DatabaseSync(restored);
    assert.equal(copy.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
    assert.equal(copy.prepare('SELECT id FROM reports').get().id, 'r1');
    copy.close();
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1, 'the live database keeps its sessions');
    assert.equal(JSON.stringify(status).includes(token), false, 'the token is never returned');
  } finally { s.done(); }
});

test('a refused upload is recorded with the reason and the local copy is kept', async () => {
  const s = setup({ reply: { ok: false, error: 'The token does not match BACKUP_TOKEN.' } });
  try {
    const status = await s.backups.run('Manager');
    assert.match(status.runs[0].error, /token does not match/);
    assert.equal(status.lastDrive, undefined); assert.equal(readdirSync(s.backups.dir).length, 1);
  } finally { s.done(); }
});

test('the nightly run happens once after 02:00 Malaysia time and retries a failure after an hour', async () => {
  const s = setup({ clock: new Date('2026-11-23T17:30:00Z'), reply: { ok: false, error: 'busy' } }); // 01:30 MYT
  try {
    assert.equal(s.backups.tick(), null, 'not before 02:00');
    s.setClock(new Date('2026-11-23T18:05:00Z')); await s.backups.tick();
    assert.equal(s.sent.length, 1);
    s.setClock(new Date('2026-11-23T18:40:00Z')); assert.equal(s.backups.tick(), null, 'waits an hour after a failure');
    s.setClock(new Date('2026-11-23T19:06:00Z')); await s.backups.tick();
    assert.equal(s.sent.length, 2);
  } finally { s.done(); }
});

test('without Drive the nightly copy stays local and runs once per day', async () => {
  const s = setup({ url: '', token: '' });
  try {
    await s.backups.tick(); assert.equal(s.backups.tick(), null);
    assert.equal(s.sent.length, 0); assert.equal(s.backups.status().lastOk.file, 'checksheet-20261124-023000.sqlite');
    s.setClock(new Date('2026-11-24T18:30:00Z')); await s.backups.tick();
    assert.equal(readdirSync(s.backups.dir).length, 2);
  } finally { s.done(); }
});
