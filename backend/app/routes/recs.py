from fastapi import APIRouter, Depends, Query, Request

from .. import queries, recs
from ..security import current_user

router = APIRouter(prefix="/api", tags=["recommendations"])


@router.get("/recommendations/discover")
def discover(request: Request, limit: int = Query(30, ge=1, le=100), user: dict = Depends(current_user)):
    """Tracks you have not played, from what listeners like you play and what matches your taste.
    Each track carries `reason: {kind: listeners | taste | popular, because}`."""
    with request.app.state.db.connect() as conn:
        picks = recs.discover(conn, user["id"], limit)
        reasons = dict(picks)
        found = queries.tracks_by_ids(conn, user["id"], [tid for tid, _ in picks])
    return {"tracks": [{**t, "reason": reasons[t["id"]]} for t in found]}
