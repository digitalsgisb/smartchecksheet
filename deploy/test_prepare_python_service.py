import ast
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_service', Path(__file__).with_name('prepare-python-service.py'))
prepare_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_module)


class PrepareServiceTest(unittest.TestCase):
    def test_all_sources_receive_identity_once_and_keep_backups(self):
        for line in ('abb2', 'abb3', 'abb7'):
            with self.subTest(line=line), tempfile.TemporaryDirectory() as folder:
                destination = Path(folder)
                script = destination / (line + '.py')
                original = ('LINE_CODE = "' + line.upper() + '"\n'
                            'def publish_live_data():\n'
                            '    payload = {\n'
                            '        "shift_id": "existing-shift",\n'
                            '        "hourly_output": 7,\n'
                            '    }\n'
                            '    return payload\n')
                script.write_text(original, encoding='utf-8')
                if line == 'abb3':
                    # Reproduce the exact upstream import/filename/class mismatch.
                    (destination / 'persistence.py').write_text('class ABB7SQLiteStore:\n    pass\nclass ABB3OutboxSender:\n    pass\n', encoding='utf-8')
                    (destination / 'shift_schedule.py').write_text('def coerce_bool(value):\n    return bool(value)\n', encoding='utf-8')
                prepare_module.prepare(script)
                prepared = script.read_text(encoding='utf-8')
                function = next(node for node in ast.parse(prepared).body if isinstance(node, ast.FunctionDef) and node.name == 'publish_live_data')
                section = '\n'.join(prepared.splitlines()[function.lineno - 1:function.end_lineno])
                self.assertEqual(section.count('"line_code": LINE_CODE'), 1)
                namespace = {}
                exec(prepared, namespace)
                self.assertEqual(namespace['publish_live_data'](), {'shift_id': 'existing-shift', 'hourly_output': 7, 'line_code': line.upper()})
                self.assertEqual(script.with_name(script.name + '.before-checksheet').read_text(), original)
                prepare_module.prepare(script)
                self.assertEqual(script.read_text(), prepared)
                if line == 'abb3':
                    self.assertTrue((destination / 'abb3_shift_schedule.py').exists())
                    tree = ast.parse((destination / 'abb3_persistence.py').read_text())
                    self.assertIn('ABB3SQLiteStore', {node.name for node in tree.body if isinstance(node, ast.ClassDef)})


if __name__ == '__main__':
    unittest.main()
