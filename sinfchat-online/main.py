import asyncio
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
import psycopg
import legacy
from storage import connect, init_schema

HERE = Path(__file__).parent
INVITE_CODE = os.environ.get("INVITE_CODE", "")
ADMIN_CODE = os.environ.get("ADMIN_SETUP_CODE", "")
LOCK = Lock()
clients = defaultdict(set)
attempts = defaultdict(deque)

online_names = {}

init_schema()

app = FastAPI(title="SinfChat Online", docs_url=None, redoc_url=None)

class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=8, max_length=128)
    invite_code: str = ""
    admin_code: str = ""

class Report(BaseModel):
    message_id: int
    reason: str = Field(min_length=3, max_length=120)

class Ban(BaseModel):
    user_id: int
    banned: bool

def fail(status, message):
    raise HTTPException(status, message)

def digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260000).hex()

def current(request):
    token = request.cookies.get("sinfchat_session", "")
    if not token:
        fail(401, "Avval akkauntga kiring")
    with connect() as db:
        row = db.execute("SELECT u.id,u.name,u.admin,u.banned FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token=? AND s.expiry>?", (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
    if not row or row["banned"]:
        fail(401, "Kirish muddati tugagan")
    return dict(row)

def throttle(key, maximum=20, window=60):
    now = time.monotonic()
    q = attempts[key]
    while q and now-q[0]>window:
        q.popleft()
    if len(q)>=maximum:
        fail(429,"Juda ko'p urinish")
    q.append(now)

def session_cookie(response, uid, request):
    token = secrets.token_urlsafe(36)
    with LOCK, connect() as db:
        db.execute("INSERT INTO sessions(token,uid,expiry) VALUES(?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),uid,int(time.time())+1209600))
        db.commit()
    https = request.url.scheme=="https" or request.headers.get("x-forwarded-proto","").startswith("https")
    response.set_cookie("sinfchat_session",token,httponly=True,secure=https,samesite="lax",max_age=1209600)

def to_msg(row):
    return {"type":"message","id":row["id"],"sender":row["sender"],"username":row["username"],"recipient":row["recipient"],"body":row["body"],"media_id":row["media_id"],"sent":row["sent"]}

@app.middleware("http")
async def security(request, call_next):
    if request.method in ("POST","PUT","DELETE"):
        origin=request.headers.get("origin")
        if origin and urlparse(origin).netloc.lower()!=request.headers.get("host","").lower():
            return PlainTextResponse("Invalid origin",status_code=403)
    response=await call_next(request)
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["X-Frame-Options"]="DENY"
    response.headers["Referrer-Policy"]="no-referrer"
    response.headers["Permissions-Policy"]="camera=(), geolocation=(), microphone=(self)"
    response.headers["Cross-Origin-Resource-Policy"]="same-origin"
    response.headers["Content-Security-Policy"]="default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self' wss: ws:; frame-ancestors 'none'"
    if request.url.path.startswith(("/api/","/media/")):
        response.headers["Cache-Control"]="private, no-store"
    return response

@app.get("/")
def index():
    return FileResponse(HERE/"static"/"index.html")

@app.get("/static/app.js")
def js():
    return FileResponse(HERE/"static"/"app.js",media_type="application/javascript")

@app.get("/static/style.css")
def css():
    return FileResponse(HERE/"static"/"style.css",media_type="text/css")

@app.get("/health")
def health():
    with connect() as db: db.execute("SELECT count(*) FROM users").fetchone()
    return {"ok":True,"app":"SinfChat Online"}

@app.get("/robots.txt")
def robots():
    return PlainTextResponse("User-agent: *\nDisallow: /api/\nDisallow: /media/\nDisallow: /ws\n")

@app.post("/api/register")
def register(data:Credentials,request:Request,response:Response):
    throttle("register:"+request.client.host,10,3600)
    if len(INVITE_CODE)<8 or not hmac.compare_digest(data.invite_code,INVITE_CODE):
        fail(403,"Taklif kodi xato yoki sozlanmagan")
    name=data.username.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{2,23}",name):
        fail(400,"Username faqat lotin harflari, raqamlar va _")
    if data.admin_code and (len(ADMIN_CODE)<12 or not hmac.compare_digest(data.admin_code,ADMIN_CODE)):
        fail(403,"Admin kodi noto'g'ri")
    salt=secrets.token_hex(16)
    try:
        with LOCK,connect() as db:
            if data.admin_code and db.execute("SELECT 1 FROM users WHERE admin=1").fetchone():
                fail(409,"Admin allaqachon mavjud")
            cur=db.execute("INSERT INTO users(name,salt,password,admin) VALUES(?,?,?,?) RETURNING id",(name,salt,digest(data.password,salt),int(bool(data.admin_code))))
            uid=cur.fetchone()["id"]
            db.commit()
    except (sqlite3.IntegrityError, psycopg.errors.UniqueViolation):
        fail(409,"Bu username band")
    session_cookie(response,uid,request)
    return {"ok":True}

@app.post("/api/login")
def login(data:Credentials,request:Request,response:Response):
    throttle("login:"+request.client.host,25,300)
    with connect() as db:
        row=db.execute("SELECT * FROM users WHERE name=?",(data.username.lower().strip(),)).fetchone()
    if not row or row["banned"] or not hmac.compare_digest(digest(data.password,row["salt"]),row["password"]):
        fail(401,"Username yoki parol xato")
    session_cookie(response,row["id"],request)
    return {"ok":True}

@app.post("/api/logout")
def logout(request:Request,response:Response):
    token=request.cookies.get("sinfchat_session","")
    with LOCK,connect() as db:
        db.execute("DELETE FROM sessions WHERE token=?",(hashlib.sha256(token.encode()).hexdigest(),))
        db.commit()
    response.delete_cookie(legacy.COOKIE,path="/api/legacy")
    response.delete_cookie("sinfchat_session")
    return {"ok":True}

@app.get("/api/me")
def me(request:Request):
    u=current(request)
    return {"id":u["id"],"username":u["name"],"admin":bool(u["admin"])}

@app.get("/api/users")
def users(request:Request):
    u=current(request)
    with connect() as db:
        rows=db.execute("SELECT id,name FROM users WHERE banned=0 AND id<>? ORDER BY name",(u["id"],)).fetchall()
    return [{"id":x["id"],"username":x["name"],"online":bool(clients.get(x["id"]))} for x in rows]

@app.get("/api/messages")
def history(request:Request, peer:int=0, before:int|None=None):
    u=current(request)
    if peer:
        scope = "((m.sender=? AND m.recipient=?) OR (m.sender=? AND m.recipient=?))"
        params = [u["id"], peer, peer, u["id"]]
    else:
        scope = "m.recipient IS NULL"
        params = []
    if before is not None:
        scope += " AND m.id < ?"
        params.append(before)
    with connect() as db:
        rows = db.execute(
            "SELECT m.*,u.name username FROM messages m JOIN users u ON m.sender=u.id "
            f"WHERE {scope} ORDER BY m.id DESC LIMIT 150", params
        ).fetchall()
    return [to_msg(x) for x in reversed(rows)]

@app.post("/api/report")
def report(data:Report,request:Request):
    u=current(request)
    with LOCK, connect() as db:
        row=db.execute("SELECT sender,recipient FROM messages WHERE id=?",(data.message_id,)).fetchone()
        if not row or (row["recipient"] is not None and u["id"] not in (row["sender"],row["recipient"])):
            fail(404,"Xabar topilmadi")
        db.execute("INSERT INTO reports(reporter,message_id,reason,sent) VALUES(?,?,?,?)",(u["id"],data.message_id,data.reason,datetime.now(timezone.utc).isoformat()))
        db.commit()
    return {"ok":True}

@app.get("/api/admin/reports")
def reports(request:Request):
    u=current(request)
    if not u["admin"]: fail(403,"Admin emas")
    with connect() as db:
        rows=db.execute("SELECT * FROM reports ORDER BY id DESC LIMIT 100").fetchall()
    return [dict(x) for x in rows]

@app.post("/api/admin/ban")
async def ban(data:Ban,request:Request):
    u=current(request)
    if not u["admin"]: fail(403,"Admin emas")
    with LOCK, connect() as db:
        row=db.execute("SELECT admin FROM users WHERE id=?",(data.user_id,)).fetchone()
        if not row or row["admin"]:fail(400,"Bu foydalanuvchini bloklab bo'lmaydi")
        db.execute("UPDATE users SET banned=? WHERE id=?",(int(data.banned),data.user_id))
        if data.banned: db.execute("DELETE FROM sessions WHERE uid=?",(data.user_id,))
        db.commit()
    if data.banned:
        # Revoke active websocket access immediately, not just future HTTP requests.
        for active_socket in list(clients.get(data.user_id, set())):
            try:
                await active_socket.close(code=1008, reason="Account restricted")
            except (RuntimeError, OSError):
                pass
    return {"ok":True}

@app.post("/api/media")
async def media(file:UploadFile=File(...),request:Request=None):
    u=current(request)
    throttle("media:"+str(u["id"]),25,3600)
    raw=await file.read(2*1024*1024+1)
    if not raw or len(raw)>2*1024*1024:fail(413,"Fayl 2MB dan oshmasin")
    kind=file.content_type or ""
    if kind in ("image/png","image/jpeg","image/webp"):
        if kind=="image/png" and not raw.startswith(b"\x89PNG\r\n\x1a\n"):fail(400,"Rasm formati xato")
        if kind=="image/jpeg" and not raw.startswith(b"\xff\xd8\xff"):fail(400,"Rasm formati xato")
        if kind=="image/webp" and not (raw[:4]==b"RIFF" and raw[8:12]==b"WEBP"):fail(400,"Rasm formati xato")
    elif kind in ("audio/webm","audio/ogg"):
        if kind=="audio/webm" and not raw.startswith(b"\x1a\x45\xdf\xa3"):fail(400,"Audio formati xato")
        if kind=="audio/ogg" and not raw.startswith(b"OggS"):fail(400,"Audio formati xato")
    else: fail(400,"Faqat rasm yoki ovozli xabar")
    with LOCK,connect() as db:
        cur=db.execute("INSERT INTO media(owner,mime,data) VALUES(?,?,?) RETURNING id",(u["id"],kind,raw))
        mid=cur.fetchone()["id"];db.commit()
    return {"media_id":mid,"mime":kind}

@app.get("/media/{mid}")
def serve_media(mid:int,request:Request):
    u=current(request)
    with connect() as db:
        f=db.execute("SELECT * FROM media WHERE id=?",(mid,)).fetchone()
        if not f:fail(404,"Fayl topilmadi")
        msg=db.execute("SELECT sender,recipient FROM messages WHERE media_id=?",(mid,)).fetchone()
        if msg and msg["recipient"] and u["id"] not in (msg["sender"],msg["recipient"]):fail(404,"Ruxsat yo'q")
        if not msg and f["owner"]!=u["id"]:fail(404,"Ruxsat yo'q")
    return Response(content=f["data"],media_type=f["mime"],headers={"Cache-Control":"private, max-age=600"})

async def send_to(uid,event):
    for ws in list(clients.get(uid,set())):
        try:await ws.send_json(event)
        except Exception:pass

async def emit(event,targets=None):
    for uid in list(clients) if targets is None else targets:
        if uid:await send_to(uid,event)

@app.websocket("/ws")
async def socket(ws:WebSocket):
    origin=ws.headers.get("origin","")
    if not origin or urlparse(origin).netloc.lower()!=ws.headers.get("host","").lower():
        await ws.close(code=1008);return
    try:u=current(ws)
    except HTTPException:
        await ws.close(code=1008);return
    await ws.accept()
    uid = u["id"]
    first_connection = not clients[uid]
    clients[uid].add(ws)
    online_names[uid] = u["name"]
    recent = deque()
    try:
        await ws.send_json({"type":"online", "users":list(clients),
                            "members":[{"id":k, "username":v} for k,v in online_names.items()]})
        if first_connection:
            await emit({"type":"presence","user":uid,"username":u["name"],"online":True})
        while True:
            data=await ws.receive_json()
            if not isinstance(data, dict):
                await ws.send_json({"type":"error","message":"Xabar formati noto'g'ri"});continue
            try:now=current(ws)
            except HTTPException:
                await ws.close(code=1008);break
            kind=data.get("type")
            if kind=="typing":
                nowtime=time.monotonic()
                if recent and nowtime-recent[-1]<0.15:continue
                try:peer=int(data.get("recipient") or 0)
                except (ValueError,TypeError):continue
                if peer<0 or peer==uid:continue
                if peer:
                    with connect() as db:
                        allowed=db.execute("SELECT 1 FROM users WHERE id=? AND banned=0",(peer,)).fetchone()
                    if not allowed:continue
                await emit({"type":"typing","user":uid,"username":u["name"],"recipient":peer or None},[peer] if peer else [n for n in clients if n!=uid])
                continue
            if kind=="delete":
                try:mid=int(data.get("id"))
                except (ValueError,TypeError):continue
                with LOCK,connect() as db:
                    msg=db.execute("SELECT sender,recipient,media_id FROM messages WHERE id=?",(mid,)).fetchone()
                    if not msg or msg["sender"]!=uid:continue
                    db.execute("DELETE FROM messages WHERE id=?",(mid,))
                    if msg["media_id"]:db.execute("DELETE FROM media WHERE id=?",(msg["media_id"],))
                    db.commit()
                await emit({"type":"deleted","id":mid},[uid,msg["recipient"]] if msg["recipient"] else None)
                continue
            if kind!="message":continue
            nowtime=time.monotonic()
            while recent and nowtime-recent[0]>10:recent.popleft()
            if len(recent)>=12:
                await ws.send_json({"type":"error","message":"Juda tez yozayapsiz"});continue
            recent.append(nowtime)
            body=str(data.get("body") or "").strip()[:2000]
            try:peer=int(data.get("recipient") or 0);media_id=int(data.get("media_id") or 0)
            except (ValueError,TypeError):continue
            if peer<0 or media_id<0 or (not body and not media_id):continue
            with LOCK,connect() as db:
                if peer:
                    exists=db.execute("SELECT 1 FROM users WHERE id=? AND banned=0",(peer,)).fetchone()
                    if not exists or peer==uid:continue
                if media_id:
                    f=db.execute("SELECT owner FROM media WHERE id=?",(media_id,)).fetchone()
                    prev=db.execute("SELECT 1 FROM messages WHERE media_id=?",(media_id,)).fetchone()
                    if not f or f["owner"]!=uid or prev:continue
                sent=datetime.now(timezone.utc).isoformat()
                cur=db.execute("INSERT INTO messages(sender,recipient,body,media_id,sent) VALUES(?,?,?,?,?) RETURNING id",(uid,peer or None,body,media_id or None,sent))
                mid=cur.fetchone()["id"];db.commit()
            event={"type":"message","id":mid,"sender":uid,"username":u["name"],"recipient":peer or None,"body":body,"media_id":media_id or None,"sent":sent}
            await emit(event,[uid,peer] if peer else None)
    except (WebSocketDisconnect,ValueError,RuntimeError):pass
    finally:
        clients[uid].discard(ws)
        if not clients[uid]:
            clients.pop(uid,None)
            online_names.pop(uid,None)
            await emit({"type":"presence","user":uid,"online":False})

@app.post("/api/legacy/link")
def legacy_link(data: Credentials, request: Request, response: Response):
    throttle("legacy:"+request.client.host,15,300)
    return legacy.link(request,response,data,current=current,digest=digest,session_cookie=session_cookie,lock=LOCK)

@app.get("/api/legacy/sources")
def legacy_sources(request: Request):
    return legacy.sources(request,current(request))

@app.post("/api/legacy/import")
def import_history(request: Request, peer:int=0, after:int=0):
    return legacy.import_page(request,current(request),peer,after,LOCK)

@app.get("/api/archive")
def archive(request: Request, chat:str|None=None):
    user=current(request)
    with connect() as db:
        rows=(db.execute(legacy.LIST,(user["id"],)) if chat is None else
              db.execute(legacy.READ,(user["id"],chat))).fetchall()
    return [dict(row) for row in rows]
