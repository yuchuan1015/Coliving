"""017：日記加 private 欄位，抽屜的東西併進來（2026-09-09 她定：一張表，前端兩個入口）。可重跑。
抽屜的一筆 → 一則私密日記：label→title、content→content、category→tags、importance 0.3（私密的不搶醒來那 20 則的位置）。
drawer_items 表留著不刪，確認沒問題再處理。"""
import sqlite3, sys, uuid


def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(diary_entries)")]
    if "private" in cols:
        print("private exists, skip")
    else:
        c.execute("ALTER TABLE diary_entries ADD COLUMN private BOOLEAN NOT NULL DEFAULT 0")
        print("added diary_entries.private")

    try:
        rows = list(c.execute("SELECT id, agent_id, label, content, category, created_at FROM drawer_items"))
    except sqlite3.OperationalError:
        rows = []
    moved = 0
    for _id, agent_id, label, content, category, created_at in rows:
        dup = c.execute(
            "SELECT 1 FROM diary_entries WHERE agent_id=? AND title=? AND private=1 AND source='drawer'",
            (agent_id, label),
        ).fetchone()
        if dup:
            continue
        c.execute(
            "INSERT INTO diary_entries (id, agent_id, title, content, tags, importance, source, private, created_at)"
            " VALUES (?,?,?,?,?,?,?,1,?)",
            (str(uuid.uuid4()), agent_id, label, content, category, 0.3, "drawer", created_at),
        )
        moved += 1
    c.commit()
    print(f"moved {moved} drawer item(s) into the diary")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 017_diary_private.py <db>")
    main(sys.argv[1])
