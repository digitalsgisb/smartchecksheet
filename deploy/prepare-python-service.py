#!/usr/bin/env python3
"""Patch an existing ABB2/3/7 service for line-identified MQTT snapshots.

Does not start Python, touch GPIO, change sensor logic or alter runtime databases.
Run while the production service is stopped in a commissioning window.
"""
import argparse
import ast
from pathlib import Path
import re
import shutil


def prepare(script):
    script = Path(script).resolve(strict=True)
    line = script.stem.upper()
    if line not in {"ABB2", "ABB3", "ABB7"}:
        raise ValueError("Select abb2.py, abb3.py or abb7.py")
    text = script.read_text(encoding="utf-8-sig")
    if not re.search(r'^LINE_CODE\s*=\s*[\"\x27]' + line + r'[\"\x27]', text, re.MULTILINE):
        raise ValueError("The script LINE_CODE does not match its filename")
    tree = ast.parse(text)
    function = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'publish_live_data'), None)
    if function is None:
        raise ValueError("Expected publish_live_data function was not found")
    rows = text.splitlines(keepends=True)
    section = ''.join(rows[function.lineno - 1:function.end_lineno])
    if '"line_code": LINE_CODE' not in section:
        needle = '    payload = {\n'
        if section.count(needle) != 1:
            raise ValueError("Unexpected live payload structure; no files changed")
        section = section.replace(needle, needle + '        "line_code": LINE_CODE,\n', 1)
        rows[function.lineno - 1:function.end_lineno] = [section]
        text = ''.join(rows)
    ast.parse(text)
    planned = {}
    # The supplied ABB3 repository imports prefixed names but ships generic files.
    if line == 'ABB3':
        for expected, fallback in [('abb3_persistence.py', 'persistence.py'), ('abb3_shift_schedule.py', 'shift_schedule.py')]:
            destination = script.parent / expected
            source = destination if destination.exists() else script.parent / fallback
            module = source.read_text(encoding='utf-8-sig')
            if expected == 'abb3_persistence.py':
                module = module.replace('ABB7SQLiteStore', 'ABB3SQLiteStore')
                classes = {node.name for node in ast.parse(module).body if isinstance(node, ast.ClassDef)}
                if not {'ABB3SQLiteStore', 'ABB3OutboxSender'} <= classes:
                    raise ValueError('Unexpected ABB3 persistence classes; no files changed')
            ast.parse(module)
            planned[destination] = module
    planned[script] = text
    for path, content in planned.items():
        if path.exists() and path.read_text(encoding='utf-8-sig') == content:
            continue
        backup = path.with_name(path.name + '.before-checksheet')
        if path.exists() and not backup.exists():
            shutil.copy2(path, backup)
        path.write_text(content, encoding='utf-8')
        print('Prepared ' + str(path))
    print(line + ' Python source is ready. Restart its existing service when commissioning.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('script', help='Path to existing abb2.py, abb3.py or abb7.py')
    prepare(parser.parse_args().script)
