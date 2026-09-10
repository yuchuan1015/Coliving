"""離線測試入口：不讀 .env，資料和上傳都放暫存目錄，不允許對外連線。"""
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def main():
    root = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="rookery-tests-") as temp:
        os.environ.update({
            "COLIVING_ENV_FILE": "", "JWT_SECRET": "isolated-tests-not-a-real-secret",
            "DATABASE_URL": f"sqlite:///{temp}/test.db", "UPLOADS_DIR": f"{temp}/uploads",
            "PHOTO_DIR": f"{temp}/photos", "MEM0_QDRANT_PATH": f"{temp}/qdrant",
            "MEM0_HISTORY_DB": f"{temp}/history.db", "EMBED_OPENAI_API_KEY": "",
            "OB_DEFAULT_ENDPOINT": "", "OB_DEFAULT_TOKEN": "", "INTERNAL_SECRET": "isolated-tests",
            "MEM0_TELEMETRY": "false", "POSTHOG_DISABLED": "true",
            "MEM0_DIR": f"{temp}/mem0-config",
        })
        os.chdir(root)
        sys.path.insert(0, str(root))
        with patch.object(socket.socket, "connect", side_effect=OSError("offline tests: network disabled")), \
             patch.object(socket, "create_connection", side_effect=OSError("offline tests: network disabled")):
            suite = (unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:]) if len(sys.argv) > 1
                     else unittest.defaultTestLoader.discover(str(root / "tests"), top_level_dir=str(root)))
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
