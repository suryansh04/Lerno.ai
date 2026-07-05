"""
Standalone Collab Server — for testing WITHOUT the main backend.
NO Firebase admin SDK required — auth is bypassed for development.

Run with:
    python -m venv venv
    venv\\Scripts\\activate
    pip install fastapi uvicorn[standard] python-socketio[asyncio_client] python-engineio
    uvicorn server:socket_app --reload --port 8001

Frontend: set VITE_COLLAB_SERVER_URL=http://localhost:8001 in .env
"""

import asyncio
import base64
import json
import logging
from datetime import datetime, timezone

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("collab-server")

# ---------------------------------------------------------------------------
# FastAPI app (for health-check endpoint)
# ---------------------------------------------------------------------------
app = FastAPI(title="Lerno Collab Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "server": "collab", "time": datetime.now(timezone.utc).isoformat()}

@app.get("/sessions")
async def list_sessions():
    """Dev helper — list active in-memory sessions."""
    return {
        sid: {
            "session_id": data.get("session_id"),
            "uid": data.get("uid"),
        }
        for sid, data in _socket_sessions.items()
    }

# ---------------------------------------------------------------------------
# Socket.IO server
# ---------------------------------------------------------------------------
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

# ASGI app — mounts Socket.IO at /collab/socket.io, FastAPI handles the rest
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="/collab/socket.io")

# ---------------------------------------------------------------------------
# In-memory state
# { sid: { uid, session_id, lesson_id, group_session_id } }
_socket_sessions: dict[str, dict] = {}

# { session_id: { doc_state: bytes | None, persist_task: Task | None } }
_sessions: dict[str, dict] = {}

PERSIST_DEBOUNCE_SECONDS = 5

# ---------------------------------------------------------------------------
# Simple in-memory "persistence" (replaces Firestore for testing)
# Saved to ./collab_snapshots/{session_id}.b64 as plain base64 text
# ---------------------------------------------------------------------------
import os
SNAPSHOT_DIR = "collab_snapshots"
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

def _snapshot_path(session_id: str) -> str:
    safe = session_id.replace(":", "_").replace("/", "_")
    return os.path.join(SNAPSHOT_DIR, f"{safe}.b64")

def _save_snapshot(session_id: str, doc_state_b64: str):
    try:
        with open(_snapshot_path(session_id), "w") as f:
            meta = {
                "docState": doc_state_b64,
                "sessionId": session_id,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            json.dump(meta, f)
        logger.info(f"Snapshot saved: {_snapshot_path(session_id)}")
    except Exception as e:
        logger.error(f"Failed to save snapshot: {e}")

def _load_snapshot(session_id: str) -> bytes | None:
    path = _snapshot_path(session_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            meta = json.load(f)
        return base64.b64decode(meta["docState"])
    except Exception as e:
        logger.error(f"Failed to load snapshot: {e}")
        return None

def _schedule_persist(session_id: str, doc_state_bytes: bytes):
    sess = _sessions.setdefault(session_id, {"doc_state": None, "persist_task": None})
    sess["doc_state"] = doc_state_bytes

    if sess["persist_task"] and not sess["persist_task"].done():
        sess["persist_task"].cancel()

    b64 = base64.b64encode(doc_state_bytes).decode()

    async def _debounced():
        await asyncio.sleep(PERSIST_DEBOUNCE_SECONDS)
        _save_snapshot(session_id, b64)

    sess["persist_task"] = asyncio.ensure_future(_debounced())

# ---------------------------------------------------------------------------
# Socket.IO event handlers
# ---------------------------------------------------------------------------

@sio.event
async def connect(sid: str, environ: dict, auth: dict | None):
    """
    DEV MODE: Auth is bypassed — no Firebase token required.
    Any client can connect for testing.
    """
    uid = "dev-user"
    if auth:
        uid = auth.get("uid") or auth.get("userId") or "dev-user"

    _socket_sessions[sid] = {
        "uid": uid,
        "session_id": None,
        "lesson_id": None,
        "group_session_id": None,
    }
    logger.info(f"[connect] sid={sid} uid={uid}")


@sio.event
async def join_session(sid: str, data: dict):
    lesson_id = data.get("lessonId", "unknown")
    group_session_id = data.get("groupSessionId", "default")
    session_id = f"{lesson_id}:{group_session_id}"

    sess = _socket_sessions.get(sid, {})
    sess.update({
        "session_id": session_id,
        "lesson_id": lesson_id,
        "group_session_id": group_session_id,
    })
    _socket_sessions[sid] = sess

    await sio.enter_room(sid, session_id)
    logger.info(f"[join_session] sid={sid} room={session_id}")

    # Send back persisted state if available
    persisted = _load_snapshot(session_id)
    if persisted:
        b64 = base64.b64encode(persisted).decode()
        await sio.emit("session_state", {"docState": b64}, to=sid)
        logger.info(f"[join_session] Sent persisted state to sid={sid}")

    # Notify room that a new user joined — include new peer's sid so
    # existing peers can send their live ydoc state directly
    await sio.emit("peer_joined", {"uid": sess.get("uid", "unknown"), "sid": sid}, room=session_id, skip_sid=sid)


@sio.event
async def sync_offer(sid: str, data: dict):
    """Relay live ydoc state from an existing peer to a newly joined peer."""
    target_sid = data.get("targetSid")
    doc_state_b64 = data.get("docState")
    if not target_sid or not doc_state_b64:
        return
    await sio.emit("sync_offer", {"docState": doc_state_b64}, to=target_sid)
    logger.info(f"[sync_offer] sid={sid} → target={target_sid}")


@sio.event
async def doc_update(sid: str, data: dict):
    session_id = data.get("sessionId")
    update_b64 = data.get("update")
    if not session_id or not update_b64:
        return

    # Relay to peers
    await sio.emit("doc_update", {"update": update_b64}, room=session_id, skip_sid=sid)

    # Schedule persist
    update_bytes = base64.b64decode(update_b64)
    _schedule_persist(session_id, update_bytes)


@sio.event
async def awareness_update(sid: str, data: dict):
    session_id = data.get("sessionId")
    if not session_id:
        return
    await sio.emit("awareness_update", {"awareness": data.get("awareness")}, room=session_id, skip_sid=sid)


@sio.event
async def playback_state(sid: str, data: dict):
    session_id = data.get("sessionId")
    state = data.get("state")
    if not session_id or not state:
        return
    await sio.emit("playback_state", {"state": state}, room=session_id, skip_sid=sid)
    logger.info(f"[playback_state] sid={sid} state={state}")


@sio.event
async def disconnect(sid: str):
    sess = _socket_sessions.pop(sid, {})
    session_id = sess.get("session_id")
    uid = sess.get("uid", "unknown")
    logger.info(f"[disconnect] sid={sid} uid={uid} room={session_id}")
    if session_id:
        await sio.emit("peer_left", {"uid": uid}, room=session_id)
