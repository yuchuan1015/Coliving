import base64
import hashlib

from cryptography.fernet import Fernet

from config import settings

_SALT = b"coliving-api-key-v1"


def _get_fernet() -> Fernet:
    dk = hashlib.pbkdf2_hmac("sha256", settings.jwt_secret.encode(), _SALT, 480_000)
    key = base64.urlsafe_b64encode(dk)
    return Fernet(key)


def encrypt_api_key(plain_key: str) -> str:
    return _get_fernet().encrypt(plain_key.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
