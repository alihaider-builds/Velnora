from fastapi import BackgroundTasks, Request
from sqlalchemy import Engine

from app.config import Settings
from app.services.jobs import run_extraction


def engine(request: Request) -> Engine:
    return request.app.state.engine


def settings(request: Request) -> Settings:
    return request.app.state.settings


def schedule_extraction(request: Request, background: BackgroundTasks, report_id: str) -> None:
    st = request.app.state
    background.add_task(run_extraction, report_id, st.engine, st.settings, st.llm, st.geocoder)
