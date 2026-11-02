"""Upload ingestion pipeline.

Modelled on how streaming services ingest releases from labels and distributors — receive,
validate, de-duplicate, review, schedule, go live, take down — at the scale of one library:

    uploading -> processing -> invalid            (failed validation; fix or delete)
                            -> pending -> scheduled -> published -> removed
                                       -> declined

Uploads live in a staging folder outside the library, so nothing is visible to listeners
until an admin approves it. Published files get their edited tags written into the file and
are filed under Uploads/<Artist>/<Album>/ in the library.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import threading
from pathlib import Path

import mutagen
from mutagen.aiff import AIFF
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggflac import OggFLAC
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

from .library import MIME_BY_EXT, TAG_FIELDS, is_lossless, read_metadata, write_tags

log = logging.getLogger(__name__)

UPLOADING, PROCESSING, INVALID, PENDING = "uploading", "processing", "invalid", "pending"
SCHEDULED, PUBLISHED, DECLINED, REMOVED = "scheduled", "published", "declined", "removed"
ACTIVE = (UPLOADING, PROCESSING, INVALID, PENDING, SCHEDULED)

UPLOAD_SUBDIR = "Uploads"
# The container a file actually has must match its extension: a renamed file is rejected
# rather than served with the wrong MIME type.
EXPECTED_TYPES = {
    ".flac": (FLAC,), ".wav": (WAVE,), ".aif": (AIFF,), ".aiff": (AIFF,), ".m4a": (MP4,),
    ".mp3": (MP3,), ".ogg": (OggVorbis, OggOpus, OggFLAC), ".opus": (OggOpus,),
}
# What a file really is, from its first bytes -> extensions that kind may use.
_SNIFF = (
    (lambda h: h[:4] == b"fLaC", "FLAC", (".flac",)),
    (lambda h: h[:4] == b"RIFF" and h[8:12] == b"WAVE", "WAV", (".wav",)),
    (lambda h: h[:4] == b"FORM" and h[8:11] == b"AIF", "AIFF", (".aif", ".aiff")),
    (lambda h: h[4:8] == b"ftyp", "MP4/M4A", (".m4a",)),
    (lambda h: h[:4] == b"OggS", "Ogg", (".ogg", ".opus")),
    (lambda h: h[:3] == b"ID3" or (h[0] == 0xFF and h[1] & 0xE0 == 0xE0), "MP3", (".mp3", ".flac", ".wav", ".aiff", ".aif")),
    (lambda h: h[:2] == b"MZ", "a Windows program", ()),
    (lambda h: h[:4] == b"PK\x03\x04", "a ZIP archive", ()),
    (lambda h: h[:4] == b"%PDF", "a PDF document", ()),
)


def sniff(path: Path) -> tuple[str, tuple] | None:
    with path.open("rb") as f:
        head = f.read(16).ljust(16, b"\0")
    return next(((kind, exts) for test, kind, exts in _SNIFF if test(head)), None)


_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_publish_lock = threading.Lock()


def safe_name(text: str, fallback: str, limit: int = 120) -> str:
    name = _UNSAFE.sub("_", text or "").strip(" .")[:limit].strip(" .")
    return name or fallback


def staged_path(settings, row) -> Path:
    suffix = Path(row["filename"]).suffix.lower()
    return settings.staging_dir / (f"{row['id']}.part" if row["status"] == UPLOADING else f"{row['id']}{suffix}")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def _issue(level: str, code: str, message: str, **extra) -> dict:
    return {"level": level, "code": code, "message": message, **extra}


def effective_metadata(row) -> dict:
    meta = json.loads(row["meta"] or "{}")
    return {**{k: meta.get(k) for k in TAG_FIELDS}, **json.loads(row["edits"] or "{}")}


def live_issues(conn, row) -> list[dict]:
    """Issues that depend on the current tags or library, so they update as tags are edited."""
    if row["status"] not in (PENDING, SCHEDULED, INVALID) or not row["meta"]:
        return []
    md = effective_metadata(row)
    issues = []
    if not (md.get("artist") or "").strip():
        issues.append(_issue("warning", "missing_artist", "No artist tag"))
    if not (md.get("album") or "").strip():
        issues.append(_issue("warning", "missing_album", "No album tag; it will be filed under Singles"))
    duration = json.loads(row["meta"]).get("duration") or 0
    dup = conn.execute(
        """SELECT id, title, artist FROM tracks
           WHERE title = ? COLLATE NOCASE AND artist = ? COLLATE NOCASE AND ABS(duration - ?) < 2 LIMIT 1""",
        (md.get("title") or "", md.get("artist") or "", duration),
    ).fetchone()
    if dup:
        issues.append(_issue("warning", "possible_duplicate",
                             f"The library already has “{dup['title']}” by {dup['artist'] or 'unknown'} "
                             "with the same length", track_id=dup["id"]))
    return issues


def validate(state, upload_id: str) -> None:
    """Inspect a fully received upload: real container type, readable audio, exact duplicates."""
    settings, db = state.settings, state.db
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None or row["status"] != PROCESSING:
        return
    path = staged_path(settings, row)
    suffix = path.suffix
    errors, warnings, meta, sha = [], [], None, None
    try:
        sha = _sha256(path)
        kind = sniff(path)
        try:
            audio = mutagen.File(path)
        except Exception:
            audio = None
        if kind and not kind[1]:
            errors.append(_issue("error", "not_audio", f"This is {kind[0]}, not an audio file"))
        elif kind and suffix not in kind[1]:
            # (ID3-tagged FLAC/WAV/AIFF also start with "ID3", hence their place in the MP3 entry.)
            errors.append(_issue("error", "type_mismatch",
                                 f"The file is really {kind[0]}, not {suffix} — rename it to {kind[1][0]}"))
        elif audio is None or audio.info is None:
            errors.append(_issue("error", "unreadable", "Not a readable audio file"))
        elif not isinstance(audio, EXPECTED_TYPES[suffix]):
            errors.append(_issue("error", "type_mismatch",
                                 f"The file is really {type(audio).__name__}, not {suffix} — rename or re-export it"))
        else:
            meta = read_metadata(path, row["filename"], display_name=Path(row["filename"]))
            if meta is None:
                errors.append(_issue("error", "unreadable", "Not a readable audio file"))
            elif meta["duration"] < 1:
                errors.append(_issue("error", "empty", "The file has no audio (zero length)"))
            else:
                if not is_lossless(meta["codec"]):
                    warnings.append(_issue("warning", "lossy",
                                           f"{meta['codec'].upper()} is a lossy format, not a lossless master"))
                if not meta["has_cover"]:
                    warnings.append(_issue("warning", "no_artwork", "No embedded cover art"))

        with db.connect() as conn:
            other = conn.execute(
                "SELECT filename, status FROM uploads WHERE sha256 = ? AND id != ? AND status NOT IN (?, ?) LIMIT 1",
                (sha, upload_id, DECLINED, REMOVED),
            ).fetchone()
            same_size = conn.execute("SELECT id, rel_path, title, artist FROM tracks WHERE size = ?",
                                     (path.stat().st_size,)).fetchall()
        if other:
            errors.append(_issue("error", "duplicate_upload",
                                 f"Identical to another upload ({other['filename']}, {other['status']})"))
        # Only files of exactly the same size can be byte-identical, so this stays cheap.
        for t in same_size:
            lib_path = state.library.resolve(t["rel_path"])
            if lib_path and _sha256(lib_path) == sha:
                errors.append(_issue("error", "duplicate_track",
                                     f"Identical file already in the library: “{t['title']}” by {t['artist'] or 'unknown'}",
                                     track_id=t["id"]))
                break
    except OSError as exc:
        log.exception("Validating upload %s failed", upload_id)
        errors.append(_issue("error", "io_error", f"Couldn't read the uploaded file: {exc.strerror or exc}"))

    status = INVALID if errors else PENDING
    if meta:
        meta.pop("id", None)
        meta.pop("rel_path", None)
        meta["lossless"] = is_lossless(meta["codec"])
    with db.connect() as conn:
        conn.execute(
            "UPDATE uploads SET status = ?, sha256 = ?, meta = ?, issues = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, sha, json.dumps(meta) if meta else None, json.dumps(errors + warnings), upload_id),
        )
        row = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        hold = any(i["code"] == "possible_duplicate" for i in live_issues(conn, row))
    log.info("Upload %s (%s) validated: %s", upload_id, row["filename"], status)

    # Admins can skip their own review, but a likely duplicate is still held for a look.
    if status == PENDING and row["auto_publish"] and not hold:
        publish(state, upload_id, row["user_id"])


def _destination(audio_dir: Path, md: dict, suffix: str) -> Path:
    artist = safe_name(md.get("album_artist") or md.get("artist") or "", "Unknown artist")
    album = safe_name(md.get("album") or "", "Singles")
    title = safe_name(md.get("title") or "", "Untitled")
    track_no = str(md.get("track_no") or "").strip()
    stem = f"{int(track_no):02d} {title}" if track_no.isdigit() else title
    folder = audio_dir / UPLOAD_SUBDIR / artist / album
    folder.mkdir(parents=True, exist_ok=True)
    target, n = folder / f"{stem}{suffix}", 1
    while target.exists():
        n += 1
        target = folder / f"{stem} ({n}){suffix}"
    return target


def release_drops(conn, upload_id: str, track_id: str) -> None:
    """A published upload releases the drops linked to it and lands the track in every pre-saver's favorites."""
    track = conn.execute("SELECT album_id FROM tracks WHERE id = ?", (track_id,)).fetchone()
    drops = conn.execute("SELECT id FROM drops WHERE upload_id = ? AND released_at IS NULL", (upload_id,)).fetchall()
    for d in drops:
        conn.execute("UPDATE drops SET track_id = ?, album_id = ?, released_at = CURRENT_TIMESTAMP WHERE id = ?",
                     (track_id, track["album_id"] if track else None, d["id"]))
        conn.execute(
            """INSERT OR IGNORE INTO favorites (user_id, track_id)
               SELECT user_id, ? FROM presaves WHERE drop_id = ? AND user_id IN (SELECT id FROM users)""",
            (track_id, d["id"]),
        )


def publish(state, upload_id: str, reviewer_id: int | None) -> dict:
    """Write edited tags into the file, move it into the library and index it."""
    settings, db = state.settings, state.db
    with _publish_lock:
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        if row is None or row["status"] not in (PENDING, SCHEDULED):
            raise ValueError("Only uploads waiting for review or release can be published")
        src = staged_path(settings, row)
        edits = json.loads(row["edits"] or "{}")
        if edits:
            write_tags(src, edits)
        dest = _destination(settings.audio_dir, effective_metadata(row), src.suffix)
        # Move under a name the scanner ignores, then rename: the library never sees half a file.
        partial = dest.with_name(dest.name + ".partial")
        shutil.move(src, partial)
        os.replace(partial, dest)
        track_id = state.library.index_file(dest)
        rel_path = dest.relative_to(state.library.audio_dir).as_posix()
        with db.connect() as conn:
            conn.execute(
                """UPDATE uploads SET status = ?, track_id = ?, rel_path = ?, published_at = CURRENT_TIMESTAMP,
                       reviewer_id = COALESCE(reviewer_id, ?), reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (PUBLISHED, track_id, rel_path, reviewer_id, upload_id),
            )
            row = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        release_drops(conn, upload_id, track_id)
    log.info("Published upload %s as %s", upload_id, rel_path)
    return row


def takedown(state, track_id: str, actor_id: int) -> None:
    """Remove a track from the library. The file is kept in the removed folder, not deleted."""
    with state.db.connect() as conn:
        row = conn.execute("SELECT rel_path FROM tracks WHERE id = ?", (track_id,)).fetchone()
    if row is None:
        raise LookupError("Track not found")
    path = state.library.resolve(row["rel_path"])
    if path is not None:
        target = state.settings.removed_dir / track_id
        target.mkdir(parents=True, exist_ok=True)
        shutil.move(path, target / path.name)
    state.library.unindex(row["rel_path"])
    with state.db.connect() as conn:
        conn.execute(
            "UPDATE uploads SET status = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE track_id = ?",
            (REMOVED, f"Taken down by user {actor_id}", track_id),
        )
    log.warning("Track %s (%s) taken down by user %s", track_id, row["rel_path"], actor_id)


def discard_file(settings, row) -> None:
    staged_path(settings, row).unlink(missing_ok=True)


class IngestWorker:
    """Background housekeeping: releases scheduled uploads when due and clears abandoned ones."""

    def __init__(self, state, interval: float = 30):
        self.state = state
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="ingest-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.run_once()
            except Exception:
                log.exception("Ingest worker run failed")

    def run_once(self) -> None:
        settings, db = self.state.settings, self.state.db
        with db.connect() as conn:
            due = [r["id"] for r in conn.execute(
                "SELECT id FROM uploads WHERE status = ? AND release_at <= strftime('%Y-%m-%d %H:%M:%S', 'now')",
                (SCHEDULED,))]
            # Transfers nobody has touched for a day, and rejected files after 30 days.
            stale = conn.execute(
                """SELECT * FROM uploads WHERE (status = ? AND updated_at < datetime('now', '-1 day'))
                   OR (status IN (?, ?) AND updated_at < datetime('now', '-30 days'))""",
                (UPLOADING, INVALID, DECLINED),
            ).fetchall()
        for upload_id in due:
            try:
                publish(self.state, upload_id, None)
            except Exception:
                log.exception("Scheduled release of upload %s failed", upload_id)
        for row in stale:
            discard_file(settings, row)
            with db.connect() as conn:
                conn.execute("DELETE FROM uploads WHERE id = ?", (row["id"],))
        if stale:
            log.info("Cleared %d abandoned or rejected uploads", len(stale))


def allowed_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in MIME_BY_EXT
