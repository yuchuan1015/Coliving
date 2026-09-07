"""共讀書架（她 2026-09-08 定）：一戶一個書架，人和室友共讀同一本、各自劃線寫批注、看得到對方的。
私人的，別人看不到；要分享走圖書館投稿。先只收 txt / markdown。
形狀照宋祈言 keke 上的 anno_*：書架 / 翻頁讀（段落有編號）/ 劃線（原文片段）/ 批注（可掛劃線）。
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.reading import Book, BookHighlight, BookNote, BookParagraph
from models.user import User
from services import activity_service, bed_service

PARAS_PER_PAGE = 12
MAX_BOOK_CHARS = 2_000_000
MAX_BOOKS_PER_USER = 50
VALID_FORMATS = {"txt", "md"}
AUTHOR_KINDS = {"human", "agent"}


# ── 切段 ──


def split_paragraphs(text: str) -> list[str]:
    """空行切段；單行硬換行也算段。去頭尾空白，丟掉空段。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    parts = re.split(r"\n\s*\n+", text)
    paras: list[str] = []
    for p in parts:
        for line in p.split("\n"):
            line = line.strip()
            if line:
                paras.append(line)
    return paras


def add_book(db: Session, user: User, title: str, text: str, author: str | None = None, source_format: str = "txt") -> Book:
    """放一本書上架：切段、分頁。不 commit。"""
    if source_format not in VALID_FORMATS:
        raise ValueError("先只收 txt 或 md")
    if len(text) > MAX_BOOK_CHARS:
        raise ValueError(f"太長了，一本最多 {MAX_BOOK_CHARS:,} 字")
    if db.query(Book).filter(Book.user_id == user.id).count() >= MAX_BOOKS_PER_USER:
        raise ValueError(f"書架最多 {MAX_BOOKS_PER_USER} 本")
    paras = split_paragraphs(text)
    if not paras:
        raise ValueError("內容是空的")
    total_pages = (len(paras) + PARAS_PER_PAGE - 1) // PARAS_PER_PAGE
    book = Book(user_id=user.id, title=title.strip(), author=(author or "").strip() or None,
                source_format=source_format, total_pages=total_pages, total_paragraphs=len(paras))
    db.add(book)
    db.flush()
    for i, p in enumerate(paras, start=1):
        db.add(BookParagraph(book_id=book.id, page=(i - 1) // PARAS_PER_PAGE + 1, idx=i, text=p))
    activity_service.log(db, None, "book_add", f"書架上架《{book.title}》")
    return book


# ── 查 ──


def get_book(db: Session, user: User, book_id: str) -> Book | None:
    return db.query(Book).filter(Book.id == book_id, Book.user_id == user.id).first()


def _counts(db: Session, book_ids: list[str]) -> tuple[dict, dict]:
    if not book_ids:
        return {}, {}
    hl = dict(db.query(BookHighlight.book_id, func.count(BookHighlight.id)).filter(BookHighlight.book_id.in_(book_ids)).group_by(BookHighlight.book_id).all())
    nt = dict(db.query(BookNote.book_id, func.count(BookNote.id)).filter(BookNote.book_id.in_(book_ids)).group_by(BookNote.book_id).all())
    return hl, nt


def book_to_dict(book: Book, highlights: int = 0, notes: int = 0) -> dict:
    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "source_format": book.source_format,
        "total_pages": book.total_pages,
        "total_paragraphs": book.total_paragraphs,
        "last_page": book.last_page,
        "progress": round(book.last_page / book.total_pages, 2) if book.total_pages else 0,
        "highlights": highlights,
        "notes": notes,
        "last_read_at": book.last_read_at.isoformat() if book.last_read_at else None,
        "created_at": book.created_at.isoformat(),
    }


def shelf(db: Session, user: User) -> list[dict]:
    books = db.query(Book).filter(Book.user_id == user.id).order_by(Book.last_read_at.desc().nullslast(), Book.created_at.desc()).all()
    hl, nt = _counts(db, [b.id for b in books])
    return [book_to_dict(b, hl.get(b.id, 0), nt.get(b.id, 0)) for b in books]


def read_page(db: Session, user: User, book: Book, page: int, mark_progress: bool = True) -> dict:
    """翻到某頁：段落（帶編號）＋這頁的劃線與批注。預設順手把進度記到這頁。不 commit。"""
    if page < 1 or page > book.total_pages:
        raise ValueError(f"這本只有 {book.total_pages} 頁")
    paras = db.query(BookParagraph).filter(BookParagraph.book_id == book.id, BookParagraph.page == page).order_by(BookParagraph.idx).all()
    idxs = [p.idx for p in paras]
    hls = db.query(BookHighlight).filter(BookHighlight.book_id == book.id, BookHighlight.paragraph_idx.in_(idxs)).order_by(BookHighlight.created_at).all() if idxs else []
    nts = db.query(BookNote).filter(BookNote.book_id == book.id, BookNote.paragraph_idx.in_(idxs)).order_by(BookNote.created_at).all() if idxs else []
    if mark_progress:
        book.last_page = page
        book.last_read_at = datetime.now(timezone.utc)
    return {
        "book_id": book.id,
        "title": book.title,
        "page": page,
        "total_pages": book.total_pages,
        "paragraphs": [{"idx": p.idx, "text": p.text} for p in paras],
        "highlights": [highlight_to_dict(h) for h in hls],
        "notes": [note_to_dict(n) for n in nts],
    }


def highlight_to_dict(h: BookHighlight) -> dict:
    return {"id": h.id, "paragraph_idx": h.paragraph_idx, "text": h.text, "author_kind": h.author_kind, "bed": h.bed, "created_at": h.created_at.isoformat()}


def note_to_dict(n: BookNote) -> dict:
    return {"id": n.id, "paragraph_idx": n.paragraph_idx, "highlight_id": n.highlight_id, "content": n.content, "author_kind": n.author_kind, "bed": n.bed, "created_at": n.created_at.isoformat()}


# ── 寫 ──


def _paragraph(db: Session, book: Book, idx: int) -> BookParagraph:
    p = db.query(BookParagraph).filter(BookParagraph.book_id == book.id, BookParagraph.idx == idx).first()
    if not p:
        raise ValueError(f"沒有第 {idx} 段（這本共 {book.total_paragraphs} 段）")
    return p


def add_highlight(db: Session, book: Book, paragraph_idx: int, text: str, author_kind: str) -> BookHighlight:
    """劃線：text 必須是那段裡的原文片段。不 commit。"""
    if author_kind not in AUTHOR_KINDS:
        raise ValueError("author_kind 要是 human 或 agent")
    text = text.strip()
    if not text:
        raise ValueError("劃線內容不能為空")
    p = _paragraph(db, book, paragraph_idx)
    if text not in p.text:
        raise ValueError("劃線必須是這段裡的原文片段")
    h = BookHighlight(book_id=book.id, paragraph_idx=paragraph_idx, text=text, author_kind=author_kind, bed=bed_service.get_bed())
    db.add(h)
    return h


def add_note(db: Session, book: Book, paragraph_idx: int, content: str, author_kind: str, highlight_id: str | None = None) -> BookNote:
    if author_kind not in AUTHOR_KINDS:
        raise ValueError("author_kind 要是 human 或 agent")
    content = content.strip()
    if not content:
        raise ValueError("批注不能為空")
    if len(content) > 4000:
        raise ValueError("批注最多 4000 字")
    _paragraph(db, book, paragraph_idx)
    if highlight_id:
        h = db.query(BookHighlight).filter(BookHighlight.id == highlight_id, BookHighlight.book_id == book.id).first()
        if not h:
            raise ValueError("找不到要掛的那條劃線")
    n = BookNote(book_id=book.id, paragraph_idx=paragraph_idx, highlight_id=highlight_id or None, content=content, author_kind=author_kind, bed=bed_service.get_bed())
    db.add(n)
    return n


def delete_highlight(db: Session, book: Book, highlight_id: str) -> bool:
    h = db.query(BookHighlight).filter(BookHighlight.id == highlight_id, BookHighlight.book_id == book.id).first()
    if not h:
        return False
    db.query(BookNote).filter(BookNote.highlight_id == h.id).update({BookNote.highlight_id: None})
    db.delete(h)
    return True


def delete_note(db: Session, book: Book, note_id: str) -> bool:
    n = db.query(BookNote).filter(BookNote.id == note_id, BookNote.book_id == book.id).first()
    if not n:
        return False
    db.delete(n)
    return True


def set_progress(db: Session, book: Book, page: int) -> None:
    if page < 1 or page > book.total_pages:
        raise ValueError(f"這本只有 {book.total_pages} 頁")
    book.last_page = page
    book.last_read_at = datetime.now(timezone.utc)


def delete_book(db: Session, book: Book) -> None:
    db.query(BookNote).filter(BookNote.book_id == book.id).delete()
    db.query(BookHighlight).filter(BookHighlight.book_id == book.id).delete()
    db.query(BookParagraph).filter(BookParagraph.book_id == book.id).delete()
    db.delete(book)


def summary(db: Session, user: User) -> dict:
    """給家具總覽的書架格。"""
    books = db.query(Book).filter(Book.user_id == user.id).all()
    ids = [b.id for b in books]
    notes = db.query(func.count(BookNote.id)).filter(BookNote.book_id.in_(ids)).scalar() if ids else 0
    highlights = db.query(func.count(BookHighlight.id)).filter(BookHighlight.book_id.in_(ids)).scalar() if ids else 0
    last = max(books, key=lambda b: (b.last_read_at or b.created_at)) if books else None
    return {
        "books": len(books),
        "highlights": highlights,
        "notes": notes,
        "last_book": {"id": last.id, "title": last.title, "last_page": last.last_page, "total_pages": last.total_pages} if last else None,
    }
