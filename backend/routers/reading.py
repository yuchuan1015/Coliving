"""共讀書架（艙室裡的家具）。人從這裡讀、劃、寫；室友走 MCP reading_*。同一戶共用。"""
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.user import User
from services import reading_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/reading", tags=["reading"])


class AddBookRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)
    author: str | None = Field(default=None, max_length=100)
    source_format: str = Field(default="txt", pattern="^(txt|md)$")


class HighlightRequest(BaseModel):
    paragraph_idx: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=2000)


class NoteRequest(BaseModel):
    paragraph_idx: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=4000)
    highlight_id: str | None = None


class ProgressRequest(BaseModel):
    page: int = Field(ge=1)


def _book_or_404(db: Session, user: User, book_id: str):
    book = reading_service.get_book(db, user, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="書架上沒有這本")
    return book


@router.get("/books")
def shelf(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return {"books": reading_service.shelf(db, current_user)}


@router.post("/books", status_code=201)
def add_book(body: AddBookRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """貼文字上架。"""
    try:
        book = reading_service.add_book(db, current_user, body.title, body.text, body.author, body.source_format)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(book)
    return reading_service.book_to_dict(book)


@router.post("/books/upload", status_code=201)
async def upload_book(
    file: UploadFile = File(...),
    title: str | None = Query(default=None, max_length=200),
    author: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """上傳 .txt / .md 檔上架。title 不填就用檔名。"""
    name = file.filename or "book.txt"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "txt"
    fmt = "md" if ext in ("md", "markdown") else "txt"
    if ext not in ("txt", "md", "markdown", "text"):
        raise HTTPException(status_code=400, detail="先只收 .txt 或 .md")
    raw = await file.read()
    if len(raw) > 4 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="檔案太大，最多 4MB")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("utf-16")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="檔案要是 UTF-8 文字")
    try:
        book = reading_service.add_book(db, current_user, (title or name.rsplit(".", 1)[0])[:200], text, author, fmt)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(book)
    return reading_service.book_to_dict(book)


@router.get("/books/{book_id}")
def read_book(
    book_id: str,
    page: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """翻頁。page 不給就翻到上次讀到的那頁。"""
    book = _book_or_404(db, current_user, book_id)
    try:
        out = reading_service.read_page(db, current_user, book, page or book.last_page)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return out


@router.delete("/books/{book_id}", status_code=204)
def delete_book(book_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    book = _book_or_404(db, current_user, book_id)
    reading_service.delete_book(db, book)
    db.commit()


@router.patch("/books/{book_id}/progress")
def set_progress(book_id: str, body: ProgressRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    book = _book_or_404(db, current_user, book_id)
    try:
        reading_service.set_progress(db, book, body.page)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return {"last_page": book.last_page, "total_pages": book.total_pages}


@router.post("/books/{book_id}/highlights", status_code=201)
def add_highlight(book_id: str, body: HighlightRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    book = _book_or_404(db, current_user, book_id)
    try:
        h = reading_service.add_highlight(db, book, body.paragraph_idx, body.text, "human")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(h)
    return reading_service.highlight_to_dict(h)


@router.delete("/books/{book_id}/highlights/{highlight_id}", status_code=204)
def delete_highlight(book_id: str, highlight_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    book = _book_or_404(db, current_user, book_id)
    if not reading_service.delete_highlight(db, book, highlight_id):
        raise HTTPException(status_code=404, detail="找不到這條劃線")
    db.commit()


@router.post("/books/{book_id}/notes", status_code=201)
def add_note(book_id: str, body: NoteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    book = _book_or_404(db, current_user, book_id)
    try:
        n = reading_service.add_note(db, book, body.paragraph_idx, body.content, "human", body.highlight_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(n)
    return reading_service.note_to_dict(n)


@router.delete("/books/{book_id}/notes/{note_id}", status_code=204)
def delete_note(book_id: str, note_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    book = _book_or_404(db, current_user, book_id)
    if not reading_service.delete_note(db, book, note_id):
        raise HTTPException(status_code=404, detail="找不到這條批注")
    db.commit()
