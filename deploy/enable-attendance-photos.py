"""Apply the narrowly scoped photo-read change to a deployed Attendance server.

Usage: python3 deploy/enable-attendance-photos.py /path/to/facescanpk/ai-pc/server.py
Backs up the original source, refuses unexpected source, and is safe to rerun.
"""
from pathlib import Path
import ast
import sys

path = Path(sys.argv[1]).resolve()
source = path.read_text(encoding='utf-8')
old = """        if route.startswith('/uploads/'):
            with self.store.connect() as db:
                self.identity(db)
"""
new = """        if route.startswith('/uploads/'):
            with self.store.connect() as db:
                who = self.identity(db, allow_device=True)
                if who['scope'] not in ('admin', 'integration'):
                    raise Problem('Photo access requires admin or read-only integration access.', 403)
                if not re.fullmatch(r'/uploads/[a-f0-9]+\\.jpg', route):
                    raise Problem('Photo not found.', 404)
                if who['scope'] == 'integration' and not db.execute(
                    'SELECT 1 FROM employees WHERE photo_url=? AND active=1', (route,)
                ).fetchone():
                    raise Problem('Photo not found.', 404)
"""
if new in source:
    print('Attendance photo access is already updated.')
elif source.count(old) != 1:
    raise SystemExit('Unexpected Attendance source; no files changed.')
else:
    updated = source.replace(old, new)
    ast.parse(updated)
    backup = path.with_name(path.name + '.before-checksheet-photos')
    if backup.exists():
        raise SystemExit('Backup already exists; inspect it before updating.')
    backup.write_text(source, encoding='utf-8')
    path.write_text(updated, encoding='utf-8')
    print('Attendance photo access updated. Rebuild/restart Attendance.')
