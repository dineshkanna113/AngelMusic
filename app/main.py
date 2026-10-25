import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings, load_settings
from .db import Database
from .library import Library
from .routes import auth, library, me, subsonic, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("lossless")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.scan_on_startup:
            # Scan in the background so a big library never blocks the server from starting.
            threading.Thread(target=app.state.library.scan, name="library-scan", daemon=True).start()
        yield

    app = FastAPI(
        title="Lossless Stream",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
    )
    app.state.settings = settings
    app.state.db = Database(settings.database_path)
    app.state.library = Library(app.state.db, settings.audio_dir)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Range"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
    )
    # No GZip middleware on purpose: it would re-compress FLAC range responses, burning CPU and
    # breaking Content-Length on 206s. Let the reverse proxy compress JSON if wanted.

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    @app.get("/api/health", tags=["meta"])
    def health():
        return {"status": "ok", "scanning": app.state.library.scanning}

    app.include_router(auth.router)
    app.include_router(library.router)
    app.include_router(me.router)
    app.include_router(users.router)
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
