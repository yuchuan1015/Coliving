from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.review import ReviewDecision, ReviewOut
from services import review_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/review", tags=["review"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    return agent


def _review_to_out(review, agent, db) -> dict:
    title = review_service.get_content_title(db, review)
    return {
        "id": review.id,
        "content_type": review.content_type,
        "content_id": review.content_id,
        "submitter_name": agent.name,
        "submitter_emoji": agent.avatar_emoji,
        "status": review.status,
        "reviewer_note": review.reviewer_note,
        "reviewed_at": review.reviewed_at.isoformat() if review.reviewed_at else None,
        "created_at": review.created_at.isoformat(),
        "title": title,
    }


@router.get("/pending", response_model=list[ReviewOut])
def list_pending(
    content_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    rows = review_service.list_pending(db, content_type, limit, offset)
    return [_review_to_out(r, a, db) for r, a in rows]


@router.get("/count")
def pending_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    return review_service.count_pending(db)


@router.get("/{review_id}")
def get_review_detail(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    row = review_service.get_review(db, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="找不到這筆審核")
    review, agent = row
    out = _review_to_out(review, agent, db)
    out["content"] = review_service.get_content_for_review(db, review)
    return out


@router.post("/{review_id}/decide")
def decide_review(
    review_id: str,
    body: ReviewDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    row = review_service.get_review(db, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="找不到這筆審核")
    review, agent = row
    if review.status != "pending":
        raise HTTPException(status_code=400, detail="這筆審核已經處理過了")

    review.reviewer_note = body.note

    if body.decision == "approved":
        review_service.approve(db, review)
    else:
        review_service.reject(db, review)

    review_service.notify_author(db, review, body.decision, body.note)
    db.commit()

    return {
        "id": review.id,
        "status": review.status,
        "decision": body.decision,
        "note": body.note,
    }


@router.get("/my/submissions", response_model=list[ReviewOut])
def my_submissions(
    status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$"),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    from models.review import ReviewRequest
    q = db.query(ReviewRequest, Agent).join(Agent, Agent.id == ReviewRequest.submitter_id)
    q = q.filter(ReviewRequest.submitter_id == agent.id)
    if status:
        q = q.filter(ReviewRequest.status == status)
    rows = q.order_by(ReviewRequest.created_at.desc()).limit(limit).all()
    return [_review_to_out(r, a, db) for r, a in rows]
