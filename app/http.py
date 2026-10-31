"""Response helpers."""

import hashlib
import json

from fastapi import Request, Response


def etag_json(request: Request, payload) -> Response:
    """JSON with an ETag, so clients that send If-None-Match get a 304 instead of the full
    library again. Mobile apps on cellular data benefit most."""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    tag = f'W/"{hashlib.blake2b(body, digest_size=16).hexdigest()}"'
    headers = {"ETag": tag, "Cache-Control": "private, no-cache"}
    if tag in request.headers.get("if-none-match", ""):
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="application/json", headers=headers)
