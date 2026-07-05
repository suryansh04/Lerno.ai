/**
 * CollabCanvasBlock — tldraw whiteboard synced through the shared Y.Doc.
 *
 * Architecture:
 *   LOCAL change flow:  tldraw store.listen(source:"user") → serialize to Y.Map → Yjs update → socket broadcast
 *   REMOTE change flow: Yjs Y.Map observe → diff against local store → store.mergeRemoteChanges()
 *
 * Responsiveness improvements (2026-07-05):
 *   - Granular record-level diffing instead of full Y.Map re-apply
 *   - Synchronous store.listen (no debounce) for instant relay
 *   - Remote changes applied record-by-record via put/remove instead of bulk overwrite
 *   - "syncing" guard flag prevents feedback loops without relying on transaction.local
 */

import { useEffect, useRef, useCallback } from "react";
import { Tldraw, createTLStore, defaultShapeUtils } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import * as Y from "yjs";
import type { TLStore, TLRecord } from "@tldraw/tldraw";

interface CollabCanvasBlockProps {
  ydoc: Y.Doc;
  isVisible?: boolean;
}

export default function CollabCanvasBlock({ ydoc, isVisible = true }: CollabCanvasBlockProps) {
  const storeRef = useRef<TLStore | null>(null);
  const ymapRef = useRef<Y.Map<string> | null>(null);
  const syncingRef = useRef(false); // guard against feedback loops

  // Create store + ymap once (stable across renders)
  if (!storeRef.current) {
    storeRef.current = createTLStore({ shapeUtils: defaultShapeUtils });
  }
  if (!ymapRef.current) {
    ymapRef.current = ydoc.getMap<string>("tldraw-canvas");
  }

  // Hydrate store from Y.Map (late-join catch-up)
  const hydrateFromYmap = useCallback(() => {
    const store = storeRef.current!;
    const ymap = ymapRef.current!;
    if (ymap.size === 0) return;

    const records: TLRecord[] = [];
    ymap.forEach((value) => {
      try { records.push(JSON.parse(value) as TLRecord); } catch { /* skip */ }
    });
    if (records.length === 0) return;

    syncingRef.current = true;
    try {
      store.mergeRemoteChanges(() => {
        store.put(records);
      });
    } catch { /* schema mismatch — safe to ignore on first sync */ }
    syncingRef.current = false;
  }, []);

  useEffect(() => {
    const store = storeRef.current!;
    const ymap = ymapRef.current!;

    // Hydrate on mount
    hydrateFromYmap();

    // ── LOCAL → Y.Map: push user-driven changes immediately ──────────
    const unsub = store.listen(
      ({ changes }) => {
        if (syncingRef.current) return; // don't echo remote changes back

        ymap.doc?.transact(() => {
          for (const record of Object.values(changes.added)) {
            ymap.set(record.id, JSON.stringify(record));
          }
          for (const [, to] of Object.values(changes.updated)) {
            ymap.set(to.id, JSON.stringify(to));
          }
          for (const record of Object.values(changes.removed)) {
            ymap.delete(record.id);
          }
        });
      },
      { source: "user" },
    );

    // ── Y.Map → LOCAL: apply remote peer changes granularly ──────────
    function handleYmapChange(event: Y.YMapEvent<string>, transaction: Y.Transaction) {
      if (transaction.local) return;

      syncingRef.current = true;
      try {
        store.mergeRemoteChanges(() => {
          const toPut: TLRecord[] = [];
          const toRemove: TLRecord["id"][] = [];

          event.keysChanged.forEach((key) => {
            const change = event.keys.get(key);
            if (!change) return;

            if (change.action === "delete") {
              toRemove.push(key as TLRecord["id"]);
            } else {
              // "add" or "update"
              const raw = ymap.get(key);
              if (raw) {
                try { toPut.push(JSON.parse(raw) as TLRecord); } catch { /* skip */ }
              }
            }
          });

          if (toPut.length > 0) store.put(toPut);
          if (toRemove.length > 0) store.remove(toRemove);
        });
      } catch { /* graceful fallback */ }
      syncingRef.current = false;
    }

    ymap.observe(handleYmapChange);

    return () => {
      unsub();
      ymap.unobserve(handleYmapChange);
    };
  }, [hydrateFromYmap]);

  if (!isVisible) return null;

  return (
    <div className="collab-canvas-container">
      <Tldraw
        store={storeRef.current!}
        hideUi={false}
        autoFocus={false}
      />
    </div>
  );
}
