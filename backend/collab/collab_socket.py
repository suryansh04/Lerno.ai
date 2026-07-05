"""
NEW FEATURE: Real-time collaborative session panel — added 2026-07-04.
Does not modify existing lesson/video/notes logic.

FILES IN THIS FEATURE:
  NEW: backend/collab/__init__.py         — Python package marker
  NEW: backend/collab/collab_socket.py   — Socket.IO server (this file)
  NEW: src/collab/useYjsSocketProvider.ts — Yjs <-> Socket.IO hook
  NEW: src/collab/CollabCanvasBlock.tsx  — tldraw drawing block
  NEW: src/collab/CollabPanel.tsx        — Main collab UI panel
  NEW: src/collab/collab.css             — Scoped panel styles

EXISTING FILES TOUCHED (minimal, listed for easy revert):
  MODIFIED: backend/main.py              — 3 lines added at bottom (import + ASGI mount)
  MODIFIED: src/components/LearningPage.tsx — 1 import + 1 JSX drawer block

TO REVERT:
  1. Delete backend/collab/ directory
  2. Delete src/collab/ directory
  3. Revert last 3 lines of main.py
  4. Remove CollabPanel import + JSX drawer from LearningPage.tsx
  5. Change uvicorn entrypoint back to main:app

=== ARCHITECTURE OVERVIEW ===
- Rooms are keyed by "{lessonId}:{groupSessionId}"
- Firebase ID tokens are verified on connect (via firebase_admin)
- Yjs doc updates are broadcast to all room peers
- Awareness (presence/cursor) updates are relayed within the room
- Video playback state (play/pause/seek) is relayed via the same room
- Yjs doc state is persisted (base64) to Firestore: collabSessions/{sessionId}

=== SCALING NOTE ===
# KNOWN LIMITATION (single-process only):
# The current in-memory room state in python-socketio works only in a
# single-process deployment. For multi-worker scaling (e.g., gunicorn),
# replace the default in-memory manager with:
#   import socketio
#   sio = socketio.AsyncServer(
#       client_manager=socketio.AsyncRedisManager("redis://localhost:6379"),
#       ...
#   )
# This is NOT implemented now to keep the feature minimal.
"""

import asyncio
import base64
import logging
from datetime import datetime, timezone

import socketio
from firebase_admin import auth as firebase_auth, firestore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Socket.IO server setup
# ---------------------------------------------------------------------------
# async_mode="asgi" is required to mount alongside FastAPI via ASGIApp.
# cors_allowed_origins="*" mirrors the existing FastAPI CORS policy.
# See SCALING NOTE above before adding workers.
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

# The ASGI app wrapper — imported by main.py and used as the uvicorn entry point.
# main.py wraps the existing FastAPI `app` as `other_asgi_app` so all REST
# routes continue to work unchanged.
socket_app = socketio.ASGIApp(sio, socketio_path="/collab/socket.io")

# ---------------------------------------------------------------------------
# In-memory session registry
# { session_id: { "doc_state": bytes | None, "persist_task": asyncio.Task | None } }
# ---------------------------------------------------------------------------
_sessions: dict[str, dict] = {}

PERSIST_DEBOUNCE_SECONDS = 5  # wait this long after last update before writing to Firestore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session_id(lesson_id: str, group_session_id: str) -> str:
    """Canonical room/session key."""
    return f"{lesson_id}:{group_session_id}"


def _get_firestore_client():
    """Lazy Firestore client — reuses the firebase_admin app already initialized in main.py."""
    return firestore.client()


async def _persist_session(session_id: str, doc_state_b64: str, lesson_id: str, group_session_id: str):
    """
    Write Yjs doc state to Firestore collabSessions/{sessionId}.
    This runs in a debounced asyncio task — see _schedule_persist().
    Does NOT touch the existing per-user notes collection.
    """
    try:
        db = _get_firestore_client()
        doc_ref = db.collection("collabSessions").document(session_id)
        doc_ref.set({
            "docState": doc_state_b64,
            "lessonId": lesson_id,
            "groupSessionId": group_session_id,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)
        logger.info(f"[collab] Persisted session {session_id} to Firestore")
    except Exception as e:
        logger.error(f"[collab] Firestore persist failed for {session_id}: {e}")


def _schedule_persist(session_id: str, doc_state_bytes: bytes, lesson_id: str, group_session_id: str):
    """
    Cancel any existing persist task for this session and schedule a new one
    after PERSIST_DEBOUNCE_SECONDS. This batches rapid updates into a single write.
    """
    sess = _sessions.setdefault(session_id, {"doc_state": None, "persist_task": None})
    sess["doc_state"] = doc_state_bytes

    # Cancel previous debounced task if still pending
    if sess["persist_task"] and not sess["persist_task"].done():
        sess["persist_task"].cancel()

    doc_state_b64 = base64.b64encode(doc_state_bytes).decode("utf-8")

    async def _debounced():
        await asyncio.sleep(PERSIST_DEBOUNCE_SECONDS)
        await _persist_session(session_id, doc_state_b64, lesson_id, group_session_id)

    sess["persist_task"] = asyncio.ensure_future(_debounced())


async def _load_persisted_state(session_id: str) -> bytes | None:
    """
    Load previously persisted Yjs doc state from Firestore on session join.
    Returns raw bytes (decoded from base64) or None if no state exists yet.
    """
    try:
        db = _get_firestore_client()
        doc_ref = db.collection("collabSessions").document(session_id)
        snap = doc_ref.get()
        if snap.exists:
            data = snap.to_dict()
            b64 = data.get("docState")
            if b64:
                return base64.b64decode(b64)
    except Exception as e:
        logger.error(f"[collab] Failed to load persisted state for {session_id}: {e}")
    return None


# ---------------------------------------------------------------------------
# Socket.IO event handlers
# ---------------------------------------------------------------------------

@sio.event
async def connect(sid: str, environ: dict, auth: dict | None):
    """
    Fired when a client connects.
    Verifies Firebase ID token passed in the `auth` dict.
    Rejects the connection (returns False) if auth is missing or token is invalid.
    """
    # if not auth or not auth.get("token"):
    #     logger.warning(f"[collab] Connection rejected — no auth token. sid={sid}")
    #     return False  # Socket.IO will send a 403-style rejection

    try:
        decoded = firebase_auth.verify_id_token(auth["token"])
        uid = decoded["uid"]
        # Store uid on the socket for use in later events
        await sio.save_session(sid, {"uid": uid, "session_id": None, "lesson_id": None, "group_session_id": None})
        logger.info(f"[collab] Client connected: sid={sid} uid={uid}")
    except Exception as e:
        logger.warning(f"[collab] Token verification failed: {e}. sid={sid}")
        return False


@sio.event
async def join_session(sid: str, data: dict):
    """
    Client joins a collab room.
    data = { lessonId: str, groupSessionId: str }

    Sends back any previously persisted Yjs doc state so late joiners
    can catch up without needing a full Yjs sync protocol.
    """
    lesson_id = data.get("lessonId", "unknown")
    group_session_id = data.get("groupSessionId", "default")
    session_id = _make_session_id(lesson_id, group_session_id)

    # Update stored session metadata for this socket
    sess_data = await sio.get_session(sid)
    sess_data.update({"session_id": session_id, "lesson_id": lesson_id, "group_session_id": group_session_id})
    await sio.save_session(sid, sess_data)

    # Join the Socket.IO room
    await sio.enter_room(sid, session_id)
    logger.info(f"[collab] sid={sid} joined room={session_id}")

    # Send back persisted state (if any) only to this client
    persisted = await _load_persisted_state(session_id)
    if persisted:
        await sio.emit(
            "session_state",
            {"docState": base64.b64encode(persisted).decode("utf-8")},
            to=sid,
        )
        logger.info(f"[collab] Sent persisted state to sid={sid}")


@sio.event
async def doc_update(sid: str, data: dict):
    """
    Client sends a Yjs binary update (base64-encoded).
    data = { sessionId: str, update: str (base64) }

    Broadcasts to all other room members and schedules Firestore persistence.
    """
    session_id = data.get("sessionId")
    update_b64 = data.get("update")
    if not session_id or not update_b64:
        return

    # Relay to all other clients in the room
    await sio.emit(
        "doc_update",
        {"update": update_b64},
        room=session_id,
        skip_sid=sid,
    )

    # Schedule debounced persistence
    sess_data = await sio.get_session(sid)
    lesson_id = sess_data.get("lesson_id", "unknown")
    group_session_id = sess_data.get("group_session_id", "default")

    update_bytes = base64.b64decode(update_b64)
    _schedule_persist(session_id, update_bytes, lesson_id, group_session_id)


@sio.event
async def awareness_update(sid: str, data: dict):
    """
    Client sends cursor/presence awareness data.
    data = { sessionId: str, awareness: any }

    Relayed to all other room members (not persisted).
    """
    session_id = data.get("sessionId")
    awareness = data.get("awareness")
    if not session_id:
        return

    await sio.emit(
        "awareness_update",
        {"awareness": awareness},
        room=session_id,
        skip_sid=sid,
    )


@sio.event
async def playback_state(sid: str, data: dict):
    """
    Client emits video playback state (play/pause/seek).
    data = { sessionId: str, state: { action: "play"|"pause"|"seek", time: float } }

    Relayed to all other room members so peers can sync video position.
    Not persisted — ephemeral sync only.
    """
    session_id = data.get("sessionId")
    state = data.get("state")
    if not session_id or not state:
        return

    await sio.emit(
        "playback_state",
        {"state": state},
        room=session_id,
        skip_sid=sid,
    )


@sio.event
async def disconnect(sid: str):
    """
    Fired when a client disconnects (tab close, network drop, etc.).
    Socket.IO automatically removes the sid from all rooms.
    No explicit cleanup needed for in-memory state.
    """
    sess_data = await sio.get_session(sid)
    uid = sess_data.get("uid", "unknown") if sess_data else "unknown"
    logger.info(f"[collab] Client disconnected: sid={sid} uid={uid}")
