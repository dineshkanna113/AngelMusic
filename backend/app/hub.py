"""In-memory hub for Rooms: who is connected to which room, and fan-out of messages.

This lives in one process. Running more than one server needs a shared channel (for example
Redis pub/sub) behind `broadcast`; room state itself is already in the database."""

import asyncio
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

log = logging.getLogger("yaapu.rooms")

MAX_LISTENERS = 50
CHAT_INTERVAL = 1.0  # seconds between chat messages from one connection
REACT_INTERVAL = 0.25
CHAT_MAX = 280
EMOJI = ("🔥", "💖", "😮", "🎶", "👏", "🙌", "😂", "🥹")


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    person: dict
    is_host: bool
    last_chat: float = 0.0
    last_react: float = 0.0
    sent: int = field(default=0, repr=False)


class RoomHub:
    def __init__(self) -> None:
        self.rooms: dict[str, list[Conn]] = {}

    def count(self, code: str) -> int:
        return len(self.rooms.get(code, []))

    def add(self, code: str, conn: Conn) -> None:
        self.rooms.setdefault(code, []).append(conn)

    def remove(self, code: str, conn: Conn) -> None:
        conns = self.rooms.get(code, [])
        if conn in conns:
            conns.remove(conn)
        if not conns:
            self.rooms.pop(code, None)

    def members(self, code: str) -> list[dict]:
        """People in the room, one entry each even if they have two tabs open."""
        seen, out = set(), []
        for c in self.rooms.get(code, []):
            if c.person["username"] not in seen:
                seen.add(c.person["username"])
                out.append({**c.person, "is_host": c.is_host})
        return out

    async def send(self, conn: Conn, message: dict) -> None:
        try:
            await conn.ws.send_json(message)
        except Exception:  # a dropped socket is cleaned up by its own receive loop
            log.debug("send failed", exc_info=True)

    async def broadcast(self, code: str, message: dict, skip: Conn | None = None) -> None:
        await asyncio.gather(*(self.send(c, message) for c in list(self.rooms.get(code, [])) if c is not skip))

    async def close_room(self, code: str, message: dict) -> None:
        conns = list(self.rooms.get(code, []))
        await asyncio.gather(*(self.send(c, message) for c in conns))
        for c in conns:
            try:
                await c.ws.close(code=1000)
            except Exception:
                pass
        self.rooms.pop(code, None)


HUB = RoomHub()
