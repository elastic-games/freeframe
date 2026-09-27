"""Synthetic live HTTP/PG pool proof; run only against the disposable local fixture."""
import asyncio
import contextlib
import json
import os
import threading
import time
import uuid
from pathlib import Path

import httpx
import uvicorn
from sqlalchemy import event, inspect

async def run():
    from apps.api.database import engine, SessionLocal
    from apps.api.main import app
    from apps.api.models.user import User, UserStatus
    from apps.api.models.project import Project, ProjectMember, ProjectRole
    from apps.api.services.auth_service import hash_password
    from apps.api.routers import projects
    from apps.api.services import branding_service
    from apps.api.services.email_service import email_service
    from apps.api.middleware.auth import _access_user

    assert os.environ.get('ELASTIC_SYNTHETIC_POOL_FIXTURE')=='owned-disposable-pg'
    assert engine.pool.size()==2 and engine.pool._max_overflow==0
    password='synthetic-fixture-password'
    actors=[uuid.uuid4(),uuid.uuid4()];pids=[uuid.uuid4(),uuid.uuid4()]
    with SessionLocal() as db:
        for i,actor in enumerate(actors):
            db.add(User(id=actor,email=f'actor{i}@example.com',name='Synthetic',password_hash=hash_password(password),
                        status=UserStatus.active,is_superadmin=i==0,preferences={}))
        db.commit()
        for actor,pid in zip(actors,pids):
            db.add(Project(id=pid,name='Synthetic owned project',created_by=actor))
            db.add(ProjectMember(project_id=pid,user_id=actor,role=ProjectRole.owner))
        db.commit()
    lock=threading.Lock();seen={'current':0,'peak':0,'checkouts':0}
    @event.listens_for(engine,'checkout')
    def checkout(*args):
        with lock:
            seen['current']+=1;seen['checkouts']+=1;seen['peak']=max(seen['peak'],seen['current'])
    @event.listens_for(engine,'checkin')
    def checkin(*args):
        with lock:seen['current']-=1

    from starlette.datastructures import UploadFile
    actual_read=UploadFile.read
    reads_started=[];release_read=asyncio.Event()
    async def delayed_read(file,*args,**kwargs):
        if file.filename=='synthetic.png':
            reads_started.append(file.filename)
            await release_read.wait()
        return await actual_read(file,*args,**kwargs)
    UploadFile.read=delayed_read
    put_started=[threading.Event(),threading.Event()];release=threading.Event();call_lock=threading.Lock();puts=[]
    def put(key,*args,**kwargs):
        with call_lock:index=len(puts);puts.append(key)
        put_started[index].set()
        assert release.wait(12),'Synthetic object IO timed out'
    projects.put_object=put
    projects.generate_presigned_get_url=lambda key:'http://fixture.invalid/'+key
    projects.delete_object=lambda key:None
    import apps.api.main as main
    main.run_startup_bucket_setup=lambda:None
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=int(os.environ['FIXTURE_HTTP_PORT']),
                                         log_level='error',access_log=False,timeout_graceful_shutdown=5))
    server_task=asyncio.create_task(server.serve())
    try:
        for _ in range(100):
            if server.started:break
            await asyncio.sleep(.02)
        assert server.started
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{os.environ['FIXTURE_HTTP_PORT']}",timeout=5) as client:
            headers=[];tokens=[]
            for i in range(2):
                response=await client.post('/auth/login',json={'email':f'actor{i}@example.com','password':password})
                assert response.status_code==200,response.status_code
                token=response.json()['access_token'];tokens.append(token);headers.append({'Authorization':'Bearer '+token})
            # Real auth retains attached ORM behavior while ending its read checkout.
            with SessionLocal() as db:
                user=_access_user(tokens[0],db)
                assert inspect(user).persistent and seen['current']==0
                user.name='Synthetic changed';db.commit();db.refresh(user)
                assert user.name=='Synthetic changed'
            assert seen['current']==0
            async with contextlib.AsyncExitStack() as stack:
                for i in range(2):
                    stream=await stack.enter_async_context(client.stream('GET',f'/events/{pids[i]}',headers=headers[i]))
                    assert stream.status_code==200
                await asyncio.sleep(.1)
                assert seen['current']==0,'SSE retained PG checkout'
                posts=[asyncio.create_task(client.post(f'/projects/{pids[i]}/poster',headers=headers[i],
                       files={'file':('synthetic.png',b'x'*1_100_000,'image/png')})) for i in range(2)]
                for _ in range(200):
                    if len(reads_started)==2:break
                    await asyncio.sleep(.01)
                assert len(reads_started)==2,'Delayed file reads did not overlap'
                assert seen['current']==0,'File read retained PG checkout'
                reads=[]
                for phase in ('file_read','object_io'):
                    if phase=='object_io':
                        release_read.set()
                        for _ in range(200):
                            if all(flag.is_set() for flag in put_started):break
                            await asyncio.sleep(.01)
                        assert all(flag.is_set() for flag in put_started),'Slow poster operations did not overlap'
                        assert seen['current']==0,'Object IO retained PG checkout'
                    for _ in range(10):
                        async def read(i):
                            start=time.monotonic()
                            r=await client.get('/auth/me',headers=headers[i]);assert r.status_code==200,r.status_code
                            r=await client.get(f'/projects/{pids[i]}',headers=headers[i]);assert r.status_code==200,r.status_code
                            return (time.monotonic()-start)*1000
                        reads.extend(await asyncio.gather(read(0),read(1)))
                assert max(reads)<1000,'Authenticated read latency breached fixture limit'
                # Sync mutation endpoint still commits/refreshes the authenticated User.
                r=await client.patch('/auth/me/preferences',headers=headers[0],json={'theme':'dark'})
                assert r.status_code==200 and r.json()['preferences']['theme']=='dark'
                r=await client.get(f'/projects/{pids[1]}',headers=headers[0]);assert r.status_code==403
                release.set()
                results=await asyncio.gather(*posts)
                assert all(r.status_code==200 for r in results),[r.status_code for r in results]
                assert all(r.json()['poster_url'] for r in results)
            await asyncio.sleep(.1)
            assert seen['current']==0
            # Direct real delegated authorization covers an awaited, uncached ASGI body.
            from apps.api.config import settings
            from apps.api.services import studio_native
            from starlette.requests import Request
            from jose import jwt
            import hashlib
            settings.studio_sso_enabled=True
            settings.studio_native_secret='synthetic-delegation-secret-at-least-32-bytes'
            with SessionLocal() as db:
                for actor in actors:
                    user=db.get(User,actor);user.preferences={'studio_sso':True}
                db.commit()
            body=json.dumps({'name':'Synthetic folder'}).encode();body_started=[];body_release=asyncio.Event()
            redis_started=[];redis_release=threading.Event();redis_lock=threading.Lock()
            original_get_redis=studio_native.get_redis
            class DelayedReplay:
                def set(self,*args,**kwargs):
                    with redis_lock:redis_started.append(True)
                    assert redis_release.wait(12),'Synthetic Redis replay wait timed out'
                    return True
            studio_native.get_redis=lambda:DelayedReplay()
            delegated_sessions=[SessionLocal(),SessionLocal()]
            tasks=[]
            for actor,pid,db in zip(actors,pids,delegated_sessions):
                path=f'/projects/{pid}/folders';now=int(time.time())
                claim={'iss':'elastic-labs-studio','aud':'studio-native-reviews','type':'studio_delegate',
                       'sub':str(actor),'org':str(uuid.uuid4()),'project':str(pid),'method':'POST','path':path,
                       'request_hash':hashlib.sha256(b'\n'+body).hexdigest(),'iat':now,'exp':now+45,'jti':str(uuid.uuid4())}
                token=jwt.encode(claim,settings.studio_native_secret,algorithm='HS256')
                async def receive():
                    body_started.append(True);await body_release.wait()
                    return {'type':'http.request','body':body,'more_body':False}
                request=Request({'type':'http','method':'POST','path':path,'query_string':b'',
                                 'headers':[(b'content-type',b'application/json')]},receive=receive)
                tasks.append(asyncio.create_task(studio_native.delegated_studio_user(request,token,db)))
            try:
                for _ in range(100):
                    if len(body_started)==2:break
                    await asyncio.sleep(.01)
                assert len(body_started)==2 and seen['current']==0,'Delegated body retained checkout'
                for i in range(10):
                    start=time.monotonic();r=await client.get('/auth/me',headers=headers[i%2])
                    assert r.status_code==200;r=await client.get(f'/projects/{pids[i%2]}',headers=headers[i%2]);assert r.status_code==200
                    reads.append((time.monotonic()-start)*1000)
                body_release.set()
                for _ in range(100):
                    if len(redis_started)==2:break
                    await asyncio.sleep(.01)
                assert len(redis_started)==2 and seen['current']==0,'Redis replay retained checkout'
                for i in range(10):
                    start=time.monotonic();r=await client.get('/auth/me',headers=headers[i%2])
                    assert r.status_code==200;r=await client.get(f'/projects/{pids[i%2]}',headers=headers[i%2]);assert r.status_code==200
                    reads.append((time.monotonic()-start)*1000)
                redis_release.set()
                delegated_users=await asyncio.gather(*tasks)
                assert all(user._studio_native and inspect(user).persistent for user in delegated_users)
                assert seen['current']==0
            finally:
                body_release.set()
                redis_release.set();studio_native.get_redis=original_get_redis
                for db in delegated_sessions:db.close()
            assert max(reads)<1000
            # Worker-only pool1: branding has no enclosing task-owned DB session.
            worker_engine=__import__('sqlalchemy').create_engine(engine.url,pool_size=1,max_overflow=0,pool_timeout=1)
            worker_session=__import__('sqlalchemy.orm',fromlist=['sessionmaker']).sessionmaker(bind=worker_engine)
            import apps.api.database as database
            original=database.SessionLocal;database.SessionLocal=worker_session
            try:
                branding_service.reset_org_name_cache()
                assert email_service.from_name=='FreeFrame'
                assert branding_service.resolve_org_name()=='FreeFrame'
                assert worker_engine.pool.checkedout()==0
            finally:database.SessionLocal=original;worker_engine.dispose()
            print(json.dumps({'result':'PASS','pg_major':engine.dialect.server_version_info[0],
                  'python':__import__('platform').python_version(),'api_pool':2,'overflow':0,'sse_streams':2,
                  'overlapping_slow_posters':2,'overlapping_delayed_file_reads':2,'overlapping_delegated_bodies':2,'overlapping_redis_replays':2,'authenticated_read_pairs':len(reads),'max_read_pair_ms':round(max(reads),3),
                  'peak_checkouts':seen['peak'],'final_checkouts':seen['current'],'worker_branding_pool':1,
                  'sync_user_commit_refresh':True,'foreign_project_denied':True},sort_keys=True))
    finally:
        release_read.set();UploadFile.read=actual_read
        release.set();server.should_exit=True
        await asyncio.wait_for(server_task,10)
        engine.dispose()

if __name__=='__main__':asyncio.run(run())
