"""001：pets 表加 lifespan_days 欄位，舊寵物用 id hash 回填。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/001_pets_lifespan.py /opt/coliving/backend/coliving.db
可重複執行：欄位已存在就跳過 ALTER，只回填 null 的。
"""
import hashlib
import sqlite3
import sys

LIFESPAN_MIN_DAYS = 90
LIFESPAN_RANGE_DAYS = 91


def hashed_lifespan(pet_id: str) -> int:
    h = int(hashlib.md5(pet_id.encode()).hexdigest(), 16)
    return LIFESPAN_MIN_DAYS + h % LIFESPAN_RANGE_DAYS


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(pets)")]
    if "lifespan_days" not in cols:
        c.execute("ALTER TABLE pets ADD COLUMN lifespan_days INTEGER")
        print("added column pets.lifespan_days")
    else:
        print("column already exists, skip ALTER")
    rows = c.execute("SELECT id FROM pets WHERE lifespan_days IS NULL").fetchall()
    for (pid,) in rows:
        c.execute("UPDATE pets SET lifespan_days = ? WHERE id = ?", (hashed_lifespan(pid), pid))
    c.commit()
    print(f"backfilled {len(rows)} pets")
    print("total pets:", c.execute("SELECT count(*) FROM pets").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 001_pets_lifespan.py <path-to-coliving.db>")
    main(sys.argv[1])
