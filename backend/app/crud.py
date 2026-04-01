from __future__ import annotations

from datetime import datetime, timezone

from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models, schemas
from .plans import FREE_PLAN, normalize_email, normalize_plan


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_user_by_email(db: Session, email: str):
    normalized_email = normalize_email(email)
    return db.query(models.User).filter(models.User.email == normalized_email).first()


def create_user(db: Session, user: schemas.UserCreate):
    normalized_email = normalize_email(user.email)
    hashed_password = get_password_hash(user.password)
    db_user = models.User(
        email=normalized_email,
        hashed_password=hashed_password,
        plan=FREE_PLAN,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def update_user_plan(
    db: Session,
    user: models.User,
    plan: str,
    note: str | None = None,
):
    user.plan = normalize_plan(plan)
    user.plan_granted_at = datetime.now(timezone.utc)
    user.plan_note = note.strip() if note else None
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
