"""Subsonic / OpenSubsonic API (subset) so native apps can use this server.

Clients such as Symfonium, DSub, Tempo, Feishin or play:Sub connect with the user's
*app password* (Settings → Subsonic apps), never the account password. Audio is always
served as the original file: `format`/`maxBitRate` transcoding requests are ignored.
"""

import hashlib
import hmac
import logging
import random
import xml.etree.ElementTree as ET
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from .. import queries
from ..library import read_lyrics
from ..security import decrypt_app_password, throttle
from .library import _file, _row, cover_response
from .me import _playlist_ids, _playlist_row, _set_tracks, playlist_summary, record_play

router = APIRouter(tags=["subsonic"], include_in_schema=False)
log = logging.getLogger(__name__)

API_VERSION = "1.16.1"
XMLNS = "http://subsonic.org/restapi"


class SubsonicError(Exception):
    def __init__(self, code: int, message: str):
        self.code, self.message = code, message


# ---- request / response plumbing ---------------------------------------------------

class Params:
    def __init__(self, items: list[tuple[str, str]]):
        self.items = items

    def get(self, key: str, default=None):
        for k, v in self.items:
            if k == key:
                return v
        return default

    def all(self, key: str) -> list[str]:
        return [v for k, v in self.items if k == key]

    def require(self, key: str) -> str:
        value = self.get(key)
        if value in (None, ""):
            raise SubsonicError(10, f"Required parameter is missing: {key}")
        return value

    def int(self, key: str, default: int, lo: int = 0, hi: int = 10_000) -> int:
        try:
            return max(lo, min(hi, int(self.get(key, default))))
        except (TypeError, ValueError):
            return default


def _scalar(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _to_xml(name: str, value: dict) -> ET.Element:
    el = ET.Element(name)
    for k, v in value.items():
        if v is None:
            continue
        if isinstance(v, dict):
            el.append(_to_xml(k, v))
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    el.append(_to_xml(k, item))
                else:
                    ET.SubElement(el, k).text = _scalar(item)
        elif k == "value":
            el.text = _scalar(v)
        else:
            el.set(k, _scalar(v))
    return el


def _envelope(status: str, payload: dict) -> dict:
    return {"status": status, "version": API_VERSION, "type": "angelmusic", "serverVersion": "1.1.0",
            "openSubsonic": True, **payload}


def _respond(params: Params, status: str, payload: dict) -> Response:
    body = _envelope(status, payload)
    if params.get("f") in ("json", "jsonp"):
        return JSONResponse({"subsonic-response": body})
    root = _to_xml("subsonic-response", body)
    root.set("xmlns", XMLNS)
    return Response(b'<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root), media_type="application/xml")


async def _params(request: Request) -> Params:
    items = list(request.query_params.multi_items())
    if request.method == "POST":
        form = await request.form()
        items += [(k, v) for k, v in form.multi_items() if isinstance(v, str)]
    return Params(items)


def _authenticate(request: Request, p: Params) -> dict:
    username = p.require("u")
    key = f"{request.client.host if request.client else '?'}:{username.lower()}"
    if throttle.is_blocked(key):
        raise SubsonicError(40, "Too many failed attempts, try again later")
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    secret = decrypt_app_password(request.app.state.settings.secret_key, row["app_password_enc"]) if row else None

    ok = False
    if secret and p.get("t") and p.get("s"):
        expected = hashlib.md5((secret + p.get("s")).encode()).hexdigest()
        ok = hmac.compare_digest(expected, p.get("t").lower())
    elif secret and p.get("p"):
        given = p.get("p")
        if given.startswith("enc:"):
            try:
                given = bytes.fromhex(given[4:]).decode()
            except ValueError:
                given = ""
        ok = hmac.compare_digest(given.encode(), secret.encode())
    elif not (p.get("t") or p.get("p")):
        raise SubsonicError(10, "Required parameter is missing: p or t+s")

    if not ok:
        throttle.fail(key)
        raise SubsonicError(40, "Wrong username or app password (create one under Settings → Subsonic apps)")
    throttle.reset(key)
    return {"id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"])}


# ---- object mappers ----------------------------------------------------------------

def _iso(ts: str | None) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace(" ", "T")).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def _year(y: str) -> int | None:
    return int(y) if y and y[:4].isdigit() else None


def _song(t: dict) -> dict:
    suffix = t["mime"].split("/")[-1].replace("mpeg", "mp3").replace("mp4", "m4a")
    return {
        "id": t["id"], "parent": f"al-{t['album_id']}", "isDir": False, "title": t["title"],
        "album": t["album"], "artist": t["artist"], "track": t["track_no"], "discNumber": t["disc_no"],
        "year": _year(t["year"]), "genre": t["genre"] or None, "coverArt": t["id"] if t["has_cover"] else None,
        "size": t["size"], "contentType": t["mime"], "suffix": suffix, "duration": int(round(t["duration"])),
        "bitRate": int((t["bitrate"] or 0) / 1000), "path": f"{t['album_artist'] or t['artist']}/{t['album']}/{t['title']}.{suffix}",
        "albumId": f"al-{t['album_id']}", "artistId": f"ar-{t['artist_id']}", "type": "music", "isVideo": False,
        "playCount": t["play_count"], "played": _iso(t["last_played"]), "starred": _iso(t["starred_at"]),
        "created": _iso(t["added_at"]), "samplingRate": t["sample_rate"], "bitDepth": t["bit_depth"],
        "channelCount": t["channels"], "mediaType": "song",
        "replayGain": {"trackGain": t["rg_track_gain"], "albumGain": t["rg_album_gain"],
                       "trackPeak": t["rg_track_peak"], "albumPeak": t["rg_album_peak"]},
    }


def _album(a: dict, songs: list[dict] | None = None) -> dict:
    out = {
        "id": f"al-{a['id']}", "parent": f"ar-{a['artist_id']}", "isDir": True, "name": a["name"],
        "title": a["name"], "album": a["name"], "artist": a["artist"], "artistId": f"ar-{a['artist_id']}",
        "coverArt": f"al-{a['id']}" if a["cover_track_id"] else None, "songCount": a["track_count"],
        "duration": int(round(a["duration"])), "playCount": a["play_count"], "created": _iso(a["added_at"]),
        "year": _year(a["year"]), "genre": a["genre"] or None, "mediaType": "album",
    }
    if songs is not None:
        out["song"] = [_song(t) for t in songs]
    return out


def _artist(ar: dict, albums: list[dict] | None = None) -> dict:
    out = {"id": f"ar-{ar['id']}", "name": ar["name"], "albumCount": ar["album_count"],
           "coverArt": f"ar-{ar['id']}" if ar["cover_track_id"] else None}
    if albums is not None:
        out["album"] = [_album(a) for a in albums]
    return out


def _playlist(pl: dict, owner: str, songs: list[dict] | None = None) -> dict:
    out = {"id": str(pl["id"]), "name": pl["name"], "comment": pl["comment"] or None, "owner": owner,
           "public": False, "songCount": pl["track_count"], "duration": int(round(pl["duration"])),
           "created": _iso(pl["created_at"]), "changed": _iso(pl["updated_at"]),
           "coverArt": f"pl-{pl['id']}" if pl["cover_track_id"] else None}
    if songs is not None:
        out["entry"] = [_song(t) for t in songs]
    return out


def _index(artist_list: list[dict]) -> list[dict]:
    groups: dict[str, list] = {}
    for ar in artist_list:
        first = ar["name"][:1].upper()
        groups.setdefault(first if first.isalpha() else "#", []).append(_artist(ar))
    return [{"name": k, "artist": v} for k, v in sorted(groups.items())]


def _strip(prefix: str, value: str) -> str:
    return value[len(prefix):] if value.startswith(prefix) else value


# ---- handlers ------------------------------------------------------------------------
# Each takes (request, params, user, conn) and returns a payload dict or a Response.

def _library(conn, user):
    tracks = queries.tracks(conn, user["id"])
    albums = queries.albums(tracks)
    return tracks, albums, queries.artists(albums)


def h_ping(*_):
    return {}


def h_license(*_):
    return {"license": {"valid": True, "email": "", "licenseExpires": "2099-12-31T00:00:00Z"}}


def h_extensions(*_):
    return {"openSubsonicExtensions": [{"name": "songLyrics", "versions": [1]}, {"name": "formPost", "versions": [1]}]}


def h_music_folders(*_):
    return {"musicFolders": {"musicFolder": [{"id": 1, "name": "Music"}]}}


def h_indexes(req, p, user, conn):
    _, _, artists = _library(conn, user)
    return {"indexes": {"lastModified": 0, "ignoredArticles": "", "index": _index(artists)}}


def h_artists(req, p, user, conn):
    _, _, artists = _library(conn, user)
    return {"artists": {"ignoredArticles": "", "index": _index(artists)}}


def h_artist(req, p, user, conn):
    artist_id = _strip("ar-", p.require("id"))
    _, albums, artists = _library(conn, user)
    ar = next((a for a in artists if a["id"] == artist_id), None)
    if ar is None:
        raise SubsonicError(70, "Artist not found")
    return {"artist": _artist(ar, [a for a in albums if a["artist_id"] == artist_id])}


def h_album(req, p, user, conn):
    album_id = _strip("al-", p.require("id"))
    tracks = queries.tracks(conn, user["id"], "t.album_id = :a", {"a": album_id})
    if not tracks:
        raise SubsonicError(70, "Album not found")
    return {"album": _album(queries.albums(tracks)[0], tracks)}


def h_music_directory(req, p, user, conn):
    raw = p.require("id")
    if raw.startswith("al-"):
        album = h_album(req, p, user, conn)["album"]
        return {"directory": {"id": raw, "name": album["name"], "parent": album["parent"], "child": album["song"]}}
    artist = h_artist(req, Params([("id", raw)]), user, conn)["artist"]
    return {"directory": {"id": artist["id"], "name": artist["name"], "child": artist.get("album", [])}}


def h_song(req, p, user, conn):
    t = queries.track(conn, user["id"], p.require("id"))
    if t is None:
        raise SubsonicError(70, "Song not found")
    return {"song": _song(t)}


def _album_list(req, p, user, conn):
    _, albums, _ = _library(conn, user)
    kind = p.require("type")
    size, offset = p.int("size", 10, 1, 500), p.int("offset", 0, 0, 1_000_000)
    if kind == "random":
        albums = random.sample(albums, len(albums))
    elif kind == "newest":
        albums.sort(key=lambda a: a["added_at"], reverse=True)
    elif kind in ("frequent", "highest"):
        albums = sorted((a for a in albums if a["play_count"]), key=lambda a: a["play_count"], reverse=True)
    elif kind == "recent":
        last = {r["album_id"]: r["last"] for r in conn.execute(
            "SELECT t.album_id, MAX(p.id) AS last FROM plays p JOIN tracks t ON t.id = p.track_id "
            "WHERE p.user_id = ? GROUP BY t.album_id", (user["id"],))}
        albums = sorted((a for a in albums if a["id"] in last), key=lambda a: last[a["id"]], reverse=True)
    elif kind == "alphabeticalByName":
        albums.sort(key=lambda a: a["name"].lower())
    elif kind == "alphabeticalByArtist":
        albums.sort(key=lambda a: (a["artist"].lower(), a["name"].lower()))
    elif kind == "starred":
        albums = [a for a in albums if a["favorite_count"]]
    elif kind == "byYear":
        lo, hi = p.int("fromYear", 0, 0, 9999), p.int("toYear", 9999, 0, 9999)
        albums = [a for a in albums if _year(a["year"]) and min(lo, hi) <= _year(a["year"]) <= max(lo, hi)]
        albums.sort(key=lambda a: _year(a["year"]), reverse=lo > hi)
    elif kind == "byGenre":
        genre = p.require("genre").lower()
        albums = [a for a in albums if a["genre"].lower() == genre]
    else:
        raise SubsonicError(0, f"Unknown album list type: {kind}")
    return [_album(a) for a in albums[offset:offset + size]]


def h_album_list2(req, p, user, conn):
    return {"albumList2": {"album": _album_list(req, p, user, conn)}}


def h_album_list(req, p, user, conn):
    return {"albumList": {"album": _album_list(req, p, user, conn)}}


def h_random_songs(req, p, user, conn):
    tracks = queries.tracks(conn, user["id"])
    if p.get("genre"):
        tracks = [t for t in tracks if t["genre"].lower() == p.get("genre").lower()]
    lo, hi = p.int("fromYear", 0, 0, 9999), p.int("toYear", 9999, 0, 9999)
    if p.get("fromYear") or p.get("toYear"):
        tracks = [t for t in tracks if _year(t["year"]) and lo <= _year(t["year"]) <= hi]
    size = p.int("size", 10, 1, 500)
    return {"randomSongs": {"song": [_song(t) for t in random.sample(tracks, min(size, len(tracks)))]}}


def _search(req, p, user, conn):
    q = (p.get("query") or "").strip().strip('"').lower()
    tracks, albums, artists = _library(conn, user)
    match = lambda *fields: not q or any(q in (f or "").lower() for f in fields)  # noqa: E731
    page = lambda items, kind, default: items[p.int(f"{kind}Offset", 0, 0, 10**6):][:p.int(f"{kind}Count", default, 0, 10**6)]  # noqa: E731
    return (
        [_artist(a) for a in page([a for a in artists if match(a["name"])], "artist", 20)],
        [_album(a) for a in page([a for a in albums if match(a["name"], a["artist"])], "album", 20)],
        [_song(t) for t in page([t for t in tracks if match(t["title"], t["artist"], t["album"])], "song", 20)],
    )


def h_search3(req, p, user, conn):
    artists, albums, songs = _search(req, p, user, conn)
    return {"searchResult3": {"artist": artists, "album": albums, "song": songs}}


def h_search2(req, p, user, conn):
    artists, albums, songs = _search(req, p, user, conn)
    return {"searchResult2": {"artist": artists, "album": albums, "song": songs}}


def _starred(req, p, user, conn):
    tracks = queries.tracks(conn, user["id"], "f.created_at IS NOT NULL", order="ORDER BY f.created_at DESC")
    return {"artist": [], "album": [], "song": [_song(t) for t in tracks]}


def h_starred2(req, p, user, conn):
    return {"starred2": _starred(req, p, user, conn)}


def h_starred(req, p, user, conn):
    return {"starred": _starred(req, p, user, conn)}


def _song_ids_for_star(conn, p: Params) -> list[str]:
    ids = list(p.all("id"))
    # Starring an album or artist favourites its tracks (favourites are track-level here).
    for album_id in p.all("albumId") + [i for i in ids if i.startswith("al-")]:
        ids += [r["id"] for r in conn.execute("SELECT id FROM tracks WHERE album_id = ?", (_strip("al-", album_id),))]
    for artist_id in p.all("artistId") + [i for i in ids if i.startswith("ar-")]:
        ids += [r["id"] for r in conn.execute("SELECT id FROM tracks WHERE artist_id = ?", (_strip("ar-", artist_id),))]
    return [i for i in ids if not i.startswith(("al-", "ar-"))]


def h_star(req, p, user, conn):
    conn.executemany("INSERT OR IGNORE INTO favorites (user_id, track_id) SELECT ?, id FROM tracks WHERE id = ?",
                     [(user["id"], i) for i in _song_ids_for_star(conn, p)])
    return {}


def h_unstar(req, p, user, conn):
    conn.executemany("DELETE FROM favorites WHERE user_id = ? AND track_id = ?",
                     [(user["id"], i) for i in _song_ids_for_star(conn, p)])
    return {}


def h_scrobble(req, p, user, conn):
    if p.get("submission", "true") != "false":
        for track_id in p.all("id"):
            try:
                record_play(conn, user["id"], track_id)
            except HTTPException:
                pass
    return {}


def _owned_playlist(conn, user, raw_id: str):
    try:
        return _playlist_row(conn, user["id"], int(_strip("pl-", raw_id)))
    except (ValueError, HTTPException):
        raise SubsonicError(70, "Playlist not found")


def h_playlists(req, p, user, conn):
    rows = conn.execute("SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC", (user["id"],)).fetchall()
    return {"playlists": {"playlist": [_playlist(playlist_summary(conn, r), user["username"]) for r in rows]}}


def h_playlist(req, p, user, conn):
    row = _owned_playlist(conn, user, p.require("id"))
    songs = queries.tracks_by_ids(conn, user["id"], _playlist_ids(conn, row["id"]))
    return {"playlist": _playlist(playlist_summary(conn, row), user["username"], songs)}


def h_create_playlist(req, p, user, conn):
    if p.get("playlistId"):
        row = _owned_playlist(conn, user, p.get("playlistId"))
        playlist_id = row["id"]
    else:
        playlist_id = conn.execute("INSERT INTO playlists (user_id, name) VALUES (?, ?)",
                                   (user["id"], p.require("name"))).lastrowid
    if p.get("name") and p.get("playlistId"):
        conn.execute("UPDATE playlists SET name = ? WHERE id = ?", (p.get("name"), playlist_id))
    _set_tracks(conn, playlist_id, p.all("songId"))
    return h_playlist(req, Params([("id", str(playlist_id))]), user, conn)


def h_update_playlist(req, p, user, conn):
    row = _owned_playlist(conn, user, p.require("playlistId"))
    if p.get("name"):
        conn.execute("UPDATE playlists SET name = ? WHERE id = ?", (p.get("name"), row["id"]))
    if p.get("comment") is not None:
        conn.execute("UPDATE playlists SET comment = ? WHERE id = ?", (p.get("comment"), row["id"]))
    ids = _playlist_ids(conn, row["id"])
    remove = {int(i) for i in p.all("songIndexToRemove") if i.isdigit()}
    ids = [t for n, t in enumerate(ids) if n not in remove] + p.all("songIdToAdd")
    _set_tracks(conn, row["id"], ids)
    return {}


def h_delete_playlist(req, p, user, conn):
    row = _owned_playlist(conn, user, p.require("id"))
    conn.execute("DELETE FROM playlists WHERE id = ?", (row["id"],))
    return {}


def h_genres(req, p, user, conn):
    rows = conn.execute("SELECT genre, COUNT(*) AS songs, COUNT(DISTINCT album_id) AS albums FROM tracks "
                        "WHERE genre != '' GROUP BY genre COLLATE NOCASE ORDER BY genre COLLATE NOCASE").fetchall()
    return {"genres": {"genre": [{"value": r["genre"], "songCount": r["songs"], "albumCount": r["albums"]} for r in rows]}}


def h_songs_by_genre(req, p, user, conn):
    tracks = queries.tracks(conn, user["id"], "t.genre = :g COLLATE NOCASE", {"g": p.require("genre")})
    offset, count = p.int("offset", 0, 0, 10**6), p.int("count", 10, 1, 500)
    return {"songsByGenre": {"song": [_song(t) for t in tracks[offset:offset + count]]}}


def h_lyrics(req, p, user, conn):
    artist, title = (p.get("artist") or "").lower(), (p.get("title") or "").lower()
    row = conn.execute("SELECT * FROM tracks WHERE lower(title) = ? AND (? = '' OR lower(artist) LIKE ?) LIMIT 1",
                       (title, artist, f"%{artist}%")).fetchone()
    lyrics = read_lyrics(_file(req, row)) if row else None
    if not lyrics:
        return {"lyrics": {}}
    return {"lyrics": {"artist": row["artist"], "title": row["title"], "value": lyrics["plain"]}}


def h_lyrics_by_song(req, p, user, conn):
    row = conn.execute("SELECT * FROM tracks WHERE id = ?", (p.require("id"),)).fetchone()
    if row is None:
        raise SubsonicError(70, "Song not found")
    lyrics = read_lyrics(_file(req, row))
    if not lyrics:
        return {"lyricsList": {"structuredLyrics": []}}
    lines = ([{"start": int(l["time"] * 1000), "value": l["text"]} for l in lyrics["synced"]] if lyrics["synced"]
             else [{"value": l} for l in lyrics["plain"].splitlines()])
    return {"lyricsList": {"structuredLyrics": [{"displayArtist": row["artist"], "displayTitle": row["title"],
                                                 "lang": "und", "synced": bool(lyrics["synced"]), "line": lines}]}}


def h_user(req, p, user, conn):
    return {"user": {"username": user["username"], "scrobblingEnabled": True, "adminRole": user["is_admin"],
                     "settingsRole": True, "downloadRole": True, "uploadRole": False, "playlistRole": True,
                     "coverArtRole": True, "commentRole": False, "podcastRole": False, "streamRole": True,
                     "jukeboxRole": False, "shareRole": False, "videoConversionRole": False, "folder": [1]}}


def h_scan_status(req, p, user, conn):
    count = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    return {"scanStatus": {"scanning": req.app.state.library.scanning, "count": count}}


def h_empty(key: str, inner: dict | None = None):
    return lambda *_: {key: inner or {}}


HANDLERS = {
    "ping": h_ping,
    "getLicense": h_license,
    "getOpenSubsonicExtensions": h_extensions,
    "getMusicFolders": h_music_folders,
    "getIndexes": h_indexes,
    "getArtists": h_artists,
    "getArtist": h_artist,
    "getAlbum": h_album,
    "getMusicDirectory": h_music_directory,
    "getSong": h_song,
    "getAlbumList": h_album_list,
    "getAlbumList2": h_album_list2,
    "getRandomSongs": h_random_songs,
    "search2": h_search2,
    "search3": h_search3,
    "getStarred": h_starred,
    "getStarred2": h_starred2,
    "star": h_star,
    "unstar": h_unstar,
    "scrobble": h_scrobble,
    "getPlaylists": h_playlists,
    "getPlaylist": h_playlist,
    "createPlaylist": h_create_playlist,
    "updatePlaylist": h_update_playlist,
    "deletePlaylist": h_delete_playlist,
    "getGenres": h_genres,
    "getSongsByGenre": h_songs_by_genre,
    "getLyrics": h_lyrics,
    "getLyricsBySongId": h_lyrics_by_song,
    "getUser": h_user,
    "getScanStatus": h_scan_status,
    "getNowPlaying": h_empty("nowPlaying"),
    "getArtistInfo": h_empty("artistInfo"),
    "getArtistInfo2": h_empty("artistInfo2"),
    "getAlbumInfo": h_empty("albumInfo"),
    "getAlbumInfo2": h_empty("albumInfo"),
    "getSimilarSongs": h_empty("similarSongs"),
    "getSimilarSongs2": h_empty("similarSongs2"),
    "getTopSongs": h_empty("topSongs"),
    "getPlayQueue": h_empty("playQueue"),
    "savePlayQueue": h_ping,
    "getBookmarks": h_empty("bookmarks"),
    "getShares": h_empty("shares"),
    "getPodcasts": h_empty("podcasts"),
    "getInternetRadioStations": h_empty("internetRadioStations"),
}


def _media(req, p, user, method):
    if method in ("stream", "download"):
        row = _row(req, p.require("id"))
        path = _file(req, row)
        return FileResponse(path, media_type=row["mime"], filename=path.name if method == "download" else None,
                            headers={"Cache-Control": "private, max-age=86400"})
    # getCoverArt: ids may be a track, album (al-), artist (ar-) or playlist (pl-)
    raw = p.require("id")
    with req.app.state.db.connect() as conn:
        if raw.startswith("al-"):
            row = conn.execute("SELECT * FROM tracks WHERE album_id = ? AND has_cover ORDER BY disc_no, track_no LIMIT 1",
                               (raw[3:],)).fetchone()
        elif raw.startswith("ar-"):
            row = conn.execute("SELECT * FROM tracks WHERE artist_id = ? AND has_cover LIMIT 1", (raw[3:],)).fetchone()
        elif raw.startswith("pl-"):
            row = conn.execute("SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id "
                               "JOIN playlists pl ON pl.id = pt.playlist_id WHERE pl.id = ? AND pl.user_id = ? "
                               "AND t.has_cover ORDER BY pt.position LIMIT 1",
                               (int(raw[3:]) if raw[3:].isdigit() else -1, user["id"])).fetchone()
        else:
            row = conn.execute("SELECT * FROM tracks WHERE id = ?", (raw,)).fetchone()
    if row is None:
        raise HTTPException(404, "No cover art")
    return cover_response(req, row)


@router.api_route("/rest/{method}", methods=["GET", "POST"])
async def subsonic(method: str, request: Request):
    method = method.removesuffix(".view")
    p = await _params(request)
    try:
        user = await run_in_threadpool(_authenticate, request, p)
        if method in ("stream", "download", "getCoverArt"):
            try:
                return await run_in_threadpool(_media, request, p, user, method)
            except HTTPException as exc:
                raise SubsonicError(70, str(exc.detail))
        if method == "startScan":
            if not user["is_admin"]:
                raise SubsonicError(50, "Admin only")
            await run_in_threadpool(request.app.state.library.scan)
            method = "getScanStatus"
        handler = HANDLERS.get(method)
        if handler is None:
            raise SubsonicError(0, f"Method not supported: {method}")

        def run():
            with request.app.state.db.connect() as conn:
                return handler(request, p, user, conn)

        return _respond(p, "ok", await run_in_threadpool(run))
    except SubsonicError as err:
        return _respond(p, "failed", {"error": {"code": err.code, "message": err.message}})
