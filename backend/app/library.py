"""Scans the audio directory and indexes track metadata straight from the files' tags.

Replaces the hand-written tracks.json, which drifted out of sync with the files on disk.
"""

import hashlib
import logging
import os
import re
import threading
from pathlib import Path

import mutagen
from mutagen import id3
from mutagen.aiff import AIFF
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

from .db import Database

log = logging.getLogger(__name__)

MIME_BY_EXT = {
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
}
LOSSLESS_CODECS = {"flac", "wav", "aiff", "alac"}
FOLDER_COVERS = ("cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png")

_FILENAME_NUMBER = re.compile(r"^\s*\d{1,3}\s*[.\-_)]?\s+")


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:16]


def track_id(rel_path: str) -> str:
    return _hash(rel_path.replace("\\", "/"))


def artist_key(album_artist: str, artist: str) -> str:
    """Artist used for browsing: the album artist, falling back to the track artist."""
    return album_artist or artist or "Unknown artist"


def album_id_for(album: str, album_artist: str, artist: str) -> str:
    return _hash(f"album|{artist_key(album_artist, artist).lower()}|{(album or 'Unknown album').lower()}")


def artist_id_for(album_artist: str, artist: str) -> str:
    return _hash(f"artist|{artist_key(album_artist, artist).lower()}")


def _first(tags, *keys) -> str:
    if not tags:
        return ""
    for key in keys:
        try:
            value = tags.get(key)
        except (KeyError, ValueError):
            value = None
        if value:
            value = value[0] if isinstance(value, list) else value
            text = getattr(value, "text", None)
            if text:
                value = text[0]
            if isinstance(value, (bytes, bytearray)):  # MP4 freeform atoms
                value = bytes(value).decode("utf-8", "replace")
            return str(value).strip()
    return ""


# ISO 639-1/639-2 codes -> display names for the languages music is commonly tagged with.
_LANGUAGES = {
    "ta": "Tamil", "tam": "Tamil", "en": "English", "eng": "English", "hi": "Hindi", "hin": "Hindi",
    "te": "Telugu", "tel": "Telugu", "ml": "Malayalam", "mal": "Malayalam", "kn": "Kannada", "kan": "Kannada",
    "bn": "Bengali", "ben": "Bengali", "mr": "Marathi", "mar": "Marathi", "pa": "Punjabi", "pan": "Punjabi",
    "gu": "Gujarati", "guj": "Gujarati", "ur": "Urdu", "urd": "Urdu", "es": "Spanish", "spa": "Spanish",
    "fr": "French", "fra": "French", "fre": "French", "de": "German", "deu": "German", "ger": "German",
    "it": "Italian", "ita": "Italian", "pt": "Portuguese", "por": "Portuguese", "ja": "Japanese", "jpn": "Japanese",
    "ko": "Korean", "kor": "Korean", "zh": "Chinese", "zho": "Chinese", "chi": "Chinese", "ru": "Russian",
    "rus": "Russian", "ar": "Arabic", "ara": "Arabic", "tr": "Turkish", "tur": "Turkish", "id": "Indonesian",
    "ind": "Indonesian", "sv": "Swedish", "swe": "Swedish", "nl": "Dutch", "nld": "Dutch", "dut": "Dutch",
    "zxx": "Instrumental",
}


def normalize_language(text: str) -> str:
    """A language tag as a display name: 'tam', 'ta' and 'Tamil' all give 'Tamil'. Only the first
    value of a multi-value tag counts. Unknown text is returned as written."""
    first = re.split(r"[;,/]", text or "")[0].strip()
    return _LANGUAGES.get(first.lower(), first)


def _int(text: str) -> int | None:
    match = re.match(r"\s*(\d+)", text or "")
    return int(match.group(1)) if match else None


def _gain(text: str) -> float | None:
    match = re.match(r"\s*([-+]?\d+(?:\.\d+)?)", text or "")
    return float(match.group(1)) if match else None


def _title_from_filename(path: Path) -> tuple[str, str]:
    stem = _FILENAME_NUMBER.sub("", path.stem).replace("_", " ").strip()
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return title.strip(), artist.strip()
    return stem, ""


def _codec(audio) -> str:
    if isinstance(audio, FLAC):
        return "flac"
    if isinstance(audio, WAVE):
        return "wav"
    if isinstance(audio, AIFF):
        return "aiff"
    if isinstance(audio, MP4):
        return "alac" if getattr(audio.info, "codec", "") == "alac" else "aac"
    if isinstance(audio, MP3):
        return "mp3"
    if isinstance(audio, OggOpus):
        return "opus"
    if isinstance(audio, OggVorbis):
        return "vorbis"
    return type(audio).__name__.lower()


def _has_embedded_cover(audio) -> bool:
    if isinstance(audio, FLAC):
        return bool(audio.pictures)
    tags = audio.tags
    if not tags:
        return False
    if isinstance(audio, MP4):
        return bool(tags.get("covr"))
    if hasattr(tags, "getall"):  # ID3 (mp3, wav, aiff)
        return bool(tags.getall("APIC"))
    return bool(tags.get("metadata_block_picture"))


LYRIC_TAGS = ("lyrics", "unsyncedlyrics", "unsynced lyrics")
_LRC_LINE = re.compile(r"\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]")


def _sidecar_lrc(path: Path) -> Path | None:
    for candidate in (path.with_suffix(".lrc"), path.with_suffix(".LRC")):
        if candidate.is_file():
            return candidate
    return None


def _embedded_lyrics(audio) -> str:
    tags = audio.tags if audio is not None else None
    if not tags:
        return ""
    if isinstance(audio, MP4):
        return _first(tags, "\xa9lyr")
    if hasattr(tags, "getall"):  # ID3
        uslt = tags.getall("USLT")
        return str(uslt[0].text).strip() if uslt else ""
    return _first(tags, *LYRIC_TAGS)


def parse_lyrics(text: str) -> dict:
    """Split LRC-style '[mm:ss.xx] line' text into timed lines; anything else is plain lyrics."""
    synced = []
    for raw in text.splitlines():
        stamps = list(_LRC_LINE.finditer(raw))
        if not stamps:
            continue
        line = _LRC_LINE.sub("", raw).strip()
        for m in stamps:
            seconds = int(m.group(1)) * 60 + float(m.group(2).replace(":", "."))
            synced.append({"time": round(seconds, 3), "text": line})
    synced.sort(key=lambda l: l["time"])
    plain = "\n".join(_LRC_LINE.sub("", l).strip() for l in text.splitlines()
                      if not re.match(r"^\s*\[[a-z]+:.*\]\s*$", l, re.I)).strip()
    return {"synced": synced or None, "plain": plain}


def read_lyrics(path: Path) -> dict | None:
    sidecar = _sidecar_lrc(path)
    text = ""
    if sidecar:
        text = sidecar.read_text(encoding="utf-8-sig", errors="replace")
    else:
        try:
            text = _embedded_lyrics(mutagen.File(path))
        except Exception:
            text = ""
    return parse_lyrics(text) if text.strip() else None


def _folder_cover(path: Path) -> Path | None:
    for name in FOLDER_COVERS:
        candidate = path.parent / name
        if candidate.is_file():
            return candidate
    return None


def read_metadata(path: Path, rel_path: str, display_name: Path | None = None) -> dict | None:
    """display_name: the file name to derive a title from when the tags have none (staged uploads)."""
    try:
        audio = mutagen.File(path)
    except Exception as exc:  # corrupt files must not abort the scan
        log.warning("Skipping unreadable file %s: %s", rel_path, exc)
        return None
    if audio is None or audio.info is None:
        log.warning("Skipping unrecognised file %s", rel_path)
        return None

    info, tags = audio.info, audio.tags
    if isinstance(audio, MP4):
        get = lambda *k: _first(tags, *k)  # noqa: E731
        title, artist = get("\xa9nam"), get("\xa9ART")
        album, album_artist = get("\xa9alb"), get("aART")
        genre, year = get("\xa9gen"), get("\xa9day")
        mood, language = get("----:com.apple.iTunes:MOOD"), get("----:com.apple.iTunes:LANGUAGE")
        trkn = tags.get("trkn") if tags else None
        disk = tags.get("disk") if tags else None
        track_no = trkn[0][0] if trkn else None
        disc_no = disk[0][0] if disk else None
        rg = lambda k: _gain(get(f"----:com.apple.iTunes:{k}"))  # noqa: E731
    elif tags is not None and hasattr(tags, "getall"):  # ID3
        get = lambda *k: _first(tags, *k)  # noqa: E731
        title, artist, album = get("TIT2"), get("TPE1"), get("TALB")
        album_artist, genre, year = get("TPE2"), get("TCON"), get("TDRC")
        mood, language = get("TMOO"), get("TLAN")
        track_no, disc_no = _int(get("TRCK")), _int(get("TPOS"))
        rg = lambda k: _gain(get(f"TXXX:{k}", f"TXXX:{k.upper()}"))  # noqa: E731
    else:  # Vorbis comments (FLAC, Ogg)
        get = lambda *k: _first(tags, *k)  # noqa: E731
        title, artist, album = get("title"), get("artist"), get("album")
        album_artist, genre, year = get("albumartist", "album artist"), get("genre"), get("date", "year")
        mood, language = get("mood"), get("language")
        track_no, disc_no = _int(get("tracknumber")), _int(get("discnumber"))
        rg = lambda k: _gain(get(k))  # noqa: E731

    if not title:
        title, fallback_artist = _title_from_filename(display_name or path)
        artist = artist or fallback_artist

    stat = path.stat()
    bitrate = getattr(info, "bitrate", 0) or (int(stat.st_size * 8 / info.length) if info.length else 0)
    return {
        "id": track_id(rel_path),
        "rel_path": rel_path,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "title": title,
        "artist": artist,
        "album": album,
        "album_artist": album_artist,
        "genre": genre,
        "mood": mood,
        "language": normalize_language(language),
        "year": year[:4] if year else "",
        "track_no": track_no,
        "disc_no": disc_no,
        "duration": float(info.length or 0),
        "codec": _codec(audio),
        "mime": MIME_BY_EXT.get(path.suffix.lower(), "application/octet-stream"),
        "sample_rate": getattr(info, "sample_rate", None),
        "bit_depth": getattr(info, "bits_per_sample", None) or None,
        "channels": getattr(info, "channels", None),
        "bitrate": bitrate,
        "rg_track_gain": rg("replaygain_track_gain"),
        "rg_track_peak": rg("replaygain_track_peak"),
        "rg_album_gain": rg("replaygain_album_gain"),
        "rg_album_peak": rg("replaygain_album_peak"),
        "has_cover": int(_has_embedded_cover(audio) or _folder_cover(path) is not None),
        "has_lyrics": int(_sidecar_lrc(path) is not None or bool(_embedded_lyrics(audio))),
        "album_id": album_id_for(album, album_artist, artist),
        "artist_id": artist_id_for(album_artist, artist),
    }


def read_cover(path: Path) -> tuple[bytes, str] | None:
    try:
        audio = mutagen.File(path)
    except Exception:
        audio = None
    if audio is not None:
        if isinstance(audio, FLAC) and audio.pictures:
            pic = next((p for p in audio.pictures if p.type == 3), audio.pictures[0])
            return pic.data, pic.mime or "image/jpeg"
        tags = audio.tags
        if isinstance(audio, MP4) and tags and tags.get("covr"):
            cover = tags["covr"][0]
            mime = "image/png" if cover.imageformat == cover.FORMAT_PNG else "image/jpeg"
            return bytes(cover), mime
        if tags is not None and hasattr(tags, "getall"):
            apic = tags.getall("APIC")
            if apic:
                return apic[0].data, apic[0].mime or "image/jpeg"
    folder = _folder_cover(path)
    if folder:
        return folder.read_bytes(), "image/png" if folder.suffix == ".png" else "image/jpeg"
    return None


# Editable tag fields -> (Vorbis comment, ID3 frame, MP4 atom).
TAG_FIELDS = {
    "title": ("title", id3.TIT2, "©nam"),
    "artist": ("artist", id3.TPE1, "©ART"),
    "album": ("album", id3.TALB, "©alb"),
    "album_artist": ("albumartist", id3.TPE2, "aART"),
    "genre": ("genre", id3.TCON, "©gen"),
    "year": ("date", id3.TDRC, "©day"),
    "track_no": ("tracknumber", id3.TRCK, "trkn"),
    "disc_no": ("discnumber", id3.TPOS, "disk"),
}


def write_tags(path: Path, fields: dict) -> None:
    """Write edited metadata into the file itself, so it survives rescans and moves to other players.
    An empty value removes the tag. Audio data is never touched."""
    audio = mutagen.File(path)
    if audio is None:
        raise ValueError("Unrecognised audio file")
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    for name, value in fields.items():
        vorbis, frame, atom = TAG_FIELDS[name]
        empty = value is None or str(value).strip() == ""
        if isinstance(audio, MP4):
            if empty:
                tags.pop(atom, None)
            elif atom in ("trkn", "disk"):
                tags[atom] = [(int(value), 0)]
            else:
                tags[atom] = [str(value)]
        elif hasattr(tags, "getall"):  # ID3: mp3, wav, aiff
            tags.delall(frame.__name__)
            if not empty:
                tags.add(frame(encoding=3, text=[str(value)]))
        else:  # Vorbis comments: flac, ogg, opus
            if empty:
                tags.pop(vorbis, None)
            else:
                tags[vorbis] = [str(value)]
    audio.save()


COLUMNS = (
    "id", "rel_path", "size", "mtime_ns", "title", "artist", "album", "album_artist", "genre", "mood", "language", "year",
    "track_no", "disc_no", "duration", "codec", "mime", "sample_rate", "bit_depth", "channels", "bitrate",
    "rg_track_gain", "rg_track_peak", "rg_album_gain", "rg_album_peak", "has_cover", "has_lyrics",
    "album_id", "artist_id",
)
_UPSERT = (
    f"INSERT INTO tracks ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))}) "
    f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{c}=excluded.{c}' for c in COLUMNS if c != 'id')}"
)


class Library:
    def __init__(self, db: Database, audio_dir: Path):
        self.db = db
        self.audio_dir = audio_dir.resolve()
        self._scan_lock = threading.Lock()
        self.scanning = False

    def resolve(self, rel_path: str) -> Path | None:
        """Map a stored relative path to a file, refusing anything outside the library."""
        path = (self.audio_dir / rel_path).resolve()
        if not path.is_relative_to(self.audio_dir) or not path.is_file():
            return None
        return path

    def index_file(self, path: Path) -> str | None:
        """Index one file without walking the whole library (used when an upload is published)."""
        rel_path = path.resolve().relative_to(self.audio_dir).as_posix()
        meta = read_metadata(path, rel_path)
        if meta is None:
            return None
        with self.db.connect() as conn:
            conn.execute(_UPSERT, [meta[c] for c in COLUMNS])
        return meta["id"]

    def unindex(self, rel_path: str) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM tracks WHERE rel_path = ?", (rel_path,))

    def scan(self) -> dict:
        """Incremental scan: only files whose size or mtime changed are re-read."""
        if not self._scan_lock.acquire(blocking=False):
            return {"status": "already_running"}
        self.scanning = True
        try:
            return self._scan()
        finally:
            self.scanning = False
            self._scan_lock.release()

    def _scan(self) -> dict:
        if not self.audio_dir.is_dir():
            log.error("Audio directory %s does not exist", self.audio_dir)
            return {"status": "missing_audio_dir", "added": 0, "updated": 0, "removed": 0, "total": 0}

        with self.db.connect() as conn:
            known = {r["rel_path"]: (r["size"], r["mtime_ns"]) for r in conn.execute(
                "SELECT rel_path, size, mtime_ns FROM tracks")}

        seen, added, updated = set(), 0, 0
        for root, _dirs, files in os.walk(self.audio_dir):
            for name in files:
                path = Path(root) / name
                if path.suffix.lower() not in MIME_BY_EXT:
                    continue
                rel_path = path.relative_to(self.audio_dir).as_posix()
                seen.add(rel_path)
                stat = path.stat()
                if known.get(rel_path) == (stat.st_size, stat.st_mtime_ns):
                    continue
                meta = read_metadata(path, rel_path)
                if meta is None:
                    continue
                with self.db.connect() as conn:
                    conn.execute(_UPSERT, [meta[c] for c in COLUMNS])
                if rel_path in known:
                    updated += 1
                else:
                    added += 1

        removed = [p for p in known if p not in seen]
        with self.db.connect() as conn:
            conn.executemany("DELETE FROM tracks WHERE rel_path = ?", [(p,) for p in removed])
            total = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        log.info("Library scan: %d added, %d updated, %d removed, %d total", added, updated, len(removed), total)
        return {"status": "ok", "added": added, "updated": updated, "removed": len(removed), "total": total}


def is_lossless(codec: str) -> bool:
    return codec in LOSSLESS_CODECS
