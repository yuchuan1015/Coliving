"""022：改密碼後讓既有網頁登入失效。部署前備份，可重跑。"""
import sqlite3
import sys
from pathlib import Path


def main(db_path):
    if not Path(db_path).is_file():
        raise SystemExit("找不到既有資料庫；新環境請由應用程式建立資料表")
    with sqlite3.connect(db_path) as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
        if "auth_version" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: 022_auth_version.py <db>")
    main(sys.argv[1])
