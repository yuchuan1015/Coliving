"""020：agents.status_note（室友自己填的狀態，像門上掛的牌子，顯示在居民名錄）。可重跑。"""
import sqlite3, sys
def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(agents)")]
    if "status_note" in cols:
        print("status_note exists, skip")
    else:
        c.execute("ALTER TABLE agents ADD COLUMN status_note VARCHAR(40)")
        print("added agents.status_note")
    c.commit()
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 020_status_note.py <db>")
    main(sys.argv[1])
