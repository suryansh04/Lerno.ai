# Lerno.ai Collab Server (Dev/Test)

Standalone Socket.IO server for the real-time collaborative session panel.
**No Firebase SDK required** — auth is bypassed and doc snapshots are saved as local JSON files.

## Setup (one time)

```powershell
cd collab-server
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run

```powershell
uvicorn server:socket_app --reload --port 8001
```

## Endpoints

| URL | Description |
|-----|-------------|
| `http://localhost:8001/health` | Health check |
| `http://localhost:8001/sessions` | List active socket sessions (dev helper) |
| `ws://localhost:8001/collab/socket.io` | Socket.IO WebSocket endpoint |

## Snapshots

Doc state is persisted to `collab-server/collab_snapshots/` as `.b64` JSON files (debounced 5s after last edit). Late joiners automatically receive the snapshot on `join_session`.

## Frontend env

Add to `Lerno.ai/.env` (or `.env.local`):
```
VITE_COLLAB_SERVER_URL=http://localhost:8001
```

## What's different from the main backend version

| Feature | Main backend (`main:socket_app`) | This server |
|---------|----------------------------------|-------------|
| Firebase auth | ✅ Verifies ID token | ❌ Bypassed (dev only) |
| Persistence | Firestore `collabSessions/` | Local `collab_snapshots/*.b64` |
| Port | 8000 | 8001 |
| Other API routes | `/process-data`, `/input-data` | `/health`, `/sessions` only |
