from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 格式: postgresql://用户名:密码@地址:端口/数据库名
SQLALCHEMY_DATABASE_URL = "postgresql://postgres:277979798@localhost:5432/smart_svg_db"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# 依赖项：用于在每个 API 请求中获取数据库会话
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()