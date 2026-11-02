"""Rooms: listen together. One host drives playback; everyone in the room hears the same song at the
same moment, and can chat and send reactions. Chat and reactions are never stored.

Frames are JSON. The first frame from a client must be {"type": "auth", "token": <access token>}."""

import asyncio
import logging
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field

from .. import hub as hubmod
from ..security import ACCESS, _load_user, current_user, decode_token

log = logging.getLogger("yaapu.rooms")
router = APIRouter(prefix="/api", tags=["rooms"])

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
ROOM_LIFETIME = 24 * 3600
AUTH_TIMEOUT = 10


class RoomBody(BaseModel):
    name: str = Field("", max_length=60)


def _person(conn, user_id: int) -> dict:
    row = conn.execute("SELECT username, display_name, avatar FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"username": row["username"], "display_name": row["display_name"] or row["username"],
            "avatar_url": f"/api/avatars/{row['avatar']}" if row["avatar"] else None}


def _snapshot(conn, row, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    position = row["position"] or 0.0
    if row["playing"]:
        position += max(0.0, now - row["state_at"])
    return {"code": row["code"], "name": row["name"], "host": _person(conn, row["host_id"]),
            "track_id": row["track_id"], "position": round(position, 3), "playing": bool(row["playing"])}


def _open_room(conn, code: str):
    row = conn.execute("SELECT * FROM rooms WHERE code = ? AND ended_at IS NULL", (code.upper(),)).fetchone()
    if row is None or time.time() - row["created"] > ROOM_LIFETIME:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That room has ended or never existed")
    return row


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
async def create_room(body: RoomBody, request: Request, user: dict = Depends(current_user)):
    """Open a room. A host has one open room at a time: starting a new one ends the old one."""
    with request.app.state.db.connect() as conn:
        previous = [r["code"] for r in conn.execute(
            "SELECT code FROM rooms WHERE host_id = ? AND ended_at IS NULL", (user["id"],))]
        conn.execute("UPDATE rooms SET ended_at = ? WHERE host_id = ? AND ended_at IS NULL", (time.time(), user["id"]))
        for _ in range(20):
            code = "".join(secrets.choice(ALPHABET) for _ in range(6))
            if conn.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is None:
                break
        name = body.name.strip() or f"{_person(conn, user['id'])['display_name']}'s room"
        conn.execute("INSERT INTO rooms (code, host_id, name, state_at, created) VALUES (?, ?, ?, ?, ?)",
                     (code, user["id"], name, time.time(), time.time()))
        snapshot = _snapshot(conn, _open_room(conn, code))
    for old in previous:
        await hubmod.HUB.close_room(old, {"type": "ended"})
    return snapshot


@router.get("/rooms/{code}")
def get_room(code: str, request: Request, _user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        return _snapshot(conn, _open_room(conn, code))


@router.delete("/rooms/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def end_room(code: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _open_room(conn, code)
        if row["host_id"] != user["id"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host can end the room")
        conn.execute("UPDATE rooms SET ended_at = ? WHERE code = ?", (time.time(), row["code"]))
    await hubmod.HUB.close_room(row["code"], {"type": "ended"})


async def _authenticate(ws: WebSocket) -> dict | None:
    """The first frame must be auth. Returns the user, or None after closing the socket."""
    try:
        frame = await asyncio.wait_for(ws.receive_json(), AUTH_TIMEOUT)
        if not isinstance(frame, dict) or frame.get("type") != "auth":
            raise ValueError("expected auth first")
        payload = decode_token(ws.app.state.settings.secret_key, str(frame.get("token", "")), ACCESS)
        return _load_user(ws, payload)
    except (HTTPException, ValueError, asyncio.TimeoutError, WebSocketDisconnect, KeyError, TypeError):
        try:
            await ws.close(code=4401)
        except Exception:
            pass
        return None


@router.websocket("/rooms/{code}/ws")
async def room_socket(ws: WebSocket, code: str):
    await ws.accept()
    user = await _authenticate(ws)
    if user is None:
        return
    code = code.upper()
    db = ws.app.state.db
    with db.connect() as conn:
        try:
            room = _open_room(conn, code)
        except HTTPException:
            await ws.close(code=4404)
            return
        person = _person(conn, user["id"])
    is_host = room["host_id"] == user["id"]
    if not is_host and hubmod.HUB.count(code) >= hubmod.MAX_LISTENERS:
        await ws.close(code=4429)
        return

    conn_ = hubmod.Conn(ws=ws, person=person, is_host=is_host)
    hubmod.HUB.add(code, conn_)
    try:
        with db.connect() as conn:
            snapshot = _snapshot(conn, _open_room(conn, code))
        await hubmod.HUB.send(conn_, {"type": "state", "room": snapshot, "members": hubmod.HUB.members(code),
                                      "you": {"username": person["username"], "is_host": is_host},
                                      "server_time": time.time()})
        await hubmod.HUB.broadcast(code, {"type": "members", "members": hubmod.HUB.members(code)}, skip=conn_)
        while True:
            frame = await ws.receive_json()
            await _handle(db, code, conn_, frame)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("room socket closed", exc_info=True)
    finally:
        hubmod.HUB.remove(code, conn_)
        await hubmod.HUB.broadcast(code, {"type": "members", "members": hubmod.HUB.members(code)})


async def _handle(db, code: str, conn_: "hubmod.Conn", frame) -> None:
    hub = hubmod.HUB
    if not isinstance(frame, dict):
        return await hub.send(conn_, {"type": "error", "message": "Unreadable message"})
    kind, now = frame.get("type"), time.monotonic()

    if kind == "play":
        if not conn_.is_host:
            return await hub.send(conn_, {"type": "error", "message": "Only the host controls playback"})
        track_id, position, playing = frame.get("track_id"), frame.get("position"), frame.get("playing")
        if (not isinstance(track_id, str) or not isinstance(position, (int, float)) or isinstance(position, bool)
                or position < 0 or not isinstance(playing, bool)):
            return await hub.send(conn_, {"type": "error", "message": "Bad playback state"})
        with db.connect() as conn:
            if conn.execute("SELECT 1 FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
                return await hub.send(conn_, {"type": "error", "message": "That track is not in the library"})
            at = time.time()
            conn.execute("UPDATE rooms SET track_id = ?, position = ?, playing = ?, state_at = ? WHERE code = ?",
                         (track_id, float(position), int(playing), at, code))
        await hub.broadcast(code, {"type": "sync", "track_id": track_id, "position": position, "playing": playing,
                                   "server_time": at}, skip=conn_)

    elif kind == "chat":
        text = frame.get("text")
        if not isinstance(text, str) or not text.strip() or len(text.strip()) > hubmod.CHAT_MAX:
            return await hub.send(conn_, {"type": "error", "message": f"Messages are 1 to {hubmod.CHAT_MAX} characters"})
        if now - conn_.last_chat < hubmod.CHAT_INTERVAL:
            return await hub.send(conn_, {"type": "error", "message": "Slow down a little"})
        conn_.last_chat = now
        await hub.broadcast(code, {"type": "chat", "from": conn_.person, "text": text.strip(), "at": time.time()})

    elif kind == "react":
        emoji = frame.get("emoji")
        if emoji not in hubmod.EMOJI:
            return await hub.send(conn_, {"type": "error", "message": "Pick one of the reactions"})
        if now - conn_.last_react < hubmod.REACT_INTERVAL:
            return
        conn_.last_react = now
        await hub.broadcast(code, {"type": "react", "from": conn_.person, "emoji": emoji})

    else:
        await hub.send(conn_, {"type": "error", "message": "Unknown message type"})
