#!/usr/bin/env python3
"""Import the existing Apps Script model/manpower arrays as a catalog snapshot."""
import argparse
import json
import math
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit
from urllib.request import urlopen


def fetch_rows(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname != 'script.google.com'
            or parsed.username or parsed.password or parsed.fragment):
        raise ValueError('Use an HTTPS script.google.com deployment URL')
    with urlopen(url, timeout=45) as response:
        raw = response.read(4_000_001)
    if len(raw) > 4_000_000:
        raise ValueError('Catalog response is too large')
    rows = json.loads(raw.decode('utf-8-sig'))
    if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) for row in rows):
        raise ValueError('Expected a nonempty JSON array of objects from Apps Script')
    return rows


def build_catalog(model_rows, people_rows):
    models, excluded, seen = [], [], set()
    for row in model_rows:
        name = row.get('name')
        if not isinstance(name, str) or not name.strip():
            raise ValueError('Every model needs a name')
        name = name.strip()
        if name in seen:
            raise ValueError('Duplicate model: ' + name)
        seen.add(name)
        values = [row.get(key) for key in ('stdCycle', 'pcsHr', 'stdSlabWidth', 'stdSlabLength')]
        valid = all(isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value) and value > 0 for value in values)
        if not valid:
            if name.upper() in {'NO PROD', 'TRIAL'}:
                excluded.append(name)
                continue
            raise ValueError('Model requires positive numeric cycle/capacity/dimensions: ' + name)
        models.append(dict(zip(('name', 'cycle', 'pcsHr', 'slabWidth', 'slabLength'), [name, *values])))
    if not models:
        raise ValueError('No valid production models')
    fields = {
        'supervisors': ('supervisors',),
        'leaders': ('lineLeaders',),
        'operators': ('formingOperators', 'waterjetOperators', 'assemblyOperators'),
        'quality': ('qualityOperators',),
    }
    people = {}
    for destination, sources in fields.items():
        names = []
        for row in people_rows:
            for source in sources:
                value = row.get(source)
                if value is None or value == '':
                    continue
                if not isinstance(value, str):
                    raise ValueError('Manpower names must be strings: ' + source)
                value = value.strip()
                if value and value not in names:
                    names.append(value)
        if not names:
            raise ValueError('Missing manpower group: ' + destination)
        people[destination] = names
    return {'models': models, 'people': people}, excluded


def write_catalog(path, catalog):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(catalog, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        # The Docker backend runs as a different user and must read the catalog.
        temporary.chmod(0o644)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-url', required=True)
    parser.add_argument('--people-url', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        catalog, excluded = build_catalog(fetch_rows(args.models_url), fetch_rows(args.people_url))
        write_catalog(args.output, catalog)
    except Exception as exc:
        # Avoid disclosing endpoint URLs or response bodies in logs.
        raise SystemExit('Catalog import failed (' + type(exc).__name__ + '); existing output was not replaced.') from None
    print('Imported ' + str(len(catalog['models'])) + ' production models; manpower groups: '
          + ', '.join(key + '=' + str(len(value)) for key, value in catalog['people'].items()))
    if excluded:
        print('Excluded non-production entries: ' + ', '.join(excluded))
    print('Saved ' + args.output + '. Restart Checksheet to load this snapshot.')


if __name__ == '__main__':
    main()
