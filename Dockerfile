# Build from the folder that contains both repos side by side:
#   docker build -f lossless-stream-backend/Dockerfile -t angelstream .
# (deploy/docker-compose.yml does this for you.)
FROM node:20-alpine AS frontend
WORKDIR /web
COPY lossless-stream-frontend/package.json lossless-stream-frontend/package-lock.json ./
RUN npm ci
COPY lossless-stream-frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    APP_ENV=production AUDIO_DIR=/music DATABASE_PATH=/data/app.db FRONTEND_DIST=/app/static \
    STAGING_DIR=/data/staging REMOVED_DIR=/data/removed
WORKDIR /app
COPY lossless-stream-backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY lossless-stream-backend/app ./app
COPY lossless-stream-backend/main.py ./
COPY --from=frontend /web/dist ./static
# Runs as uid 10001; the host folders mounted at /data and /music must be writable by it.
RUN useradd --system --uid 10001 app && mkdir -p /data /music && chown app /data /music
USER app
VOLUME ["/data", "/music"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
# One worker on purpose: SQLite, the upload chunk locks and the release scheduler live in
# this process. Async I/O plus the thread pool serve many concurrent listeners.
# --proxy-headers: client IPs (for login throttling) come from Caddy's X-Forwarded-For; the
# port is only reachable from Caddy on the compose network.
# --no-access-log keeps short-lived stream tokens (query string) out of logs.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips=*", "--no-access-log", "--timeout-graceful-shutdown", "20"]
