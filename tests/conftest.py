import struct
import wave
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import throttle


def write_wav(path, seconds=1, rate=44100):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<hh", 0, 0) * rate * seconds)


def register(client, username="admin", password="correct-horse"):
    return client.post("/api/auth/register", json={"username": username, "password": password})


def auth_headers(client):
    token = register(client).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def login_headers(client, username, password):
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def stream_token(client, headers):
    return client.post("/api/auth/stream-token", headers=headers).json()["token"]


def tracks(client, headers):
    return client.get("/api/tracks", headers=headers).json()["tracks"]


@pytest.fixture
def audio_dir(tmp_path):
    lib = tmp_path / "library"
    (lib / "Album").mkdir(parents=True)
    write_wav(lib / "Album" / "03 - Artist Name - Song Title.wav")
    (lib / "notes.txt").write_text("not audio")
    return lib


@pytest.fixture
def client(tmp_path, audio_dir):
    settings = replace(
        Settings(),
        env="test",
        secret_key="test-secret",
        audio_dir=audio_dir,
        database_path=tmp_path / "test.db",
        frontend_dist=tmp_path / "no-dist",
        allow_registration=False,
        scan_on_startup=False,
    )
    throttle._failures.clear()  # module-level throttle is shared across tests
    app = create_app(settings)
    app.state.library.scan()
    with TestClient(app) as c:
        yield c
