"""MCP OAuth 授權伺服器的 HTTP 面（2026-09-09）。
公開端點（不掛 /api）：/.well-known/*、/oauth/register、/oauth/authorize、/oauth/token、/oauth/revoke、/oauth/consent（陽春同意頁）。
給前端的（掛 /api/oauth，一般 JWT）：requests/{id}、decide、grants、grants/{id}。
"""
from __future__ import annotations

import base64
import html
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.user import User
from services import oauth_service
from services.oauth_service import OAuthError
from utils.deps import get_current_user, get_db

router = APIRouter(tags=["oauth"])
api = APIRouter(prefix="/api/oauth", tags=["oauth"])

_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _err(e: OAuthError) -> JSONResponse:
    return JSONResponse({"error": e.error, "error_description": e.description}, status_code=e.status, headers=_NO_STORE)


# ───────── discovery ─────────

@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/oauth-authorization-server/mcp")
@router.get("/.well-known/openid-configuration")
def as_metadata():
    return JSONResponse(oauth_service.as_metadata(), headers={"Cache-Control": "public, max-age=3600"})


@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
def resource_metadata():
    return JSONResponse(oauth_service.resource_metadata(), headers={"Cache-Control": "public, max-age=3600"})


# ───────── DCR ─────────

@router.post("/oauth/register", status_code=201)
async def register(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
    except Exception:
        return _err(OAuthError("invalid_client_metadata", "要是 JSON"))
    if not isinstance(body, dict):
        return _err(OAuthError("invalid_client_metadata", "要是 JSON 物件"))
    try:
        out = oauth_service.register_client(db, body)
    except OAuthError as e:
        return _err(e)
    db.commit()
    return JSONResponse(out, status_code=201, headers=_NO_STORE)


# ───────── authorize ─────────

@router.get("/oauth/authorize")
def authorize(request: Request, db: Session = Depends(get_db)):
    params = dict(request.query_params)
    try:
        req = oauth_service.start_request(db, params)
    except OAuthError as e:
        # client / redirect_uri 本身有問題不能跳回去，直接顯示；其他錯照規範帶回 redirect_uri
        import json as _json
        client = oauth_service.get_client(db, params.get("client_id", ""))
        redirect_uri = params.get("redirect_uri", "")
        registered = _json.loads(client.redirect_uris or "[]") if client else []
        if client and redirect_uri in registered and e.error not in ("invalid_client",) and "redirect_uri" not in e.description:
            q = {"error": e.error, "error_description": e.description}
            if params.get("state"):
                q["state"] = params["state"]
            sep = "&" if "?" in redirect_uri else "?"
            return RedirectResponse(f"{redirect_uri}{sep}{urlencode(q)}", status_code=302, headers=_NO_STORE)
        return HTMLResponse(_page("連不上", f"<p>這個 app 的授權請求有問題：{html.escape(e.description or e.error)}</p><p>請回到 app 重新連線。</p>"), status_code=400)
    db.commit()
    return RedirectResponse(oauth_service.consent_url(req), status_code=302, headers=_NO_STORE)


# ───────── token / revoke ─────────

def _client_creds(request: Request, form: dict) -> tuple[str, str | None]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("basic "):
        try:
            raw = base64.b64decode(auth[6:]).decode()
            cid, _, sec = raw.partition(":")
            return cid, sec
        except Exception:
            pass
    return form.get("client_id", ""), form.get("client_secret")


@router.post("/oauth/token")
async def token(request: Request, db: Session = Depends(get_db)):
    ct = request.headers.get("content-type", "")
    try:
        if "json" in ct:
            form = await request.json()
        else:
            form = dict(await request.form())
    except Exception:
        return _err(OAuthError("invalid_request", "要用 form 或 JSON"))
    cid, secret = _client_creds(request, form)
    try:
        client = oauth_service.authenticate_client(db, cid, secret)
        gt = form.get("grant_type")
        if gt == "authorization_code":
            out = oauth_service.exchange_code(db, client, form.get("code", ""), form.get("redirect_uri"), form.get("code_verifier"), form.get("resource"))
        elif gt == "refresh_token":
            out = oauth_service.refresh(db, client, form.get("refresh_token"))
        else:
            raise OAuthError("unsupported_grant_type", "只支援 authorization_code / refresh_token")
    except OAuthError as e:
        db.commit()
        return _err(e)
    db.commit()
    return JSONResponse(out, headers=_NO_STORE)


@router.post("/oauth/revoke")
async def revoke(request: Request, db: Session = Depends(get_db)):
    try:
        form = dict(await request.form())
    except Exception:
        form = {}
    cid, secret = _client_creds(request, form)
    client = None
    if cid:
        try:
            client = oauth_service.authenticate_client(db, cid, secret)
        except OAuthError as e:
            return _err(e)
    tok = form.get("token", "")
    if tok:
        oauth_service.revoke(db, client, tok)
        db.commit()
    return JSONResponse({}, headers=_NO_STORE)


# ───────── 給前端的 ─────────

class DecideRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=36)
    approve: bool


@api.get("/requests/{request_id}")
def get_request(request_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = oauth_service.get_request(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="找不到這個授權請求")
    try:
        return oauth_service.request_view(db, req, current_user)
    except OAuthError as e:
        raise HTTPException(status_code=e.status, detail=e.description)


@api.post("/decide")
def decide(body: DecideRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = oauth_service.get_request(db, body.request_id)
    if not req:
        raise HTTPException(status_code=404, detail="找不到這個授權請求")
    try:
        redirect_to = oauth_service.decide(db, req, current_user, body.approve)
    except OAuthError as e:
        raise HTTPException(status_code=e.status, detail=e.description)
    db.commit()
    return {"redirect_to": redirect_to, "approved": body.approve}


@api.get("/grants")
def grants(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return oauth_service.list_grants(db, current_user.id)


@api.delete("/grants/{grant_id}", status_code=204)
def delete_grant(grant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not oauth_service.revoke_grant(db, current_user.id, grant_id):
        raise HTTPException(status_code=404, detail="找不到這筆授權")
    db.commit()
    return None


# ───────── 陽春同意頁（Codex 的 /authorize 做好前先用；config oauth_consent_url 指過去就不會來這） ─────────

def _page(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · 鴉巢</title>
<style>body{{margin:0;background:#12101c;color:#e9e4f2;font:16px/1.6 -apple-system,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:380px;width:92%;background:#1c1830;border:1px solid #2e2850;border-radius:18px;padding:28px}}
h1{{font-size:20px;margin:0 0 12px}}label{{display:block;margin:12px 0 4px;color:#b9b0d0}}input{{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #3a3360;background:#0f0d1a;color:#fff}}
button{{margin-top:16px;width:100%;padding:12px;border:0;border-radius:12px;font-size:16px;cursor:pointer}}.ok{{background:#7c5cff;color:#fff}}.no{{background:transparent;color:#b9b0d0;border:1px solid #3a3360}}
.app{{background:#0f0d1a;border-radius:12px;padding:12px;margin:8px 0}}.err{{color:#ff8a8a;min-height:1.4em}}small{{color:#8d84a8}}</style></head><body><div class="card">{body}</div></body></html>"""


@router.get("/oauth/consent", response_class=HTMLResponse)
def consent_page(request_id: str = ""):
    rid = html.escape(request_id)
    body = f"""<h1>有個 app 想連上你的室友</h1>
<div id="app" class="app">讀取中…</div>
<div id="login">
<label>鴉巢帳號</label><input id="u" autocomplete="username">
<label>密碼</label><input id="p" type="password" autocomplete="current-password">
</div>
<div class="err" id="e"></div>
<button class="ok" id="yes">登入並同意</button>
<button class="no" id="no">拒絕</button>
<p><small>同意後這個 app 就能用你室友的身分進社區，之後可以在艙室的鑰匙頁撤銷。</small></p>
<script>
const rid={rid!r};const $=id=>document.getElementById(id);let tok=null;
async function login(){{const r=await fetch('/api/auth/login',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{username:$('u').value.trim(),password:$('p').value}})}});
if(!r.ok){{throw new Error((await r.json()).detail||'登入失敗')}}tok=(await r.json()).access_token;}}
async function view(){{const r=await fetch('/api/oauth/requests/'+rid,{{headers:{{Authorization:'Bearer '+tok}}}});const d=await r.json();
if(!r.ok){{throw new Error(d.detail||'讀不到這個請求')}}
$('app').innerHTML='<b>'+esc(d.client_name)+'</b><br><small>'+esc(d.redirect_host)+'</small><br>要連的室友：'+esc(d.agent_avatar_emoji||'')+' '+esc(d.agent_name||'（你還沒有室友）');}}
async function decide(ok){{$('e').textContent='';try{{if(!tok){{await login();await view();}}
const r=await fetch('/api/oauth/decide',{{method:'POST',headers:{{'Content-Type':'application/json',Authorization:'Bearer '+tok}},body:JSON.stringify({{request_id:rid,approve:ok}})}});const d=await r.json();
if(!r.ok){{throw new Error(d.detail||'失敗')}}location.href=d.redirect_to;}}catch(err){{$('e').textContent=err.message}}}}
function esc(s){{return String(s).replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[c])}}
$('yes').onclick=()=>decide(true);$('no').onclick=()=>decide(false);
$('app').textContent='登入後會顯示是哪個 app、要連哪位室友。';
</script>"""
    return HTMLResponse(_page("授權", body), headers=_NO_STORE)
