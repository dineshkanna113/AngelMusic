"""Server admin commands, run on the host (or in the container):

    python -m app.manage create-user <username> --admin       # first admin on a production server
    python -m app.manage create-user <username> --uploader
    python -m app.manage set-password <username>
    python -m app.manage list-users
    python -m app.manage scan                                 # rescan the music folder
    python -m app.manage backup <file.db>                     # consistent copy while the server runs
    python -m app.manage openapi docs/openapi.json            # API schema for mobile/client developers

Passwords are prompted for, or read from stdin with --password-stdin (for scripts).
"""

import argparse
import getpass
import sqlite3
import sys
from pathlib import Path

from .config import load_settings
from .db import Database
from .library import Library
from .security import hash_password


def _password(args) -> str:
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\n")
    else:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords don't match")
    if not 8 <= len(password) <= 128:
        sys.exit("Password must be 8 to 128 characters")
    return password


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.manage", description="AngelMusic server admin")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-user", help="add a user")
    create.add_argument("username")
    role = create.add_mutually_exclusive_group()
    role.add_argument("--admin", action="store_true")
    role.add_argument("--uploader", action="store_true")
    create.add_argument("--password-stdin", action="store_true")
    reset = sub.add_parser("set-password", help="reset a password and sign the user out everywhere")
    reset.add_argument("username")
    reset.add_argument("--password-stdin", action="store_true")
    sub.add_parser("list-users")
    sub.add_parser("scan", help="rescan the music folder")
    backup = sub.add_parser("backup", help="online backup of the database")
    backup.add_argument("destination", type=Path)
    spec = sub.add_parser("openapi", help="write the OpenAPI schema")
    spec.add_argument("destination", type=Path)
    args = parser.parse_args(argv)

    if args.command == "openapi":
        import json
        from dataclasses import replace

        from .main import create_app

        settings = replace(load_settings(), scan_on_startup=False)
        args.destination.parent.mkdir(parents=True, exist_ok=True)
        args.destination.write_text(json.dumps(create_app(settings).openapi(), indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.destination}")
        return

    settings = load_settings()
    db = Database(settings.database_path)

    if args.command == "create-user":
        password = _password(args)
        with db.connect() as conn:
            try:
                conn.execute("INSERT INTO users (username, password_hash, is_admin, can_upload) VALUES (?, ?, ?, ?)",
                             (args.username, hash_password(password), int(args.admin), int(args.uploader)))
            except sqlite3.IntegrityError:
                sys.exit(f"User {args.username!r} already exists")
        print(f"Created {args.username}" + (" (admin)" if args.admin else " (uploader)" if args.uploader else ""))
    elif args.command == "set-password":
        password = _password(args)
        with db.connect() as conn:
            cur = conn.execute("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?",
                               (hash_password(password), args.username))
            if cur.rowcount == 0:
                sys.exit(f"No user {args.username!r}")
            conn.execute("""UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
                            WHERE user_id = (SELECT id FROM users WHERE username = ?) AND revoked_at IS NULL""",
                         (args.username,))
        print(f"Password reset; {args.username} was signed out everywhere")
    elif args.command == "list-users":
        with db.connect() as conn:
            for r in conn.execute("SELECT username, is_admin, can_upload, created_at FROM users ORDER BY username"):
                role = "admin" if r["is_admin"] else "uploader" if r["can_upload"] else "listener"
                print(f"{r['username']:<32} {role:<9} {r['created_at']}")
    elif args.command == "scan":
        print(Library(db, settings.audio_dir).scan())
    elif args.command == "backup":
        args.destination.parent.mkdir(parents=True, exist_ok=True)
        # SQLite's backup API copies a consistent snapshot even while the server is writing.
        with sqlite3.connect(settings.database_path) as src, sqlite3.connect(args.destination) as dst:
            src.backup(dst)
        print(f"Backed up {settings.database_path} to {args.destination}")


if __name__ == "__main__":
    main()
