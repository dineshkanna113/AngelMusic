import pytest
from starlette.websockets import WebSocketDisconnect

from app import hub
from .conftest import auth_headers, login_headers, tracks


@pytest.fixture
def rooms(client):
    admin = auth_headers(client)
    for name in ("host", "fan", "guest"):
        client.post("/api/users", json={"username": name, "password": f"{name}-pass-1"}, headers=admin)
    h = {n: login_headers(client, n, f"{n}-pass-1") for n in ("host", "fan", "guest")}
    tok = {n: v["Authorization"].split()[1] for n, v in h.items()}
    return {"h": h, "tok": tok, "track": tracks(client, admin)[0]["id"]}


def open_room(client, rooms, name="Late night"):
    res = client.post("/api/rooms", json={"name": name}, headers=rooms["h"]["host"])
    assert res.status_code == 201, res.text
    return res.json()


def join(client, code, token):
    ws = client.websocket_connect(f"/api/rooms/{code}/ws")
    sock = ws.__enter__()
    sock.send_json({"type": "auth", "token": token})
    return ws, sock


def until(sock, kind, limit=12):
    for _ in range(limit):
        msg = sock.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"no {kind} frame")


def test_create_get_and_end(client, rooms):
    room = open_room(client, rooms)
    assert len(room["code"]) == 6 and room["name"] == "Late night" and room["host"]["username"] == "host"
    assert client.get(f"/api/rooms/{room['code']}", headers=rooms["h"]["fan"]).json()["code"] == room["code"]
    assert client.get("/api/rooms/NOPE12", headers=rooms["h"]["fan"]).status_code == 404
    assert client.delete(f"/api/rooms/{room['code']}", headers=rooms["h"]["fan"]).status_code == 403
    assert client.delete(f"/api/rooms/{room['code']}", headers=rooms["h"]["host"]).status_code == 204
    assert client.get(f"/api/rooms/{room['code']}", headers=rooms["h"]["fan"]).status_code == 404


def test_a_host_has_one_open_room(client, rooms):
    first = open_room(client, rooms)
    second = open_room(client, rooms, "Second")
    assert client.get(f"/api/rooms/{first['code']}", headers=rooms["h"]["fan"]).status_code == 404
    assert client.get(f"/api/rooms/{second['code']}", headers=rooms["h"]["fan"]).status_code == 200


def test_socket_needs_a_valid_token_first(client, rooms):
    room = open_room(client, rooms)
    with client.websocket_connect(f"/api/rooms/{room['code']}/ws") as ws:
        ws.send_json({"type": "chat", "text": "hi"})  # not auth
        with pytest.raises(WebSocketDisconnect) as err:
            ws.receive_json()
        assert err.value.code == 4401
    with client.websocket_connect(f"/api/rooms/{room['code']}/ws") as ws:
        ws.send_json({"type": "auth", "token": "garbage"})
        with pytest.raises(WebSocketDisconnect) as err:
            ws.receive_json()
        assert err.value.code == 4401


def test_unknown_room_closes(client, rooms):
    with client.websocket_connect("/api/rooms/ZZZZZZ/ws") as ws:
        ws.send_json({"type": "auth", "token": rooms["tok"]["fan"]})
        with pytest.raises(WebSocketDisconnect) as err:
            ws.receive_json()
        assert err.value.code == 4404


def test_host_drives_listeners(client, rooms):
    room = open_room(client, rooms)
    hws, host = join(client, room["code"], rooms["tok"]["host"])
    state = until(host, "state")
    assert state["you"] == {"username": "host", "is_host": True} and state["room"]["track_id"] is None
    fws, fan = join(client, room["code"], rooms["tok"]["fan"])
    assert until(fan, "state")["you"]["is_host"] is False
    assert [m["username"] for m in until(host, "members")["members"]] == ["host", "fan"]

    host.send_json({"type": "play", "track_id": rooms["track"], "position": 12.5, "playing": True})
    sync = until(fan, "sync")
    assert sync["track_id"] == rooms["track"] and sync["position"] == 12.5 and sync["playing"] is True
    assert isinstance(sync["server_time"], float)

    fan.send_json({"type": "play", "track_id": rooms["track"], "position": 99, "playing": False})
    assert "host" in until(fan, "error")["message"].lower()

    host.send_json({"type": "play", "track_id": "no-such-track", "position": 1, "playing": True})
    assert until(host, "error")["message"]
    fws.__exit__(None, None, None)
    hws.__exit__(None, None, None)


def test_late_joiner_gets_the_current_position(client, rooms):
    room = open_room(client, rooms)
    hws, host = join(client, room["code"], rooms["tok"]["host"])
    until(host, "state")
    host.send_json({"type": "play", "track_id": rooms["track"], "position": 30, "playing": False})
    host.send_json({"type": "chat", "text": "ping"})
    until(host, "chat")  # the room has processed the play frame
    fws, fan = join(client, room["code"], rooms["tok"]["fan"])
    paused = until(fan, "state")["room"]
    assert (paused["track_id"], paused["position"], paused["playing"]) == (rooms["track"], 30, False)
    fws.__exit__(None, None, None)

    host.send_json({"type": "play", "track_id": rooms["track"], "position": 30, "playing": True})
    host.send_json({"type": "react", "emoji": "🔥"})
    until(host, "react")
    gws, guest = join(client, room["code"], rooms["tok"]["guest"])
    playing = until(guest, "state")["room"]
    assert playing["playing"] is True and playing["position"] >= 30
    gws.__exit__(None, None, None)
    hws.__exit__(None, None, None)


def test_chat_is_validated_and_rate_limited(client, rooms, monkeypatch):
    monkeypatch.setattr(hub, "CHAT_INTERVAL", 0.3)
    room = open_room(client, rooms)
    hws, host = join(client, room["code"], rooms["tok"]["host"])
    until(host, "state")
    fws, fan = join(client, room["code"], rooms["tok"]["fan"])
    until(fan, "state")
    fan.send_json({"type": "chat", "text": "  hello  "})
    msg = until(host, "chat")
    assert msg["text"] == "hello" and msg["from"]["username"] == "fan"
    fan.send_json({"type": "chat", "text": "too fast"})
    assert "slow" in until(fan, "error")["message"].lower()
    import time; time.sleep(0.35)
    fan.send_json({"type": "chat", "text": "   "})
    assert until(fan, "error")["message"]
    time.sleep(0.35)
    fan.send_json({"type": "chat", "text": "x" * 281})
    assert until(fan, "error")["message"]
    fws.__exit__(None, None, None)
    hws.__exit__(None, None, None)


def test_reactions_use_a_fixed_set(client, rooms):
    room = open_room(client, rooms)
    hws, host = join(client, room["code"], rooms["tok"]["host"])
    until(host, "state")
    fws, fan = join(client, room["code"], rooms["tok"]["fan"])
    until(fan, "state")
    fan.send_json({"type": "react", "emoji": "💖"})
    assert until(host, "react")["emoji"] == "💖"
    fan.send_json({"type": "react", "emoji": "<script>"})
    assert until(fan, "error")["message"]
    fws.__exit__(None, None, None)
    hws.__exit__(None, None, None)


def test_ending_a_room_tells_everyone(client, rooms):
    room = open_room(client, rooms)
    hws, host = join(client, room["code"], rooms["tok"]["host"])
    until(host, "state")
    fws, fan = join(client, room["code"], rooms["tok"]["fan"])
    until(fan, "state")
    assert client.delete(f"/api/rooms/{room['code']}", headers=rooms["h"]["host"]).status_code == 204
    until(fan, "ended")
    until(host, "ended")
    fws.__exit__(None, None, None)
    hws.__exit__(None, None, None)


def test_room_capacity(client, rooms, monkeypatch):
    monkeypatch.setattr(hub, "MAX_LISTENERS", 1)
    room = open_room(client, rooms)
    hws, host = join(client, room["code"], rooms["tok"]["host"])
    until(host, "state")
    with client.websocket_connect(f"/api/rooms/{room['code']}/ws") as ws:
        ws.send_json({"type": "auth", "token": rooms["tok"]["fan"]})
        with pytest.raises(WebSocketDisconnect) as err:
            ws.receive_json()
        assert err.value.code == 4429
    hws.__exit__(None, None, None)
