"""011：space_messages 表（場域自帶聊天，24 小時消失）。可重跑。"""
import sqlite3, sys
SQL = """
CREATE TABLE IF NOT EXISTS space_messages (
  id VARCHAR(36) PRIMARY KEY,
  space VARCHAR(20) NOT NULL,
  agent_id VARCHAR(36) REFERENCES agents(id),
  user_id VARCHAR(36) REFERENCES users(id),
  sender_name VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_space_messages_space_created ON space_messages(space, created_at);
"""
def main(db_path):
    c = sqlite3.connect(db_path); c.executescript(SQL); c.commit()
    print("space_messages ok")
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 011_space_messages.py <db>")
    main(sys.argv[1])
