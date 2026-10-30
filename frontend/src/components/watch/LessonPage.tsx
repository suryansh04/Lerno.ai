import { CornersIn, CornersOut, NotePencil, Pause, SpeakerSlash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ICON_BUTTON } from "@/components/app/Sidebar";
import PlayIcon from "@/components/ui/play-icon";
import Dock, { type CardName } from "@/components/watch/Dock";
import Notepad from "@/components/watch/Notepad";
import NotesCard from "@/components/watch/NotesCard";
import { CompleteOverlay, QuizOverlay } from "@/components/watch/Overlays";
import QuizCard from "@/components/watch/QuizCard";
import ScenesPanel from "@/components/watch/ScenesPanel";
import Scrub from "@/components/watch/Scrub";
import { DOCK_KEYS, SOLID, scoreOf } from "@/components/watch/shared";
import TutorCard from "@/components/watch/TutorCard";
import useFullscreen from "@/hooks/useFullscreen";
import useNotes, { type Note } from "@/hooks/useNotes";
import useTutor from "@/hooks/useTutor";
import useVideoTime from "@/hooks/useVideoTime";
import { LEVELS, type LessonWithScenes } from "@/lib/api";
import { saveProgress, saveScenesRail, savedProgress, savedScenesRail } from "@/lib/saved";
import { cn, formatTime } from "@/lib/utils";

const NOTES_LIMIT = 100;
const SKIP_SECONDS = 5;
// The server keeps note and tutor times under 10 minutes; scenes are far shorter.
const TIME_MAX = 600;

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

interface LessonPageProps {
  lesson: LessonWithScenes;
  refresh: () => Promise<void>;
  className?: string;
}

export default function LessonPage({ lesson, refresh, className }: LessonPageProps) {
  const scenes = lesson.scenes;
  const [start] = useState(() => savedProgress(lesson.id));
  const [scene, setScene] = useState(() =>
    start && scenes.some((s) => s.position === start.scene) ? start.scene : scenes[0].position,
  );
  const [watched, setWatched] = useState<number[]>(start?.watched ?? []);
  const [answers, setAnswers] = useState<Record<number, number>>(start?.answers ?? {});
  const [progress, setProgress] = useState<Record<number, number>>(() =>
    Object.fromEntries((start?.watched ?? []).map((position) => [position, 1])),
  );
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState<"quiz" | "complete" | null>(null);
  const [card, setCard] = useState<CardName | null>(null);
  const [notesFocus, setNotesFocus] = useState<{ ids: string[]; at: number } | null>(null);
  const [notepadAt, setNotepadAt] = useState<number | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [railRight, setRailRight] = useState(savedScenesRail);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);

  const notes = useNotes(lesson.id);
  const tutor = useTutor(lesson.id);
  const video = useRef<HTMLVideoElement>(null);
  // The element itself, for the small parts that follow its time; the ref is for handlers.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    setVideoEl(element);
  }, []);
  const film = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(film);
  // What to do once the next video's details load: where to start, and whether to play.
  const pending = useRef({ at: start?.time ?? 0, play: false });
  const retried = useRef(false);
  const timeNow = useRef(start?.time ?? 0);

  const current = scenes.find((s) => s.position === scene)!;
  const index = scenes.indexOf(current);
  const sceneNotes = notes.notes.filter((note) => note.scene_position === scene);

  // Progress is saved whenever the scene, the ticks or the answers change, and on pause and on leaving.
  const save = useCallback(
    () => saveProgress(lesson.id, { scene, time: timeNow.current, watched, answers }),
    [lesson.id, scene, watched, answers],
  );
  useEffect(() => {
    save();
    return save;
  }, [save]);

  // The furthest point reached in this scene, for its bar in the scenes list. Kept on pause and when leaving.
  const keepProgress = useCallback(() => {
    const v = video.current;
    if (!v?.duration) return;
    const fraction = v.currentTime / v.duration;
    setProgress((p) => (fraction > (p[scene] ?? 0) ? { ...p, [scene]: fraction } : p));
  }, [scene]);

  // Browsers, iPhones most of all, can refuse sound when play does not start inside a tap. The scene then plays
  // muted and offers its sound, instead of not starting at all.
  const playVideo = useCallback((v: HTMLVideoElement) => {
    v.play().catch((error: DOMException) => {
      if (error.name !== "NotAllowedError" || v.muted) return;
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, []);

  const unmute = () => {
    if (video.current) video.current.muted = false;
    setMuted(false);
  };

  const go = useCallback(
    (position: number, at = 0, play = true) => {
      keepProgress();
      pending.current = { at, play };
      retried.current = false;
      timeNow.current = at;
      setVideoFailed(false);
      setOverlay(null);
      setNotepadAt(null);
      const v = video.current;
      if (position === scene && v && v.readyState > 0) {
        v.currentTime = at;
        if (play) playVideo(v);
      } else {
        // A new scene gets a new video element, which starts with its sound on.
        setMuted(false);
        setScene(position);
      }
    },
    [scene, keepProgress, playVideo],
  );

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v || overlay) return;
    if (v.paused) playVideo(v);
    else v.pause();
  }, [overlay, playVideo]);

  const finishScene = () => {
    video.current?.pause();
    setWatched((list) => (list.includes(scene) ? list : [...list, scene]));
    setProgress((p) => ({ ...p, [scene]: 1 }));
    setOverlay("quiz");
  };

  const next = () => (scenes[index + 1] ? go(scenes[index + 1].position) : setOverlay("complete"));

  const openCard = useCallback((name: CardName) => {
    video.current?.pause();
    setNotepadAt(null);
    setCard(name);
  }, []);
  // A tool's button opens its card, or closes it when it is the open one.
  const pickCard = useCallback((name: CardName) => (card === name ? setCard(null) : openCard(name)), [card, openCard]);
  const closeCard = () => setCard(null);
  const closeAll = useCallback(() => {
    setCard(null);
    setNotepadAt(null);
  }, []);
  const openNotes = (ids: string[]) => {
    setNotesFocus({ ids, at: Date.now() });
    openCard("notes");
  };

  const openNotepad = () => {
    video.current?.pause();
    setCard(null);
    setNotepadAt(video.current?.currentTime ?? timeNow.current);
  };

  // A link that expired (they last an hour) is fetched once more, keeping the scene and the time.
  const reload = async () => {
    pending.current = { at: timeNow.current, play: !!video.current && !video.current.paused };
    try {
      await refresh();
    } catch {
      setVideoFailed(true);
    }
  };
  const onVideoError = () => {
    if (retried.current) return setVideoFailed(true);
    retried.current = true;
    void reload();
  };

  // A click outside the open card closes it.
  useEffect(() => {
    if (!card) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-card], [data-dock]")) setCard(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [card]);

  // Keys: Space plays, the arrows skip 5 seconds, T, N and Q open the tools, Esc closes what is open. Nothing fires
  // while the user types.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea")) {
        if (event.key === "Escape") {
          setNotepadAt(null);
          target.blur();
        }
        return;
      }
      const v = video.current;
      if (event.key === " " && !target.closest("button, a")) {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowRight" && v) v.currentTime = Math.min(v.duration, v.currentTime + SKIP_SECONDS);
      else if (event.key === "ArrowLeft" && v) v.currentTime = Math.max(0, v.currentTime - SKIP_SECONDS);
      else if (event.key === "Escape") closeAll();
      else if (DOCK_KEYS[event.key.toLowerCase()] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // The card focuses its input at once; without this the key's letter would land in it.
        event.preventDefault();
        pickCard(DOCK_KEYS[event.key.toLowerCase()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, closeAll, pickCard]);

  const seek = (fraction: number) => {
    const v = video.current;
    if (!v || !v.duration) return;
    // Dragging the bar to the end counts as finishing the scene.
    if (fraction >= 0.99) return finishScene();
    v.currentTime = fraction * v.duration;
  };

  const toggleRail = () => {
    saveScenesRail(!railRight);
    setRailRight(!railRight);
  };
  const hasVideo = !!current.video_url && !videoFailed;
  const notesFull = notes.notes.length >= NOTES_LIMIT;

  return (
    // The page fills the shell's main area edge to edge on desktop, with its own scroll and the scenes on the right.
    <div
      className={cn(
        // On phones the bottom padding keeps the last scene clear of the floating dock.
        "w-full pb-8 lg:-mx-6 lg:-mb-12 lg:grid lg:h-svh lg:w-[calc(100%+3rem)] lg:grid-cols-[minmax(0,1fr)_auto] lg:pb-0",
        // Where the scenes panel ends on desktop; the dock and the cards sit beside it.
        railRight ? "[--rail-edge:94px]" : "[--rail-edge:334px]",
        className,
      )}
    >
      <div
        data-lenis-prevent
        className="relative min-w-0 pb-2 lg:[scrollbar-width:thin] lg:overflow-y-auto lg:px-8 lg:pt-[22px] lg:pb-10"
      >
        <div className="pointer-events-none absolute -inset-x-4 inset-y-0 bg-[radial-gradient(550px_350px_at_50%_40%,rgba(122,96,230,0.16),transparent)] lg:inset-x-0" />
        {!online && <p className="text-muted-foreground relative mb-2 text-center text-xs">You're offline.</p>}
        <div className="relative mx-auto max-w-[min(1040px,max(440px,calc((100vh-330px)*16/9)))]">
          <small className="text-muted-foreground text-[13px]">{LEVELS[lesson.audience]}</small>
          <h1 className="mt-0.5 text-xl font-semibold tracking-[-0.02em] lg:text-2xl">
            {lesson.title ?? lesson.topic}
          </h1>

          {/* On phones the film runs edge to edge, like a video app; the main area's 16px gutter is undone here. A quiz
              is too tall for a 16:9 phone film, so there the film grows to hold it. */}
          <div
            ref={film}
            data-overlay={overlay ? "" : undefined}
            className="relative -mx-4 mt-2.5 aspect-video overflow-hidden bg-black shadow-[0_40px_120px_-40px_rgba(120,90,230,0.6),0_0_0_1px_rgba(255,255,255,0.07)] max-sm:data-overlay:aspect-auto sm:mx-0 sm:rounded-xl lg:mt-4 lg:rounded-2xl"
          >
            {current.video_url && !videoFailed && (
              <video
                key={scene}
                ref={attachVideo}
                src={current.video_url}
                // A scene's first frame is dark while its title fades in, so its thumbnail stands in until it plays.
                poster={current.thumbnail_url ?? undefined}
                playsInline
                preload="metadata"
                onClick={toggle}
                onLoadedMetadata={(event) => {
                  const v = event.currentTarget;
                  const { at, play } = pending.current;
                  setDuration(v.duration);
                  if (at > 0 && at < v.duration) v.currentTime = at;
                  if (play) playVideo(v);
                }}
                onTimeUpdate={(event) => (timeNow.current = event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={(event) => {
                  // The last time update can be a quarter second old; notes and saved progress use the exact moment.
                  timeNow.current = event.currentTarget.currentTime;
                  keepProgress();
                  setPlaying(false);
                  save();
                }}
                onEnded={finishScene}
                onError={onVideoError}
                className="absolute inset-0 block size-full object-cover"
              />
            )}

            {!current.video_url && (
              // A scene that could not be animated: its narration stands in for the video, and the quiz still works.
              <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(60%_60%_at_50%_50%,#12111f,#07080c)] p-6 text-center sm:p-10">
                <div>
                  <small className="text-danger text-[13px]">Couldn't animate this scene</small>
                  <p className="text-secondary-foreground mt-2.5 max-w-[560px] text-sm leading-relaxed sm:text-lg">
                    {current.narration}
                  </p>
                  <button type="button" onClick={() => setOverlay("quiz")} className={`${SOLID} mt-[18px]`}>
                    Continue
                  </button>
                </div>
              </div>
            )}

            {videoFailed && (
              <div className="absolute inset-0 grid place-items-center bg-[#07080c] p-6 text-center">
                <div>
                  <p className="text-secondary-foreground text-sm">This video didn't load.</p>
                  <button
                    type="button"
                    onClick={() => {
                      retried.current = true;
                      setVideoFailed(false);
                      void reload();
                    }}
                    className={`${SOLID} mt-3`}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {hasVideo && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] bg-linear-to-b from-transparent to-black/75" />
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Play"
                  className={cn(
                    "ease-snappy absolute inset-0 m-auto grid size-[72px] place-items-center rounded-full bg-[#f5f5f7]/94 shadow-[0_0_60px_rgba(155,124,255,0.45)] transition-[opacity,scale] duration-[400ms] hover:scale-105",
                    (playing || overlay || notepadAt !== null) && "pointer-events-none scale-90 opacity-0",
                  )}
                >
                  <PlayIcon size={28} className="text-background" />
                </button>
                {muted && current.word_starts_ms && (
                  <button
                    type="button"
                    onClick={unmute}
                    className="text-foreground absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-[#16171f]/90 px-3 py-1.5 text-xs font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:bg-[#1f2029] sm:top-4 sm:left-4"
                  >
                    <SpeakerSlash size={15} />
                    Tap for sound
                  </button>
                )}
                <div className="text-secondary-foreground absolute inset-x-2 bottom-1.5 flex items-center gap-1.5 text-xs tabular-nums sm:inset-x-4 sm:bottom-3.5 sm:gap-3.5">
                  <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={CONTROL}>
                    {playing ? <Pause size={18} weight="fill" /> : <PlayIcon size={16} />}
                  </button>
                  <TimeLabel video={videoEl} duration={duration} />
                  <Scrub
                    video={videoEl}
                    playing={playing}
                    duration={duration}
                    notes={sceneNotes}
                    onSeek={seek}
                    onOpenNotes={openNotes}
                  />
                  <button
                    type="button"
                    onClick={openNotepad}
                    disabled={notesFull}
                    aria-label="Add a note"
                    title={notesFull ? "This lesson has 100 notes. Delete one to add more." : undefined}
                    className={cn(CONTROL, "disabled:cursor-default disabled:opacity-40")}
                  >
                    <NotePencil size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={fullscreen.toggle}
                    aria-label={fullscreen.full ? "Exit full screen" : "Full screen"}
                    className={CONTROL}
                  >
                    {fullscreen.full ? <CornersIn size={18} /> : <CornersOut size={18} />}
                  </button>
                </div>
              </>
            )}

            {notepadAt !== null && (
              <Notepad
                time={notepadAt}
                onCancel={() => setNotepadAt(null)}
                onSave={async (content) => {
                  await notes.add(scene, Math.min(notepadAt, TIME_MAX), content);
                  setNotepadAt(video.current?.currentTime ?? notepadAt);
                }}
              />
            )}

            {overlay === "quiz" && (
              <QuizOverlay
                scene={current}
                total={scenes.length}
                picked={answers[scene]}
                onPick={(choice) => setAnswers((a) => ({ ...a, [scene]: choice }))}
                onNext={next}
              />
            )}
            {overlay === "complete" && (
              <CompleteOverlay
                score={scoreOf(scenes, answers)}
                total={scenes.length}
                onAgain={() => go(scenes[0].position)}
                onAskTutor={() => {
                  setOverlay(null);
                  openCard("tutor");
                }}
              />
            )}
          </div>

          {/* On phones the quiz fills the film, so the finished scene's narration steps aside for it. */}
          <Narration
            video={videoEl}
            text={current.narration}
            wordStarts={current.word_starts_ms}
            className={cn(overlay && "max-sm:hidden")}
          />
        </div>
      </div>

      <ScenesPanel
        scenes={scenes}
        current={scene}
        watched={watched}
        progress={progress}
        video={videoEl}
        onSelect={go}
        rail={railRight}
        onToggleRail={toggleRail}
      />

      <Dock card={card} onPick={pickCard} />
      <TutorCard
        open={card === "tutor"}
        onClose={closeCard}
        tutor={tutor}
        moment={<Moment video={videoEl} scene={scene} />}
        onAsk={() => tutor.ask(scene, stampOf(video.current))}
      />
      <NotesCard
        open={card === "notes"}
        onClose={closeCard}
        notes={notes.notes}
        scenes={scenes}
        onOpenNote={(note: Note) => {
          setCard(null);
          go(note.scene_position, note.time_seconds);
        }}
        onEdit={notes.edit}
        onDelete={notes.remove}
        onDropped={notes.drop}
        focus={notesFocus}
      />
      <QuizCard
        open={card === "quiz"}
        onClose={closeCard}
        scenes={scenes}
        answers={answers}
        onPick={(position, choice) => setAnswers((a) => ({ ...a, [position]: choice }))}
      />
    </div>
  );
}

const CONTROL = cn(ICON_BUTTON, "text-foreground size-[30px] rounded-tile hover:bg-white/10 sm:size-[34px]");

const stampOf = (video: HTMLVideoElement | null) => Math.min(video?.currentTime ?? 0, TIME_MAX);

// The parts below follow the video's time on their own, so the page does not re-render as it plays.

function TimeLabel({ video, duration }: { video: HTMLVideoElement | null; duration: number }) {
  const seconds = useVideoTime(video, (v) => Math.floor(v.currentTime), 0);
  return (
    <span className="hidden sm:inline">
      {formatTime(seconds)} / {formatTime(duration)}
    </span>
  );
}

// Words grouped in sentences, split the way the server splits, so word k here is word k of the voice.
function sentencesOf(text: string) {
  const sentences: string[][] = [[]];
  for (const word of text.trim().split(/\s+/)) {
    sentences[sentences.length - 1].push(word);
    if (/[.!?]$/.test(word)) sentences.push([]);
  }
  return sentences.filter((words) => words.length);
}

// The last word that has started at this time; -1 before the voice begins.
function wordAt(starts: number[], ms: number) {
  let k = -1;
  while (k + 1 < starts.length && starts[k + 1] <= ms) k++;
  return k;
}

// The narration under the film, like subtitles. A voiced scene lights each word as it is spoken; an older, silent
// scene lights the sentence its share of the video has reached.
function Narration({
  video,
  text,
  wordStarts,
  className,
}: {
  video: HTMLVideoElement | null;
  text: string;
  wordStarts: number[] | null;
  className?: string;
}) {
  const sentences = sentencesOf(text);
  const firsts = sentences.map((_, s) => sentences.slice(0, s).reduce((sum, words) => sum + words.length, 0));
  const timed = wordStarts?.length === sentences.flat().length ? wordStarts : null;
  const lit = useVideoTime(
    video,
    (v) =>
      timed
        ? wordAt(timed, v.currentTime * 1000)
        : v.duration
          ? Math.min(sentences.length - 1, Math.floor((v.currentTime / v.duration) * sentences.length))
          : 0,
    0,
    !!timed,
  );
  return (
    <p
      className={cn(
        "text-foreground/50 mx-auto mt-3.5 max-w-[720px] text-center text-base leading-relaxed tracking-[-0.01em] sm:mt-5 sm:min-h-[60px] sm:text-[19px]",
        className,
      )}
    >
      {sentences.map((words, s) =>
        timed ? (
          <span key={s}>
            {words.map((word, w) => {
              const k = firsts[s] + w;
              // Only the sentence being spoken is lit, up to the word being spoken.
              const spoken = k <= lit && lit < firsts[s] + words.length;
              return (
                <span key={w} className={cn("transition-colors duration-150", spoken && "text-foreground")}>
                  {word}{" "}
                </span>
              );
            })}
          </span>
        ) : (
          <span key={s} className={cn("transition-colors duration-[400ms]", s === lit && "text-foreground")}>
            {words.join(" ")}{" "}
          </span>
        ),
      )}
    </p>
  );
}

function Moment({ video, scene }: { video: HTMLVideoElement | null; scene: number }) {
  const seconds = useVideoTime(video, (v) => Math.floor(stampOf(v)), 0);
  return `Scene ${scene} · ${formatTime(seconds)}`;
}
