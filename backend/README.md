# 後端開發與驗證

使用 Python 3.12。在 backend 目錄建立自己的環境：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run_tests.py
```

`run_tests.py` 不讀 `.env`，使用暫存 SQLite、照片與記憶目錄，禁止對外連線。
測試完成後清掉暫存資料。也可以傳入個別測試模組，例如：

```sh
.venv/bin/python run_tests.py tests.test_handoff_fixes
```

一般開發另複製 `.env.example` 為 `.env`，產生獨立 JWT_SECRET，再執行：

```sh
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

這會建立空資料庫，不會複製正式住戶、室友、鑰匙或記憶。對外開放練習場之前，仍須完成獨立帳號／邀請碼、DNS、反向代理與服務設定。
本輪只提供開發環境與測試入口，沒有建立正式練習場。

## 儲存位置

- `UPLOADS_DIR`：頭像、餐桌圖片的共同根目錄；預設 `backend/uploads`。
- `PHOTO_DIR`：私人相框照片；預設 `backend/private_photos`，必須放在公開 uploads 之外。
- `MEM0_QDRANT_PATH`、`MEM0_HISTORY_DB`：預設 `backend/memdata/` 底下。
- SDK 設定目錄預設跟隨記憶資料庫；可用 `MEM0_DIR` 環境變數覆寫。遙測預設關閉。
- 若 backend 仍放在 `/opt/coliving/backend`，預設路徑與原正式站相同。

## 套件與遷移

2026-09-10 唯讀核對正式機：mem0ai 2.0.20、mcp 2.0.0、qdrant-client 1.19.0、Pillow 12.3.0、anthropic 1.4.0、bcrypt 5.0.0。
安裝清單補齊記憶和圖片依賴，mem0 固定為已核對的版本，避免安裝時換用不同的記憶 API。
Gemini 記憶額外需要 `google-genai`，已列入 requirements；正式機尚未安裝此項。

既有資料庫上線前先備份，再執行 `migrations/022_auth_version.py <資料庫檔案>`。
此遷移只增加登入版本欄位，可重跑；新的資料庫由模型直接建表。
部署需連同 API、公開 MCP、私人 MCP 程式一起更新並重啟；本輪尚未部署。

不要把前端 main 的舊版本打包上線。此次前端接線在 `codex/frontend-handoff`，以原 `codex/ui-chrome` 為基底。
