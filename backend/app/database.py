from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings


engine_kwargs: dict[str, object] = {"pool_pre_ping": True}
if settings.database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def ensure_schema() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    existing_columns = {
        column["name"]
        for column in inspector.get_columns("users")
    }
    alter_statements: list[str] = []

    if "plan" not in existing_columns:
        alter_statements.append(
            "ALTER TABLE users ADD COLUMN plan VARCHAR(32) NOT NULL DEFAULT 'free'"
        )
    if "plan_granted_at" not in existing_columns:
        alter_statements.append(
            "ALTER TABLE users ADD COLUMN plan_granted_at DATETIME NULL"
        )
    if "plan_note" not in existing_columns:
        alter_statements.append(
            "ALTER TABLE users ADD COLUMN plan_note VARCHAR(255) NULL"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            connection.execute(text(statement))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
