import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

// Nightly database backup: a consistent copy next to the database (newest 14 kept, same files as "site.sh backup"),
// then the same copy gzipped to Google Drive through the DriveBackup Apps Script (public/apps-script/DriveBackup.gs).
// The web app URL and its token live only in .env.docker. Sign-in sessions are removed from every copy.
export const driveLimit = 30 * 1024 * 1024; // Apps Script accepts about 50 MB per request; base64 adds a third.
const myt = date => new Date(date.getTime() + 8 * 3600000).toISOString(); // Malaysia has no daylight saving.
const stamp = date => myt(date).slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
export const validDriveUrl = url => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url);

export function createDriveBackup({ db, dbPath, url = process.env.BACKUP_DRIVE_URL || '', token = process.env.BACKUP_DRIVE_TOKEN || '', hour = 2, keepLocal = 14, keepDrive = 30, fetchImpl = fetch, now = () => new Date(), timeout = 180000 }) {
  db.exec('CREATE TABLE IF NOT EXISTS backup_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, actor TEXT NOT NULL, file TEXT, size INTEGER, drive TEXT, error TEXT)');
  const dir = join(dirname(resolve(dbPath)), 'backups');
  const drive = validDriveUrl(url) && token.length >= 24 ? url : '';
  const setupError = url && !drive ? 'BACKUP_DRIVE_URL must be an Apps Script /exec link and BACKUP_DRIVE_TOKEN at least 24 characters.' : '';
  let running = null;

  function localCopy(date) {
    mkdirSync(dir, { recursive: true });
    const file = `checksheet-${stamp(date)}.sqlite`, path = join(dir, file);
    rmSync(path, { force: true });
    db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    const copy = new DatabaseSync(path);
    try { copy.exec('DELETE FROM sessions'); copy.exec('VACUUM'); } finally { copy.close(); }
    for (const old of readdirSync(dir).filter(name => /^checksheet-\d{8}-\d{6}\.sqlite$/.test(name)).sort().slice(0, -keepLocal)) rmSync(join(dir, old), { force: true });
    return { file, path };
  }
  async function upload(file, path) {
    const data = gzipSync(readFileSync(path), { level: 9 });
    if (data.length > driveLimit) throw new Error(`The backup is ${Math.round(data.length / 1048576)} MB after compression; Google Apps Script accepts up to ${driveLimit / 1048576} MB. Copy it from the AI PC instead.`);
    const response = await fetchImpl(drive, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name: `${file}.gz`, data: data.toString('base64'), keep: keepDrive }), redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    const text = await response.text();
    let reply; try { reply = JSON.parse(text); } catch { throw new Error(response.ok ? 'Google answered with a page instead of the backup result. Check that the web app is deployed with access "Anyone".' : `Google answered ${response.status}.`); }
    if (!reply.ok) throw new Error(`Google Drive: ${reply.error || 'upload refused.'}`);
    return `${reply.folder || 'Drive'}/${reply.name || `${file}.gz`}`;
  }
  // One backup at a time; a second request waits for the one already running.
  function run(actor = 'Nightly') {
    if (running) return running;
    const started = now(), id = Number(db.prepare('INSERT INTO backup_runs(started_at, actor) VALUES(?, ?)').run(started.toISOString(), actor).lastInsertRowid);
    running = (async () => {
      await null; // let "running" be set before the work (and its finally) runs
      let copy, saved = null;
      try {
        copy = localCopy(started);
        if (drive) saved = await upload(copy.file, copy.path);
        db.prepare('UPDATE backup_runs SET finished_at=?, file=?, size=?, drive=? WHERE id=?').run(now().toISOString(), copy.file, statSync(copy.path).size, saved, id);
      } catch (error) {
        db.prepare('UPDATE backup_runs SET finished_at=?, file=?, size=?, error=? WHERE id=?').run(now().toISOString(), copy?.file || null, copy ? statSync(copy.path).size : null, String(error.message || error).slice(0, 500), id);
      } finally {
        db.prepare('DELETE FROM backup_runs WHERE id NOT IN (SELECT id FROM backup_runs ORDER BY id DESC LIMIT 60)').run();
        running = null;
      }
      return status();
    })();
    return running;
  }
  const done = row => row && { at: row.finished_at || row.started_at, actor: row.actor, file: row.file, size: row.size, drive: row.drive, error: row.error };
  const complete = date => db.prepare(`SELECT * FROM backup_runs WHERE error IS NULL AND finished_at IS NOT NULL ${drive ? 'AND drive IS NOT NULL' : ''} AND started_at >= ? ORDER BY id DESC LIMIT 1`).get(date);
  // Called every minute: after the nightly hour (Malaysia time), back up once a day; a failed try is repeated hourly.
  function tick() {
    const at = now(), local = myt(at);
    if (running || Number(local.slice(11, 13)) < hour) return null;
    const midnight = new Date(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - 8 * 3600000).toISOString();
    if (complete(midnight)) return null;
    const last = db.prepare('SELECT started_at FROM backup_runs WHERE actor = ? ORDER BY id DESC LIMIT 1').get('Nightly');
    if (last && at - new Date(last.started_at) < 3600000) return null;
    return run('Nightly');
  }
  function status() {
    const rows = db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 10').all();
    return { drive: !!drive, setupError, hour, keepLocal, keepDrive, running: !!running, lastOk: done(complete('')), lastDrive: done(db.prepare('SELECT * FROM backup_runs WHERE drive IS NOT NULL ORDER BY id DESC LIMIT 1').get()), runs: rows.map(done) };
  }
  return { run, tick, status, dir };
}
