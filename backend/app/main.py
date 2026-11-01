import logging
import secrets
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import API_VERSION, __version__

from .config import Settings, load_settings
from .db import Database
from .ingest import IngestWorker
from .library import Library
from .routes import auth, library, me, subsonic, uploads, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("lossless")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.scan_on_startup:
            # Scan in the background so a big library never blocks the server from starting.
            threading.Thread(target=app.state.library.scan, name="library-scan", daemon=True).start()
        app.state.ingest.start()
        yield
        app.state.ingest.stop()

    app = FastAPI(
        title="Yaapu API",
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
    )
    app.state.settings = settings
    app.state.db = Database(settings.database_path)
    app.state.library = Library(app.state.db, settings.audio_dir)
    app.state.ingest = IngestWorker(app.state)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Range", "Upload-Offset", "If-None-Match", "X-Request-ID"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "ETag", "X-Request-ID"],
    )
    # No GZip middleware on purpose: it would re-compress FLAC range responses, burning CPU and
    # breaking Content-Length on 206s. Let the reverse proxy compress JSON if wanted.

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        # A request ID ties a client-side error report to the server log line.
        rid = request.headers.get("x-request-id", "")[:64] or secrets.token_hex(8)
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", "")
        log.exception("Unhandled error on %s %s [request %s]", request.method, request.url.path, rid)
        return JSONResponse({"detail": "Internal server error", "request_id": rid}, status_code=500)

    @app.get("/api/health", tags=["meta"])
    def health():
        """For load balancers and uptime checks: 503 unless the database answers."""
        try:
            with app.state.db.connect() as conn:
                conn.execute("SELECT 1").fetchone()
        except Exception:
            log.exception("Health check failed")
            return JSONResponse({"status": "error"}, status_code=503)
        return {"status": "ok", "version": __version__, "scanning": app.state.library.scanning}

    @app.get("/api/config", tags=["meta"])
    def client_config():
        """Read by clients at launch (no auth). Mobile apps compare their version with
        min_app_version and ask the user to update when they're older."""
        with app.state.db.connect() as conn:
            has_users = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
        return {
            "name": "Yaapu",
            "server_version": __version__,
            "api_version": API_VERSION,
            "min_app_version": settings.min_app_version,
            "public_url": settings.public_url or None,
            "registration_open": auth.registration_open(settings, has_users),
            "max_upload_mb": settings.max_upload_mb,
            "upload_chunk_bytes": uploads.CHUNK_SIZE,
            "access_token_ttl": settings.access_token_ttl,
            "features": ["lossless", "offline", "lyrics", "playlists", "favorites", "history", "uploads",
                         "scheduled-releases", "subsonic"],
            "subsonic_url": f"{settings.public_url}/rest" if settings.public_url else "/rest",
        }

    app.include_router(auth.router)
    app.include_router(library.router)
    app.include_router(me.router)
    app.include_router(users.router)
    app.include_router(uploads.router)
    app.include_router(subsonic.router)

    _mount_frontend(app, settings)
    return app


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    """In production the built React app is served from the same origin as the API."""
    dist = settings.frontend_dist
    index = dist / "index.html"
    if not index.is_file():
        return
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith(("api/", "rest/")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_relative_to(dist.resolve()) and candidate.is_file():
            media_type = STATIC_TYPES.get(candidate.suffix)
            # The service worker must be revalidated on every load or updates never reach users.
            headers = {"Cache-Control": "no-cache"} if candidate.name == "sw.js" else None
            return FileResponse(candidate, media_type=media_type, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


# Windows' registry-based mimetypes can mislabel these, which breaks the PWA.
STATIC_TYPES = {".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png"}
