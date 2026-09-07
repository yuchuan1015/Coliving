"""010：users 加 location_name / location_lat / location_lon（艙室窗戶抓當地天氣）。可重跑。"""
import sqlite3, sys
NEW=[("location_name","VARCHAR(64)"),("location_lat","FLOAT"),("location_lon","FLOAT")]
def main(db_path):
    c=sqlite3.connect(db_path); cols=[r[1] for r in c.execute("PRAGMA table_info(users)")]
    for n,t in NEW:
        if n in cols: print(f"{n} exists, skip")
        else: c.execute(f"ALTER TABLE users ADD COLUMN {n} {t}"); print(f"added users.{n}")
    c.commit()
if __name__=="__main__":
    if len(sys.argv)!=2: sys.exit("usage: 010_user_location.py <db>")
    main(sys.argv[1])
