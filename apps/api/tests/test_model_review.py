"""Native 3D reviews preserve complete view state and reject incorrect content/version anchors."""
import hashlib
import io
import json
import struct
import uuid
from types import SimpleNamespace as NS
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from apps.api.services import model_review as models, studio_review
from apps.api.models.asset import AssetType, ProcessingStatus, FileType
from apps.api.schemas.comment import AnnotationData
from apps.api.schemas.upload import mime_to_asset_type, ALLOWED_MIME_TYPES


def glb(extra=None):
    data=json.dumps({'asset':{'version':'2.0'},'nodes':[],**(extra or {})}).encode();data+=b' '*(-len(data)%4)
    return struct.pack('<III',0x46546c67,2,20+len(data))+struct.pack('<II',len(data),0x4e4f534a)+data


def view(version,digest):
    return {'schema':'freeframe-model-view/v1','versionId':str(version),'sha256':digest,'position':[3,2,3],'target':[0,0,0],'up':[0,1,0],
        'objectMatrix':[1,0,0,0,0,1,0,0,0,0,1,0,5,2,1,1],'fov':45,'near':.01,'far':1000,'aspect':1.6,'clip':-1,'time':0}


def test_model_type_and_complete_view_round_trip():
    assert mime_to_asset_type('model/gltf-binary')==AssetType.model and 'model/gltf-binary' in ALLOWED_MIME_TYPES
    assert FileType.model.value=='model'
    v=uuid.uuid4();sha=hashlib.sha256(glb()).hexdigest();saved=view(v,sha)
    annotation=AnnotationData(drawing_data={'objects':[],'_modelView':saved})
    restored=AnnotationData.model_validate_json(annotation.model_dump_json())
    assert models.validate_view(restored.drawing_data['_modelView'],v,sha,models.validate_glb(glb()))==saved


@pytest.mark.parametrize('patch',[{'versionId':str(uuid.uuid4())},{'sha256':'0'*64},{'position':[float('nan'),0,0]},{'up':[0,0,0]},{'objectMatrix':[]},{'objectMatrix':[0]*16},{'aspect':0},{'clip':0},{'time':1}])
def test_wrong_identity_pose_projection_and_transform_fail(patch):
    v=uuid.uuid4();sha=hashlib.sha256(glb()).hexdigest()
    with pytest.raises(HTTPException):models.validate_view({**view(v,sha),**patch},v,sha,models.validate_glb(glb()))


@pytest.mark.parametrize('extra',[{'buffers':[{'uri':'https://outside.example/model.bin'}]},{'images':[{'uri':'file:///etc/passwd'}]},{'nodes':[{'children':[0]}]},{'accessors':[{'count':2000001}]}])
def test_external_dependencies_and_resource_bombs_rejected(extra):
    with pytest.raises(HTTPException):models.validate_glb(glb(extra))


def test_content_read_is_bounded_closed_and_preserves_original_digest(mock_db,monkeypatch):
    raw=glb();v=uuid.uuid4();asset=NS(id=uuid.uuid4(),asset_type=AssetType.model)
    version=NS(id=v,asset_id=asset.id,deleted_at=None,processing_status=ProcessingStatus.ready)
    media=NS(file_type=FileType.model,mime_type='model/gltf-binary',file_size_bytes=len(raw),s3_key_raw='raw/project/asset/version/original.glb')
    client=MagicMock();bodies=[]
    def get(**_):
        body=io.BytesIO(raw);bodies.append(body);return {'Body':body,'ContentLength':len(raw)}
    client.get_object.side_effect=get;monkeypatch.setattr(models,'get_s3_client',lambda:client)
    mock_db.all.return_value=[media]
    state=view(v,hashlib.sha256(raw).hexdigest())
    models.validate_annotation(mock_db,asset,version,AnnotationData(drawing_data={'objects':[],'_modelView':state}))
    evidence=studio_review.media_evidence(mock_db,v)
    assert evidence=={'rawSha256':state['sha256'],'reviewSha256':state['sha256'],'timing':None,'reviewClock':None}
    assert all(body.closed for body in bodies)
    with pytest.raises(HTTPException):models.validate_annotation(mock_db,asset,version,None)
    with pytest.raises(HTTPException):models.validate_annotation(mock_db,asset,version,AnnotationData(drawing_data={'objects':[{}],'_modelView':{**state,'sha256':'0'*64}}))
    media.file_size_bytes=len(raw)+1
    with pytest.raises(HTTPException):models.read_model(media)
    media.file_size_bytes=models.MAX_MODEL_BYTES+1
    calls=client.get_object.call_count
    with pytest.raises(HTTPException):models.read_model(media)
    assert client.get_object.call_count==calls


def test_access_is_rechecked_after_model_bytes_before_comment_write(mock_db, monkeypatch):
    from apps.api.routers import comments
    from apps.api.models.user import UserStatus
    asset=NS(id=uuid.uuid4(),asset_type=AssetType.model)
    version=NS(asset_id=asset.id,deleted_at=None,processing_status=ProcessingStatus.ready)
    user=NS(id=uuid.uuid4(),deleted_at=None,status=UserStatus.active)
    monkeypatch.setattr(comments,'_get_asset',lambda *_:asset)
    def revoked(*_):raise HTTPException(403,'Access denied')
    monkeypatch.setattr(comments,'require_asset_access',revoked)
    with pytest.raises(HTTPException) as error:comments._recheck_model_access(mock_db,asset,version,user)
    assert error.value.status_code==403
    mock_db.expire_all.assert_called_once()
    mock_db.refresh.assert_called_once_with(user)
