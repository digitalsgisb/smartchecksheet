import { spawn } from 'node:child_process';
import { watchFile, unwatchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
let child, stopping = false, restarting = false;
function start() {
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { cwd: root, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); stop(); });
  child.on('exit', code => {
    if (restarting && !stopping) { restarting = false; start(); }
    else { unwatchFile(envPath); process.exitCode = stopping ? 0 : code || 0; }
  });
}
function stop() { stopping = true; unwatchFile(envPath); child?.kill(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
watchFile(envPath, { interval: 1000 }, (current, previous) => {
  if (!stopping && !restarting && current.mtimeMs !== previous.mtimeMs) {
    console.log('Local configuration changed. Restarting the test server.');
    restarting = true; child.kill();
  }
});
start();
