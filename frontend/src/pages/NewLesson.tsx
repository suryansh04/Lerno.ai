import { CaretDown } from "@phosphor-icons/react";
import { AnimatePresence, m } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";

import AskBox, { MAX_QUESTION } from "@/components/app/AskBox";
import ContinueWatching from "@/components/app/ContinueWatching";
import TopicSuggestion from "@/components/app/TopicSuggestion";
import GradientText from "@/components/brand/GradientText";
import Picker from "@/components/ui/picker";
import type { AppData } from "@/hooks/useAppData";
import { api, ApiError, LEVEL_CLASSES, LEVELS, type Lesson, type Level, type Usage } from "@/lib/api";
import { rememberMade } from "@/lib/lessonStore";
import { lastLanguage, saveLevel, savedLevel } from "@/lib/saved";
import { cn } from "@/lib/utils";
import { EASE_EXPO } from "@/lib/variants";

const LEVEL_OPTIONS = (Object.keys(LEVELS) as Level[]).map(
  (level) => [level, `${LEVELS[level]}, ${LEVEL_CLASSES[level]}`] as const,
);

// The box cycles through a level's examples; a new user also gets the first few as buttons.
const EXAMPLES: Record<Level, string[]> = {
  school: [
    "Why is the angle sum of a triangle 180°?",
    "How do you find the area of a circle?",
    "What does a negative number mean?",
    "Why do we flip the fraction when we divide?",
    "What does the Pythagoras theorem show?",
  ],
  high_school: [
    "Why does the quadratic formula work?",
    "What does a derivative measure?",
    "How does the sine curve come from a circle?",
    "Why is the area under y = x² from 0 to 2 equal to 8/3?",
    "What is a logarithm actually doing?",
  ],
  college: [
    "How do eigenvectors stay on their own line?",
    "Why does e^(iπ) = −1?",
    "What is a Fourier series doing to a square wave?",
    "Why does the harmonic series never stop growing?",
    "What does a determinant measure?",
  ],
};
const CHIP_COUNT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTER_FROM = 180;

export default function NewLesson() {
  const { lessons, usage, failed, lastCounts, reload } = useOutletContext<AppData>();
  const navigate = useNavigate();
  // A failed lesson's "Try again" sends its topic and level at once; "Change the question" only fills the box.
  const retry = useLocation().state as { topic: string; level: Level; send?: boolean } | null;
  const [question, setQuestion] = useState(retry?.topic ?? "");
  const [level, setLevel] = useState(retry?.level ?? savedLevel());
  const [sending, setSending] = useState(false);
  const [madeId, setMadeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refused, setRefused] = useState<{ topic: string; suggestion: string } | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pickSuggestion = useRef<() => void>(null);

  const limit = limitNotice(lessons, usage);
  const newUser = lessons ? lessons.length === 0 : !lastCounts?.lessons;

  const submit = async () => {
    const topic = question.trim();
    if (!topic || sending || limit) return;
    // Sending the refused topic again would only spend a try.
    if (refused) return pickSuggestion.current?.();
    if (topic.length < 3) return setTooShort(true);
    setSending(true);
    setError("");
    setRefused(null);
    try {
      // The last voice the user picked is made with the lesson, so it is ready when they open it.
      const language = lastLanguage();
      const lesson = await api<Lesson>("/lessons", {
        method: "POST",
        body: JSON.stringify({ topic, audience: level, ...(language !== "en" && { language }) }),
      });
      saveLevel(level);
      rememberMade(lesson);
      void reload();
      setMadeId(lesson.id);
    } catch (failure) {
      // The question stays in the box, so the user can try again without typing it twice.
      if (failure instanceof ApiError && failure.suggestion) setRefused({ topic, suggestion: failure.suggestion });
      else setError((failure as Error).message);
      setSending(false);
      void reload();
    }
  };

  // Sent once: the history entry loses "send", so Back to this page doesn't send it again.
  const retried = useRef(false);
  useEffect(() => {
    if (!retry?.send || retried.current) return;
    retried.current = true;
    navigate(".", { replace: true, state: { topic: retry.topic, level: retry.level } });
    void submit();
  });

  const openLesson = useCallback(() => navigate(`/lesson/${madeId}`), [madeId, navigate]);

  const type = (value: string) => {
    setQuestion(value);
    setTooShort(false);
    setRefused(null);
  };

  // Into the box, not sent: the student reads it before it costs a lesson.
  const takeSuggestion = () => {
    type(refused!.suggestion);
    input.current?.focus();
  };

  const full = question.length >= MAX_QUESTION;
  const hint = tooShort
    ? "Ask a little more."
    : question.length >= COUNTER_FROM
      ? `${question.length} / ${MAX_QUESTION}`
      : "";

  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(450px_260px_at_50%_26%,rgba(122,96,230,0.16),transparent)]" />
      <GraphPaper />

      {/* Above the section below, which the level menu opens over. */}
      <section className="relative z-[2] mt-[12vh] w-full max-w-[640px] text-center lg:mt-[19vh]">
        <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance lg:text-[40px]">
          What do you want to <GradientText>understand?</GradientText>
        </h1>
        <p className="text-secondary-foreground mt-2.5 text-sm lg:text-[15px]">
          Ask about any maths idea. We'll animate it into a short lesson.
        </p>

        {newUser && (
          <div
            aria-label="Example questions"
            className="-mx-4 mt-5 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 sm:mx-0 sm:mt-[26px] sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
          >
            {EXAMPLES[level].slice(0, CHIP_COUNT).map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => type(chip)}
                className="text-secondary-foreground hover:text-foreground hover:bg-accent/8 flex-none rounded-full bg-white/[0.025] px-[13px] py-[7px] text-[13px] whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-[color,background-color,box-shadow] duration-250 hover:shadow-[inset_0_0_0_1px_rgba(155,124,255,0.4)]"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        <div className={newUser ? "mt-3" : "mt-[30px]"}>
          <AskBox
            value={question}
            onChange={type}
            onSubmit={submit}
            examples={EXAMPLES[level]}
            locked={sending || !!limit}
            busy={sending && !madeId}
            inputRef={input}
            vanishing={!!madeId}
            onVanished={openLesson}
            cover={
              refused && (
                <TopicSuggestion key={refused.topic} ref={pickSuggestion} {...refused} onTaken={takeSuggestion} />
              )
            }
          />
          {/* Right under the box, as a form shows a field's error, lined up with the box's text. */}
          <AnimatePresence initial={false}>
            {refused && (
              <m.p
                role="status"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE_EXPO }}
                className="text-muted-foreground overflow-hidden pl-5 text-left text-[13px] sm:pl-[26px]"
              >
                <span className="block pt-2.5">Lerno makes maths lessons only. Pick the suggestion to use it.</span>
              </m.p>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-3.5 flex flex-col items-center gap-2.5 px-1.5 sm:flex-row sm:justify-between sm:gap-4">
          <Picker label="Explain it for" options={LEVEL_OPTIONS} value={level} onPick={setLevel} icon={CaretDown} />
          {hint && (
            <span className={cn("text-xs tabular-nums", tooShort || full ? "text-danger" : "text-muted-foreground")}>
              {hint}
            </span>
          )}
          {/* Wide screens have this in the sidebar; here the sidebar is closed. */}
          {usage && (
            <span className="text-muted-foreground text-xs tabular-nums lg:hidden">
              {Math.max(usage.limit - usage.used, 0)} of {usage.limit} lessons left
            </span>
          )}
        </div>

        {(limit || error) && (
          <p role="status" className="text-secondary-foreground mt-3.5 text-[13px]">
            {limit ? (
              <>
                {limit.time ? (
                  <>
                    {limit.text} at <b className="text-foreground font-medium">{limit.time}</b>.
                  </>
                ) : (
                  `${limit.text} later.`
                )}
              </>
            ) : (
              error
            )}
          </p>
        )}
      </section>

      <ContinueWatching lessons={lessons} failed={failed} lastCounts={lastCounts} />
    </>
  );
}

// Which limit locks the box, and when the oldest lesson that counts drops out of the 24 hours.
function limitNotice(lessons: Lesson[] | null, usage: Usage | null) {
  if (!lessons || !usage) return null;
  const recent = lessons.filter((lesson) => Date.parse(lesson.created_at) > Date.now() - DAY_MS);
  if (usage.used >= usage.limit)
    return {
      text: `You've used today's ${usage.limit} lessons. You get one back`,
      time: backAt(recent.filter((lesson) => lesson.status !== "failed")),
    };
  if (usage.tries >= usage.try_limit)
    return { text: "Too many lessons failed today. You can try again", time: backAt(recent) };
  return null;
}

// Empty when the user's clock runs ahead of the server's; the message then leaves the time out.
function backAt(lessons: Lesson[]) {
  if (!lessons.length) return "";
  const oldest = Math.min(...lessons.map((lesson) => Date.parse(lesson.created_at)));
  return new Date(oldest + DAY_MS).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Faint graph paper behind the ask box, faded out at the edges so it never widens the column.
function GraphPaper() {
  const columns = Array.from({ length: 15 }, (_, index) => 120 + index * 60);
  const rows = Array.from({ length: 10 }, (_, index) => 40 + index * 60);
  return (
    <svg
      viewBox="0 0 1100 640"
      preserveAspectRatio="xMidYMin slice"
      aria-hidden="true"
      className="pointer-events-none absolute top-[2vh] left-0 h-[640px] w-full [mask-image:radial-gradient(40%_42%_at_50%_40%,#000_20%,transparent_100%)] stroke-[rgba(183,164,255,0.065)]"
    >
      {columns.map((x) => (
        <path key={`x${x}`} d={`M${x} 40V600`} />
      ))}
      {rows.map((y) => (
        <path key={`y${y}`} d={`M120 ${y}H980`} />
      ))}
    </svg>
  );
}
