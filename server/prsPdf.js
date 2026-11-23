import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Turns the filled PRS workbook into a PDF with LibreOffice (installed in the Docker image). One conversion runs at a
// time because LibreOffice shares its profile; results are cached by workbook content, so a re-download is instant.
export function createPrsPdf({ soffice = process.env.PRS_SOFFICE || 'soffice', run = execFile, timeout = 90000 } = {}) {
  let available, queue = Promise.resolve();
  const cache = new Map();
  const call = (args, ms) => new Promise((resolve, reject) => run(soffice, args, { timeout: ms, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  async function ready() {
    if (available === undefined) available = await call(['--version'], 20000).then(() => true, () => false);
    return available;
  }
  async function convert(xlsx) {
    const key = createHash('sha256').update(xlsx).digest('hex');
    if (cache.has(key)) return cache.get(key);
    const job = queue.then(async () => {
      const dir = await mkdtemp(join(tmpdir(), 'prs-'));
      try {
        const input = join(dir, 'prs.xlsx');
        await writeFile(input, xlsx);
        await call(['--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=${pathToFileURL(join(tmpdir(), 'checksheet-lo-profile')).href}`, '--convert-to', 'pdf', '--outdir', dir, input], timeout);
        return await readFile(join(dir, 'prs.pdf'));
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
    queue = job.catch(() => {});
    const pdf = await job;
    cache.set(key, pdf); if (cache.size > 30) cache.delete(cache.keys().next().value);
    return pdf;
  }
  return { ready, convert };
}
