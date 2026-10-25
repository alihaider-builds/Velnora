"""Run:  uvicorn app.main:app --reload --port 8000"""

import logging

from app.factory import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
