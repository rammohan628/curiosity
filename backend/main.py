import os, re, io, csv, json, hmac, hashlib, secrets, time, uuid, datetime as dt, concurrent.futures as cf
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text, func, case, Column, Integer, Float, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from openai import OpenAI

load_dotenv()
DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-6-luna")
UPLOAD_DIR = os.path.abspath(os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")))
os.makedirs(UPLOAD_DIR, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://curiosity:curiosity@localhost:3306/curiosity?charset=utf8mb4")
DEFAULT_PRICES = tuple(float(os.getenv(k, d)) for k, d in (("PRICE_INPUT_PER_M", "0.10"), ("PRICE_CACHED_INPUT_PER_M", "0.01"), ("PRICE_OUTPUT_PER_M", "0.50")))
MAX_PDF = 30 * 1024 * 1024
TOKEN_HOURS = 12
ai = OpenAI()  # reads OPENAI_API_KEY

# ---------- database (MySQL) ----------
def ensure_database(url):
    u = make_url(url)
    if u.get_backend_name() != "mysql" or not re.fullmatch(r"\w+", u.database or ""): return
    try:
        with create_engine(u.set(database=None)).begin() as c:
            c.execute(text(f"CREATE DATABASE IF NOT EXISTS `{u.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    except Exception as e:
        print(f"[db] could not auto-create database ({e}); assuming it already exists")

ensure_database(DATABASE_URL)
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()
LongText = Text().with_variant(LONGTEXT(), "mysql")
now = lambda: dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True); name = Column(String(120), nullable=False)
    username = Column(String(60), unique=True, nullable=False); role = Column(String(10), nullable=False)
    password_hash = Column(String(255), nullable=False); active = Column(Boolean, nullable=False, default=True)
    must_change_password = Column(Boolean, nullable=False, default=True); created_at = Column(DateTime, default=now)

class AuthToken(Base):
    __tablename__ = "auth_tokens"
    id = Column(Integer, primary_key=True); user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False); expires_at = Column(DateTime, nullable=False)

class Activity(Base):
    __tablename__ = "activities"
    id = Column(Integer, primary_key=True); title = Column(String(200), nullable=False)
    description = Column(Text); duration_min = Column(Integer, nullable=False)
    file_name = Column(String(255), nullable=False); openai_file_id = Column(String(100), nullable=False)
    state = Column(String(12), nullable=False, default="scheduled")
    started_at = Column(DateTime); created_by = Column(ForeignKey("users.id")); created_at = Column(DateTime, default=now)
    stored_name = Column(String(80)); max_prompts = Column(Integer); allow_download = Column(Boolean, nullable=False, default=True)

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (UniqueConstraint("activity_id", "student_id"),)
    id = Column(Integer, primary_key=True); activity_id = Column(ForeignKey("activities.id"), nullable=False)
    student_id = Column(ForeignKey("users.id"), nullable=False); conversation_id = Column(String(100))
    created_at = Column(DateTime, default=now)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True); session_id = Column(ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role = Column(String(10), nullable=False); content = Column(LongText, nullable=False); created_at = Column(DateTime, default=now)

class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True); session_id = Column(ForeignKey("chat_sessions.id"), unique=True, nullable=False)
    msg_count = Column(Integer, nullable=False); data = Column(LongText, nullable=False); created_at = Column(DateTime, default=now)

class UsageEvent(Base):
    __tablename__ = "usage_events"
    id = Column(Integer, primary_key=True); activity_id = Column(ForeignKey("activities.id"), nullable=False, index=True)
    user_id = Column(ForeignKey("users.id")); kind = Column(String(12), nullable=False); model = Column(String(60), nullable=False)
    input_tokens = Column(Integer, nullable=False, default=0); cached_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0); cost = Column(Float, nullable=False, default=0); created_at = Column(DateTime, default=now)

class Setting(Base):  # runtime-editable configuration (model, output cap, ...)
    __tablename__ = "settings"
    key = Column(String(40), primary_key=True); value = Column(String(255), nullable=False)

class ModelPrice(Base):  # editable price list, USD per 1M tokens
    __tablename__ = "model_prices"
    model = Column(String(60), primary_key=True); input_per_m = Column(Float, nullable=False, default=0)
    cached_per_m = Column(Float, nullable=False, default=0); output_per_m = Column(Float, nullable=False, default=0)

Base.metadata.create_all(engine)

def migrate():  # add columns introduced after the first release (create_all never alters existing tables)
    from sqlalchemy import inspect
    have = {c["name"] for c in inspect(engine).get_columns("activities")}
    adds = {"stored_name": "VARCHAR(80) NULL", "max_prompts": "INT NULL", "allow_download": "TINYINT(1) NOT NULL DEFAULT 1"}
    with engine.begin() as c:
        for k, ddl in adds.items():
            if k not in have: c.execute(text(f"ALTER TABLE activities ADD COLUMN {k} {ddl}"))
migrate()

# ---------- security helpers ----------
def hash_pw(p, iters=150_000):
    salt = secrets.token_hex(16)
    return f"pbkdf2${iters}${salt}${hashlib.pbkdf2_hmac('sha256', p.encode(), salt.encode(), iters).hex()}"
def check_pw(p, stored):
    try:
        _, it, salt, h = stored.split("$")
        return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", p.encode(), salt.encode(), int(it)).hex(), h)
    except Exception: return False
sha = lambda t: hashlib.sha256(t.encode()).hexdigest()
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
temp_password = lambda: "".join(secrets.choice(ALPHABET) for _ in range(10))
FAILS = {}
def throttle_check(k):
    FAILS[k] = [x for x in FAILS.get(k, []) if time.time() - x < 600]
    if len(FAILS[k]) >= 5: raise HTTPException(429, "Too many failed attempts. Try again in a few minutes.")
def check_new_password(p):
    if len(p) < 8: raise HTTPException(400, "Password must be at least 8 characters")

# ---------- schemas / serializers ----------
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=60); password: str = Field(min_length=1, max_length=128)
class PwIn(BaseModel):
    current_password: str; new_password: str = Field(min_length=8, max_length=128)
class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120); username: str = ""; role: str = Field(pattern="^(admin|teacher|student)$"); password: str = ""
class UserPatch(BaseModel):
    active: bool | None = None; name: str | None = Field(default=None, min_length=1, max_length=120)
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

iso = lambda d: d.isoformat() + "Z" if d else None
def ends_at(a): return a.started_at + dt.timedelta(minutes=a.duration_min) if a.started_at else None
def status(a):
    if a.state == "scheduled": return "Scheduled"
    if a.state == "stopped": return "Stopped"
    return "Time Elapsed" if now() >= ends_at(a) else "In Progress"
def act_out(a):
    return dict(id=a.id, title=a.title, description=a.description or "", duration_min=a.duration_min, file_name=a.file_name,
                status=status(a), started_at=iso(a.started_at), ends_at=iso(ends_at(a)),
                max_prompts=a.max_prompts or 0, allow_download=bool(a.allow_download), has_file=bool(a.stored_name))
def msg_out(m): return dict(id=m.id, role=m.role, content=m.content, created_at=iso(m.created_at))
def user_out(u): return dict(id=u.id, name=u.name, username=u.username, role=u.role, active=u.active,
                             must_change_password=u.must_change_password, created_at=iso(u.created_at))

# ---------- app / auth ----------
app = FastAPI(title="Curiosity")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","), allow_methods=["*"], allow_headers=["*"])

def db():
    s = SessionLocal()
    try: yield s
    finally: s.close()

def seed_admin():
    with SessionLocal() as s:
        if s.query(User).filter_by(role="admin").first(): return
        un, pw = os.getenv("ADMIN_USERNAME", "admin").lower(), os.getenv("ADMIN_PASSWORD", "Admin@12345")
        s.add(User(name="Administrator", username=un, role="admin", password_hash=hash_pw(pw), must_change_password=True)); s.commit()
        print(f"[auth] created default admin '{un}' - password change is required at first login")
seed_admin()

def seed_settings():
    with SessionLocal() as s:
        if not s.query(ModelPrice).first():
            s.add(ModelPrice(model=DEFAULT_MODEL, input_per_m=DEFAULT_PRICES[0], cached_per_m=DEFAULT_PRICES[1], output_per_m=DEFAULT_PRICES[2])); s.commit()
seed_settings()
EFFORTS = ("", "none", "minimal", "low", "medium", "high", "xhigh")
def cfg(s):
    d = {r.key: r.value for r in s.query(Setting)}
    return dict(model=d.get("model") or DEFAULT_MODEL, max_output_tokens=int(d.get("max_output_tokens") or 0), reasoning_effort=d.get("reasoning_effort", ""))
def price_map(s): return {p.model: p for p in s.query(ModelPrice)}

def bearer(h): return h.removeprefix("Bearer ").strip()
def auth_user(authorization: str = Header(default=""), s: Session = Depends(db)) -> User:
    t = s.query(AuthToken).filter(AuthToken.token_hash == sha(bearer(authorization)), AuthToken.expires_at > now()).first() if authorization else None
    u = s.get(User, t.user_id) if t else None
    if not u or not u.active: raise HTTPException(401, "Please sign in again")
    return u
def user(u: User = Depends(auth_user)) -> User:
    if u.must_change_password: raise HTTPException(403, "Please change your temporary password first")
    return u
def staff(u: User = Depends(user)) -> User:
    if u.role not in ("admin", "teacher"): raise HTTPException(403, "Staff only")
    return u
def admin(u: User = Depends(user)) -> User:
    if u.role != "admin": raise HTTPException(403, "Administrators only")
    return u

def get_activity(s, id, u=None):
    a = s.get(Activity, id)
    if not a: raise HTTPException(404, "Activity not found")
    if u is not None and u.role == "teacher" and a.created_by != u.id: raise HTTPException(403, "This activity belongs to another teacher")
    return a

@app.post("/api/login")
def login(d: LoginIn, s: Session = Depends(db)):
    k = d.username.strip().lower(); throttle_check(k)
    u = s.query(User).filter_by(username=k).first()
    if not u or not u.active or not check_pw(d.password, u.password_hash):
        FAILS.setdefault(k, []).append(time.time()); raise HTTPException(401, "Invalid username or password")
    FAILS.pop(k, None)
    tok = secrets.token_urlsafe(32)
    s.add(AuthToken(user_id=u.id, token_hash=sha(tok), expires_at=now() + dt.timedelta(hours=TOKEN_HOURS))); s.commit()
    return dict(token=tok, user=user_out(u))

@app.post("/api/logout")
def logout(authorization: str = Header(default=""), s: Session = Depends(db)):
    s.query(AuthToken).filter_by(token_hash=sha(bearer(authorization))).delete(); s.commit(); return dict(ok=True)

@app.get("/api/me")
def me(u: User = Depends(auth_user)): return user_out(u)

@app.post("/api/me/password")
def change_password(d: PwIn, authorization: str = Header(default=""), s: Session = Depends(db), u: User = Depends(auth_user)):
    if not check_pw(d.current_password, u.password_hash): raise HTTPException(400, "Current password is incorrect")
    if d.new_password == d.current_password: raise HTTPException(400, "Choose a password different from the current one")
    u.password_hash, u.must_change_password = hash_pw(d.new_password), False
    s.query(AuthToken).filter(AuthToken.user_id == u.id, AuthToken.token_hash != sha(bearer(authorization))).delete()  # sign out other devices
    s.commit(); return dict(user=user_out(u))

# ---------- user management ----------
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._@-]{2,59}$")
def derive_username(name, taken):
    base = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".")[:50] or "user"
    base = base if len(base) >= 3 else base + "user"
    u, n = base, 1
    while u in taken: n += 1; u = f"{base}{n}"
    return u
def can_manage(actor, target): return actor.role == "admin" or target.role == "student"

@app.get("/api/users")
def list_users(role: str = "", q: str = "", s: Session = Depends(db), u: User = Depends(staff)):
    qs = s.query(User)
    if u.role == "teacher": role = "student"
    if role: qs = qs.filter(User.role == role)
    if q: qs = qs.filter((User.name.like(f"%{q}%")) | (User.username.like(f"%{q}%")))
    return [user_out(x) for x in qs.order_by(User.role, User.name).limit(1000)]

@app.post("/api/users")
def create_user(d: UserIn, s: Session = Depends(db), u: User = Depends(staff)):
    if u.role == "teacher" and d.role != "student": raise HTTPException(403, "Teachers can only create student accounts")
    taken = {x for (x,) in s.query(User.username)}
    un = d.username.strip().lower() or derive_username(d.name, taken)
    if not USERNAME_RE.match(un): raise HTTPException(400, "Username must be 3-60 characters: letters, numbers, . _ @ -")
    if un in taken: raise HTTPException(409, "That username is already taken")
    pw = d.password or temp_password()
    check_new_password(pw)
    x = User(name=d.name.strip(), username=un, role=d.role, password_hash=hash_pw(pw), must_change_password=True)
    s.add(x); s.commit()
    return dict(user=user_out(x), password=pw)

@app.post("/api/users/upload")
def upload_students(file: UploadFile = File(...), s: Session = Depends(db), u: User = Depends(staff)):
    raw = file.file.read(1_000_001)
    if len(raw) > 1_000_000: raise HTTPException(400, "CSV must be under 1 MB")
    try: rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    except Exception: raise HTTPException(400, "Could not read the CSV (use UTF-8)")
    if not rows: raise HTTPException(400, "The CSV has no rows. Expected columns: name, username (optional), password (optional)")
    if len(rows) > 500: raise HTTPException(400, "Upload at most 500 students at a time")
    taken = {x for (x,) in s.query(User.username)}; todo, skipped = [], []
    for i, r in enumerate(rows, 2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        name, given, pw = r.get("name", ""), (r.get("username") or r.get("email") or "").lower(), r.get("password", "")
        if not name: skipped.append(dict(row=i, name="", reason="Missing name")); continue
        if given:
            if not USERNAME_RE.match(given): skipped.append(dict(row=i, name=name, reason="Invalid username")); continue
            if given in taken: skipped.append(dict(row=i, name=name, reason=f"Username '{given}' already exists")); continue
            un = given
        else: un = derive_username(name, taken)
        if pw and len(pw) < 8: skipped.append(dict(row=i, name=name, reason="Password shorter than 8 characters")); continue
        taken.add(un); todo.append((name[:120], un, pw or temp_password()))
    with cf.ThreadPoolExecutor(8) as ex: hashes = list(ex.map(lambda t: hash_pw(t[2]), todo))
    s.add_all([User(name=n, username=un, role="student", password_hash=h, must_change_password=True) for (n, un, _), h in zip(todo, hashes)])
    s.commit()
    return dict(created=[dict(name=n, username=un, password=p) for n, un, p in todo], skipped=skipped)

@app.patch("/api/users/{id}")
def patch_user(id: int, d: UserPatch, s: Session = Depends(db), u: User = Depends(staff)):
    x = s.get(User, id)
    if not x or not can_manage(u, x): raise HTTPException(404, "User not found")
    if d.active is not None:
        if x.id == u.id and not d.active: raise HTTPException(400, "You cannot deactivate your own account")
        x.active = d.active
        if not d.active: s.query(AuthToken).filter_by(user_id=x.id).delete()
    if d.name: x.name = d.name.strip()
    s.commit(); return user_out(x)

@app.post("/api/users/{id}/reset-password")
def reset_password(id: int, s: Session = Depends(db), u: User = Depends(staff)):
    x = s.get(User, id)
    if not x or not can_manage(u, x): raise HTTPException(404, "User not found")
    if x.id == u.id: raise HTTPException(400, "Use “Change password” for your own account")
    pw = temp_password(); x.password_hash, x.must_change_password = hash_pw(pw), True
    s.query(AuthToken).filter_by(user_id=x.id).delete(); s.commit()
    return dict(name=x.name, username=x.username, password=pw)

# ---------- AI usage + cost ----------
_n = lambda v: int(v) if isinstance(v, (int, float)) else 0
def usage_of(r):
    us = getattr(r, "usage", None)
    i, o = _n(getattr(us, "input_tokens", 0)), _n(getattr(us, "output_tokens", 0))
    c = min(i, _n(getattr(getattr(us, "input_tokens_details", None), "cached_tokens", 0)))
    return dict(i=i, c=c, o=o)
def cost_of(p, i, c, o): return 0.0 if not p else ((i - c) * p.input_per_m + c * p.cached_per_m + o * p.output_per_m) / 1e6
def log_usage(s, activity_id, user_id, kind, us, model):
    s.add(UsageEvent(activity_id=activity_id, user_id=user_id, kind=kind, model=model, input_tokens=us["i"], cached_tokens=us["c"], output_tokens=us["o"],
                     cost=cost_of(price_map(s).get(model), us["i"], us["c"], us["o"])))

def costs_payload(s, ids):
    """Costs are computed from stored token counts with the CURRENT price list, so editing prices re-prices the whole report."""
    rows, pm = {}, price_map(s)
    if ids:
        E = UsageEvent
        q = (s.query(E.activity_id, E.user_id, E.model, E.kind, func.count(E.id), func.sum(E.input_tokens), func.sum(E.cached_tokens), func.sum(E.output_tokens))
             .filter(E.activity_id.in_(ids)).group_by(E.activity_id, E.user_id, E.model, E.kind).all())
        titles = {a.id: a.title for a in s.query(Activity).filter(Activity.id.in_(ids))}
        names = {x.id: (x.name, x.username) for x in s.query(User)}
        for aid, uid, model, kind, calls, i, c, o in q:
            i, c, o = int(i or 0), int(c or 0), int(o or 0); cost = cost_of(pm.get(model), i, c, o)
            nm = names.get(uid, ("Class summary", "")) if uid else ("Class summary", "")
            r = rows.setdefault((aid, uid, model), dict(activity_id=aid, activity=titles.get(aid, "?"), user_id=uid, user=nm[0], username=nm[1], model=model, calls=0,
                                                      messages=0, input_tokens=0, cached_tokens=0, output_tokens=0, cost=0.0, chat_cost=0.0, analysis_cost=0.0, priced=model in pm))
            r["calls"] += calls; r["input_tokens"] += i; r["cached_tokens"] += c; r["output_tokens"] += o; r["cost"] += cost
            if kind == "chat": r["chat_cost"] += cost; r["messages"] += calls
            if kind == "analysis": r["analysis_cost"] += cost
    rows = list(rows.values()); active = cfg(s)["model"]; used = {r["model"] for r in rows} | {active}
    tot = {k: sum(r[k] for r in rows) for k in ("cost", "input_tokens", "cached_tokens", "output_tokens", "calls")}
    pricing = dict(active_model=active, models={m: dict(input_per_m=p.input_per_m, cached_per_m=p.cached_per_m, output_per_m=p.output_per_m) for m, p in pm.items() if m in used})
    return dict(rows=rows, totals=tot, pricing=pricing)

@app.get("/api/reports/costs")
def cost_report(s: Session = Depends(db), u: User = Depends(staff)):
    q = s.query(Activity.id)
    if u.role == "teacher": q = q.filter(Activity.created_by == u.id)
    return costs_payload(s, [i for (i,) in q])

@app.get("/api/activities/{id}/costs")
def activity_costs(id: int, s: Session = Depends(db), u: User = Depends(staff)):
    return costs_payload(s, [get_activity(s, id, u).id])

# ---------- admin settings: model + price list ----------
class PriceIn(BaseModel):
    model: str = Field(min_length=1, max_length=60); input_per_m: float = Field(ge=0, le=100000)
    cached_per_m: float = Field(ge=0, le=100000); output_per_m: float = Field(ge=0, le=100000)
class SettingsIn(BaseModel):
    model: str = Field(min_length=1, max_length=60); max_output_tokens: int = Field(ge=0, le=128000); reasoning_effort: str = ""; prices: list[PriceIn]
def settings_out(s):
    return dict(**cfg(s), prices=[dict(model=p.model, input_per_m=p.input_per_m, cached_per_m=p.cached_per_m, output_per_m=p.output_per_m) for p in sorted(price_map(s).values(), key=lambda p: p.model)])
def set_setting(s, k, v):
    row = s.get(Setting, k)
    if row: row.value = str(v)
    else: s.add(Setting(key=k, value=str(v)))

@app.get("/api/settings")
def get_settings(s: Session = Depends(db), u: User = Depends(admin)): return settings_out(s)

@app.put("/api/settings")
def put_settings(d: SettingsIn, s: Session = Depends(db), u: User = Depends(admin)):
    if d.reasoning_effort not in EFFORTS: raise HTTPException(400, "Unknown reasoning effort")
    new = {p.model.strip(): p for p in d.prices if p.model.strip()}
    if d.model.strip() not in new: raise HTTPException(400, "The selected model needs an entry in the price list")
    pm = price_map(s)
    for name, p in new.items():
        row = pm.get(name) or ModelPrice(model=name)
        row.input_per_m, row.cached_per_m, row.output_per_m = p.input_per_m, p.cached_per_m, p.output_per_m; s.add(row)
    set_setting(s, "model", d.model.strip()); set_setting(s, "max_output_tokens", d.max_output_tokens); set_setting(s, "reasoning_effort", d.reasoning_effort)
    s.commit(); return settings_out(s)

@app.post("/api/settings/test")
def test_model(model: str, u: User = Depends(admin)):
    try:
        r = ai.responses.create(model=model, input="Reply with the single word OK.", max_output_tokens=64)
        return dict(ok=True, message=(r.output_text or "")[:80])
    except Exception as e: return dict(ok=False, message=str(e)[:300])

# ---------- activities ----------
@app.get("/api/activities")
def list_activities(s: Session = Depends(db), u: User = Depends(user)):
    q = s.query(Activity)
    if u.role == "teacher": q = q.filter(Activity.created_by == u.id)
    return [act_out(a) for a in q.order_by(Activity.id.desc())]

@app.post("/api/activities")
def create_activity(title: str = Form(..., max_length=200), description: str = Form(""), duration_min: int = Form(30, ge=1, le=600),
                    max_prompts: int = Form(0, ge=0, le=500), allow_download: bool = Form(True),
                    file: UploadFile = File(...), s: Session = Depends(db), u: User = Depends(staff)):
    data = file.file.read()
    if not (file.filename or "").lower().endswith(".pdf") or data[:4] != b"%PDF": raise HTTPException(400, "Please upload a PDF file")
    if len(data) > MAX_PDF: raise HTTPException(400, "PDF must be under 30 MB")
    try: f = ai.files.create(file=(file.filename, data, "application/pdf"), purpose="user_data")  # stored once at OpenAI
    except Exception as e: raise HTTPException(502, f"Could not upload PDF to OpenAI: {e}")
    stored = uuid.uuid4().hex + ".pdf"  # local copy so students/teachers can download the original
    with open(os.path.join(UPLOAD_DIR, stored), "wb") as fh: fh.write(data)
    a = Activity(title=title.strip(), description=description.strip(), duration_min=duration_min, file_name=file.filename[:255], openai_file_id=f.id,
                 created_by=u.id, stored_name=stored, max_prompts=max_prompts or None, allow_download=allow_download)
    s.add(a); s.commit(); return act_out(a)

class ActivityPatch(BaseModel):
    max_prompts: int | None = Field(default=None, ge=0, le=500); allow_download: bool | None = None

@app.patch("/api/activities/{id}")
def patch_activity(id: int, d: ActivityPatch, s: Session = Depends(db), u: User = Depends(staff)):
    a = get_activity(s, id, u)
    if d.max_prompts is not None: a.max_prompts = d.max_prompts or None
    if d.allow_download is not None: a.allow_download = d.allow_download
    s.commit(); return act_out(a)

@app.get("/api/activities/{id}/file")
def download_file(id: int, s: Session = Depends(db), u: User = Depends(user)):
    a = get_activity(s, id, u)
    if u.role == "student" and not a.allow_download: raise HTTPException(403, "Your teacher has disabled downloads for this activity")
    path = os.path.join(UPLOAD_DIR, a.stored_name or "")
    if not a.stored_name or not os.path.isfile(path): raise HTTPException(404, "The original PDF is not available for download")
    return FileResponse(path, media_type="application/pdf", filename=a.file_name)

@app.post("/api/activities/{id}/start")
def start(id: int, s: Session = Depends(db), u: User = Depends(staff)):
    a = get_activity(s, id, u)
    if a.state != "scheduled": raise HTTPException(400, "Activity already started")
    a.state, a.started_at = "in_progress", now(); s.commit(); return act_out(a)

@app.post("/api/activities/{id}/stop")
def stop(id: int, s: Session = Depends(db), u: User = Depends(staff)):
    a = get_activity(s, id, u); a.state = "stopped"; s.commit(); return act_out(a)

# ---------- student chat (one private OpenAI conversation per student) ----------
def own_session(s, a, u): return s.query(ChatSession).filter_by(activity_id=a.id, student_id=u.id).first()
def chat_state(s, a, cs):
    msgs = s.query(Message).filter_by(session_id=cs.id).order_by(Message.id).all() if cs else []
    used, lim = sum(1 for m in msgs if m.role == "student"), a.max_prompts or 0
    return dict(activity=act_out(a), can_send=status(a) == "In Progress", messages=[msg_out(m) for m in msgs],
                prompts_used=used, max_prompts=lim, prompts_left=max(0, lim - used) if lim else None, limit_reached=bool(lim and used >= lim))

@app.get("/api/activities/{id}/chat")
def get_chat(id: int, s: Session = Depends(db), u: User = Depends(user)):
    a = get_activity(s, id); return chat_state(s, a, own_session(s, a, u))

SYSTEM = ("You are a friendly tutor for the activity '{t}'. Teacher's note: {d}. "
          "Answer the student's questions using the attached PDF as your source of truth. Explain clearly, give short examples, "
          "and if the answer is not in the PDF, say so briefly before offering general help. Keep replies concise and use clean Markdown (short paragraphs, bullet lists, **bold** key terms, fenced code blocks).")

@app.post("/api/activities/{id}/chat")
def send(id: int, d: ChatIn, s: Session = Depends(db), u: User = Depends(user)):
    if u.role != "student": raise HTTPException(403, "Only students can chat")
    a = get_activity(s, id)
    if status(a) != "In Progress": raise HTTPException(409, "This activity is not accepting messages")
    msg = d.message.strip()
    if not msg: raise HTTPException(400, "Message is empty")
    cs = own_session(s, a, u)
    if not cs: cs = ChatSession(activity_id=a.id, student_id=u.id); s.add(cs); s.commit()
    lim = a.max_prompts or 0
    if lim and s.query(Message).filter_by(session_id=cs.id, role="student").count() >= lim:
        raise HTTPException(429, f"You have used all {lim} prompts for this activity")
    c = cfg(s)
    content = [{"type": "input_text", "text": msg}]
    if not cs.conversation_id:  # the PDF is attached ONCE, as the opening context of this student's conversation
        content.insert(0, {"type": "input_file", "file_id": a.openai_file_id})
    try:
        conv_id = cs.conversation_id or ai.conversations.create().id
        kw = dict(model=c["model"], conversation=conv_id, instructions=SYSTEM.format(t=a.title, d=a.description or "none"),
                  input=[{"role": "user", "content": content}], prompt_cache_key=f"activity-{a.id}")  # instructions + PDF form a prefix shared by all students -> cache hits
        if c["max_output_tokens"]: kw["max_output_tokens"] = c["max_output_tokens"]
        if c["reasoning_effort"]: kw["reasoning"] = {"effort": c["reasoning_effort"]}
        try: r = ai.responses.create(**kw)
        except Exception as e:
            if "prompt_cache_key" not in str(e): raise
            kw.pop("prompt_cache_key"); r = ai.responses.create(**kw)
        reply = r.output_text
        if not (reply or "").strip(): raise RuntimeError("The answer was cut off by the output limit. Ask an administrator to raise it in Settings.")
    except Exception as e: raise HTTPException(502, f"The AI could not answer: {e}")
    cs.conversation_id = conv_id
    s.add_all([Message(session_id=cs.id, role="student", content=msg), Message(session_id=cs.id, role="assistant", content=reply)])
    log_usage(s, a.id, u.id, "chat", usage_of(r), c["model"]); s.commit()
    return chat_state(s, a, cs)

# ---------- staff: all conversations, prompt analysis, class summary ----------
def sessions_payload(s, a):
    out = []
    for cs in s.query(ChatSession).filter_by(activity_id=a.id).all():
        ms = s.query(Message).filter_by(session_id=cs.id).order_by(Message.id).all()
        if not ms: continue
        an = s.query(Analysis).filter_by(session_id=cs.id).first(); st = s.get(User, cs.student_id)
        out.append(dict(session_id=cs.id, student=st.name, message_count=len(ms), messages=[msg_out(m) for m in ms],
                        analysis=json.loads(an.data) if an else None, stale=bool(an and an.msg_count != len(ms))))
    return dict(activity=act_out(a), sessions=out)

@app.get("/api/activities/{id}/sessions")
def sessions(id: int, s: Session = Depends(db), u: User = Depends(staff)): return sessions_payload(s, get_activity(s, id, u))

RUBRIC = """You are an experienced teacher auditing how a student used an AI tutor on a classroom activity. The attached PDF is the assignment material.
Judge ONLY the student's prompts (short AI replies are shown for context). Be calibrated and strict: 5 is average, 8+ is rare.
Scores are integers 0-10:
- relevance: how closely the prompts relate to the specific content of the PDF.
- depth: how deeply the student probes the concepts (why/how questions, follow-ups, applying ideas, challenging or verifying answers, asking for examples) versus only asking for definitions or answers to copy.
- focus: how consistently the student stays on task. Score low for greetings only, small talk, jokes, nonsense, repeatedly testing the bot, trying to make the AI do the work, or unrelated topics.
Label every prompt: deep | relevant | casual | off_topic.
Engagement: deep (real concept-building) | engaged (on task, moderate) | surface (shallow, copy-style or very few prompts) | off_task (mostly unrelated or nonsense).
Reply with ONLY a JSON object:
{"relevance":0,"depth":0,"focus":0,"engagement":"surface","summary":"2-3 sentences for the teacher","strengths":["..."],"concerns":["..."],"concepts_explored":["PDF topics the student actually explored"],"concepts_missed":["important PDF topics never touched"],"feedback_to_student":"a direct, kind, specific message the teacher can send to correct the student and push them deeper","prompts":[{"n":1,"label":"deep","note":"max 12 words"}]}
Include one entry in prompts for every numbered prompt."""

def _int(v):
    try: return max(0, min(10, int(round(float(v)))))
    except Exception: return 0
def _list(v, n=6): return [str(x)[:300] for x in v][:n] if isinstance(v, list) else []
def clean_analysis(d, n):
    rel, dep, foc = _int(d.get("relevance")), _int(d.get("depth")), _int(d.get("focus")); prompts = []
    for p in d.get("prompts") if isinstance(d.get("prompts"), list) else []:
        if isinstance(p, dict) and isinstance(p.get("n"), int) and 1 <= p["n"] <= n:
            prompts.append(dict(n=p["n"], label=p.get("label") if p.get("label") in ("deep", "relevant", "casual", "off_topic") else "casual", note=str(p.get("note", ""))[:120]))
    return dict(relevance=rel, depth=dep, focus=foc, overall=round(0.4 * rel + 0.4 * dep + 0.2 * foc, 1),
                engagement=d.get("engagement") if d.get("engagement") in ("deep", "engaged", "surface", "off_task") else "surface",
                summary=str(d.get("summary", ""))[:800], strengths=_list(d.get("strengths")), concerns=_list(d.get("concerns")),
                concepts_explored=_list(d.get("concepts_explored"), 8), concepts_missed=_list(d.get("concepts_missed"), 8),
                feedback_to_student=str(d.get("feedback_to_student", ""))[:1200], prompts=prompts)

def analyse_one(model, file_id, title, note, pairs, aid=0):
    body = f"Activity: {title}\nTeacher note: {note or 'none'}\n\n" + "\n\n".join(f"Prompt {i}: {p}\n(AI replied: {r[:300]})" for i, (p, r) in enumerate(pairs, 1))
    r = ai.responses.create(model=model, instructions=RUBRIC, prompt_cache_key=f"analysis-{aid}", text={"format": {"type": "json_object"}},
                            input=[{"role": "user", "content": [{"type": "input_file", "file_id": file_id},
                                    {"type": "input_text", "text": body[:40000] + "\n\nReturn your analysis as a single JSON object."}]}])
    return clean_analysis(json.loads(r.output_text), len(pairs)), usage_of(r)

@app.post("/api/activities/{id}/analysis")
def analyse(id: int, force: bool = False, s: Session = Depends(db), u: User = Depends(staff)):
    a = get_activity(s, id, u); aid, fid, title, note = a.id, a.openai_file_id, a.title, a.description; model = cfg(s)["model"]; jobs = []
    for cs in s.query(ChatSession).filter_by(activity_id=id).all():
        ms = s.query(Message).filter_by(session_id=cs.id).order_by(Message.id).all()
        an = s.query(Analysis).filter_by(session_id=cs.id).first()
        if not any(m.role == "student" for m in ms) or (an and an.msg_count == len(ms) and not force): continue
        pairs = [(m.content, ms[i + 1].content if i + 1 < len(ms) else "") for i, m in enumerate(ms) if m.role == "student"]
        jobs.append((cs.id, cs.student_id, len(ms), pairs))
    def run(j):
        try: return j, analyse_one(model, fid, title, note, j[3], aid), None
        except Exception as e: return j, None, str(e)
    with cf.ThreadPoolExecutor(4) as ex: results = list(ex.map(run, jobs))
    errors = []
    for j, res, err in results:
        if err: errors.append(err[:200]); continue
        data, us = res; log_usage(s, aid, j[1], "analysis", us, model)
        an = s.query(Analysis).filter_by(session_id=j[0]).first()
        if an: an.msg_count, an.data, an.created_at = j[2], json.dumps(data), now()
        else: s.add(Analysis(session_id=j[0], msg_count=j[2], data=json.dumps(data)))
    s.commit()
    return {**sessions_payload(s, a), "errors": errors[:3]}

@app.get("/api/activities/{id}/insights")
def insights(id: int, s: Session = Depends(db), u: User = Depends(staff)):
    a = get_activity(s, id, u); parts = []
    for cs in s.query(ChatSession).filter_by(activity_id=id).all():
        qs = [m.content for m in s.query(Message).filter_by(session_id=cs.id, role="student").order_by(Message.id)]
        if qs: parts.append(f"Student {s.get(User, cs.student_id).name} asked:\n- " + "\n- ".join(qs))
    if not parts: return dict(report="No student questions yet.")
    prompt = ("Activity: %s. Below are the questions students asked about the activity PDF. Write a short teacher report: "
              "1) topics students engaged with most, 2) concepts that seem confusing, 3) students who may need help, "
              "4) suggested follow-up. Be concise.\n\n%s" % (a.title, "\n\n".join(parts)[:60000]))
    m = cfg(s)["model"]
    try: r = ai.responses.create(model=m, input=prompt)
    except Exception as e: raise HTTPException(502, f"Could not build report: {e}")
    log_usage(s, a.id, None, "summary", usage_of(r), m); s.commit()
    return dict(report=r.output_text)
