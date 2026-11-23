"""Copy a stopped site's SQLite backup into an empty, dedicated Postgres database."""
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path

from storage import DATABASE_URL, connect, init_schema

TABLES = ("users", "sessions", "media", "messages", "reports")


def migrate(path):
    if not DATABASE_URL:
        raise ValueError("Set the destination DATABASE_URL")
    init_schema()
    with closing(sqlite3.connect(path.resolve(strict=True).as_uri() + "?mode=ro", uri=True)) as source, connect() as target:
        source.execute("BEGIN")
        target.execute("LOCK TABLE users, sessions, media, messages, reports IN ACCESS EXCLUSIVE MODE")
        for table in TABLES:
            if target.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise ValueError("Destination must be empty")
        for table in TABLES:
            rows = source.execute(f"SELECT * FROM {table}")
            columns = [col[0] for col in rows.description]
            expected = target.execute(f"SELECT * FROM {table} LIMIT 0").description
            if set(columns) != {col.name for col in expected}:
                raise ValueError(f"Unexpected columns in {table}")
            fields = ",".join(columns)
            placeholders = ",".join(["?"] * len(columns))
            for record in rows:
                target.execute(f"INSERT INTO {table} ({fields}) VALUES ({placeholders})", record)
            if table != "sessions":
                target.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id),1), COUNT(*)>0) FROM {table}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    migrate(parser.parse_args().backup)
