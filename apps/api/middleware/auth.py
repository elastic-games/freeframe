from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import uuid
from typing import Optional
from sqlalchemy.orm import Session
from ..database import get_db
from ..services.auth_service import decode_token, get_user_by_id
from ..services.studio_native import delegated_studio_user
from ..models.user import User, UserStatus

bearer_scheme = HTTPBearer()
optional_bearer_scheme = HTTPBearer(auto_error=False)

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    if request.url.path and token.count(".") == 2:
        # Separate audience/key; a delegated token cannot become a normal access token.
        from jose import JWTError, jwt
        from ..config import settings
        if settings.studio_native_secret:
            try:
                preview = jwt.decode(token, settings.studio_native_secret, algorithms=["HS256"], audience="studio-native-reviews")
                if preview.get("type") == "studio_delegate":
                    return await delegated_studio_user(request, token, db)
            except JWTError:
                pass
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = get_user_by_id(db, uuid.UUID(payload["sub"]))
    if not user or user.status == UserStatus.deactivated:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or deactivated")
    from ..config import settings
    if settings.studio_native_only and (user.preferences or {}).get("studio_sso"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Use Studio Reviews")
    return user

def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Returns the authenticated user if a valid token is provided, None otherwise."""
    if not credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
        if not payload or payload.get("type") != "access":
            return None
        user = get_user_by_id(db, uuid.UUID(payload["sub"]))
        if not user or user.status == UserStatus.deactivated:
            return None
        from ..config import settings
        if settings.studio_native_only and (user.preferences or {}).get("studio_sso"):
            return None
        return user
    except Exception:
        return None

