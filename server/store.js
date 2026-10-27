import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [salt, hash] = stored.split(':'); const supplied = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS state (line TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, lines TEXT NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, line TEXT NOT NULL, created_at TEXT NOT NULL, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
  `);
  // Preserve existing ABB2 commands while adding line-scoped live connections.
  if (!db.prepare('PRAGMA table_info(commands)').all().some(column => column.name === 'line')) db.exec("ALTER TABLE commands ADD COLUMN line TEXT NOT NULL DEFAULT 'ABB2'");
  db.exec('CREATE INDEX IF NOT EXISTS commands_line_created ON commands(line,created_at); CREATE TABLE IF NOT EXISTS machine_events (line TEXT NOT NULL, event_id TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(line,event_id));');
  return db;
}
export function publicUser(user) { return { id: user.id, username: user.username, name: user.name, role: user.role, lines: JSON.parse(user.lines), active: Boolean(user.active) }; }

export function syncDeveloperLines(db, lines) {
  const configured = JSON.stringify(lines);
  db.prepare("UPDATE users SET lines=? WHERE role='developer' AND lines<>?").run(configured, configured);
}
