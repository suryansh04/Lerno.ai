/**
 * CollabPanel — real-time collaborative session drawer.
 *
 * Design: mirrors LearningPage's existing modal patterns
 *   - bg-neutral-900, border-white/10, rounded-2xl
 *   - Lucide SVG icons (no emojis)
 *   - text-white, text-white/60, text-white/70 hierarchy
 *   - hover:bg-white/10 interactive states
 */

import { useState, useEffect, useMemo } from "react";
import * as Y from "yjs";
import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewRaw as BlockNoteView } from "@blocknote/react";
import { Collaboration } from "@tiptap/extension-collaboration";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/core/style.css";
import { Users, FileText, Pen, X, Play, Wifi, WifiOff, Lightbulb } from "lucide-react";
import CollabCanvasBlock from "./CollabCanvasBlock";
import { useYjsSocketProvider, type PlaybackState } from "./useYjsSocketProvider";
import "./collab.css";

interface CollabPanelProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string;
  groupSessionId?: string;
  displayName?: string;
  onPeerPlaybackState?: (state: PlaybackState) => void;
}

interface PresenceUser {
  uid: string;
  name: string;
  color: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function CollabPanel({
  isOpen,
  onClose,
  lessonId,
  groupSessionId = "default",
  displayName,
  onPeerPlaybackState,
}: CollabPanelProps) {
  const [activeTab, setActiveTab] = useState<"notes" | "canvas">("notes");
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const ydoc = useMemo(() => new Y.Doc(), []);

  const provider = useYjsSocketProvider({
    lessonId,
    groupSessionId,
    ydoc,
    displayName: displayName || localStorage.getItem("userName") || "Student",
    onPlaybackState: (state) => onPeerPlaybackState?.(state),
    onAwarenessUpdate: (raw) => {
      const update = raw as { user: PresenceUser };
      if (!update?.user) return;
      setPresenceUsers((prev) => {
        if (prev.find((u) => u.uid === update.user.uid)) return prev;
        return [...prev, update.user];
      });
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setIsConnected(provider.isConnected);
    }, 800);
    return () => clearInterval(interval);
  }, [provider]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => provider.emitAwareness({ status: "active" }), 1200);
      return () => clearTimeout(t);
    }
  }, [isOpen, provider]);

  const editor = useMemo(() => {
    return BlockNoteEditor.create({
      _tiptapOptions: {
        extensions: [
          Collaboration.configure({ document: ydoc, field: "blocknote" }),
        ],
      },
    });
  }, [ydoc]);

  useEffect(() => {
    return () => { ydoc.destroy(); };
  }, [ydoc]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-end z-50">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer */}
      <div className="relative bg-neutral-900 border-l border-white/10 w-[420px] max-w-[95vw] h-full flex flex-col backdrop-blur-md shadow-2xl animate-slide-in-right">

        {/* Header — matches Notes modal header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
              <Users size={16} className="text-white/80" />
            </div>
            <h2 className="text-lg font-semibold text-white">Collaborate</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-white/40">
            {isConnected ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : (
              <WifiOff size={13} className="text-white/30" />
            )}
            <span className={isConnected ? "text-emerald-400" : ""}>
              {isConnected ? "Connected" : "Connecting…"}
            </span>
            <span className="text-white/15 mx-1">·</span>
            <span className="text-white/25 truncate max-w-[140px]">
              {lessonId}
            </span>
          </div>

          {/* Presence avatars */}
          <div className="flex items-center -space-x-1.5">
            {presenceUsers.length === 0 ? (
              <span className="text-[11px] text-white/20">Just you</span>
            ) : (
              presenceUsers.slice(0, 5).map((user) => (
                <div
                  key={user.uid}
                  className="w-6 h-6 rounded-full border-2 border-neutral-900 flex items-center justify-center text-[9px] font-bold text-black"
                  style={{ background: user.color }}
                  title={user.name}
                >
                  {getInitials(user.name)}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tabs — matches the neutral card style */}
        <div className="flex gap-1.5 p-3 border-b border-white/10 flex-shrink-0">
          <button
            onClick={() => setActiveTab("notes")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all duration-200
              ${activeTab === "notes"
                ? "bg-white/10 text-white border border-white/15"
                : "text-white/40 hover:text-white/60 hover:bg-white/5 border border-transparent"
              }`}
          >
            <FileText size={14} />
            Shared Notes
          </button>
          <button
            onClick={() => setActiveTab("canvas")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all duration-200
              ${activeTab === "canvas"
                ? "bg-white/10 text-white border border-white/15"
                : "text-white/40 hover:text-white/60 hover:bg-white/5 border border-transparent"
              }`}
          >
            <Pen size={14} />
            Whiteboard
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 collab-scrollbar">

          {activeTab === "notes" && (
            <div className="flex flex-col gap-4">
              {/* Section label */}
              <div className="flex items-center gap-2 text-[11px] font-semibold text-white/30 uppercase tracking-wider">
                <FileText size={12} />
                Shared notes — edits sync in real time
              </div>

              {/* Editor card — matches the LearningPage card pattern */}
              <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:border-white/20 min-h-[280px]">
                <BlockNoteView editor={editor} theme="dark" />
              </div>

              {/* Tips — styled like an info card */}
              <div className="rounded-xl border border-white/10 bg-zinc-900/30 p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-3">
                  <Lightbulb size={12} />
                  Tips
                </div>
                <ul className="space-y-1 text-xs text-white/40 leading-relaxed">
                  <li>Type <span className="text-white/60 font-medium">/</span> to insert headings, bullets, or code blocks</li>
                  <li>All changes sync instantly to everyone in this session</li>
                  <li>Switch to <span className="text-white/60 font-medium">Whiteboard</span> to draw diagrams</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === "canvas" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-white/30 uppercase tracking-wider">
                <Pen size={12} />
                Collaborative whiteboard
              </div>
              <CollabCanvasBlock ydoc={ydoc} isVisible={activeTab === "canvas"} />
              <p className="text-[11px] text-white/20 text-center">
                Shapes and annotations sync with session peers
              </p>
            </div>
          )}

        </div>

        {/* Footer — playback sync */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 flex-shrink-0">
          <span className="text-xs text-white/30">Sync video playback with group</span>
          <button
            onClick={() => provider.emitPlaybackState({ action: "play", time: 0 })}
            className="bg-white/10 hover:bg-white/20 border border-white/20 text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Play size={12} />
            Sync Play
          </button>
        </div>

      </div>
    </div>
  );
}
