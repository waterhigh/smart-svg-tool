# backend/app/crud.py
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from . import models, schemas

# 1. 配置密码加密器 (使用 bcrypt 算法)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

# 2. 通过邮箱查找用户 (用于查重)
def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()

# 3. 创建新用户 (带加密)
def create_user(db: Session, user: schemas.UserCreate):
    # 真正的加密过程
    hashed_password = get_password_hash(user.password)
    # 创建数据库对象
    db_user = models.User(email=user.email, hashed_password=hashed_password)
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user