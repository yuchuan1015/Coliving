"""015：photos 表（相框的照片，一人 20 張、只擺 1 張）。可重跑。"""
import sqlite3, sys
SQL = """
CREATE TABLE IF NOT EXISTS photos (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  filename VARCHAR(128) NOT NULL,
  caption VARCHAR(200) NOT NULL DEFAULT '',
  is_displayed BOOLEAN NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_photos_user_id ON photos(user_id);
"""
def main(db_path):
    c = sqlite3.connect(db_path); c.executescript(SQL); c.commit(); print("photos ok")
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 015_photos.py <db>")
    main(sys.argv[1])
