// Downtime reference codes from the PRS template (PRS TEMPLATE SELF ADJUSTMENT.xlsx, REV1 11022025).
// The reason is sent as "<code> - <description>": the Pi trackers split it into code and description for the sheet,
// and Schedule + "model change" in the reason puts the tracker into MODEL CHANGE mode. stdMinutes is the standard time.
export const downtimeCodes = {
  Quality: [{ title: 'Quality downtime', codes: [
    ['D1', 'Over cut'], ['D2', 'Felt Missing'], ['D3', 'Torn'], ['D4', 'Pressmark'], ['D5', 'Short width'], ['D6', 'Short forming'], ['D7', 'Thin'], ['D8', 'Patches'], ['D9', 'Linemark'], ['D10', 'Foreign Particle'],
    ['D11', 'Under heat'], ['D12', 'Burnmark'], ['D13', 'Soft'], ['D14', 'Shape deform'], ['D15', 'App NG'], ['D16', 'Punchmark'], ['D17', 'Thick'], ['D18', 'Hole / Slit cut missing'], ['D19', 'Hole / Slit cut offset'], ['D20', 'Over cut'],
    ['D21', 'Undercut'], ['D22', 'Folded'], ['D23', 'Felt missing'], ['D24', 'Detach'], ['D25', 'Velcro tape missing'], ['D26', 'C/part missing'], ['D27', 'Glue Stain'], ['D28', 'Dirty'], ['D29', 'Hole half cut'], ['D30', 'Tear'],
    ['D31', 'Sticker missing'], ['D32', 'Others'], ['D33', 'Trial'], ['D34', 'PE missing'], ['D35', 'Wrinkles'], ['D36', 'Curling'], ['D37', 'Loose punch'], ['D38', 'Poor cutting'], ['D39', 'PE stain']
  ] }],
  Schedule: [
    { title: 'Maintenance downtime', codes: [['X1', 'Mechanical'], ['X2', 'Electrical'], ['X3', 'Facilities']] },
    { title: 'Stoppage downtime', codes: [['Y1', 'Model Change', 30], ['Y2', 'Weekly Cleaning / PM', 60], ['Y3', 'Meeting / Training', 10], ['Y4', '1st Product / Line setup', 5], ['Y5', 'End Shift cleaning', 5], ['Y6', 'Monday Assy', 20], ['Y7', 'Variant change', 15], ['Y8', 'Trial', 60]] }
  ],
  Production: [{ title: 'Production downtime', codes: [['Z1', 'No material / Stockout'], ['Z2', 'Quality problem'], ['Z3', 'Excessive model change'], ['Z4', 'Manpower'], ['Z5', 'Excessive meeting'], ['Z6', 'Others']] }]
};
export const codedCategory = category => Boolean(downtimeCodes[category]);
export const codeReason = (code, description) => `${code} - ${description}`;
const all = Object.entries(downtimeCodes).flatMap(([category, groups]) => groups.flatMap(group => group.codes.map(([code, description, stdMinutes]) => ({ category, code, description, stdMinutes: stdMinutes || 0 }))));
// The code entry a saved reason points to, or null when the reason is free text.
export function findCode(category, reason) {
  const code = String(reason || '').match(/^\s*([A-Z]\d{1,2})\s*-/)?.[1];
  return code ? all.find(item => item.code === code && item.category === category) || null : null;
}
// Code and description for a saved downtime row; live rows carry the code split off by the Pi, manual rows keep it in the reason.
export function splitReason(row) {
  const reason = String(row.reason || '');
  if (row.code && row.code !== 'N/A') return { code: row.code, description: reason };
  const match = reason.match(/^\s*([A-Z]\d{1,2})\s*-\s*(.*)$/);
  return match ? { code: match[1], description: match[2] } : { code: '', description: reason };
}
export const modelChangeCode = all.find(item => item.code === 'Y1');
