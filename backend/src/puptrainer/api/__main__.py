"""`puptrainer-api`: serve the API (and the web app when `PUPTRAINER_WEB_DIR` is set)."""

import uvicorn

from puptrainer.core.settings import Settings


def main() -> None:
    """Run the server on `PUPTRAINER_BIND`."""
    settings = Settings()
    uvicorn.run(
        "puptrainer.api.app:create_app", factory=True, host=settings.host, port=settings.port
    )


if __name__ == "__main__":
    main()
