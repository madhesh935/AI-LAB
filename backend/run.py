"""Development entry point. Refuses non-loopback binds unless RETAILEDGE_ALLOW_LAN=true."""

import uvicorn

from core.config import get_settings

if __name__ == "__main__":
    settings = get_settings()
    settings.assert_safe_bind()
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=False, log_config=None)
