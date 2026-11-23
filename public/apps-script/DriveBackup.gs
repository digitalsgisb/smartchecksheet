// Smart Checksheet nightly backup -> Google Drive.
// The AI PC sends one gzipped copy of the database each night; this script saves it in the
// "Smart Checksheet backups" folder of the Google account that deploys it and moves older copies to the Bin.
//
// Setup (once):
//  1. script.google.com -> New project -> paste this file.
//  2. Project Settings -> Script properties -> add BACKUP_TOKEN = a long random password (at least 24 characters).
//  3. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: Anyone. Authorise, then copy the /exec URL.
//  4. On the AI PC run: bash deploy/site.sh drive-backup   and paste the URL and the same token.
var FOLDER_NAME = 'Smart Checksheet backups';
var FILE_PATTERN = /^checksheet-\d{8}-\d{6}\.sqlite\.gz$/;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('BACKUP_TOKEN');
    if (!expected || expected.length < 24) return reply({ ok: false, error: 'Set the BACKUP_TOKEN script property (at least 24 characters).' });
    if (body.token !== expected) return reply({ ok: false, error: 'The token does not match BACKUP_TOKEN.' });
    if (!FILE_PATTERN.test(String(body.name))) return reply({ ok: false, error: 'Unexpected file name.' });
    var folder = backupFolder(props);
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.data), 'application/gzip', body.name));
    var keep = Math.max(7, Math.min(365, Number(body.keep) || 30));
    var files = [], it = folder.getFiles();
    while (it.hasNext()) { var f = it.next(); if (FILE_PATTERN.test(f.getName())) files.push(f); }
    files.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
    files.slice(keep).forEach(function (old) { old.setTrashed(true); });
    return reply({ ok: true, name: file.getName(), size: file.getSize(), folder: folder.getName(), kept: Math.min(files.length, keep) });
  } catch (error) {
    return reply({ ok: false, error: String(error && error.message || error) });
  }
}

function backupFolder(props) {
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { var saved = DriveApp.getFolderById(id); if (!saved.isTrashed()) return saved; } catch (e) {} }
  var found = DriveApp.getFoldersByName(FOLDER_NAME);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
