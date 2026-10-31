"""Entry point: `uvicorn main:app` (dev) or see README for production."""

from app.main import create_app

app = create_app()
