from datetime import datetime

from pydantic import BaseModel


class UserBase(BaseModel):
    email: str


class UserCreate(UserBase):
    password: str


class User(UserBase):
    id: int
    is_active: bool
    plan: str
    plan_label: str
    has_basic_access: bool
    has_advanced_access: bool
    is_lifetime_plan: bool
    plan_granted_at: datetime | None = None
    plan_note: str | None = None

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
