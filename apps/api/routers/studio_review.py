import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..middleware.rate_limit import rate_limit
from ..services.studio_review import assertion_user, read_review

router = APIRouter(tags=['studio-review'])

class ReviewRead(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assertion: str = Field(max_length=4096)
    project_id: uuid.UUID
    asset_id: uuid.UUID
    version_id: uuid.UUID
    operation: Literal['authorize', 'snapshot']

@router.post('/studio/review-read', dependencies=[Depends(rate_limit('studio_review', 20, 60))])
def review_read(body: ReviewRead, response: Response, db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'private, no-store'
    user = assertion_user(body.assertion, db, body.project_id, body.asset_id, body.version_id, body.operation)
    return read_review(db,user,body.project_id,body.asset_id,body.version_id,body.operation)
