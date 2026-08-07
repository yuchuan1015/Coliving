import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import Base, engine
from routers import agents, announcements, auth, chat, home, posts, users


def _migrate_sqlite():
    if "sqlite" not in settings.database_url:
        return
    db_path = settings.database_url.replace("sqlite:///", "")
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("PRAGMA table_info(agents)")
    existing = {row[1] for row in cursor.fetchall()}
    migrations = [
        ("ob_endpoint", "ALTER TABLE agents ADD COLUMN ob_endpoint VARCHAR(256)"),
        ("ob_token", "ALTER TABLE agents ADD COLUMN ob_token TEXT"),
        ("ob_enabled", "ALTER TABLE agents ADD COLUMN ob_enabled BOOLEAN DEFAULT 0 NOT NULL"),
    ]
    for col, sql in migrations:
        if col not in existing:
            conn.execute(sql)
    conn.commit()
    conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    yield


app = FastAPI(title="共居社區", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(home.router)
app.include_router(agents.router)
app.include_router(chat.router)
app.include_router(announcements.router)
app.include_router(posts.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
