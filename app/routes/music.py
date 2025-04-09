from fastapi import APIRouter

router = APIRouter()

@router.get("/")
def get_tracks():
    return {"tracks": ["song1.flac", "song2.flac"]}
