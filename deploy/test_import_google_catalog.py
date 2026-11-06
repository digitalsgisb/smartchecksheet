import json
from pathlib import Path
import tempfile
import unittest

from import_google_catalog import build_catalog, write_catalog


class CatalogImportTest(unittest.TestCase):
    def setUp(self):
        self.models = [{'name': 'FC3', 'stdCycle': 5.5, 'pcsHr': 60 / 5.5,
                        'stdSlabWidth': 1.66, 'stdSlabLength': 2.9}]
        self.people = [{'supervisors': 'S', 'lineLeaders': 'L', 'formingOperators': 'A',
                        'waterjetOperators': 'A', 'assemblyOperators': 'B', 'qualityOperators': 'Q'}]

    def test_real_shape_preserves_units_precision_and_deduplicates_people(self):
        catalog, excluded = build_catalog(self.models + [
            {'name': 'NO PROD', 'stdCycle': 0, 'pcsHr': 0, 'stdSlabWidth': 0, 'stdSlabLength': 0},
            {'name': 'TRIAL', 'stdCycle': 60, 'pcsHr': 0, 'stdSlabWidth': 0, 'stdSlabLength': 0},
        ], self.people + [{'qualityOperators': ' Q '}])
        self.assertEqual(catalog['models'][0], {'name': 'FC3', 'cycle': 5.5, 'pcsHr': 60 / 5.5,
                                               'slabWidth': 1.66, 'slabLength': 2.9})
        self.assertEqual(catalog['people']['operators'], ['A', 'B'])
        self.assertEqual(catalog['people']['quality'], ['Q'])
        self.assertEqual(excluded, ['NO PROD', 'TRIAL'])

    def test_bad_production_models_and_missing_people_are_rejected(self):
        for value in (-1, float('nan'), True, '1.5'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                build_catalog([{**self.models[0], 'stdCycle': value}], self.people)
        with self.assertRaises(ValueError):
            build_catalog(self.models, [{'supervisors': 'S'}])
        with self.assertRaisesRegex(ValueError, 'conflicting standards'):
            build_catalog(self.models + [{**self.models[0], 'stdCycle': 10}], self.people)

    def test_identical_duplicate_names_produce_one_option(self):
        catalog, _ = build_catalog(self.models + [{**self.models[0], 'name': ' FC3 '}], self.people)
        self.assertEqual(len(catalog['models']), 1)
        self.assertEqual(catalog['models'][0]['name'], 'FC3')

    def test_incomplete_production_models_remain_in_dropdown_without_fake_standards(self):
        catalog, _ = build_catalog([
            {'name': 'KA4 FR', 'stdCycle': 6, 'pcsHr': 0, 'stdSlabWidth': 0, 'stdSlabLength': 0},
            {'name': 'Name only'},
        ], self.people)
        self.assertEqual(catalog['models'][0], {'name': 'KA4 FR', 'cycle': 6, 'pcsHr': 0,
                                               'slabWidth': 0, 'slabLength': 0})
        self.assertEqual(catalog['models'][1], {'name': 'Name only', 'cycle': None, 'pcsHr': None,
                                               'slabWidth': None, 'slabLength': None})

    def test_snapshot_replacement_is_valid_json_and_readable(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'catalog.json'
            output.write_text('old catalog', encoding='utf-8')
            catalog, _ = build_catalog(self.models, self.people)
            write_catalog(output, catalog)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')), catalog)
            self.assertEqual(list(Path(folder).glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
