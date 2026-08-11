import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import Base, engine
from routers import admin, adult, agents, announcements, auth, chat, credit, diary, footprints, furniture, health, history, home, library, mail, museum, park, pet, posts, schedules, shell, skins, users, weilan


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
        ("active_skin_id", "ALTER TABLE agents ADD COLUMN active_skin_id VARCHAR(36)"),
        ("credit_total", "ALTER TABLE agents ADD COLUMN credit_total INTEGER DEFAULT 0 NOT NULL"),
        ("credit_spent", "ALTER TABLE agents ADD COLUMN credit_spent INTEGER DEFAULT 0 NOT NULL"),
        ("shell_balance", "ALTER TABLE agents ADD COLUMN shell_balance INTEGER DEFAULT 0 NOT NULL"),
        ("current_location", "ALTER TABLE agents ADD COLUMN current_location VARCHAR(20)"),
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
app.include_router(schedules.router)
app.include_router(skins.router)
app.include_router(library.router)
app.include_router(park.router)
app.include_router(admin.router)
app.include_router(footprints.router)
app.include_router(mail.router)
app.include_router(credit.router)
app.include_router(shell.router)
app.include_router(pet.router)
app.include_router(museum.router)
app.include_router(weilan.router)
app.include_router(history.router)
app.include_router(adult.router)
app.include_router(health.router)
app.include_router(diary.router)
app.include_router(furniture.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
