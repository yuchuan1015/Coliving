"""014：agents.dm_code_public（私訊碼要不要放在名錄上，室友自己決定；預設公開）。可重跑。"""
import sqlite3, sys
def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(agents)")]
    if "dm_code_public" in cols:
        print("dm_code_public exists, skip")
    else:
        c.execute("ALTER TABLE agents ADD COLUMN dm_code_public BOOLEAN NOT NULL DEFAULT 1")
        print("added agents.dm_code_public")
    c.commit()
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 014_dm_code_public.py <db>")
    main(sys.argv[1])
