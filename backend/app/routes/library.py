from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse

from .. import queries
from ..http import etag_json
from ..library import read_cover, read_lyrics
from ..security import admin_user, current_user, stream_user

router = APIRouter(prefix="/api", tags=["library"])


def _row(request: Request, track_id: str):
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Track not found")
    return row


def _file(request: Request, row) -> Path:
    path = request.app.state.library.resolve(row["rel_path"])
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio file missing; rescan the library")
    return path


@router.get("/tracks")
def list_tracks(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        tracks = queries.tracks(conn, user["id"])
    return etag_json(request, {"tracks": tracks, "scanning": request.app.state.library.scanning})


@router.get("/tracks/{track_id}")
def get_track(track_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        track = queries.track(conn, user["id"], track_id)
    if track is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Track not found")
    return track


@router.get("/albums")
def list_albums(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        return etag_json(request, {"albums": queries.albums(queries.tracks(conn, user["id"]))})


@router.get("/artists")
def list_artists(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        return etag_json(request, {"artists": queries.artists(queries.albums(queries.tracks(conn, user["id"])))})


@router.get("/tracks/{track_id}/lyrics")
def lyrics(track_id: str, request: Request, _user: dict = Depends(current_user)):
    lyrics = read_lyrics(_file(request, _row(request, track_id)))
    if lyrics is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No lyrics for this track")
    return lyrics


@router.post("/library/rescan", status_code=status.HTTP_202_ACCEPTED)
def rescan(request: Request, background: BackgroundTasks, _admin: dict = Depends(admin_user)):
    background.add_task(request.app.state.library.scan)
    return {"status": "scheduled"}


@router.get("/stream/{track_id}")
def stream(track_id: str, request: Request, _user: dict = Depends(stream_user)):
    """Serves the original file untouched (no transcoding), with HTTP Range support so
    playback starts after the first chunk and seeking jumps straight to the byte offset."""
    row = _row(request, track_id)
    return FileResponse(_file(request, row), media_type=row["mime"], headers={"Cache-Control": "private, max-age=86400"})


@router.get("/download/{track_id}")
def download(track_id: str, request: Request, _user: dict = Depends(stream_user)):
    row = _row(request, track_id)
    path = _file(request, row)
    return FileResponse(path, media_type=row["mime"], filename=path.name)


@lru_cache(maxsize=128)
def _cover(path: str, _mtime_ns: int) -> tuple[bytes, str] | None:
    return read_cover(Path(path))


def cover_response(request: Request, row) -> Response:
    etag = f'"{row["id"]}-{row["mtime_ns"]}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    found = _cover(str(_file(request, row)), row["mtime_ns"])
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No cover art")
    data, mime = found
    return Response(data, media_type=mime, headers={"ETag": etag, "Cache-Control": "private, max-age=604800"})


@router.get("/tracks/{track_id}/cover")
def cover(track_id: str, request: Request, _user: dict = Depends(stream_user)):
    return cover_response(request, _row(request, track_id))
