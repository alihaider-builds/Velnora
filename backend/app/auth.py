"""Single reviewer sign-in with a signed session cookie.

Generate a password hash with:  python -m app.auth hash-password
"""

import getpass
import sys

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.errors import APIError

COOKIE_NAME = "rl_session"
REVIEWER = "reviewer"
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def _serializer(request: Request) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(request.app.state.session_secret, salt="relieflens-session")


def set_session(request: Request, response: Response) -> None:
    token = _serializer(request).dumps({"r": REVIEWER})
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=request.app.state.settings.session_max_age_seconds,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def current_reviewer(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        data = _serializer(request).loads(token, max_age=request.app.state.settings.session_max_age_seconds)
    except BadSignature:
        return None
    return data.get("r")


def require_reviewer(request: Request) -> str:
    reviewer = current_reviewer(request)
    if reviewer is None:
        raise APIError(401, "UNAUTHORIZED", "Sign in as the reviewer to continue.")
    return reviewer


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "hash-password":
        pw = getpass.getpass("Reviewer password: ")
        if len(pw) < 8:
            sys.exit("Use at least 8 characters.")
        if pw != getpass.getpass("Repeat password: "):
            sys.exit("Passwords did not match.")
        print(hash_password(pw))
    else:
        sys.exit("Usage: python -m app.auth hash-password")
