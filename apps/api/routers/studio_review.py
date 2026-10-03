import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Response, Request, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from ..database import get_db
from ..config import settings
from ..middleware.rate_limit import rate_limit
from ..services.studio_review import assertion_user, read_review
from ..services.studio_native import delegated_studio_user

router = APIRouter(tags=['studio-review'])

class ReviewRead(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assertion: str | None = Field(default=None, max_length=4096)
    project_id: uuid.UUID
    asset_id: uuid.UUID
    version_id: uuid.UUID
    operation: Literal['authorize', 'snapshot']

@router.post('/studio/review-read', dependencies=[Depends(rate_limit('studio_review', 20, 60))])
async def review_read(body: ReviewRead, request: Request, response: Response, db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'private, no-store'
    authorization = request.headers.get('authorization')
    if authorization:
        scheme, _, token = authorization.partition(' ')
        if scheme.lower() != 'bearer' or not token or body.assertion is not None:
            raise HTTPException(401, 'Invalid Studio review credential')
        # Only native delegation is valid here; a normal FreeFrame bearer never
        # substitutes for the exact method/body/project-bound assertion.
        user = await delegated_studio_user(request, token, db)
    elif body.assertion is not None:
        if settings.studio_native_only:
            raise HTTPException(401, 'Native Studio review credential required')
        user = assertion_user(body.assertion, db, body.project_id, body.asset_id, body.version_id, body.operation)
    else:
        raise HTTPException(401, 'Studio review credential required')
    return await run_in_threadpool(read_review, db, user, body.project_id, body.asset_id, body.version_id, body.operation)
