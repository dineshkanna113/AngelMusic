from fastapi import FastAPI
from app.routes import music

app= FastAPI()
app.include_router(music.router, prefix="/api/musi")
