from pydantic import BaseModel

class Track(BaseModel):
    id: int
    title: str
    artist: str
    url: str
