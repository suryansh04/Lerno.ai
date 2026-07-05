/*
 * NEW FEATURE: Real-time collaborative session panel — added 2026-07-04.
 * Does not modify existing lesson/video/notes logic.
 *
 * FIX (2026-07-05): Bidirectional sync repaired.
 *   - Root cause: Y.applyUpdate() without "remote" origin caused received
 *     updates to re-trigger the broadcast handler → feedback loop that
 *     corrupted Yjs vector clocks, making one direction appear broken.
 *   - Fix: all socket-received updates are now applied with Y.applyUpdate(ydoc, bytes, "remote")
 *   - Added peer-to-peer state sync: when a new peer joins, existing peers
 *     immediately send their live ydoc state (not just the server snapshot).
 */

import { useEffect, useRef, useCallback } from "react";
import * as Y from "yjs";
import { io, Socket } from "socket.io-client";
import { getAuth } from "firebase/auth";

export interface PlaybackState {
  action: "play" | "pause" | "seek";
  time: number;
}

export interface AwarenessUser {
  uid: string;
  name: string;
  color: string;
}

export interface UseYjsSocketProviderOptions {
  lessonId: string;
  groupSessionId: string;
  ydoc: Y.Doc;
  onPlaybackState?: (state: PlaybackState) => void;
  onAwarenessUpdate?: (awareness: unknown) => void;
  displayName?: string;
  serverUrl?: string;
}

export interface UseYjsSocketProviderReturn {
  isConnected: boolean;
  emitPlaybackState: (state: PlaybackState) => void;
  emitAwareness: (awareness: unknown) => void;
}

const SOCKET_URL = import.meta.env.VITE_COLLAB_SERVER_URL || "http://localhost:8001";
const SESSION_ID_SEPARATOR = ":";

function randomColor(): string {
  const hues = [210, 140, 30, 270, 0, 180];
  const h = hues[Math.floor(Math.random() * hues.length)];
  return `hsl(${h}, 70%, 65%)`;
}

export function useYjsSocketProvider({
  lessonId,
  groupSessionId,
  ydoc,
  onPlaybackState,
  onAwarenessUpdate,
  displayName,
  serverUrl = SOCKET_URL,
}: UseYjsSocketProviderOptions): UseYjsSocketProviderReturn {
  const socketRef = useRef<Socket | null>(null);
  const isConnectedRef = useRef(false);
  const userColorRef = useRef(randomColor());
  const sessionId = `${lessonId}${SESSION_ID_SEPARATOR}${groupSessionId}`;

  // -----------------------------------------------------------------------
  // Connect + authenticate + register all socket listeners
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      let token = "";
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (user) token = await user.getIdToken();
      } catch {
        // dev mode — token is optional, server accepts empty
      }

      if (cancelled) return;

      const socket = io(serverUrl, {
        path: "/collab/socket.io",
        transports: ["websocket", "polling"],
        auth: { token },
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      socketRef.current = socket;

      // ── Lifecycle ──────────────────────────────────────────────────────
      socket.on("connect", () => {
        if (cancelled) return;
        isConnectedRef.current = true;
        console.log("[collab] Connected → joining room:", sessionId);
        socket.emit("join_session", { lessonId, groupSessionId });
      });

      socket.on("disconnect", () => {
        isConnectedRef.current = false;
      });

      socket.on("connect_error", (err) => {
        console.error("[collab] Connection error:", err.message);
      });

      // ── Receive persisted server snapshot on join ──────────────────────
      // FIX: apply with "remote" origin so the update handler doesn't
      // re-broadcast it back to the server (which was causing the one-way bug).
      socket.on("session_state", ({ docState }: { docState: string }) => {
        try {
          const bytes = Uint8Array.from(atob(docState), (c) => c.charCodeAt(0));
          Y.applyUpdate(ydoc, bytes, "remote"); // ← "remote" prevents re-broadcast
          console.log("[collab] Applied server snapshot");
        } catch (err) {
          console.error("[collab] Failed to apply session_state:", err);
        }
      });

      // ── Receive Yjs updates from peers ─────────────────────────────────
      // FIX: "remote" origin prevents the update handler from re-broadcasting
      // the received update back, which was corrupting vector clocks.
      socket.on("doc_update", ({ update }: { update: string }) => {
        try {
          const bytes = Uint8Array.from(atob(update), (c) => c.charCodeAt(0));
          Y.applyUpdate(ydoc, bytes, "remote"); // ← "remote" prevents re-broadcast
        } catch (err) {
          console.error("[collab] Failed to apply doc_update:", err);
        }
      });

      // ── Peer-to-peer live state sync ────────────────────────────────────
      // When a NEW peer joins the room, the server sends "peer_joined" to
      // EXISTING peers. Each existing peer sends their LIVE ydoc state
      // directly to the new peer (bypasses the 5s snapshot debounce).
      socket.on("peer_joined", ({ sid: newPeerSid }: { uid: string; sid: string }) => {
        const stateUpdate = Y.encodeStateAsUpdate(ydoc);
        const b64 = btoa(String.fromCharCode(...Array.from(stateUpdate)));
        socket.emit("sync_offer", { targetSid: newPeerSid, docState: b64 });
        console.log("[collab] Sent live state to new peer:", newPeerSid);
      });

      // When YOU are the new peer, receive live state from existing peers.
      socket.on("sync_offer", ({ docState }: { docState: string }) => {
        try {
          const bytes = Uint8Array.from(atob(docState), (c) => c.charCodeAt(0));
          Y.applyUpdate(ydoc, bytes, "remote"); // ← "remote" prevents re-broadcast
          console.log("[collab] Applied live peer state sync");
        } catch (err) {
          console.error("[collab] Failed to apply sync_offer:", err);
        }
      });

      // ── Awareness relay ────────────────────────────────────────────────
      socket.on("awareness_update", ({ awareness }: { awareness: unknown }) => {
        onAwarenessUpdate?.(awareness);
      });

      // ── Video playback sync ────────────────────────────────────────────
      socket.on("playback_state", ({ state }: { state: PlaybackState }) => {
        onPlaybackState?.(state);
      });

      // ── Peer disconnect notification ───────────────────────────────────
      socket.on("peer_left", ({ uid }: { uid: string }) => {
        console.log("[collab] Peer left:", uid);
      });
    }

    connect();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      isConnectedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, groupSessionId, serverUrl]);

  // -----------------------------------------------------------------------
  // Broadcast local Yjs doc changes to peers
  // Only fires for LOCAL changes (origin !== "remote").
  // With the "remote" origin fix above, received updates will NOT re-trigger
  // this handler, so the feedback loop is broken.
  // -----------------------------------------------------------------------
  useEffect(() => {
    function handleUpdate(update: Uint8Array, origin: unknown) {
      // Skip remote-applied updates — they came FROM the socket, not from the user
      if (origin === "remote") return;

      const socket = socketRef.current;
      if (!socket?.connected) return;

      const b64 = btoa(String.fromCharCode(...Array.from(update)));
      socket.emit("doc_update", { sessionId, update: b64 });
    }

    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, sessionId]);

  // -----------------------------------------------------------------------
  // Stable emit helpers
  // -----------------------------------------------------------------------
  const emitPlaybackState = useCallback(
    (state: PlaybackState) => {
      socketRef.current?.emit("playback_state", { sessionId, state });
    },
    [sessionId]
  );

  const emitAwareness = useCallback(
    (awareness: unknown) => {
      socketRef.current?.emit("awareness_update", {
        sessionId,
        awareness: {
          user: {
            uid: localStorage.getItem("userId") || "anonymous",
            name: displayName || "Student",
            color: userColorRef.current,
          },
          data: awareness,
        },
      });
    },
    [sessionId, displayName]
  );

  return {
    isConnected: isConnectedRef.current,
    emitPlaybackState,
    emitAwareness,
  };
}
