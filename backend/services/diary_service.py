from sqlalchemy import func
from sqlalchemy.orm import Session

from models.agent import Agent
from models.diary import DiaryEntry

SOURCE_LABELS = {
    "manual": "手動記錄",
    "chat": "對話提取",
    "system": "系統事件",
}

VALID_SOURCES = set(SOURCE_LABELS.keys())


def _entry_to_dict(entry: DiaryEntry) -> dict:
    return {
        "id": entry.id,
        "title": entry.title,
        "content": entry.content,
        "tags": entry.tags,
        "importance": entry.importance,
        "source": entry.source,
        "source_label": SOURCE_LABELS.get(entry.source, entry.source),
        "created_at": entry.created_at.isoformat(),
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


def write_diary(
    db: Session,
    agent: Agent,
    title: str,
    content: str,
    tags: str | None = None,
    importance: float = 0.5,
    source: str = "manual",
) -> DiaryEntry:
    if source not in VALID_SOURCES:
        source = "manual"
    importance = max(0.0, min(1.0, importance))

    entry = DiaryEntry(
        agent_id=agent.id,
        title=title.strip(),
        content=content.strip(),
        tags=tags.strip() if tags else None,
        importance=importance,
        source=source,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def read_diary(
    db: Session,
    agent: Agent,
    keyword: str | None = None,
    source: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    q = db.query(DiaryEntry).filter(DiaryEntry.agent_id == agent.id)

    if source and source in VALID_SOURCES:
        q = q.filter(DiaryEntry.source == source)

    if keyword:
        kw = f"%{keyword.strip()}%"
        q = q.filter(
            (DiaryEntry.title.ilike(kw))
            | (DiaryEntry.content.ilike(kw))
            | (DiaryEntry.tags.ilike(kw))
        )

    total = q.count()

    entries = (
        q.order_by(DiaryEntry.importance.desc(), DiaryEntry.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    source_counts = {}
    for src in VALID_SOURCES:
        cnt = db.query(func.count(DiaryEntry.id)).filter(
            DiaryEntry.agent_id == agent.id,
            DiaryEntry.source == src,
        ).scalar()
        source_counts[src] = cnt or 0

    return {
        "entries": [_entry_to_dict(e) for e in entries],
        "total": total,
        "source_counts": source_counts,
    }


def get_entry(db: Session, agent: Agent, entry_id: str) -> DiaryEntry | None:
    return db.query(DiaryEntry).filter(
        DiaryEntry.id == entry_id,
        DiaryEntry.agent_id == agent.id,
    ).first()


def update_entry(
    db: Session,
    agent: Agent,
    entry_id: str,
    title: str | None = None,
    content: str | None = None,
    tags: str | None = None,
    importance: float | None = None,
) -> DiaryEntry | None:
    entry = get_entry(db, agent, entry_id)
    if not entry:
        return None

    if title is not None:
        entry.title = title.strip()
    if content is not None:
        entry.content = content.strip()
    if tags is not None:
        entry.tags = tags.strip() if tags else None
    if importance is not None:
        entry.importance = max(0.0, min(1.0, importance))

    db.commit()
    db.refresh(entry)
    return entry


def delete_entry(db: Session, agent: Agent, entry_id: str) -> bool:
    entry = get_entry(db, agent, entry_id)
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True
