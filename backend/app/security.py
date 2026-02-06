import os

from fastapi import Header, HTTPException, status


def require_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    """Require a static API key when configured.

    - If TEST_MODE=1, allow requests without a key for test automation.
    - If API_KEY is unset, auth is effectively disabled (dev convenience).
    """
    if os.getenv("TEST_MODE") == "1":
        return

    required = os.getenv("API_KEY")
    if not required:
        return

    if x_api_key != required:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )