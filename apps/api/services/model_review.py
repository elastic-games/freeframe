"""Bounded, self-contained GLB inspection and version-bound 3D annotations."""
import hashlib
import json
import math
import re
import struct
from fastapi import HTTPException
from ..config import settings
from .s3_service import get_s3_client

MAX_MODEL_BYTES = 16_777_216


def validate_glb(raw):
    """GLB v2 with embedded resources only; loaders must not fetch source URLs."""
    if type(raw) is not bytes or not 20 <= len(raw) <= MAX_MODEL_BYTES:
        raise HTTPException(413, 'Choose a GLB model up to 16 MiB')
    if struct.unpack_from('<III', raw) != (0x46546C67, 2, len(raw)):
        raise HTTPException(415, 'Invalid GLB v2 model')
    offset = 12
    document = None
    seen = set()
    while offset < len(raw):
        if offset + 8 > len(raw):raise HTTPException(415, 'Invalid GLB chunk')
        length, kind = struct.unpack_from('<II', raw, offset)
        offset += 8
        if length % 4 or offset + length > len(raw) or kind in seen:
            raise HTTPException(415, 'Invalid GLB chunk')
        seen.add(kind)
        if document is None:
            if kind != 0x4E4F534A or length > 1_048_576:
                raise HTTPException(415, 'Bounded GLB metadata required')
            try:
                document = json.loads(raw[offset:offset+length].decode('utf-8'),
                    object_pairs_hook=unique_model_pairs,
                    parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            except (ValueError, UnicodeError, RecursionError):
                raise HTTPException(415, 'Invalid GLB metadata') from None
        offset += length
    if type(document) is not dict or type(document.get('asset')) is not dict or document['asset'].get('version') != '2.0':
        raise HTTPException(415, 'GLB v2 metadata required')
    for name, bound in (('nodes',10000),('meshes',10000),('accessors',20000),('images',256),('buffers',1),('animations',256)):
        values=document.get(name,[])
        if type(values) is not list or len(values)>bound or any(type(v) is not dict for v in values):
            raise HTTPException(415, 'Model exceeds the browser inspection limit')
    for value in document.get('buffers',[]):
        if 'uri' in value:raise HTTPException(415, 'Use a self-contained GLB with embedded buffers')
    for value in document.get('images',[]):
        uri=value.get('uri')
        if uri is not None and (type(uri) is not str or re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}',uri) is None):
            raise HTTPException(415, 'Use a self-contained GLB with embedded textures')
    for accessor in document.get('accessors',[]):
        if type(accessor.get('count')) is not int or not 0<=accessor['count']<=2_000_000:
            raise HTTPException(415, 'Model accessor exceeds the inspection limit')
    if type(document.get('extensionsRequired',[])) is not list:
        raise HTTPException(415, 'Invalid model extensions')
    if any(x in ('KHR_draco_mesh_compression','KHR_texture_basisu','EXT_meshopt_compression','KHR_meshopt_compression') for x in document.get('extensionsRequired',[])):
        raise HTTPException(415, 'Export an uncompressed GLB for browser inspection')
    nodes=document.get('nodes',[]); visiting=set(); complete=set()
    def visit(index,depth):
        if type(index) is not int or not 0<=index<len(nodes) or index in visiting or depth>256:
            raise HTTPException(415, 'Invalid model node graph')
        if index in complete:return
        visiting.add(index)
        children=nodes[index].get('children',[])
        if type(children) is not list:raise HTTPException(415, 'Invalid model node graph')
        for child in children:visit(child,depth+1)
        visiting.remove(index);complete.add(index)
    for index in range(len(nodes)):visit(index,0)
    return document


def unique_model_pairs(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate model metadata key')
        result[key]=value
    return result



def read_model(media):
    if media.mime_type != 'model/gltf-binary' or not 20 <= media.file_size_bytes <= MAX_MODEL_BYTES:
        raise HTTPException(415, 'A self-contained GLB up to 16 MiB is required')
    response=get_s3_client().get_object(Bucket=settings.s3_bucket, Key=media.s3_key_raw)
    body=response['Body']
    try:
        raw=body.read(MAX_MODEL_BYTES+1)
    finally:body.close()
    if len(raw)!=media.file_size_bytes:raise HTTPException(409, 'Model content size differs from its version')
    return raw,validate_glb(raw)


def validate_view(value, version_id, digest, document):
    expected={'schema','versionId','sha256','position','target','up','objectMatrix','fov','near','far','aspect','clip','time'}
    if type(value) is not dict or set(value)!=expected or value['schema']!='freeframe-model-view/v1' or value['versionId']!=str(version_id) or value['sha256']!=digest:
        raise HTTPException(409, '3D feedback must name this exact model version and content digest')
    def finite(v):return type(v) in (int,float) and math.isfinite(v) and abs(v)<=1e9
    def vector(v):return type(v) is list and len(v)==3 and all(finite(n) for n in v)
    matrix=value['objectMatrix']
    if not all(vector(value[k]) for k in ('position','target','up')) or type(matrix) is not list or len(matrix)!=16 or not all(finite(n) for n in matrix) or [matrix[i] for i in (3,7,11,15)]!=[0,0,0,1]:
        raise HTTPException(400, 'Invalid camera or object transform')
    determinant=matrix[0]*(matrix[5]*matrix[10]-matrix[9]*matrix[6])-matrix[4]*(matrix[1]*matrix[10]-matrix[9]*matrix[2])+matrix[8]*(matrix[1]*matrix[6]-matrix[5]*matrix[2])
    if abs(determinant)<1e-18 or sum((a-b)**2 for a,b in zip(value['position'],value['target']))<1e-12 or sum(n*n for n in value['up'])<1e-12:
        raise HTTPException(400, 'Camera and object transform must be invertible')
    if not finite(value['near']) or value['near']<=0 or type(value['far']) not in (int,float) or not math.isfinite(value['far']) or not value['near']<value['far']<=1e12 or not finite(value['fov']) or not 10<=value['fov']<=100 or not finite(value['aspect']) or not .1<=value['aspect']<=10 or type(value['clip']) is not int or not -1<=value['clip']<len(document.get('animations',[])) or not finite(value['time']) or not 0<=value['time']<=86400 or (value['clip']==-1 and value['time']!=0):
        raise HTTPException(400, 'Invalid model pose or projection')
    return value


def validate_annotation(db, asset, version, annotation):
    from ..models.asset import AssetType, MediaFile, ProcessingStatus
    if getattr(asset,'asset_type',None) != AssetType.model:
        if annotation is not None and '_modelView' in annotation.drawing_data:
            raise HTTPException(400, '3D view metadata requires a model asset')
        return
    if version.asset_id!=asset.id or version.deleted_at is not None or version.processing_status!=ProcessingStatus.ready:
        raise HTTPException(409, 'Exact model review version is unavailable')
    if annotation is None:raise HTTPException(400, 'Capture a model view with this 3D feedback')
    files=db.query(MediaFile).filter(MediaFile.version_id==version.id).all()
    if len(files)!=1:raise HTTPException(409, 'A single model is required for 3D review')
    raw,document=read_model(files[0])
    validate_view(annotation.drawing_data.get('_modelView'),version.id,hashlib.sha256(raw).hexdigest(),document)
    if annotation.frame_number is not None or annotation.carousel_position is not None:
        raise HTTPException(400, '3D feedback uses a saved pose and camera')
