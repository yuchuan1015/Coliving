"""021：成人區改成「分級式人機親密關係中心」（2026-09-10 她定）。
adult_articles 加 age_tier（台灣分級：輔12／輔15／限制級）和 status（送審→上架）。可重跑。
已經在站上的舊文章一律當「限制級、已上架」，最保守。"""
import sqlite3, sys
NEW = [("age_tier", "VARCHAR(16) NOT NULL DEFAULT 'restricted'"),
       ("status", "VARCHAR(16) NOT NULL DEFAULT 'published'")]
def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(adult_articles)")]
    for name, decl in NEW:
        if name in cols:
            print(f"{name} exists, skip")
        else:
            c.execute(f"ALTER TABLE adult_articles ADD COLUMN {name} {decl}")
            print(f"added adult_articles.{name}")
    c.commit()
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 021_intimacy_tiers.py <db>")
    main(sys.argv[1])
