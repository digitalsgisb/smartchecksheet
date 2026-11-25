import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from urllib.error import HTTPError

from checksheet_event_relay import EventRelay


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self, *_):
        return b'{"ok":true}'


class RelayTest(unittest.TestCase):
    def test_delivery_retries_survive_restart_without_changing_analytics_outbox(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'machine.db'
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE outbox_events(event_id TEXT PRIMARY KEY,event_type TEXT,line_code TEXT,shift_id TEXT,occurred_at TEXT,payload_json TEXT,status TEXT)')
            for line in ('ABB2', 'ABB3', 'ABB7'):
                db.execute('INSERT INTO outbox_events VALUES(?,?,?,?,?,?,?)', (line + '-event', 'reject.recorded', line, 'shift-' + line, '2026-10-23T00:00:00Z', '{"ng_quantity":2}', 'SENT'))
            db.commit()
            received = []

            def failing(req, **_):
                raise HTTPError(req.full_url, 503, 'Unavailable', {}, None)

            relay = EventRelay(path, 'ABB3', 'http://ai-pc/api/integrations/events', 'private-token', opener=failing)
            self.assertFalse(relay.deliver_one(now=100))
            relay.close()

            def success(req, **_):
                received.append(json.loads(req.data))
                self.assertEqual(req.get_header('Authorization'), 'Bearer private-token')
                return Response()

            relay = EventRelay(path, 'ABB3', 'http://ai-pc/api/integrations/events', 'private-token', opener=success)
            self.assertFalse(relay.deliver_one(now=101), 'retry delay is persisted')
            self.assertTrue(relay.deliver_one(now=103))
            self.assertFalse(relay.deliver_one(now=104), 'acknowledged events never replay')
            self.assertEqual(received, [{'event_id': 'ABB3-event', 'event_type': 'reject.recorded', 'line_code': 'ABB3', 'shift_id': 'shift-ABB3', 'occurred_at': '2026-10-23T00:00:00Z', 'payload': {'ng_quantity': 2}}])
            self.assertEqual(db.execute('SELECT status FROM outbox_events').fetchall(), [('SENT',)] * 3)
            relay.close()
            # Separate line relays can read the same schema without consuming each other's events.
            for line in ('ABB2', 'ABB7'):
                relay = EventRelay(path, line, 'http://ai-pc/api/integrations/events', 'private-token', opener=success)
                self.assertTrue(relay.deliver_one(now=105))
                relay.close()
            self.assertEqual([event['line_code'] for event in received], ['ABB3', 'ABB2', 'ABB7'])
            db.close()

    def make_outbox(self, folder, events):
        path = Path(folder) / 'machine.db'
        db = sqlite3.connect(path)
        db.execute('CREATE TABLE outbox_events(event_id TEXT PRIMARY KEY,event_type TEXT,line_code TEXT,shift_id TEXT,occurred_at TEXT,payload_json TEXT,status TEXT)')
        for event_id, payload in events:
            db.execute('INSERT INTO outbox_events VALUES(?,?,?,?,?,?,?)', (event_id, 'reject.recorded', 'SDY1', 's1', '2026-11-24T00:00:00Z', payload, 'SENT'))
        db.commit(); db.close()
        return path

    def test_refused_event_is_set_aside_and_does_not_block_the_queue(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make_outbox(folder, [('bad', '{"x":1}'), ('broken', 'not json'), ('good', '{"x":2}')])
            sent, agents = [], []

            def server(req, **_):
                body = json.loads(req.data); agents.append(req.get_header('User-agent'))
                if body['event_id'] == 'bad':
                    raise HTTPError(req.full_url, 400, 'Bad Request', {}, io.BytesIO(b'{"error":"A valid event envelope for this line is required."}'))
                sent.append(body['event_id']); return Response()

            relay = EventRelay(path, 'SDY1', 'http://ai-pc/api/integrations/events', 'private-token', opener=server)
            with self.assertLogs(level='WARNING') as logs:
                self.assertTrue(relay.deliver_one(now=1))
                self.assertTrue(relay.deliver_one(now=1), 'an unreadable payload is set aside without being sent')
            self.assertTrue(relay.deliver_one(now=1))
            self.assertEqual(sent, ['good'])
            self.assertIn('HTTP 400: A valid event envelope for this line is required.', logs.output[0])
            self.assertTrue(all('private-token' not in line and 'ai-pc' not in line for line in logs.output))
            self.assertEqual(agents[0], 'SmartChecksheet-Relay/2')
            self.assertEqual(relay.counts(), (0, 2))
            self.assertEqual(relay.retry_refused(), 2)
            self.assertEqual(relay.counts(), (2, 0))
            relay.close()

    def test_nan_from_python_is_sent_as_empty_json(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make_outbox(folder, [('setup', '{"standard_cycle": NaN, "target": Infinity, "model": "D27A"}')])
            bodies = []

            def server(req, **_):
                bodies.append(req.data.decode()); return Response()

            relay = EventRelay(path, 'SDY1', 'http://ai-pc/api/integrations/events', 'private-token', opener=server)
            self.assertTrue(relay.deliver_one(now=1))
            self.assertNotIn('NaN', bodies[0]); self.assertNotIn('Infinity', bodies[0])
            self.assertEqual(json.loads(bodies[0])['payload'], {'standard_cycle': None, 'target': None, 'model': 'D27A'})
            relay.close()

    def test_blocked_or_unauthorized_requests_are_retried_in_order_with_the_reason(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make_outbox(folder, [('first', '{}'), ('second', '{}')])

            def cloudflare(req, **_):
                raise HTTPError(req.full_url, 403, 'Forbidden', {}, io.BytesIO(b'error code: 1010\n'))

            relay = EventRelay(path, 'SDY1', 'https://public.example/api/integrations/events', 'private-token', opener=cloudflare)
            with self.assertLogs(level='WARNING') as logs:
                self.assertFalse(relay.deliver_one(now=1))
            self.assertIn('first delivery failed (HTTP 403: error code: 1010)', logs.output[0])
            self.assertEqual(relay.counts(), (2, 0), 'nothing is set aside for a block that can be fixed')
            relay.close()

    def test_heartbeat_reports_the_queue_once_a_minute_and_is_never_an_event(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make_outbox(folder, [('a', '{}'), ('b', '{}')])
            beats = []

            def server(req, **_):
                beats.append(json.loads(req.data)); return Response()

            relay = EventRelay(path, 'SDY1', 'http://ai-pc/api/integrations/events', 'private-token', opener=server)
            self.assertTrue(relay.heartbeat(now=100))
            self.assertFalse(relay.heartbeat(now=130))
            self.assertTrue(relay.heartbeat(now=161))
            self.assertEqual(beats[0], {'event_type': 'relay.heartbeat', 'line_code': 'SDY1', 'payload': {'waiting': 2, 'refused': 0, 'last_error': '', 'relay': 'SmartChecksheet-Relay/2'}})
            self.assertEqual(relay.counts(), (2, 0))
            relay.close()

    def test_invalid_configuration_does_not_create_a_database(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'missing.db'
            with self.assertRaises(ValueError):
                EventRelay(path, 'abb 4', 'http://ai-pc/events', 'token')
            with self.assertRaises(ValueError):
                EventRelay(path, 'ABB3', 'http://ai-pc/events', '')
            with self.assertRaises(sqlite3.OperationalError):
                EventRelay(path, 'ABB3', 'http://ai-pc/events', 'token')
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
