import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router";

import Dust from "@/components/making/Dust";
import SlabStack from "@/components/making/SlabStack";
import { READY, SWAP, useStepLabel } from "@/components/making/steps";
import useMediaQuery from "@/hooks/useMediaQuery";
import { LEVELS, type LessonWithScenes } from "@/lib/api";
import { cn, formatTime, prefersReducedMotion } from "@/lib/utils";

// A step that moves fast is still shown for a moment, so the loader never skips one.
const MIN_STEP_MS = 1200;
// After the last slab lights, a short pause before the lesson opens.
const OPEN_DELAY_MS = 1200;

/** Which slab a lesson is at: Plan, Write or Render while it is made, Ready at the end, and the step it failed at. */
function slabOf(lesson: LessonWithScenes) {
  if (lesson.status === "ready") return READY;
  return Math.min(Math.max(lesson.step - 1, 0), READY - 1);
}

// The shown slab climbs one step at a time towards the real one. It starts at the real one,
// so coming back to a lesson shows where it is now, not slab 1.
function useShownSlab(target: number) {
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (shown >= target) return;
    const timer = setTimeout(() => setShown(shown + 1), MIN_STEP_MS);
    return () => clearTimeout(timer);
  }, [shown, target]);
  return shown;
}

function useSecondsSince(iso: string, running: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(0, (now - Date.parse(iso)) / 1000);
}

interface MakingScreenProps {
  lesson: LessonWithScenes;
  offline: boolean;
  onReady: () => void;
}

export default function MakingScreen({ lesson, offline, onReady }: MakingScreenProps) {
  const navigate = useNavigate();
  const compact = useMediaQuery("(max-width: 40rem)");
  const target = slabOf(lesson);
  const shown = useShownSlab(target);
  const failed = lesson.status === "failed" && shown === target;
  const seconds = useSecondsSince(lesson.created_at, !failed);
  const { label, swapping } = useStepLabel(shown, failed);

  useEffect(() => {
    if (shown !== READY) return;
    const timer = setTimeout(onReady, OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shown, onReady]);

  // The stack tilts a little towards the pointer; the dust reads the same offset.
  const root = useRef<HTMLElement>(null),
    stage = useRef<HTMLDivElement>(null),
    tilt = useRef({ x: 0, y: 0 });
  const reduceMotion = prefersReducedMotion();
  const lean = (x: number, y: number) => {
    tilt.current = { x, y };
    stage.current?.style.setProperty("--ry", `${x * 10}deg`);
    stage.current?.style.setProperty("--rx", `${-y * 8}deg`);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (reduceMotion) return;
    const box = root.current!.getBoundingClientRect();
    lean((event.clientX - box.left) / box.width - 0.5, (event.clientY - box.top) / box.height - 0.5);
  };

  return (
    <section
      ref={root}
      onPointerMove={onPointerMove}
      onPointerLeave={() => lean(0, 0)}
      className="relative flex w-full flex-1 flex-col items-center justify-start pt-[4vh] sm:justify-center sm:pt-0"
    >
      {/* Reaches past the main area's 16px phone gutter, so the glow has no hard side edges. */}
      <div className="pointer-events-none absolute -inset-x-4 inset-y-0 bg-[radial-gradient(410px_310px_at_50%_46%,rgba(122,96,230,0.17),transparent)] lg:inset-x-0" />
      {!reduceMotion && <Dust around={stage} tilt={tilt} />}

      <header className="relative text-center">
        <small className="text-muted-foreground text-[13px]">{LEVELS[lesson.audience]}</small>
        <h1 className="mt-1 text-[21px] font-semibold tracking-[-0.02em] text-balance sm:text-[26px]">
          {lesson.title ?? lesson.topic}
        </h1>
      </header>

      <div
        ref={stage}
        className="ease-snappy relative mt-2 mb-1 w-[min(800px,100%,max(420px,calc((100svh-300px)*800/470)))] [transform:perspective(1000px)_rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] transition-transform duration-600 sm:mt-2.5"
      >
        <SlabStack step={shown} failed={failed} compact={compact} />
      </div>

      {compact && (
        <div className={cn("mb-2.5 flex items-center gap-2.5", SWAP, swapping && "opacity-0 blur-[6px]")}>
          <i
            className={cn(
              "size-3.5 rounded-full border-2",
              failed ? "border-danger" : "border-accent-soft/25 border-t-accent-soft motion-safe:animate-spin",
            )}
          />
          <b className="text-lg font-semibold">{label[0]}</b>
          <span className="text-secondary-foreground text-sm">{label[1]}</span>
        </div>
      )}

      <div className="relative grid justify-items-center gap-1.5 text-center">
        {failed ? (
          <>
            <p className="text-danger max-w-[380px] text-[13px]">{lesson.error}</p>
            <button
              type="button"
              onClick={() => navigate("/new", { state: { topic: lesson.topic, level: lesson.audience, send: true } })}
              className="bg-foreground text-background mt-2.5 h-[42px] rounded-[10px] px-5 font-semibold shadow-[0_0_32px_rgba(155,124,255,0.3)] transition-[box-shadow,scale] duration-300 hover:shadow-[0_0_44px_rgba(155,124,255,0.5)] active:scale-[0.985]"
            >
              Try again
            </button>
            <Link
              to="/new"
              state={{ topic: lesson.topic, level: lesson.audience }}
              className="text-accent-soft hover:text-foreground decoration-accent-soft/40 mt-1 text-[13px] underline underline-offset-4 transition-colors duration-200 hover:decoration-current"
            >
              Change the question
            </Link>
            <p className="text-muted-foreground mt-1 max-w-[380px] text-xs">
              Failed lessons don't use up your daily lessons.
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] tabular-nums">
              {formatTime(seconds)} <span className="text-muted-foreground">so far</span>
            </p>
            <p className="text-secondary-foreground max-w-[380px] text-[13px]">
              Usually takes about 2 minutes. You can leave this page. We keep making your lesson.
            </p>
          </>
        )}
        {offline && <p className="text-muted-foreground text-xs">Reconnecting…</p>}
      </div>
    </section>
  );
}
