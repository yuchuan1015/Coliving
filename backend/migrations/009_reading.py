"""009：共讀書架四張表（books / book_paragraphs / book_highlights / book_notes）。可重跑。
create_all 也會建，這支是給生產 DB 明確跑一次、留紀錄。"""
import sqlite3, sys

DDL = [
    """CREATE TABLE IF NOT EXISTS books (
        id VARCHAR(36) NOT NULL PRIMARY KEY, user_id VARCHAR(36) NOT NULL REFERENCES users(id),
        title VARCHAR(200) NOT NULL, author VARCHAR(100), source_format VARCHAR(8) NOT NULL DEFAULT 'txt',
        total_pages INTEGER NOT NULL DEFAULT 1, total_paragraphs INTEGER NOT NULL DEFAULT 0,
        last_page INTEGER NOT NULL DEFAULT 1, last_read_at DATETIME, created_at DATETIME NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_books_user_id ON books(user_id)",
    """CREATE TABLE IF NOT EXISTS book_paragraphs (
        id VARCHAR(36) NOT NULL PRIMARY KEY, book_id VARCHAR(36) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        page INTEGER NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_book_paragraphs_book_page ON book_paragraphs(book_id, page)",
    """CREATE TABLE IF NOT EXISTS book_highlights (
        id VARCHAR(36) NOT NULL PRIMARY KEY, book_id VARCHAR(36) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        paragraph_idx INTEGER NOT NULL, text TEXT NOT NULL, author_kind VARCHAR(8) NOT NULL, bed VARCHAR(40), created_at DATETIME NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_book_highlights_book_id ON book_highlights(book_id)",
    """CREATE TABLE IF NOT EXISTS book_notes (
        id VARCHAR(36) NOT NULL PRIMARY KEY, book_id VARCHAR(36) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        paragraph_idx INTEGER NOT NULL, highlight_id VARCHAR(36) REFERENCES book_highlights(id) ON DELETE SET NULL,
        content TEXT NOT NULL, author_kind VARCHAR(8) NOT NULL, bed VARCHAR(40), created_at DATETIME NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_book_notes_book_id ON book_notes(book_id)",
]

def main(db_path):
    c = sqlite3.connect(db_path)
    for d in DDL: c.execute(d)
    c.commit()
    print("reading tables ready; books:", c.execute("SELECT count(*) FROM books").fetchone()[0])

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 009_reading.py <db>")
    main(sys.argv[1])
