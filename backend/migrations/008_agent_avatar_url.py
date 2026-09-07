"""008：agents 加 avatar_url（照片頭像，可空）。可重跑。"""
import sqlite3, sys

def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(agents)")]
    if "avatar_url" in cols:
        print("column exists, skip")
    else:
        c.execute("ALTER TABLE agents ADD COLUMN avatar_url VARCHAR(256)")
        c.commit()
        print("added agents.avatar_url")

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 008_agent_avatar_url.py <db>")
    main(sys.argv[1])
