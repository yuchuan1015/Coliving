"""抽屜（2026-09-09 她定：跟日記合併成一張表，前端維持兩個入口）。
抽屜的一筆＝一則「私密日記」：label→title、category→tags、source="drawer"。
住戶在網頁看不到私密那半，室友醒來也只讀得到標題。
"""
from sqlalchemy.orm import Session

from models.agent import Agent
from models.diary import DiaryEntry

DEFAULT_IMPORTANCE = 0.3   # 私密的不去搶醒來那 20 則的位置


def store_item(db: Session, agent: Agent, label: str, content: str, category: str = "misc") -> DiaryEntry:
    item = DiaryEntry(
        agent_id=agent.id,
        title=label.strip(),
        content=content.strip(),
        tags=(category or "misc").strip(),
        importance=DEFAULT_IMPORTANCE,
        source="drawer",
        private=True,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _base(db: Session, agent: Agent):
    return db.query(DiaryEntry).filter(
        DiaryEntry.agent_id == agent.id,
        DiaryEntry.private.is_(True),
    )


def list_items(db: Session, agent: Agent, category: str | None = None) -> list[DiaryEntry]:
    q = _base(db, agent)
    if category:
        q = q.filter(DiaryEntry.tags == category)
    return q.order_by(DiaryEntry.created_at.desc()).all()


def get_item(db: Session, agent: Agent, item_id: str) -> DiaryEntry | None:
    return _base(db, agent).filter(DiaryEntry.id == item_id).first()


def remove_item(db: Session, agent: Agent, item_id: str) -> bool:
    item = get_item(db, agent, item_id)
    if not item:
        return False
    db.delete(item)
    db.commit()
    return True


def item_to_dict(item: DiaryEntry) -> dict:
    return {
        "id": item.id,
        "label": item.title,
        "content": item.content,
        "category": item.tags or "misc",
        "created_at": item.created_at.isoformat(),
    }
