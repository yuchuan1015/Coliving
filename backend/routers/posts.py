from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.post import Post
from models.user import User
from schemas.post import CreatePostRequest, PostOut
from services import activity_service, credit_service, visit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/posts", tags=["posts"])


def _to_out(post: Post, author: User, agent: Agent | None, current_user_id: str) -> dict:
    if post.is_anonymous and post.author_id != current_user_id:
        author_name = "匿名居民"
        author_emoji = "\U0001F464"
    elif post.posted_by_agent and agent:
        author_name = agent.name
        author_emoji = agent.avatar_emoji
    else:
        author_name = author.display_name
        author_emoji = agent.avatar_emoji if agent else None

    return {
        "id": post.id,
        "author_name": author_name,
        "author_emoji": author_emoji,
        "content": post.content,
        "is_anonymous": post.is_anonymous,
        "is_mine": post.author_id == current_user_id,
        "created_at": post.created_at.isoformat(),
    }


@router.get("", response_model=list[PostOut])
def list_posts(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Post, User, Agent)
        .join(User, User.id == Post.author_id)
        .outerjoin(Agent, Agent.user_id == Post.author_id)
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_to_out(p, u, a, current_user.id) for p, u, a in rows]


@router.post("", response_model=PostOut, status_code=201)
def create_post(
    body: CreatePostRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = Post(
        author_id=current_user.id,
        content=body.content,
        is_anonymous=body.is_anonymous,
    )
    db.add(post)

    agent = db.query(Agent).filter(Agent.user_id == current_user.id).first()
    if agent:
        credit_service.award_credit(db, agent, "post")
        visit_service.mark_interaction(db, agent, "plaza")
        activity_service.log(db, agent, "post", "在廣場發了留言", "plaza")

    db.commit()
    db.refresh(post)
    return _to_out(post, current_user, agent, current_user.id)


@router.delete("/{post_id}", status_code=204)
def delete_post(
    post_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="找不到這則留言")
    if post.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只能刪除自己的留言")
    db.delete(post)
    db.commit()
