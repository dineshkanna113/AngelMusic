"""SQLite storage for users, the scanned track library and per-user data."""

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

# Bump when the tracks table changes; tracks are a cache of the files on disk, so they're
# simply dropped and rescanned. User data tables are migrated in place.
SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    username          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash     TEXT NOT NULL,
    is_admin          INTEGER NOT NULL DEFAULT 0,
    token_version     INTEGER NOT NULL DEFAULT 0,
    app_password_enc  TEXT,
    can_upload        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracks (
    id              TEXT PRIMARY KEY,
    rel_path        TEXT NOT NULL UNIQUE,
    size            INTEGER NOT NULL,
    mtime_ns        INTEGER NOT NULL,
    title           TEXT NOT NULL,
    artist          TEXT NOT NULL DEFAULT '',
    album           TEXT NOT NULL DEFAULT '',
    album_artist    TEXT NOT NULL DEFAULT '',
    album_id        TEXT NOT NULL,
    artist_id       TEXT NOT NULL,
    genre           TEXT NOT NULL DEFAULT '',
    year            TEXT NOT NULL DEFAULT '',
    track_no        INTEGER,
    disc_no         INTEGER,
    duration        REAL NOT NULL DEFAULT 0,
    codec           TEXT NOT NULL,
    mime            TEXT NOT NULL,
    sample_rate     INTEGER,
    bit_depth       INTEGER,
    channels        INTEGER,
    bitrate         INTEGER,
    rg_track_gain   REAL,
    rg_track_peak   REAL,
    rg_album_gain   REAL,
    rg_album_peak   REAL,
    has_cover       INTEGER NOT NULL DEFAULT 0,
    has_lyrics      INTEGER NOT NULL DEFAULT 0,
    added_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);

CREATE TABLE IF NOT EXISTS favorites (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS playlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    comment     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    track_id    TEXT NOT NULL,
    PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS plays (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL,
    played_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, played_at);

-- One row per signed-in device. The refresh token is "<id>.<secret>"; only a hash of the
-- secret is stored, and it rotates on every refresh.
CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secret_hash   TEXT NOT NULL,
    prev_hash     TEXT,
    rotated_at    TEXT,
    device        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TEXT NOT NULL,
    revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Upload ingestion: each row is one file moving through
-- uploading -> processing -> invalid | pending -> scheduled -> published (-> removed), or declined.
CREATE TABLE IF NOT EXISTS uploads (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    filename      TEXT NOT NULL,
    size          INTEGER NOT NULL,
    received      INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    auto_publish  INTEGER NOT NULL DEFAULT 0,
    sha256        TEXT,
    meta          TEXT,
    edits         TEXT NOT NULL DEFAULT '{}',
    issues        TEXT NOT NULL DEFAULT '[]',
    release_at    TEXT,
    reviewer_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_note   TEXT NOT NULL DEFAULT '',
    reviewed_at   TEXT,
    track_id      TEXT,
    rel_path      TEXT,
    published_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_uploads_sha ON uploads(sha256);

-- Social graph: one-way follows (mutual = friends) and followed artists.
CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS artist_follows (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, artist_id)
);
"""

# Columns added to user tables after the first release: (table, column, definition).
ADDED_COLUMNS = [
    ("users", "token_version", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "app_password_enc", "TEXT"),
    ("users", "can_upload", "INTEGER NOT NULL DEFAULT 0"),
    ("sessions", "prev_hash", "TEXT"),
    ("sessions", "rotated_at", "TEXT"),
    ("users", "display_name", "TEXT NOT NULL DEFAULT ''"),
    ("users", "bio", "TEXT NOT NULL DEFAULT ''"),
    ("users", "avatar", "TEXT"),
    ("users", "is_private", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "share_activity", "INTEGER NOT NULL DEFAULT 1"),
    ("playlists", "visibility", "TEXT NOT NULL DEFAULT 'private'"),
]


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        with self.connect() as conn:
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version < SCHEMA_VERSION:
            conn.execute("DROP TABLE IF EXISTS tracks")
        conn.executescript(SCHEMA)
        for table, column, definition in ADDED_COLUMNS:
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    @contextmanager
    def connect(self):
        conn = self._conn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
