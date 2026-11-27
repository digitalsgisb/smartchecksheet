import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { buildPrsWorkbook, prsCells, setCell, sheetForLine } from '../server/prsWorkbook.js';
import { createPrsPdf } from '../server/prsPdf.js';

const id = '20261123-Day-SDY2';
export const sample = {
  line: 'SDY2',
  shift: { id, date: '2026-11-23', shift: 'Day', workingTime: '8:00 AM - 8:00 PM', supervisor: 'ABU HASSAN', leader: 'ZIAUL HAQUE', forming: ['FAINUR', 'AUNG'], waterjet: ['MAHATO'], assembly: ['KHAN'], quality: 'LIM' },
  hourly: [
    { id: 'h1', shiftId: id, slot: '8.00-9.00', model: 'D46H', lot: 'L1', plan: 30, actual: 28, restMinutes: 0 },
    { id: 'h2', shiftId: id, slot: '9.00-10.00', model: 'D46H', lot: 'L1', plan: 40, actual: 41, restMinutes: 0 },
    { id: 'h3', shiftId: id, slot: '13.00-14.00', model: 'J72A', lot: 'L2', plan: 15, actual: 12, restMinutes: 60 },
    { id: 'old', shiftId: 'other', slot: '8.00-9.00', model: 'X', lot: 'X', plan: 99, actual: 99 }
  ],
  downtime: [
    { id: 'd1', shiftId: id, slot: '8.00-9.00', category: 'Planned Stop', reason: 'Morning meeting', duration: 30 },
    { id: 'd2', shiftId: id, slot: '9.00-10.00', category: 'Machine', code: 'X1', reason: 'X1 - Mechanical', duration: 12, action: 'Changed belt' },
    { id: 'd3', shiftId: id, slot: '9.00-10.00', category: 'Quality', code: 'Z2', reason: 'Z2 - Quality problem', duration: 5 }
  ],
  rejects: [{ id: 'r1', shiftId: id, slot: '9.00-10.00', ng: 2, loft: 0, slab: 0, returnRoll: 0, code: 'D21' }, { id: 'r2', shiftId: id, slot: '9.00-10.00', slab: 1.5, returnRoll: 0, ng: 0, loft: 0, code: 'D3' }],
  parameters: [{ id: 'p1', shiftId: id, model: 'D46H', heating: 45, cooling: 30, shuttle: 'S1', waterjet: 'WJ-7', rh: 180, ctr: 175, lh: 182, glueStd: 25, glueActual: 24, actor: 'ABU HASSAN' }],
  verification: [{ id: 'v1', shiftId: id, hour: '8.00-9.00', actor: 'ABU HASSAN', createdAt: '2026-11-23T01:05:00Z' }]
};

test('each line prints on its own template sheet; unknown lines use the master sheet', () => {
  assert.deepEqual(['SDY1', 'SDY2', 'ABB2', 'ABB3', 'ABB7', 'ROLL MAKING'].map(sheetForLine), ['FC L1', 'FC L2', 'FC 3&4', 'FC 3&4', 'MF 1&2', 'REV1 11022025']);
});

test('shift header, hour lines, downtime, rejects and tables land in the PRS cells', () => {
  const c = prsCells(sample);
  assert.equal(c.A3, 'PROD LINE : SDY2'); assert.equal(c.T3, 'FORMING OPT : FAINUR, AUNG'); assert.equal(c.AA4, 'QUALITY INSPECTOR : LIM');
  assert.deepEqual([c.A10, c.D10, c.D11, c.B10, c.G10], [1, '8.00 - 9.00', '', 'D46H', 'L1']);
  // Diagonal boxes: this hour top-left, running shift total bottom-right.
  assert.deepEqual([c.E10, c.F10].map(v => v.split('\n').map(s => s.trim())), [['30', '', '', '30'], ['28', '', '', '28']]);
  assert.deepEqual([c.E14, c.F14].map(v => v.split('\n').map(s => s.trim())), [['15', '', '', '85'], ['12', '', '', '81']]);
  assert.deepEqual([c.AA10, c.AB10], ['PS', 30]);
  assert.deepEqual([c.AE12, c.AF12, c.AA13], ['X1', 12, "Quality Z2 5' · X1: Changed belt"]);
  assert.deepEqual([c.R12, c.S12, c.N12, c.O12], [2, 'D21', 1.5, 'D3']);
  assert.deepEqual([c.D14, c.D15], ['1.00 - 2.00', "Break 60'"]); assert.equal(c.E16, '');
  assert.equal(c.AI10, 'ABU HASSAN\n09:05');
  assert.deepEqual([c.V41, c.W41, c.Z41, c.W55, c.AE41, c.AF41], ['D46H', 45, 'WJ-7', 180, 25, 24]);
  assert.deepEqual([c.AE53, c.AE55, c.AF53, c.AF55], ['D46H', 69, 'J72A', 12]);
});

test('cells are written in place with the template style, or inserted in column order', () => {
  const xml = '<sheetData><row r="3"><c r="A3" s="7" t="s"><v>4</v></c><c r="F3" s="2"/></row><row r="9"><c r="B9" s="1"/></row></sheetData>';
  let out = setCell(xml, 'A3', 'PROD LINE : <SDY2> & co');
  assert.match(out, /<c r="A3" s="7" t="inlineStr"><is><t xml:space="preserve">PROD LINE : &lt;SDY2&gt; &amp; co<\/t><\/is><\/c><c r="F3" s="2"\/>/);
  out = setCell(out, 'C3', 5); assert.match(out, /<c r="A3"[^]*<c r="C3"><v>5<\/v><\/c><c r="F3"/);
  out = setCell(out, 'A5', 'x'); assert.match(out, /<\/row><row r="5"><c r="A5" t="inlineStr">[^]*<row r="9">/);
  assert.equal(setCell(out, 'Z99', ''), out);
});

test('the workbook keeps the template parts and shows only the line sheet', () => {
  const files = unzipSync(buildPrsWorkbook(sample, 'SDY2'));
  const workbook = strFromU8(files['xl/workbook.xml']);
  assert.match(workbook, /<sheet name="FC L2"(?![^>]*hidden)/);
  assert.equal((workbook.match(/state="hidden"/g) || []).length, 5);
  assert.ok(Object.keys(files).some(name => name.startsWith('xl/media/')), 'logo kept');
  const sheets = Object.keys(files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(name => strFromU8(files[name]));
  const filled = sheets.filter(xml => xml.includes('PROD LINE : SDY2'));
  assert.equal(filled.length, 1); assert.match(filled[0], /tabSelected="1"/); assert.match(filled[0], /<mergeCell ref="A1:AJ1"\/>/);
});

test('the PDF workbook has only the line sheet and does not print comments', () => {
  const files = unzipSync(buildPrsWorkbook(sample, 'SDY1', undefined, { pdf: true }));
  const workbook = strFromU8(files['xl/workbook.xml']), rels = strFromU8(files['xl/_rels/workbook.xml.rels']);
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  assert.deepEqual(sheets.map(s => s[1]), ['FC L1']);
  assert.match(workbook, /<definedName name="_xlnm.Print_Area" localSheetId="0">'FC L1'!\$A\$1:\$AJ\$64<\/definedName>/);
  assert.equal((workbook.match(/<definedName\b/g) || []).length, 1);
  assert.match(workbook, /activeTab="0"/);
  assert.equal((rels.match(/worksheets\//g) || []).length, 1);
  const target = rels.match(new RegExp(`Id="${sheets[0][2]}"[^>]*Target="([^"]+)"`))?.[1] || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${sheets[0][2]}"`))[1];
  const sheet = strFromU8(files[target.startsWith('/') ? target.slice(1) : `xl/${target}`]);
  assert.match(sheet, /PROD LINE : SDY1/); assert.doesNotMatch(sheet.match(/<pageSetup\b[^>]*>/)[0], /cellComments/);
  assert.match(strFromU8(unzipSync(buildPrsWorkbook(sample, 'SDY1'))['xl/workbook.xml']), /<sheet state="hidden" name="FC L2"/, 'Excel download keeps every sheet');
});

test('PDF conversion runs LibreOffice once per workbook and reports when it is missing', async () => {
  const calls = [];
  const run = (cmd, args, opts, done) => { calls.push(args); if (args[0] === '--version') return done(null, 'LibreOffice 7'); const dir = args[args.indexOf('--outdir') + 1]; import('node:fs').then(fs => { fs.writeFileSync(`${dir}/prs.pdf`, '%PDF-1.7'); done(null, ''); }); };
  const pdf = createPrsPdf({ run });
  assert.equal(await pdf.ready(), true);
  const bytes = Buffer.from('xlsx');
  assert.equal(String(await pdf.convert(bytes)), '%PDF-1.7'); await pdf.convert(bytes);
  assert.equal(calls.filter(a => a.includes('--convert-to')).length, 1);
  const missing = createPrsPdf({ run: (cmd, args, opts, done) => done(new Error('ENOENT')) });
  assert.equal(await missing.ready(), false);
});

test('lines of one hour share NO, TIME and MODEL boxes, merged like the live checksheet', async () => {
  const { prsMerges, mergeRanges } = await import('../server/prsWorkbook.js');
  const split = { ...sample, hourly: [
    { shiftId: id, slot: '8.00-9.00', model: 'M1', lot: 'L1', plan: 6, actual: 7, restMinutes: 0 },
    { shiftId: id, slot: '8.00-9.00', model: 'M1', lot: 'L2', plan: 13, actual: 16, restMinutes: 10 },
    { shiftId: id, slot: '9.00-10.00', model: 'M1', lot: 'L2', plan: 20, actual: 20, restMinutes: 0 },
    { shiftId: id, slot: '10.00-11.00', model: 'M1', lot: 'L2', plan: 5, actual: 4, restMinutes: 0 },
    { shiftId: id, slot: '10.00-11.00', model: 'M2', lot: 'L3', plan: 5, actual: 5, restMinutes: 0 },
    { shiftId: id, slot: '10.00-11.00', model: 'M2', lot: 'L4', plan: 5, actual: 2, restMinutes: 0 }
  ], downtime: [], rejects: [], verification: [] };
  const c = prsCells(split);
  assert.deepEqual([c.A10, c.A12, c.A14, c.A16, c.A18, c.A20], [1, '', 2, 3, '', '']);
  assert.deepEqual([c.D10, c.D11, c.D12, c.D13, c.D14], ['8.00 - 9.00', '', '', "Break 10'", '9.00 - 10.00']);
  assert.deepEqual([c.B16, c.B18, c.B20, c.G18, c.G20], ['M1', 'M2', '', 'L3', 'L4']);
  assert.deepEqual([c.E12, c.F20].map(v => v.split('\n').map(s => s.trim())), [['13', '', '', '19'], ['2', '', '', '54']]);
  assert.deepEqual(prsMerges(split), ['A10:A13', 'D10:D12', 'B10:C13', 'A16:A21', 'D16:D20', 'B18:C21']);
  const xml = '<mergeCells count="5"><mergeCell ref="A10:A11"/><mergeCell ref="A12:A13"/><mergeCell ref="B10:C11"/><mergeCell ref="E10:E11"/><mergeCell ref="G12:G13"/></mergeCells>';
  assert.equal(mergeRanges(xml, ['A10:A13', 'B10:C13']), '<mergeCells count="4"><mergeCell ref="E10:E11"/><mergeCell ref="G12:G13"/><mergeCell ref="A10:A13"/><mergeCell ref="B10:C13"/></mergeCells>');
  const files = unzipSync(buildPrsWorkbook(split, 'SDY2', undefined, { pdf: true }));
  const sheet = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).map(n => strFromU8(files[n]))[0];
  assert.match(sheet, /<mergeCell ref="A16:A21"\/>/); assert.doesNotMatch(sheet, /<mergeCell ref="A18:A19"\/>/);
  assert.equal(Number(sheet.match(/<mergeCells count="(\d+)"/)[1]), (sheet.match(/<mergeCell ref=/g) || []).length);
});
