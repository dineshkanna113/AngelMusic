# Build from the parent folder that contains both repos:
#   docker build -f lossless-stream-backend/Dockerfile -t angelstream .
FROM node:20-alpine AS frontend
WORKDIR /web
COPY lossless-stream-frontend/package.json lossless-stream-frontend/package-lock.json ./
RUN npm ci
COPY lossless-stream-frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    APP_ENV=production AUDIO_DIR=/music DATABASE_PATH=/data/app.db FRONTEND_DIST=/app/static
WORKDIR /app
COPY lossless-stream-backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY lossless-stream-backend/app ./app
COPY lossless-stream-backend/main.py ./
COPY --from=frontend /web/dist ./static
RUN useradd --system --uid 10001 app && mkdir -p /data && chown app /data
USER app
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
# --no-access-log keeps short-lived stream tokens (query string) out of logs.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*", "--no-access-log"]
