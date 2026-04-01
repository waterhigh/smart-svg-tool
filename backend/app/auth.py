from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import crud, database
from .config import settings
from .plans import has_basic_access


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)


def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta
        else timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(
        to_encode,
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(database.get_db),
):
    if not token:
        return None

    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        email = payload.get("sub")
        if not email:
            return None
    except JWTError:
        return None

    return crud.get_user_by_email(db, email=email)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(database.get_db),
):
    user = await get_current_user_optional(token=token, db=db)
    if user is None:
        raise _credentials_exception()
    return user


async def get_current_user_with_basic_access(
    user=Depends(get_current_user),
):
    if not has_basic_access(getattr(user, "plan", None)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account is not activated for the Founder Lifetime Basic plan yet. "
                "Please register with your purchase email and grant access for that email."
            ),
        )
    return user
