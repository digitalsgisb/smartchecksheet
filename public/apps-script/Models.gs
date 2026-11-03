// Google Sheet tab: Models
// Row 1: line | model | targetPerHour | cycleMinutes | active
// Example row: ABB3 | YOUR_REAL_MODEL | 60 | 1 | TRUE
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

function doGet(e) {
  try {
    const line = String(e && e.parameter && e.parameter.line || '').trim();
    if (!line) throw new Error('Missing line parameter.');
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Models');
    if (!sheet) throw new Error('Models tab missing.');
    const rows = sheet.getDataRange().getValues();
    const headers = rows.shift().map(value => String(value).trim());
    const index = {};
    ['line', 'model', 'targetPerHour', 'cycleMinutes', 'active'].forEach(key => {
      index[key] = headers.indexOf(key);
      if (index[key] < 0) throw new Error('Missing column: ' + key);
    });
    const models = rows.filter(row => String(row[index.line]).trim() === line && ['true', '1', 'yes'].includes(String(row[index.active]).trim().toLowerCase()))
      .map(row => ({ name: String(row[index.model]).trim(), pcsHr: Number(row[index.targetPerHour]), cycle: Number(row[index.cycleMinutes]) }));
    return ContentService.createTextOutput(JSON.stringify({ models: models })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Check the Models tab, headers and deployment settings.' })).setMimeType(ContentService.MimeType.JSON);
  }
}
