"""Access the class's private D1 store. Writes in one commit are sent as a batch."""
import base64
import os
import sqlite3
from urllib.parse import urlsplit

import httpx


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class ClassStore:
    def __init__(self):
        origin = os.environ["CLASS_STORE_URL"].rstrip("/")
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("CLASS_STORE_URL must be an HTTPS origin")
        self.endpoint = origin + "/v1/batch"
        self.http = httpx.Client(timeout=30, headers={
            "OAI-Sites-Authorization": "Bearer " + os.environ["CLASS_STORE_ACCESS"],
            "X-Chat-Service": os.environ["CLASS_STORE_SECRET"],
        })

    def batch(self, commands):
        response = self.http.post(self.endpoint, json=commands)
        if response.status_code == 409:
            raise sqlite3.IntegrityError("Unique constraint")
        response.raise_for_status()
        return response.json()


class RemoteSession:
    def __init__(self, store):
        self.store = store
        self.writes = []

    def execute(self, statement, parameters=()):
        args = [base64.b64encode(p).decode("ascii") if isinstance(p, bytes) else p for p in parameters]
        if not statement.startswith("SELECT") and " RETURNING " not in statement:
            self.writes.append([statement, args])
            return Result([])
        if self.writes:
            raise RuntimeError("A dependent read needs an explicit commit")
        rows = self.store.batch([[statement, args]])[0]
        for row in rows:
            if "data_hex" in row:
                row["data"] = bytes.fromhex(row.pop("data_hex"))
        return Result(rows)

    def commit(self):
        if self.writes:
            self.store.batch(self.writes)
            self.writes.clear()
