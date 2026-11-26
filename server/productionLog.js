// Production log: the time each piece came out, per counter, so a supervisor can see when a line gave no output.
// The server notes the moment a live counter goes up (about 1 s accuracy). Time when no telemetry arrived is kept
// as "no data" (coverage holes) and never reported as a gap: a server or network outage must not look like a stopped line.
export const logRoles = ['management', 'executive', 'developer'];
export const counters = { output: 'Output', forming: 'Forming', waterjet: 'Waterjet' };
// A gap is no piece for 3 x the standard cycle time (minutes per piece), or 5 minutes when there is no cycle time.
export const gapRule = { cycleMultiple: 3, fallbackSeconds: 300 };
const holeMs = 15000, flushMs = 10000, keepMs = 365 * 86400000;
const gapSeconds = cycle => Number(cycle) > 0 ? Math.round(cycle * 60 * gapRule.cycleMultiple) : gapRule.fallbackSeconds;

// Gaps inside the covered time only. Each covered stretch is split by its pieces; a part longer than the threshold is a gap.
export function findGaps(ticks, coverage, { cycle = 0, until = Infinity } = {}) {
  const pieces = ticks.filter(t => t.qty > 0 && !t.catchup).sort((a, b) => a.at - b.at), gaps = [];
  for (const segment of coverage) {
    const end = Math.min(segment.to, until), inside = pieces.filter(t => t.at >= segment.from && t.at <= end);
    // A gap starts at a piece or where data starts, and ends at a piece, where data stops, or now (still running).
    let from = segment.from, fromCycle = inside[0]?.cycle ?? cycle, after = 'data start';
    for (const piece of [...inside, { at: end, end: true }]) {
      const limit = gapSeconds(fromCycle || cycle), seconds = Math.round((piece.at - from) / 1000);
      if (seconds > limit) gaps.push({ from, to: piece.at, seconds, limitSeconds: limit, after, until: !piece.end ? 'piece' : end < segment.to || until - segment.to < holeMs ? 'now' : 'no data' });
      from = piece.at; fromCycle = piece.cycle ?? fromCycle; after = 'piece';
    }
  }
  return gaps;
}

// Hourly view: one bucket per clock hour of the shift (a partial first or last hour is shorter). Bars count the timed pieces;
// pieces counted while no data was received have no hour and are reported apart. Plan, downtime and rejects come from the
// shift's checksheet records and are matched by the Pi's hour slot ("8.00-9.00"), the same slot the checksheet and PRS use.
const hourMs = 3600000;
const localHour = t => new Date(t + 8 * hourMs).getUTCHours();
const slotHour = (slot, at) => { const h = Number.parseInt(String(slot ?? ''), 10); return Number.isInteger(h) && h >= 0 && h < 24 ? h : Number.isFinite(at) ? localHour(at) : null; };
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
export function hourBuckets(log, records = {}, at = Date.now()) {
  const series = Object.entries(log.counters), lastTick = Math.max(0, ...series.map(([, c]) => c.ticks.at(-1)?.at || 0));
  const start = Math.min(...[Date.parse(log.shift.startAt), log.coverage[0]?.from, ...series.map(([, c]) => c.ticks[0]?.at)].filter(Number.isFinite));
  const end = log.live ? at : Math.max(log.coverage.at(-1)?.to || 0, lastTick);
  const downtime = (records.downtime || []).map(d => ({ id: d.id, at: Date.parse(d.createdAt), hour: slotHour(d.slot, Date.parse(d.createdAt)), category: d.category || '', reason: d.reason || '', minutes: num(d.duration), action: d.action || '' }));
  const rejects = (records.rejects || []).map(r => ({ id: r.id, at: Date.parse(r.createdAt), hour: slotHour(r.slot, Date.parse(r.createdAt)), code: r.code || '', slab: num(r.slab), returnRoll: num(r.returnRoll), ng: num(r.ng), loft: num(r.loft) })).map(r => ({ ...r, total: r.slab + r.returnRoll + r.ng + r.loft }));
  const catchup = Object.fromEntries(series.map(([key, c]) => [key, c.ticks.filter(t => t.catchup).reduce((sum, t) => sum + t.qty, 0)]).filter(([, n]) => n));
  const hours = [];
  for (let h = Math.floor(start / hourMs) * hourMs; Number.isFinite(start) && h < end; h += hourMs) {
    const from = Math.max(h, start), to = Math.min(h + hourMs, end), hour = localHour(h), last = to >= end;
    const covered = log.coverage.reduce((sum, c) => sum + Math.max(0, Math.min(c.to, to) - Math.max(c.from, from)), 0);
    const counts = Object.fromEntries(series.map(([key, c]) => [key, c.ticks.filter(t => !t.catchup && t.at >= from && (t.at < to || last && t.at <= to)).reduce((sum, t) => sum + t.qty, 0)]));
    const pi = (records.hourly || []).filter(r => slotHour(r.slot) === hour);
    const inProgress = log.live && last;
    hours.push({ from, to, hour, counts, inProgress,
      // Finished hours use the Pi's plan for the slot (rest already taken off); the running hour shows the full-hour target.
      plan: pi.length ? pi.reduce((sum, r) => sum + num(r.plan), 0) : null, piActual: pi.length ? pi.reduce((sum, r) => sum + num(r.actual), 0) : null,
      target: inProgress && Number(log.shift.plan) > 0 ? Number(log.shift.plan) : null,
      noData: covered < 15000 && to - from > 60000, partData: covered >= 15000 && to - from - covered > 60000,
      downtimeMinutes: downtime.filter(d => d.hour === hour).reduce((sum, d) => sum + d.minutes, 0), rejectCount: rejects.filter(r => r.hour === hour).reduce((sum, r) => sum + r.total, 0) });
  }
  return { hours, downtime, rejects, catchup };
}

export function createProductionLog({ db, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS production_ticks (line TEXT NOT NULL, shift_id TEXT NOT NULL, counter TEXT NOT NULL, at INTEGER NOT NULL, qty INTEGER NOT NULL, total INTEGER NOT NULL, cycle REAL, catchup INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS production_ticks_shift ON production_ticks(line, shift_id, at);
    CREATE INDEX IF NOT EXISTS production_ticks_at ON production_ticks(at);
    CREATE TABLE IF NOT EXISTS production_coverage (id INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT NOT NULL, shift_id TEXT NOT NULL, from_at INTEGER NOT NULL, to_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS production_coverage_shift ON production_coverage(line, shift_id);
    CREATE TABLE IF NOT EXISTS production_shifts (line TEXT NOT NULL, shift_id TEXT NOT NULL, date TEXT, shift TEXT, start_at TEXT, end_at TEXT, cycle REAL, model TEXT, last_at INTEGER NOT NULL, PRIMARY KEY(line, shift_id));
    CREATE INDEX IF NOT EXISTS production_shifts_date ON production_shifts(line, date);`);
  // Hourly target (pcs/h) of the running model, for the hour still in progress.
  if (!db.prepare('PRAGMA table_info(production_shifts)').all().some(c => c.name === 'plan')) db.exec('ALTER TABLE production_shifts ADD COLUMN plan REAL');
  const memory = new Map();
  const insertTick = db.prepare('INSERT INTO production_ticks VALUES(?,?,?,?,?,?,?,?)');
  function flush(m, line) { if (m.seg && m.seg.savedTo !== m.seg.to) { db.prepare('UPDATE production_coverage SET to_at=? WHERE id=?').run(m.seg.to, m.seg.id); m.seg.savedTo = m.seg.to; } }
  function load(line, shiftId) {
    const totals = {};
    for (const row of db.prepare('SELECT counter, total FROM production_ticks WHERE line=? AND shift_id=? ORDER BY at, rowid').all(line, shiftId)) totals[row.counter] = row.total;
    return { shiftId, totals, seg: null, meta: '' };
  }
  // values: { output, forming, waterjet } running totals for the shift; meta: { date, shift, startAt, endAt, cycle, model, plan }.
  function observe(line, shiftId, values, meta = {}) {
    if (!shiftId || shiftId === 'NO PROD') return;
    const at = now();
    let m = memory.get(line);
    if (!m || m.shiftId !== shiftId) { if (m) flush(m, line); m = load(line, shiftId); memory.set(line, m); }
    let resumed = false;
    if (m.seg && at - m.seg.to <= holeMs) { m.seg.to = at; if (at - m.seg.savedAt >= flushMs) { m.seg.savedAt = at; flush(m, line); } }
    else { flush(m, line); const id = db.prepare('INSERT INTO production_coverage(line,shift_id,from_at,to_at) VALUES(?,?,?,?)').run(line, shiftId, at, at).lastInsertRowid; m.seg = { id, from: at, to: at, savedTo: at, savedAt: at }; resumed = true; }
    const cycle = Number(meta.cycle) > 0 ? Number(meta.cycle) : null;
    for (const key of Object.keys(counters)) {
      const value = Number(values[key]);
      if (values[key] == null || !Number.isFinite(value)) continue;
      const prev = m.totals[key];
      // Pieces counted while nothing was received (first sight of a shift, or after a hole) have no real time: mark them catch-up.
      if (prev === undefined) { if (value > 0) insertTick.run(line, shiftId, key, at, value, value, cycle, 1); }
      else if (value !== prev) insertTick.run(line, shiftId, key, at, value - prev, value, cycle, resumed && value > prev ? 1 : 0);
      m.totals[key] = value;
    }
    const plan = Number(meta.plan) > 0 ? Number(meta.plan) : null, metaKey = JSON.stringify([meta.date, meta.shift, meta.startAt, meta.endAt, cycle, meta.model, plan]);
    if (metaKey !== m.meta || at - (m.metaAt || 0) > 60000) {
      m.meta = metaKey; m.metaAt = at;
      db.prepare('INSERT INTO production_shifts(line,shift_id,date,shift,start_at,end_at,cycle,model,last_at,plan) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(line,shift_id) DO UPDATE SET date=COALESCE(excluded.date,date), shift=COALESCE(excluded.shift,shift), start_at=COALESCE(excluded.start_at,start_at), end_at=COALESCE(excluded.end_at,end_at), cycle=COALESCE(excluded.cycle,cycle), model=COALESCE(excluded.model,model), plan=COALESCE(excluded.plan,plan), last_at=excluded.last_at')
        .run(line, shiftId, meta.date || null, meta.shift || null, meta.startAt || null, meta.endAt || null, cycle, meta.model || null, at, plan);
    }
  }
  function shifts(line, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Choose a valid date.');
    return db.prepare('SELECT shift_id AS id, shift, start_at AS startAt, end_at AS endAt, model FROM production_shifts WHERE line=? AND date=? ORDER BY COALESCE(start_at, last_at)').all(line, date).map(row => ({ ...row }));
  }
  // records: the shift's checksheet records { hourly, downtime, rejects } for the hourly view (optional).
  function shiftLog(line, shiftId, records) {
    if (memory.has(line)) flush(memory.get(line), line);
    const info = db.prepare('SELECT shift_id AS id, date, shift, start_at AS startAt, end_at AS endAt, cycle, model, plan, last_at AS lastAt FROM production_shifts WHERE line=? AND shift_id=?').get(line, shiftId);
    if (!info) return null;
    const ticks = db.prepare('SELECT counter, at, qty, total, cycle, catchup FROM production_ticks WHERE line=? AND shift_id=? ORDER BY at, rowid').all(line, shiftId).map(row => ({ ...row, catchup: !!row.catchup }));
    const coverage = db.prepare('SELECT from_at AS "from", to_at AS "to" FROM production_coverage WHERE line=? AND shift_id=? ORDER BY from_at').all(line, shiftId).map(row => ({ ...row }));
    const live = memory.get(line)?.shiftId === shiftId && now() - (memory.get(line).seg?.to || 0) <= holeMs;
    const result = { line, shift: { ...info }, live, coverage, counters: {}, gaps: [], gapRule };
    for (const key of Object.keys(counters)) {
      const own = ticks.filter(t => t.counter === key);
      if (!own.some(t => t.qty > 0)) continue;
      result.counters[key] = { label: counters[key], ticks: own.map(({ counter, ...t }) => t), total: own.at(-1).total };
      result.gaps.push(...findGaps(own, coverage, { cycle: info.cycle, until: live ? now() : Infinity }).map(gap => ({ ...gap, counter: key })));
    }
    result.gaps.sort((a, b) => a.from - b.from || a.counter.localeCompare(b.counter));
    if (records) Object.assign(result, hourBuckets(result, records, now()));
    return result;
  }
  // 2026-11-25 08:01:00 (Malaysia time) sorts correctly as text and opens as a date in Excel.
  const clock = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  function csv(log) {
    const rows = [['Time', 'Counter', 'Pieces', 'Running total', 'Note']];
    for (const [key, c] of Object.entries(log.counters)) for (const t of c.ticks) rows.push([clock(t.at), counters[key], t.qty, t.total, t.catchup ? 'Counted while no data was received' : t.qty < 0 ? 'Count corrected' : '']);
    rows.splice(1, rows.length, ...rows.slice(1).sort((a, b) => a[0].localeCompare(b[0])));
    return rows.map(row => row.map(cell => /[",\n]/.test(String(cell)) ? `"${String(cell).replaceAll('"', '""')}"` : cell).join(',')).join('\r\n') + '\r\n';
  }
  function purge() {
    const before = now() - keepMs;
    db.prepare('DELETE FROM production_ticks WHERE at<?').run(before);
    db.prepare('DELETE FROM production_coverage WHERE to_at<?').run(before);
    db.prepare('DELETE FROM production_shifts WHERE last_at<?').run(before);
  }
  const deny = (req, res) => { if (logRoles.includes(req.user?.role)) return false; res.status(403).json({ error: 'The production log is for executives and managers.' }); return true; };
  return {
    observe, shifts, shiftLog, csv, purge,
    // manual(line): true when the line has no sensor (manual workspace). records(line, shiftId): that shift's checksheet records.
    routes(manual, records = () => ({})) {
      return {
        shifts(req, res) { if (deny(req, res)) return; try { res.json({ line: req.line, manual: manual(req.line), shifts: shifts(req.line, String(req.query.date || '')) }); } catch (error) { res.status(400).json({ error: error.message }); } },
        log(req, res) { if (deny(req, res)) return; const shiftId = String(req.query.shift || ''), log = shiftLog(req.line, shiftId, records(req.line, shiftId)); if (!log) return res.status(404).json({ error: 'No production log for this shift.' }); res.json(log); },
        csv(req, res) {
          if (deny(req, res)) return; const log = shiftLog(req.line, String(req.query.shift || '')); if (!log) return res.status(404).json({ error: 'No production log for this shift.' });
          res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="production-log-${log.shift.id.replace(/[^\w.-]/g, '_')}.csv"`); res.send('﻿' + csv(log));
        }
      };
    }
  };
}
