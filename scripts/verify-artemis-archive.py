#!/usr/bin/env python3

import argparse
import hashlib
import os
import sqlite3
import tarfile
import tempfile


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as archive:
        for chunk in iter(lambda: archive.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify an official Artemis-Database release archive")
    parser.add_argument("archive")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--bytes", required=True, type=int)
    parser.add_argument("--version", required=True, type=int)
    args = parser.parse_args()

    actual_size = os.path.getsize(args.archive)
    if actual_size != args.bytes:
        raise SystemExit(f"Archive size mismatch: expected {args.bytes}, got {actual_size}")
    actual_digest = sha256_file(args.archive)
    if actual_digest != args.sha256.lower():
        raise SystemExit(f"Archive SHA-256 mismatch: expected {args.sha256}, got {actual_digest}")

    try:
        with tarfile.open(args.archive, "r:") as archive:
            members = [member for member in archive.getmembers() if member.name.lstrip("./") == "data.sqlite"]
            if len(members) != 1:
                raise SystemExit("Archive must contain exactly one data.sqlite")
            member = members[0]
            if not member.isfile() or member.size <= 0 or member.size > 100 * 1024 * 1024:
                raise SystemExit("Archive data.sqlite has an invalid type or size")
            source = archive.extractfile(member)
            if source is None:
                raise SystemExit("Unable to read archive data.sqlite")
            with tempfile.NamedTemporaryFile(suffix=".sqlite") as database:
                while chunk := source.read(1024 * 1024):
                    database.write(chunk)
                database.flush()
                connection = sqlite3.connect(f"file:{database.name}?mode=ro", uri=True)
                try:
                    integrity = connection.execute("PRAGMA integrity_check").fetchall()
                    if integrity != [("ok",)]:
                        raise SystemExit(f"Archive database failed integrity_check: {integrity[:5]}")
                    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
                    if foreign_keys:
                        raise SystemExit(f"Archive database failed foreign_key_check: {foreign_keys[:5]}")
                    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
                    required_tables = {
                        "signals", "acf", "bandwidth", "categorylabel", "category", "documents",
                        "frequency", "info", "location", "mode", "modulation",
                    }
                    if not required_tables.issubset(tables):
                        raise SystemExit(f"Archive database is missing tables: {sorted(required_tables - tables)}")
                    info_rows = connection.execute('SELECT "DATE", "EDITABLE", "NAME", "VERSION" FROM info').fetchall()
                    if len(info_rows) != 1 or info_rows[0][1] != -1 or info_rows[0][2] != "SigID":
                        raise SystemExit(f"Archive database has invalid Info metadata: {info_rows}")
                    row = info_rows[0]
                finally:
                    connection.close()
    except (tarfile.TarError, OSError, sqlite3.DatabaseError) as error:
        raise SystemExit(f"Archive validation failed: {error}") from error
    if int(row[3]) != args.version:
        raise SystemExit(f"Archive database version mismatch: expected {args.version}, got {row[3]}")
    print(f"Verified Artemis-Database archive v{args.version} ({actual_size} bytes, {actual_digest})")


if __name__ == "__main__":
    main()
