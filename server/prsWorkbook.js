import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { aggregateHourly } from './domain.js';
import { splitReason } from '../shared/downtimeCodes.js';

// Fills the company PRS form (templates/prs-template.xlsx, FR-PR-083) from a saved shift report. The template is edited
// cell by cell inside its own XML so borders, merges, logo and print setup stay exactly as the paper form.
const templatePath = new URL('./templates/prs-template.xlsx', import.meta.url);
let template;
// Every sheet has the same layout; each line prints on its own copy (they differ only in the Table 4 model list).
export const prsSheets = { SDY1: 'FC L1', SDY2: 'FC L2', ABB2: 'FC 3&4', ABB3: 'FC 3&4', ABB7: 'MF 1&2' };
export const sheetForLine = line => prsSheets[line] || 'REV1 11022025';

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colNumber = col => [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const parseRef = ref => { const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/); return { col, row: Number(row), n: colNumber(col) }; };

// Writes one cell, keeping the template's style (s=) so fonts and borders stay; empty value clears the cell.
export function setCell(xml, ref, value, restyle) {
  const { row, n } = parseRef(ref);
  const cellPattern = new RegExp(`<c r="${ref}"(?=[ />])([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const existing = xml.match(cellPattern);
  const original = existing?.[1].match(/\ss="(\d+)"/)?.[1], style = restyle ? restyle(original) : original;
  const attrs = `r="${ref}"${style ? ` s="${style}"` : ''}`;
  const empty = value === undefined || value === null || value === '';
  const cell = empty ? `<c ${attrs}/>` : typeof value === 'number' && Number.isFinite(value) ? `<c ${attrs}><v>${value}</v></c>` : `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  if (existing) return xml.replace(cellPattern, cell);
  if (empty) return xml;
  const rowPattern = new RegExp(`<row r="${row}"(?=[ >])([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const found = xml.match(rowPattern);
  if (found) {
    const body = found[3] || '', cells = [...body.matchAll(/<c r="([A-Z]+)\d+"/g)];
    const after = cells.find(c => colNumber(c[1]) > n);
    const nextBody = after ? body.slice(0, after.index) + cell + body.slice(after.index) : body + cell;
    return xml.replace(rowPattern, `<row r="${row}"${found[1]}>${nextBody}</row>`);
  }
  const rows = [...xml.matchAll(/<row r="(\d+)"/g)], next = rows.find(r => Number(r[1]) > row);
  const newRow = `<row r="${row}">${cell}</row>`;
  if (next) return xml.slice(0, next.index) + newRow + xml.slice(next.index);
  return xml.replace('</sheetData>', `${newRow}</sheetData>`);
}

const list = value => Array.isArray(value) ? value.join(', ') : value || '';
const slotText = slot => String(slot || '').replace(/^(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})$/, (_, a, b, c, d) => `${Number(a) > 12 ? Number(a) - 12 : Number(a) || 12}.${b} - ${Number(c) > 12 ? Number(c) - 12 : Number(c) || 12}.${d}`);
const slotStart = slot => { const h = Number(String(slot).match(/^(\d{1,2})/)?.[1]); return Number.isFinite(h) ? h : 99; };
const shiftOrder = slot => (slotStart(slot) - 8 + 24) % 24;
const sum = (items, field) => items.reduce((n, item) => n + Number(item[field] || 0), 0);
const codes = items => [...new Set(items.map(item => item.code).filter(Boolean))].join(', ');
const dtCode = d => d.category === 'Planned Stop' ? 'PS' : d.code || splitReason(d).code || '';
const dtColumn = { Schedule: ['AA', 'AB'], 'Planned Stop': ['AA', 'AB'], Production: ['AC', 'AD'], Machine: ['AE', 'AF'] };
const minutes = value => Math.round(Number(value || 0) * 10) / 10;
// Plan and Actual boxes are split by a diagonal: this line's value top-left, the running shift total bottom-right.
const diagonal = (hour, total) => { const digits = String(total).length; return `${hour}\n\n\n${' '.repeat(Math.max(1, Math.floor((49 - 10 * digits) / 5)))}${total}`; };
const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });

// The cell values for one shift: header, the 12 two-row hour lines, and the condition, temperature and glue tables.
export function prsCells(snapshot, line = snapshot.line) {
  const shift = snapshot.shift || {}, id = shift.id;
  const mine = rows => (rows || []).filter(row => !id || !row.shiftId || row.shiftId === id);
  const hourly = aggregateHourly(mine(snapshot.hourly)), downtime = mine(snapshot.downtime), rejects = mine(snapshot.rejects), signs = mine(snapshot.verification).filter(v => v.hour);
  const cells = {
    A3: `PROD LINE : ${line || ''}`, F3: `SHIFT : ${shift.shift || ''}${shift.overtime ? ' (OT)' : ''}`, M3: `SPV : ${shift.supervisor || ''}`, T3: `FORMING OPT : ${list(shift.forming)}`, AA3: `ASSEMBLY OPT : ${list(shift.assembly)}`,
    A4: `DATE : ${shift.date || ''}`, F4: `WORKING TIME : ${shift.workingTime || ''}`, I4: '', L4: '', M4: `LEADER : ${shift.leader || ''}`, T4: `WATERJET OPT : ${list(shift.waterjet)}`, AA4: `QUALITY INSPECTOR : ${list(shift.quality)}`
  };
  // One line per hour and model segment, in shift order; hours with only downtime still get a line.
  const slots = [...new Set([...hourly.map(r => r.slot), ...downtime.map(d => d.slot), ...rejects.map(r => r.slot)].filter(Boolean))].sort((a, b) => shiftOrder(a) - shiftOrder(b));
  const lines = slots.flatMap(slot => { const segments = hourly.filter(r => r.slot === slot); return (segments.length ? segments : [{ slot }]).map((row, i, all) => ({ ...row, last: i === all.length - 1 })); });
  const overflow = lines.length > 12 ? lines.length - 12 : 0;
  let planTotal = 0, actualTotal = 0;
  for (let i = 0; i < 12; i++) {
    const r = 10 + i * 2, row = lines[i];
    const blank = ['A', 'B', 'D', 'E', 'F', 'G', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AI'];
    for (const col of blank) cells[`${col}${r}`] = '';
    cells[`AA${r + 1}`] = ''; cells[`D${r + 1}`] = '';
    if (!row) continue;
    const inSlot = items => row.last ? items.filter(item => item.slot === row.slot) : [];
    // The break goes in the lower half of the TIME box.
    if (Number(row.restMinutes) > 0) cells[`D${r + 1}`] = `Break ${minutes(row.restMinutes)}'`;
    Object.assign(cells, { [`A${r}`]: i + 1, [`D${r}`]: slotText(row.slot), [`B${r}`]: row.model || '', [`G${r}`]: row.lot || '' });
    if (row.model !== undefined) { const plan = Number(row.plan || 0), actual = Number(row.actual || 0); planTotal += plan; actualTotal += actual; Object.assign(cells, { [`E${r}`]: diagonal(plan, planTotal), [`F${r}`]: diagonal(actual, actualTotal) }); }
    const rj = inSlot(rejects), before = rj.filter(x => x.slab || x.returnRoll), ng = rj.filter(x => x.ng), loft = rj.filter(x => x.loft);
    if (before.length) Object.assign(cells, { [`N${r}`]: sum(before, 'slab') || '', [`O${r}`]: codes(before), [`P${r}`]: sum(before, 'returnRoll') || '' });
    if (ng.length) Object.assign(cells, { [`R${r}`]: sum(ng, 'ng'), [`S${r}`]: codes(ng) });
    if (loft.length) Object.assign(cells, { [`T${r}`]: sum(loft, 'loft'), [`U${r}`]: codes(loft) });
    const dt = inSlot(downtime), notes = [];
    for (const [category, [codeCol, minCol]] of Object.entries(dtColumn)) {
      if (category === 'Planned Stop') continue;
      const items = dt.filter(d => (d.category === 'Planned Stop' ? 'Schedule' : d.category) === category);
      if (items.length) Object.assign(cells, { [`${codeCol}${r}`]: [...new Set(items.map(dtCode).filter(Boolean))].join(', '), [`${minCol}${r}`]: minutes(sum(items, 'duration')) });
    }
    // The form has no Quality downtime column; it goes on the line's note row with any actions taken.
    for (const d of dt.filter(d => d.category === 'Quality')) notes.push(`Quality ${dtCode(d)} ${minutes(d.duration)}'`);
    for (const d of dt.filter(d => d.action)) notes.push(`${dtCode(d) || d.category}: ${d.action}`);
    if (row.last && overflow && i === 11) notes.push(`+${overflow} more line(s) in the system report`);
    cells[`AA${r + 1}`] = notes.join(' · ');
    const sign = row.last && signs.filter(v => v.hour === row.slot).at(-1);
    if (sign) cells[`AI${r}`] = `${sign.actor}\n${time(sign.createdAt)}`;
  }
  // Table 1 (parameter condition, 4 rows), Table 2 (temperature, 8 rows), Table 3 (glue, 2 rows), latest entries first kept in order.
  const params = mine(snapshot.parameters);
  params.slice(-4).forEach((p, i) => { const r = 41 + i * 2; Object.assign(cells, { [`V${r}`]: p.model || '', [`W${r}`]: num(p.heating), [`X${r}`]: num(p.cooling), [`Y${r}`]: p.shuttle || '', [`Z${r}`]: p.waterjet || '', [`AA${r}`]: p.actor || '' }); });
  params.slice(-8).forEach((p, i) => { const r = 55 + i; Object.assign(cells, { [`V${r}`]: p.model || '', [`W${r}`]: num(p.rh), [`X${r}`]: num(p.ctr), [`Y${r}`]: num(p.lh), [`Z${r}`]: p.actor || '' }); });
  params.filter(p => p.glueStd !== undefined || p.glueActual !== undefined).slice(-2).forEach((p, i) => { const r = 41 + i * 4; Object.assign(cells, { [`AD${r}`]: p.model || '', [`AE${r}`]: num(p.glueStd), [`AF${r}`]: num(p.glueActual) }); });
  // Summary: output per model, up to two models.
  const models = [...new Set(hourly.map(r => r.model).filter(Boolean))].slice(0, 2);
  models.forEach((model, i) => { const col = i ? 'AF' : 'AE'; Object.assign(cells, { [`${col}53`]: model, [`${col}55`]: hourly.filter(r => r.model === model).reduce((n, r) => n + Number(r.actual || 0), 0) }); });
  const verified = mine(snapshot.verification).filter(v => !v.hour && v.status === 'verified').at(-1);
  if (verified) cells.AE57 = `${verified.actor} ${time(verified.createdAt)}`;
  return cells;
}
function num(value) { const n = Number(value); return value === '' || value === undefined || value === null || !Number.isFinite(n) ? '' : n; }

// The form's blank boxes use a tiny handwriting font; written values get a copy of each box's style (same borders and
// fill) with the readable font of the TIME column, centred and wrapped. The header lines (rows 3-4) keep their style.
function readableStyles(styles, sheetXml) {
  const section = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const xfs = [...section[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0]);
  const timeStyle = Number(sheetXml.match(/<c r="D10"[^>]*?\ss="(\d+)"/)?.[1] ?? 0);
  const font = xfs[timeStyle]?.match(/fontId="(\d+)"/)?.[1] ?? '0';
  const added = [], made = new Map();
  // fit: one short line shrinks into a narrow box; wrap: multi-line or long text; corner: above the Plan/Actual diagonal.
  const alignments = { fit: '<alignment horizontal="center" vertical="center" shrinkToFit="1"/>', wrap: '<alignment horizontal="center" vertical="center" wrapText="1"/>', corner: '<alignment horizontal="left" vertical="top" indent="1" wrapText="1"/>' };
  const restyle = (index, mode = 'wrap') => {
    const key = `${index ?? 0}:${mode}`;
    if (!made.has(key)) {
      const base = (xfs[Number(index ?? 0)] || xfs[0]).replace(/<alignment\b[^>]*\/>/, '').replace(/\s(fontId|applyFont|applyAlignment)="[^"]*"/g, '');
      const open = base.match(/^<xf\b[^>]*?(\/?)>/), selfClosing = open[1] === '/';
      const attrs = open[0].replace(/\/?>$/, '') + ` fontId="${font}" applyFont="1" applyAlignment="1"`;
      const inner = selfClosing ? '' : base.slice(open[0].length, -'</xf>'.length);
      added.push(`${attrs}>${alignments[mode]}${inner}</xf>`);
      made.set(key, String(xfs.length + added.length - 1));
    }
    return made.get(key);
  };
  const finish = () => added.length ? styles.replace(section[0], section[0].replace(/count="\d+"/, `count="${xfs.length + added.length}"`).replace('</cellXfs>', `${added.join('')}</cellXfs>`)) : styles;
  return { restyle, finish };
}

// Returns the filled workbook (xlsx bytes). Only the line's sheet stays visible in Excel. LibreOffice prints hidden
// sheets and the template's cell comments (each on a page of its own), so with pdf the other sheets are removed and
// comments are not printed: the PDF is the one form page.
export function buildPrsWorkbook(snapshot, line = snapshot.line, templateBytes, { pdf = false } = {}) {
  const files = unzipSync(templateBytes || (template ||= readFileSync(templatePath)));
  let workbook = strFromU8(files['xl/workbook.xml']);
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels']);
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*?\/>/g)].map(m => ({ tag: m[0], name: m[1].replace(/&amp;/g, '&'), rid: m[2] }));
  const wanted = sheetForLine(line), index = Math.max(0, sheets.findIndex(s => s.name === wanted)), target = sheets[index];
  const relTarget = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${target.rid}"[^>]*>`))[0].match(/Target="([^"]+)"/)[1];
  const path = relTarget.startsWith('/') ? relTarget.slice(1) : `xl/${relTarget}`;
  for (const sheet of sheets) workbook = workbook.replace(sheet.tag, sheet.tag.replace(/\sstate="[^"]*"/, '').replace('<sheet ', sheet === target ? '<sheet ' : '<sheet state="hidden" '));
  workbook = workbook.replace(/activeTab="\d+"/, `activeTab="${index}"`).replace(/firstSheet="\d+"/, `firstSheet="${index}"`);
  if (!/activeTab=/.test(workbook)) workbook = workbook.replace('<workbookView ', `<workbookView activeTab="${index}" `);
  if (pdf) {
    for (const sheet of sheets) if (sheet !== target) workbook = workbook.replace(sheet.tag.replace(/\sstate="[^"]*"/, '').replace('<sheet ', '<sheet state="hidden" '), '');
    workbook = workbook.replace(/<definedName\b[^>]*?localSheetId="(\d+)"[^>]*>[\s\S]*?<\/definedName>/g, (name, id) => Number(id) === index ? name.replace(/localSheetId="\d+"/, 'localSheetId="0"') : '').replace(/<definedNames>\s*<\/definedNames>/, '');
    workbook = workbook.replace(/activeTab="\d+"/, 'activeTab="0"').replace(/firstSheet="\d+"/, 'firstSheet="0"');
    files['xl/_rels/workbook.xml.rels'] = strToU8(sheets.filter(s => s !== target).reduce((xml, s) => xml.replace(new RegExp(`<Relationship\\b[^>]*Id="${s.rid}"[^>]*/>`), ''), rels));
  }
  files['xl/workbook.xml'] = strToU8(workbook);
  for (const sheet of sheets) {
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${sheet.rid}"[^>]*>`))[0].match(/Target="([^"]+)"/)[1];
    const p = rel.startsWith('/') ? rel.slice(1) : `xl/${rel}`;
    let xml = strFromU8(files[p]).replace(/\stabSelected="1"/g, '');
    if (p === path) {
      xml = xml.replace('<sheetView ', '<sheetView tabSelected="1" ');
      if (pdf) xml = xml.replace(/(<pageSetup\b[^>]*?)\scellComments="[^"]*"/, '$1');
      const styles = readableStyles(strFromU8(files['xl/styles.xml']), xml);
      for (const [ref, value] of Object.entries(prsCells(snapshot, line))) {
        const { col, row } = parseRef(ref), mode = row <= 33 && ['E', 'F'].includes(col) ? 'corner' : String(value).includes('\n') || String(value).length > 24 ? 'wrap' : 'fit';
        xml = setCell(xml, ref, value, row > 4 && value !== '' ? index => styles.restyle(index, mode) : undefined);
      }
      files['xl/styles.xml'] = strToU8(styles.finish());
    }
    files[p] = strToU8(xml);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}
export const prsFileName = (snapshot, ext) => `PRS_${String(snapshot.shift?.id || snapshot.line || 'shift').replace(/[^A-Za-z0-9_-]/g, '_')}.${ext}`;
