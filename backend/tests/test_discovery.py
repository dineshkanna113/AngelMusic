import pytest
from mutagen.id3 import ID3, TLAN, TMOO
from mutagen.wave import WAVE

from app.library import normalize_language

from .conftest import auth_headers, tracks, write_wav


@pytest.mark.parametrize("raw, expected", [
    ("tam", "Tamil"), ("ta", "Tamil"), ("TAM", "Tamil"), ("Tamil", "Tamil"), ("eng", "English"), ("hin", "Hindi"),
    ("tam; eng", "Tamil"), ("xx", "xx"), ("  ", ""), ("", ""),
])
def test_normalize_language(raw, expected):
    assert normalize_language(raw) == expected


def tag_file(path, **frames):
    audio = WAVE(path)
    audio.add_tags()
    for frame in frames.values():
        audio.tags.add(frame)
    audio.save()


def test_scan_reads_mood_and_language(client, audio_dir):
    tagged = audio_dir / "Album" / "Tagged.wav"
    write_wav(tagged)
    tag_file(tagged, lang=TLAN(encoding=3, text=["tam"]), mood=TMOO(encoding=3, text=["Energetic"]))
    client.app.state.library.scan()
    h = auth_headers(client)
    by_title = {t["title"]: t for t in tracks(client, h)}
    assert by_title["Tagged"]["language"] == "Tamil" and by_title["Tagged"]["mood"] == "Energetic"
    untagged = by_title["Song Title"]
    assert untagged["language"] == "" and untagged["mood"] == ""
