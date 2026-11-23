"""Opt-in recovery from the original class server, scoped to the signed-in member."""
import hmac
import secrets
import sqlite3
from threading import Lock

import httpx
import psycopg
from fastapi import HTTPException

from storage import connect

ORIGIN = "https://sinfchat-online-2026.onrender.com"
COOKIE = "sinfchat_archive_session"
SCHEMA = """CREATE TABLE IF NOT EXISTS legacy_messages(
 owner INTEGER NOT NULL, chat TEXT NOT NULL, legacy_id INTEGER NOT NULL, sent TEXT NOT NULL,
 author TEXT NOT NULL, body TEXT NOT NULL, attachment INTEGER, media_id INTEGER,
 PRIMARY KEY(owner,chat,legacy_id,sent))"""
LIST = "SELECT chat,COUNT(*) AS total FROM legacy_messages WHERE owner=? GROUP BY chat ORDER BY chat"
READ = "SELECT legacy_id,sent,author,body,attachment,media_id FROM legacy_messages WHERE owner=? AND chat=? ORDER BY sent,legacy_id"
IMPORT_LOCKS = [Lock() for _ in range(31)]
SAVE = ("INSERT INTO legacy_messages(owner,chat,legacy_id,sent,author,body,attachment,media_id) VALUES(?,?,?,?,?,?,?,?) "
        "ON CONFLICT(owner,chat,legacy_id,sent) DO UPDATE SET media_id=COALESCE(legacy_messages.media_id,excluded.media_id)")


def call(client, path, payload=None):
    try:
        r = client.get(path) if payload is None else client.post(path, json=payload)
    except httpx.HTTPError:
        raise HTTPException(503, "Eski server bilan aloqa uzildi. Yana urinib ko‘ring.")
    if r.status_code in (401, 403):
        raise HTTPException(401, "Eski akkaunt nomi va parolini tekshiring yoki qayta kiring.")
    if r.status_code == 429:
        raise HTTPException(429, "Eski serverda urinishlar chegarasiga yetildi. Birozdan keyin qayta urining.")
    if r.status_code >= 300:
        raise HTTPException(503, "Eski server hozir javob bera olmayapti.")
    if "application/json" not in r.headers.get("content-type",""):
        raise HTTPException(503, "Eski server ishga tushyapti. Birozdan keyin qayta urining.")
    return r


def client_for(request):
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Avval eski akkauntingizni tasdiqlang.")
    return httpx.Client(base_url=ORIGIN, cookies={"sinfchat_session":token}, timeout=12)


def verify_owner(client, user):
    remote = call(client, "/api/me").json()
    if remote["username"] != user["name"]:
        raise HTTPException(403, "Faqat o‘z akkauntingizdagi yozishmalarni ko‘chira olasiz.")
    return remote


def link(request, response, data, *, current, digest, session_cookie, lock):
    name = data.username.strip().lower()
    try:
        active = current(request)
    except HTTPException:
        active = None
    if active and active["name"] != name:
        raise HTTPException(409, "Hozir kirilgan akkaunt nomini kiriting.")
    with httpx.Client(base_url=ORIGIN, timeout=httpx.Timeout(60,connect=8)) as client:
        call(client, "/api/login", {"username":name,"password":data.password})
        remote = call(client, "/api/me").json()
        token = client.cookies.get("sinfchat_session")
        if not token or remote.get("username") != name:
            raise HTTPException(403, "Eski akkaunt tasdiqlanmadi.")
    with lock, connect() as db:
        row = db.execute("SELECT * FROM users WHERE name=?", (name,)).fetchone()
        if row:
            if row["banned"] or (not active and not hmac.compare_digest(digest(data.password,row["salt"]),row["password"])):
                raise HTTPException(409, "Avval yangi saytdagi akkauntingizga kiring, keyin arxivni ulang.")
            uid = row["id"]
        else:
            salt = secrets.token_hex(16)
            try:
                uid = db.execute("INSERT INTO users(name,salt,password,admin) VALUES(?,?,?,?) RETURNING id",
                                 (name,salt,digest(data.password,salt),0)).fetchone()["id"]
            except (sqlite3.IntegrityError, psycopg.errors.UniqueViolation):
                raise HTTPException(409, "Akkaunt mavjud. Qayta kiring.")
    if not active:
        session_cookie(response,uid,request)
    secure = request.url.scheme=="https" or request.headers.get("x-forwarded-proto","").startswith("https")
    response.set_cookie(COOKIE,token,max_age=3600,httponly=True,secure=secure,samesite="strict",path="/api/legacy")
    return {"ok":True}


def sources(request,user):
    with client_for(request) as client:
        verify_owner(client,user)
        members=call(client,"/api/users").json()
    return [{"id":0,"name":"Guruh"}]+[{"id":u["id"],"name":u["username"]} for u in members]


def import_page(request,user,peer,after,lock):
    guard=IMPORT_LOCKS[user["id"] % len(IMPORT_LOCKS)]
    if not guard.acquire(blocking=False):
        raise HTTPException(409,"Ko‘chirish davom etyapti. Birozdan keyin qayta urining.")
    try:
        return copy_page(request,user,peer,after,lock)
    finally:
        guard.release()


def copy_page(request,user,peer,after,lock):
    with client_for(request) as client:
        remote=verify_owner(client,user)
        rows=call(client,f"/api/messages?peer={peer}").json()
        pending=[m for m in rows if m["id"]>after]
        page=pending[:12]
        if peer:
            members=call(client,"/api/users").json()
            chat=next((u["username"] for u in members if u["id"]==peer),None)
            if not chat:
                raise HTTPException(404,"Eski suhbat topilmadi.")
        else:
            chat="Guruh"
        missing=0
        with connect() as db:
            known={(row["legacy_id"],row["sent"]):row for row in db.execute(READ,(user["id"],chat)).fetchall()}
        saved=[]
        for m in page:
            if peer and {m["sender"],m["recipient"]}!={remote["id"],peer}:
                raise HTTPException(403,"Suhbat ishtirokchilari mos kelmadi.")
            if not peer and m["recipient"] is not None:
                raise HTTPException(403,"Guruh xabari tasdiqlanmadi.")
            key=(user["id"],chat,m["id"],m["sent"])
            mid=None
            old=known.get((m["id"],m["sent"]))
            if old and (old["media_id"] or not m["media_id"]):
                continue
            if m["media_id"]:
                try:
                    file=client.get(f"/media/{int(m['media_id'])}")
                except httpx.HTTPError:
                    raise HTTPException(503,"Faylni ko‘chirish uzildi. Qayta urining.")
                if file.status_code==404:
                    missing+=1
                elif file.status_code!=200:
                    raise HTTPException(503,"Eski faylni yuklab bo‘lmadi.")
                elif len(file.content)<=2097152 and file.headers.get("content-type","").split(";")[0] in (
                    "image/png","image/jpeg","image/webp","audio/ogg","audio/webm"):
                    with lock,connect() as db:
                        mid=db.execute("INSERT INTO media(owner,mime,data) VALUES(?,?,?) RETURNING id",
                                       (user["id"],file.headers["content-type"],file.content)).fetchone()["id"]
                else:
                    missing+=1
            record=(*key,m["username"],m["body"],m["media_id"],mid)
            if mid:
                # Persist the attachment reference before starting the next download.
                with lock,connect() as db:
                    db.execute(SAVE,record)
            else:
                saved.append(record)
        for offset in range(0,len(saved),8):
            with lock,connect() as db:
                for record in saved[offset:offset+8]:
                    db.execute(SAVE,record)
        return {"after":page[-1]["id"] if page else after,"more":len(pending)>len(page),"missing":missing}
