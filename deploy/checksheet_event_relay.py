#!/usr/bin/env python3
"""Deliver Pi events to Checksheet with an independent SQLite delivery ledger.

Reads the existing outbox, including events already delivered to the analytics
API. Never changes its status or replays machine commands. Standard library only.

An event the server refuses as invalid (HTTP 400) is set aside on this Pi, so it
cannot block the events behind it. Put set-aside events back in the queue with:
    sudo systemd-run --wait --uid=USER -p EnvironmentFile=/etc/smartchecksheet-relay.env \
        python3 /opt/smartchecksheet/checksheet_event_relay.py --retry-refused
"""
import json
import logging
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import threading
import time
from urllib import request
from urllib.error import HTTPError
from urllib.parse import urlsplit

USER_AGENT = "SmartChecksheet-Relay/2"
HEARTBEAT_SECONDS = 60


def short_reason(exc):
    """Status and the server's short message only: never the URL, token or payload."""
    if isinstance(exc, HTTPError):
        try:
            body = exc.read(600).decode("utf-8", "replace")
        except Exception:
            body = ""
        finally:
            exc.close()
        try:
            body = json.loads(body).get("error", "") or body
        except Exception:
            pass
        body = re.sub(r"\s+", " ", str(body)).strip()[:160]
        return f"HTTP {exc.code}" + (f": {body}" if body else "")
    return type(exc).__name__


class EventRelay:
    def __init__(self, database_path, line, url, token, opener=request.urlopen):
        if not re.fullmatch(r"[A-Z][A-Z0-9]{1,7}", str(line)):
            raise ValueError("CHECKSHEET_LINE must be a line code such as ABB7 or SDY1")
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Set a valid private HTTP or HTTPS Checksheet events URL")
        if not token:
            raise ValueError("CHECKSHEET_TOKEN is required")
        # mode=rw refuses to create an empty DB if the source path is wrong.
        self.db = sqlite3.connect(Path(database_path).resolve().as_uri() + "?mode=rw", uri=True, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute("SELECT event_id, line_code, payload_json FROM outbox_events LIMIT 1")
        self.db.execute("""CREATE TABLE IF NOT EXISTS checksheet_deliveries (
            event_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt REAL NOT NULL DEFAULT 0, delivered_at REAL, last_error TEXT
        )""")
        if "refused_at" not in {row[1] for row in self.db.execute("PRAGMA table_info(checksheet_deliveries)")}:
            self.db.execute("ALTER TABLE checksheet_deliveries ADD COLUMN refused_at REAL")
        self.db.commit()
        self.line, self.url, self.token, self.opener = line, url, token, opener
        self.next_heartbeat, self.last_error = 0, ""

    def post(self, envelope):
        req = request.Request(self.url, data=json.dumps(envelope).encode("utf-8"), method="POST", headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + self.token, "User-Agent": USER_AGENT})
        # The response must explicitly acknowledge the envelope before delivery.
        with self.opener(req, timeout=5) as response:
            if not 200 <= response.status < 300 or json.loads(response.read(65536)).get("ok") is not True:
                raise ValueError("Checksheet did not acknowledge the event")

    def deliver_one(self, now=None):
        now = time.time() if now is None else now
        row = self.db.execute("""
            SELECT e.*, COALESCE(d.attempts,0) AS relay_attempts,
                   COALESCE(d.next_attempt,0) AS relay_next_attempt
            FROM outbox_events e LEFT JOIN checksheet_deliveries d ON d.event_id=e.event_id
            WHERE e.line_code=? AND d.delivered_at IS NULL AND d.refused_at IS NULL
            ORDER BY e.rowid LIMIT 1
        """, (self.line,)).fetchone()
        if row is None or row["relay_next_attempt"] > now:
            return False
        envelope = {key: row[key] for key in ("event_id", "event_type", "line_code", "shift_id", "occurred_at")}
        attempts = row["relay_attempts"] + 1
        try:
            try:
                envelope["payload"] = json.loads(row["payload_json"])
            except (TypeError, ValueError):
                raise HTTPError(self.url, 400, "Unreadable payload", {}, None)
            self.post(envelope)
            self.db.execute("""INSERT INTO checksheet_deliveries(event_id,attempts,delivered_at)
                VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET
                attempts=excluded.attempts, delivered_at=excluded.delivered_at, last_error=NULL""",
                            (row["event_id"], attempts, now))
            self.db.commit()
            self.last_error = ""
            return True
        except Exception as exc:
            message = short_reason(exc)
            self.last_error = message
            # 400: the server read the event and refused it. Retrying cannot help, so keep it here and move on.
            # Anything else (network, Cloudflare, wrong token, server restarting) is retried in order.
            if isinstance(exc, HTTPError) and exc.code == 400:
                self.db.execute("""INSERT INTO checksheet_deliveries(event_id,attempts,refused_at,last_error)
                    VALUES(?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET
                    attempts=excluded.attempts, refused_at=excluded.refused_at, last_error=excluded.last_error""",
                                (row["event_id"], attempts, now, message))
                self.db.commit()
                logging.warning("%s event %s (%s) refused (%s); kept on this Pi, continuing with the next event",
                                self.line, row["event_id"], row["event_type"], message)
                return True
            delay = min(300, 2 ** min(attempts, 9))
            self.db.execute("""INSERT INTO checksheet_deliveries(event_id,attempts,next_attempt,last_error)
                VALUES(?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET
                attempts=excluded.attempts, next_attempt=excluded.next_attempt, last_error=excluded.last_error""",
                            (row["event_id"], attempts, now + delay, message))
            self.db.commit()
            logging.warning("%s event %s delivery failed (%s); retry in %ss", self.line, row["event_id"], message, delay)
            return False

    def counts(self):
        waiting, refused = self.db.execute("""
            SELECT SUM(d.delivered_at IS NULL AND d.refused_at IS NULL), SUM(d.refused_at IS NOT NULL)
            FROM outbox_events e LEFT JOIN checksheet_deliveries d ON d.event_id=e.event_id WHERE e.line_code=?
        """, (self.line,)).fetchone()
        return int(waiting or 0), int(refused or 0)

    def heartbeat(self, now=None):
        """Tell Checksheet the relay is alive and how much is queued, once a minute. Never stored as an event."""
        now = time.time() if now is None else now
        if now < self.next_heartbeat:
            return False
        self.next_heartbeat = now + HEARTBEAT_SECONDS
        waiting, refused = self.counts()
        try:
            self.post({"event_type": "relay.heartbeat", "line_code": self.line,
                       "payload": {"waiting": waiting, "refused": refused, "last_error": self.last_error, "relay": USER_AGENT}})
            return True
        except Exception as exc:
            logging.debug("%s heartbeat failed (%s)", self.line, short_reason(exc))
            return False

    def retry_refused(self):
        changed = self.db.execute("""UPDATE checksheet_deliveries SET refused_at=NULL, next_attempt=0
            WHERE refused_at IS NOT NULL AND event_id IN (SELECT event_id FROM outbox_events WHERE line_code=?)""", (self.line,)).rowcount
        self.db.commit()
        return changed

    def close(self):
        self.db.close()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    relay = EventRelay(os.environ["CHECKSHEET_SQLITE_PATH"], os.environ["CHECKSHEET_LINE"],
                       os.environ["CHECKSHEET_EVENTS_URL"], os.environ["CHECKSHEET_TOKEN"])
    if "--retry-refused" in sys.argv[1:]:
        print(f"{relay.line}: {relay.retry_refused()} set-aside event(s) put back in the queue.")
        relay.close()
        return
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    waiting, refused = relay.counts()
    logging.info("%s Checksheet event relay started (%s waiting, %s set aside)", relay.line, waiting, refused)
    try:
        while not stop.is_set():
            relay.heartbeat()
            if not relay.deliver_one():
                stop.wait(2)
    finally:
        relay.close()


if __name__ == "__main__":
    main()
