# backend/app/schemas.py
from pydantic import BaseModel

# 基础模型
class UserBase(BaseModel):
    email: str

# 注册时需要密码
class UserCreate(UserBase):
    password: str

# 返回给前端的信息 (不包含密码！)
class User(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True  # 让 Pydantic 兼容 SQLAlchemy 对象