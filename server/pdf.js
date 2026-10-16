import PDFDocument from 'pdfkit';
import { aggregateHourly, rejectTotals } from './domain.js';

export function renderReport(snapshot, response, reportId) {
  const pdf = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 32, info: { Title: `Production Digital - ${snapshot.shift?.id || 'ABB2'}`, Author: 'Production Digital' } });
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `inline; filename="PRS_${snapshot.shift?.id || 'ABB2'}_${reportId.slice(0, 8)}.pdf"`);
  pdf.pipe(response);
  const width = pdf.page.width - 64;
  function heading(text) { if (pdf.y > pdf.page.height - 100) pdf.addPage(); pdf.moveDown(0.6).font('Helvetica-Bold').fontSize(13).fillColor('#122540').text(text).moveDown(0.4); }
  function table(headers, rows, weights) {
    const widths = weights.map(w => width * w / weights.reduce((a, b) => a + b));
    function row(values, header = false) {
      pdf.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const height = Math.max(26, ...values.map((v, i) => pdf.heightOfString(String(v ?? '-'), { width: widths[i] - 12 }) + 12));
      if (pdf.y + height > pdf.page.height - 38) { pdf.addPage(); if (!header) row(headers, true); }
      const y = pdf.y; let x = 32;
      values.forEach((v, i) => {
        pdf.rect(x, y, widths[i], height).fillAndStroke(header ? '#e5e9ee' : '#ffffff', '#d7dce2');
        pdf.fillColor('#222e40').text(String(v ?? '-'), x + 6, y + 6, { width: widths[i] - 12 }); x += widths[i];
      });
      pdf.y = y + height; pdf.x = 32;
    }
    row(headers, true); for (const values of rows) row(values);
    if (!rows.length) row(headers.map((_, i) => i ? '-' : 'No records'));
  }
  pdf.fontSize(25).font('Helvetica-Bold').fillColor('#122540').text('Production Digital');
  pdf.fontSize(10).font('Helvetica').fillColor('#636c78').text(`PRODUCTION RECORD SHEET  |  ${snapshot.line}  |  ${snapshot.shift?.id || 'No shift'}  |  ${snapshot.mode === 'demo' ? 'DEMO DATA' : 'PRODUCTION'}`);
  pdf.moveDown().fontSize(11).fillColor('#222e40');
  const s = snapshot.shift || {};
  pdf.text(`Date: ${s.date || '-'}     Shift: ${s.shift || '-'}     Working time: ${s.workingTime || '-'}     Status: ${s.status || '-'}`);
  pdf.text(`Supervisor: ${s.supervisor || '-'}     Leader: ${s.leader || '-'}     Quality: ${s.quality || '-'}`);
  pdf.text(`Forming: ${(s.forming || []).join(', ')}     Waterjet: ${(s.waterjet || []).join(', ')}     Assembly: ${(s.assembly || []).join(', ')}`);
  pdf.text(`Snapshot: ${snapshot.updatedAt}     Report version: ${reportId}`);
  heading('Hourly production');
  const rows = aggregateHourly(snapshot.hourly || []);
  if (s.status === 'active' && snapshot.setup) rows.push({ slot: snapshot.live.slot, model: snapshot.setup.model, lot: snapshot.setup.lot, plan: snapshot.live.plan, actual: snapshot.live.actual, restMinutes: '-', live: true });
  table(['Hour / segment', 'Model', 'Lot number', 'Plan', 'Actual', 'Rest (min)', 'Record'], rows.map(r => [r.slot, r.model, r.lot, r.plan, r.actual, r.restMinutes, r.live ? 'Live snapshot' : 'Finalized']), [2, 3, 3, 1, 1, 1, 2]);
  heading('Rejects — before forming in metres; after forming in pieces');
  table(['Hour', 'Slab (m)', 'Return roll (m)', 'NG (pcs)', 'Loft (pcs)', 'Code / remarks', 'Recorded by'], (snapshot.rejects || []).map(r => [r.slot, r.slab, r.returnRoll, r.ng, r.loft, `${r.code || '-'} / ${r.remarks || '-'}`, r.actor]), [2, 1, 1, 1, 1, 4, 2]);
  heading('Downtime');
  table(['Hour', 'Category', 'Reason', 'Duration (min)', 'Action taken', 'Recorded by'], (snapshot.downtime || []).map(r => [r.slot, r.category, r.reason, r.duration, r.action, r.actor]), [2, 2, 4, 2, 4, 2]);
  heading('Parameter condition');
  table(['Model', 'Heating / cooling (s)', 'Shuttle / waterjet', 'RH / CTR / LH (C)', 'Glue STD / ACT (g)', 'Recorded by'], (snapshot.parameters || []).map(r => [r.model, `${r.heating} / ${r.cooling}`, `${r.shuttle} / ${r.waterjet}`, `${r.rh} / ${r.ctr} / ${r.lh}`, `${r.glueStd} / ${r.glueActual}`, r.actor]), [3, 2, 2, 2, 2, 2]);
  heading('Henkaten and verification');
  table(['Category', 'Issue', 'Action', 'Status', 'Reported by'], (snapshot.issues || []).map(r => [r.category, r.issue, r.action, r.status, r.actor]), [2, 4, 4, 2, 2]);
  table(['Verified by', 'Result', 'Remarks', 'Time'], (snapshot.verification || []).map(r => [r.actor, r.status, r.remarks, r.createdAt]), [2, 2, 5, 3]);
  const rejects = rejectTotals(snapshot.rejects || []);
  pdf.moveDown().fontSize(10).text(`Finalized output: ${rows.filter(r => !r.live).reduce((n, r) => n + r.actual, 0)} pcs  |  After-forming rejects: ${rejects.pieces} pcs  |  Slab: ${rejects.slab} m  |  Return roll: ${rejects.returnRoll} m`);
  pdf.end();
}
