from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from .database import Base
from .plans import FREE_PLAN, get_plan_label, has_advanced_access, has_basic_access, is_lifetime_plan


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    plan = Column(String, nullable=False, default=FREE_PLAN, index=True)
    plan_granted_at = Column(DateTime(timezone=True), nullable=True)
    plan_note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def plan_label(self) -> str:
        return get_plan_label(self.plan)

    @property
    def has_basic_access(self) -> bool:
        return has_basic_access(self.plan)

    @property
    def has_advanced_access(self) -> bool:
        return has_advanced_access(self.plan)

    @property
    def is_lifetime_plan(self) -> bool:
        return is_lifetime_plan(self.plan)
