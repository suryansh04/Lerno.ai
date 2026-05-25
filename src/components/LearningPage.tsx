"use client";
import { useState, useEffect, useRef } from "react";
import AIChatbot from "./AIChatbot";
import { HoverBorderGradient } from "@/ui/hover-border-gradient";
import { AnimatedShinyText } from "@/ui/animated-shiny-text";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { ref, getDownloadURL, listAll } from "firebase/storage";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { storage, db } from "./firebaseConfig";
import axios from "axios";
import { FiChevronDown, FiX, FiSave, FiEdit3, FiTrash2 } from "react-icons/fi";
import { FloatingDock } from "@/ui/floating-dock";
import { Phone, BookOpen } from "lucide-react";

const MURF_API_KEY = import.meta.env.VITE_MURF_API;

const getCurrentUserId = () => {
  return localStorage.getItem("userId") || "defaultUser";
};

const slideVariants: Variants = {
  hidden: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 300, damping: 30 },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
    transition: { duration: 0.2 },
  }),
};

// Language options
const LANGUAGE_OPTIONS = [
  { code: "en-US", label: "English", voiceId: "en-US-natalie" },
  { code: "hi-IN", label: "Hindi - India", voiceId: "hi-IN-ayushi" },
  { code: "ta-IN", label: "Tamil - India", voiceId: "ta-IN-abirami" },
  { code: "bn-IN", label: "Bengali - India", voiceId: "bn-IN-ishani" },
];

interface Note {
  id: string;
  title: string;
  content: string;
  timestamp: Date;
  lessonTitle: string;
}

const LearningPage = () => {
  const location = useLocation();
  const [videoURLs, setVideoURLs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const murfAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isMurfLoading, setIsMurfLoading] = useState(false);
  const [murfError, setMurfError] = useState<string | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [isCallLoading, setIsCallLoading] = useState(false);

  // Language-related states
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGE_OPTIONS[0]);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [translatedNarration, setTranslatedNarration] = useState<string>("");
  const [isTranslating, setIsTranslating] = useState(false);

  // Notes state
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState({ title: "", content: "" });
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        setLoading(true);
        const storageRef = ref(storage, "/");
        const result = await listAll(storageRef);
        const videoRefs = result.items.filter((item) =>
          item.name.toLowerCase().endsWith(".mp4"),
        );
        videoRefs.sort((a, b) => {
          const sceneA = a.name.match(/_Scene(\d+)\.mp4$/i);
          const sceneB = b.name.match(/_Scene(\d+)\.mp4$/i);
          if (sceneA && sceneB) {
            return Number.parseInt(sceneA[1]) - Number.parseInt(sceneB[1]);
          }
          return a.name.localeCompare(b.name);
        });
        const urls = await Promise.all(
          videoRefs.map((videoRef) => getDownloadURL(videoRef)),
        );
        setVideoURLs(urls);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching videos:", error);
        setLoading(false);
      }
    };
    fetchVideos();
  }, []);

  useEffect(() => {
    loadNotes();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      localStorage.removeItem("userId");
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const FetchData = location.state?.responseData || [
    {
      title: "Introduction to Vectors",
      assessment: {
        multiple_choice: {
          question: "What is the primary purpose of vectors in computing?",
          choices: [
            "A. Data storage only",
            "B. Mathematical operations and graphics",
            "C. Text processing",
            "D. Audio manipulation",
          ],
          correct_index: 1,
        },
      },
      narration:
        "Vectors are a fundamental concept in computing, especially in graphics programming and mathematical operations.",
    },
  ];

  const [selectedAnswerIndex, setSelectedAnswerIndex] = useState<number | null>(
    null,
  );
  const [hasAnswered, setHasAnswered] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);

  //Narration Logic
  const [narrationWords, setNarrationWords] = useState<string[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const [wordTimings, setWordTimings] = useState<
    { word: string; start: number; end: number; index: number }[]
  >([]);
  const currentSlide = FetchData[currentSlideIndex] || FetchData[0];
  const answer = currentSlide.assessment.multiple_choice.choices;
  const question = currentSlide.assessment.multiple_choice.question;
  const correctAnswerIndex =
    currentSlide.assessment.multiple_choice.correct_index;

  function handleAnswerClick(currIndex: number) {
    setSelectedAnswerIndex(currIndex);
    setHasAnswered(true);
  }

  function handleNextSlide() {
    const totalSlides = Math.min(FetchData.length, 5);
    if (currentSlideIndex < totalSlides - 1) {
      setCurrentSlideIndex((prevIndex) => prevIndex + 1);
    } else {
      setCurrentSlideIndex(0);
    }

    if (videoURLs.length > 0) {
      if (currentVideoIndex < videoURLs.length - 1) {
        setCurrentVideoIndex((prevIndex) => prevIndex + 1);
      } else {
        setCurrentVideoIndex(0);
      }
    }
    setSelectedAnswerIndex(null);
    setHasAnswered(false);
  }

  const [direction, setDirection] = useState(1);

  function animatedNextSlide() {
    setDirection(1);
    handleNextSlide();
  }

  // Notes functions
  const loadNotes = async () => {
    try {
      setNotesLoading(true);
      const userId = getCurrentUserId();
      const notesDoc = await getDoc(doc(db, "userNotes", userId));

      if (notesDoc.exists()) {
        const userData = notesDoc.data();
        const userNotes = userData.notes || [];
        // Convert timestamps back to Date objects
        const formattedNotes = userNotes.map((note: any) => ({
          ...note,
          timestamp: note.timestamp?.toDate
            ? note.timestamp.toDate()
            : new Date(note.timestamp),
        }));
        setNotes(formattedNotes);
      }
    } catch (error) {
      console.error("Error loading notes:", error);
    } finally {
      setNotesLoading(false);
    }
  };

  const saveNote = async () => {
    if (!currentNote.title.trim() || !currentNote.content.trim()) return;

    try {
      setIsSavingNote(true);
      const userId = getCurrentUserId();
      const noteId = editingNoteId || Date.now().toString();

      const noteData = {
        id: noteId,
        title: currentNote.title,
        content: currentNote.content,
        timestamp: new Date(),
        lessonTitle: currentSlide.title,
      };

      if (isEditingNote && editingNoteId) {
        // Update existing note
        const updatedNotes = notes.map((note) =>
          note.id === editingNoteId ? noteData : note,
        );
        await setDoc(doc(db, "userNotes", userId), { notes: updatedNotes });
        setNotes(updatedNotes);
      } else {
        // Add new note
        const newNotes = [...notes, noteData];
        await setDoc(doc(db, "userNotes", userId), { notes: newNotes });
        setNotes(newNotes);
      }

      // Reset form
      setCurrentNote({ title: "", content: "" });
      setIsEditingNote(false);
      setEditingNoteId(null);
    } catch (error) {
      console.error("Error saving note:", error);
    } finally {
      setIsSavingNote(false);
    }
  };

  const editNote = (note: Note) => {
    setCurrentNote({ title: note.title, content: note.content });
    setIsEditingNote(true);
    setEditingNoteId(note.id);
  };

  const deleteNote = async (noteId: string) => {
    try {
      const userId = getCurrentUserId();
      const updatedNotes = notes.filter((note) => note.id !== noteId);
      await setDoc(doc(db, "userNotes", userId), { notes: updatedNotes });
      setNotes(updatedNotes);
    } catch (error) {
      console.error("Error deleting note:", error);
    }
  };

  const resetNoteForm = () => {
    setCurrentNote({ title: "", content: "" });
    setIsEditingNote(false);
    setEditingNoteId(null);
  };

  // Function to stop all audio playback
  const stopAllAudio = () => {
    if (murfAudioRef.current) {
      murfAudioRef.current.pause();
      murfAudioRef.current.currentTime = 0;
      murfAudioRef.current.removeEventListener("timeupdate", () => {});
      murfAudioRef.current = null;
    }
    setCurrentWordIndex(-1);
  };

  // Translation function
  const translateText = async (
    text: string,
    targetLanguage: string,
  ): Promise<string> => {
    if (targetLanguage === "en-US") {
      return text; // Return original text for English
    }

    try {
      setIsTranslating(true);
      const response = await axios.post(
        "https://api.murf.ai/v1/text/translate",
        {
          targetLanguage: targetLanguage,
          texts: [text],
        },
        {
          headers: {
            "api-key": MURF_API_KEY,
            "Content-Type": "application/json",
          },
        },
      );

      if (response.data.translations && response.data.translations.length > 0) {
        return response.data.translations[0].translated_text;
      }
      return text; // Fallback to original text
    } catch (error) {
      console.error("Translation failed:", error);
      return text; // Fallback to original text
    } finally {
      setIsTranslating(false);
    }
  };

  // Handle language change
  const handleLanguageChange = async (
    language: (typeof LANGUAGE_OPTIONS)[0],
  ) => {
    // Stop all current audio first
    stopAllAudio();

    setSelectedLanguage(language);
    setShowLanguageDropdown(false);

    // Translate the narration
    const translated = await translateText(
      currentSlide.narration,
      language.code,
    );
    setTranslatedNarration(translated);
  };

  //It Shows Paragraph Immediately
  useEffect(() => {
    const textToUse = translatedNarration || currentSlide.narration;
    if (textToUse) {
      const words = textToUse.trim().split(/\s+/);
      setNarrationWords(words);
      setCurrentWordIndex(-1); // Reset on new slide
    }
  }, [currentSlide.narration, translatedNarration]);

  // Reset translation when slide changes
  useEffect(() => {
    stopAllAudio(); // Stop audio when slide changes
    setTranslatedNarration("");
    setSelectedLanguage(LANGUAGE_OPTIONS[0]); // Reset to English
  }, [currentSlideIndex]);

  useEffect(() => {
    let cancelled = false;
    let audio: HTMLAudioElement | null = null;
    let timeUpdateHandler: ((event: Event) => void) | null = null;

    async function fetchAndPlayMurfAudio() {
      setIsMurfLoading(true);
      setMurfError(null);

      // Stop any existing audio before starting new one
      stopAllAudio();

      try {
        const textToNarrate = translatedNarration || currentSlide.narration;

        const response = await axios.post(
          "https://api.murf.ai/v1/speech/generate",
          {
            text: textToNarrate,
            voiceId: selectedLanguage.voiceId,
            format: "mp3",
            channelType: "MONO",
            sampleRate: 44100,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "api-key": MURF_API_KEY,
            },
          },
        );

        if (cancelled) return;

        const audioUrl = response.data.audioFile;
        const wordTimingsData = response.data.wordDurations.map((w, i) => ({
          word: w.word,
          start: w.startMs / 1000,
          end: w.endMs / 1000,
          index: i,
        }));
        setWordTimings(wordTimingsData);
        console.log(wordTimingsData);

        console.log(response);
        if (audioUrl) {
          audio = new Audio(audioUrl);
          murfAudioRef.current = audio;

          // Create time update handler
          timeUpdateHandler = () => {
            if (!audio) return;
            const currentTime = audio.currentTime;
            const currentWord = wordTimingsData.find(
              (w) => currentTime >= w.start && currentTime <= w.end,
            );
            if (currentWord) {
              setCurrentWordIndex(currentWord.index);
            }
          };

          audio.addEventListener("timeupdate", timeUpdateHandler);

          // Add ended event listener to reset word index
          audio.addEventListener("ended", () => {
            setCurrentWordIndex(-1);
          });

          const playPromise = audio.play();
          playPromise?.catch(() => {
            const handleUserInteraction = () => {
              if (audio && !cancelled) {
                audio.play();
              }
              window.removeEventListener("click", handleUserInteraction);
              window.removeEventListener("keydown", handleUserInteraction);
            };
            window.addEventListener("click", handleUserInteraction, {
              once: true,
            });
            window.addEventListener("keydown", handleUserInteraction, {
              once: true,
            });
          });
        }
      } catch (e) {
        if (!cancelled) {
          setMurfError(
            "Failed to fetch narration audio from Murf. See console for details.",
          );
          console.error(e);
        }
      }
      if (!cancelled) setIsMurfLoading(false);
    }

    const textToUse = translatedNarration || currentSlide.narration;
    if (textToUse) fetchAndPlayMurfAudio();

    return () => {
      cancelled = true;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        if (timeUpdateHandler) {
          audio.removeEventListener("timeupdate", timeUpdateHandler);
        }
        audio.removeEventListener("ended", () => {});
      }
      if (murfAudioRef.current) {
        murfAudioRef.current.pause();
        murfAudioRef.current.currentTime = 0;
        murfAudioRef.current = null;
      }
    };
  }, [currentSlide.narration, translatedNarration, selectedLanguage]);

  const handleInitiateCall = async () => {
    setIsCallLoading(true);

    const phoneNumber = import.meta.env.VITE_PHONE_NUMBER;
    const VAPI_API_KEY = import.meta.env.VITE_VAPI_API_KEY;
    const ASSISTANT_ID = import.meta.env.VITE_ASSISTANT_ID;
    const PHONE_NUMBER_ID = import.meta.env.VITE_PHONE_NUMBER_ID;

    try {
      const response = await axios.post(
        "https://api.vapi.ai/call",
        {
          assistantId: ASSISTANT_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          customer: {
            number: phoneNumber,
          },
          metadata: {
            topic: "Vectors",
            narration:
              "Vectors are a fundamental concept in computing, especially in graphics programming and mathematical operations.",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${VAPI_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (response.data?.id) {
        alert("📞 Call initiated! You'll receive a call shortly.");
      } else {
        alert("⚠ Call failed, no call ID returned.");
        console.log(response.data);
      }
    } catch (error: any) {
      console.error("❌ Call failed:", error);
      if (error.response?.data) {
        alert(`❌ Vapi Error: ${JSON.stringify(error.response.data)}`);
      } else {
        alert("❌ Unknown error. See console.");
      }
    } finally {
      setIsCallLoading(false);
    }
  };

  // Floating dock items
  const dockItems = [
    {
      title: "Notes",
      icon: <BookOpen className="h-full w-full text-white/80" />,
      href: "#",
      onClick: () => setShowNotesModal(true),
    },
    {
      title: "Call Tutor",
      icon: <Phone className="h-full w-full text-white/80" />,
      href: "#",
      onClick: () => setShowCallModal(true),
    },
  ];

  return (
    <>
      <div className="relative flex flex-col items-center justify-center w-full min-h-screen bg-black p-4 md:p-8">
        <div className="z-10 flex mb-8">
          <div
            className={cn(
              "group rounded-full border border-black/5 bg-neutral-900 text-base transition-all ease-in hover:cursor-pointer hover:bg-neutral-800 shadow-lg",
            )}
          >
            <AnimatedShinyText className="inline-flex items-center justify-center px-6 py-2.5 font-medium text-lg transition ease-out">
              <AnimatePresence mode="wait">
                <motion.span
                  key={currentSlideIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {currentSlide.title}
                </motion.span>
              </AnimatePresence>
            </AnimatedShinyText>
          </div>
        </div>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentSlideIndex}
            custom={direction}
            variants={slideVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 w-full max-w-6xl"
          >
            {/* Box 1: Video */}
            <div className="relative group overflow-hidden rounded-xl border border-white/10 md:col-span-2 h-72 md:h-96 bg-zinc-900/50 backdrop-blur-sm transition-all duration-300 hover:border-white/30 hover:bg-zinc-900/70">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]"></div>
              <div className="h-full w-full flex items-center justify-center p-2">
                {loading ? (
                  <div className="text-white/70 flex flex-col items-center">
                    <svg
                      className="animate-spin h-10 w-10 text-white/30 mb-3"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span>Loading videos...</span>
                  </div>
                ) : videoURLs.length > 0 ? (
                  <div className="w-auto h-auto">
                    <video
                      src={videoURLs[currentVideoIndex]}
                      autoPlay
                      muted
                      loop
                      className="object-contain rounded-lg"
                      key={videoURLs[currentVideoIndex]}
                    ></video>
                  </div>
                ) : (
                  <div className="text-white/70">
                    No videos found in storage
                  </div>
                )}
              </div>
              <div className="absolute inset-0 pointer-events-none border border-white/5 rounded-xl"></div>
              <div className="absolute -inset-px bg-gradient-to-r from-purple-500/30 via-transparent to-cyan-500/30 rounded-xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500"></div>
            </div>
            {/* Narration Box */}
            <div className="relative group overflow-hidden rounded-xl border border-white/10 p-6 h-72 md:h-96 bg-zinc-900/50 backdrop-blur-sm transition-all duration-300 hover:border-white/30 hover:bg-zinc-900/70">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/20 via-emerald-500/20 to-teal-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]"></div>
              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="white"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="white"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-white">Narration</h3>
                </div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="flex-grow overflow-y-auto pr-2 text-white/70 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
                >
                  {isTranslating ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-white/50 flex flex-col items-center">
                        <svg
                          className="animate-spin h-6 w-6 text-white/30 mb-2"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        <span className="text-sm">Translating...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-x-1 gap-y-2 leading-relaxed">
                      {narrationWords.map((word, idx) => {
                        const isHighlighted = currentWordIndex === idx;
                        const isPunctuation = /^[.,!?]$/.test(word);
                        return (
                          <span
                            key={idx}
                            className={`transition-all duration-200 ${
                              isHighlighted
                                ? "bg-white/20 px-1 rounded text-white"
                                : "text-white/70"
                            }`}
                            style={{
                              display: isPunctuation
                                ? "inline"
                                : "inline-block",
                              marginRight: isPunctuation ? "0" : "0.1rem",
                            }}
                          >
                            {word}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </motion.div>

                {/* Language Dropdown */}
                <div className="relative mt-3">
                  <button
                    onClick={() =>
                      setShowLanguageDropdown(!showLanguageDropdown)
                    }
                    className="flex items-center justify-between  px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg text-white/70 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                  >
                    <span>{selectedLanguage.label}</span>
                    <FiChevronDown
                      className={`w-3 h-3 transition-transform duration-200 ${
                        showLanguageDropdown ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {showLanguageDropdown && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-zinc-800 border border-white/10 rounded-lg shadow-lg z-20 overflow-hidden">
                      {LANGUAGE_OPTIONS.map((language) => (
                        <button
                          key={language.code}
                          onClick={() => handleLanguageChange(language)}
                          className={`w-full px-3 py-2 text-xs text-left hover:bg-white/10 transition-colors duration-200 ${
                            selectedLanguage.code === language.code
                              ? "bg-white/10 text-white"
                              : "text-white/70"
                          }`}
                        >
                          {language.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="absolute -inset-px bg-gradient-to-r from-green-500/30 via-transparent to-emerald-500/30 rounded-xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500"></div>
            </div>
            {/* Box 2: MCQ Question & Answers */}
            <div className="relative group overflow-hidden rounded-xl border border-white/10 p-4 min-h-[18rem] h-auto bg-zinc-900/50 backdrop-blur-sm transition-all duration-300 hover:border-white/30 hover:bg-zinc-900/70">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-cyan-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]"></div>
              <div className="relative z-10 flex flex-col h-full">
                <h3 className="text-xl font-medium text-white mb-3">
                  Question
                </h3>
                <p className="text-white/70 mb-4">{question}</p>
                <div className="space-y-3 flex-grow">
                  {answer.map((info: string, index: number) => (
                    <motion.button
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.1,
                      }}
                      className={`w-full text-left px-4 py-2.5 rounded-lg border ${
                        selectedAnswerIndex === index &&
                        correctAnswerIndex === index
                          ? "bg-green-500/30 border-green-500/50 text-white"
                          : selectedAnswerIndex === index
                            ? "bg-red-500/30 border-red-500/50 text-white"
                            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20"
                      } transition-all duration-200 ${
                        hasAnswered && "cursor-default"
                      }`}
                      onClick={() => !hasAnswered && handleAnswerClick(index)}
                      key={index}
                      disabled={hasAnswered}
                    >
                      {info}
                    </motion.button>
                  ))}
                </div>
              </div>
              <div className="absolute -inset-px bg-gradient-to-r from-blue-500/30 via-transparent to-purple-500/30 rounded-xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500"></div>
            </div>
            {/* Box 3: AI Chatbot */}
            <div className="md:col-span-1 h-full">
              <AIChatbot
                lessonTitle={currentSlide.title}
                lessonContent={currentSlide.narration}
              />
            </div>
            {/* Box 4: Next button */}
            <div className="relative group overflow-hidden rounded-xl border border-white/10 p-6 bg-zinc-900/50 backdrop-blur-sm transition-all duration-300 hover:border-white/30 hover:bg-zinc-900/70">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-rose-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]"></div>
              <div className="h-full w-full flex items-center justify-center relative z-10">
                <HoverBorderGradient
                  containerClassName={`rounded-full ${
                    !hasAnswered && "opacity-50 pointer-events-none"
                  }`}
                  as="button"
                  className="bg-black text-white flex items-center space-x-2 px-6 py-3"
                  onClick={animatedNextSlide}
                >
                  <span>Next Lesson</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-5 h-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                    />
                  </svg>
                </HoverBorderGradient>
              </div>
              <div className="absolute -inset-px bg-gradient-to-r from-amber-500/30 via-transparent to-rose-500/30 rounded-xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500"></div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Floating Dock - Right Side */}
        <div className="fixed right-5 top-1/2 -translate-y-1/2 z-50">
          <FloatingDock
            items={dockItems}
            desktopClassName="flex-col h-auto w-16"
            mobileClassName="flex-col h-auto w-16"
          />
        </div>

        {/* Call Modal */}
        {showCallModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-neutral-900 border border-white/10 rounded-2xl p-8 shadow-2xl w-[90%] max-w-md text-white backdrop-blur-md">
              <h2 className="text-xl font-semibold mb-4 text-white">
                Need help with this lesson?
              </h2>
              <p className="mb-6 text-neutral-400 leading-relaxed">
                We'll connect you with an AI tutor via phone call to solve your
                doubts live.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  className="bg-transparent border border-white/20 text-white hover:bg-white/5 active:bg-white/10 px-6 py-2.5 rounded-full font-medium transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                  onClick={() => setShowCallModal(false)}
                  disabled={isCallLoading}
                >
                  Cancel
                </button>
                <button
                  className="bg-white text-black hover:bg-gray-100 active:bg-gray-200 px-6 py-2.5 rounded-full font-medium transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
                  onClick={() => {
                    setShowCallModal(false);
                    handleInitiateCall();
                  }}
                  disabled={isCallLoading}
                >
                  {isCallLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Calling...
                    </>
                  ) : (
                    "Start Call"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Notes Modal */}
        {showNotesModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] text-white flex flex-col backdrop-blur-md">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <BookOpen size={24} className="text-white/80" />
                  <h2 className="text-xl font-semibold text-white">
                    My Learning Notes
                  </h2>
                </div>
                <button
                  onClick={() => {
                    setShowNotesModal(false);
                    resetNoteForm();
                  }}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white "
                >
                  <FiX size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Notes List */}
                <div className="w-1/2 border-r border-white/10 p-6 overflow-y-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-medium text-white">
                      Saved Notes
                    </h3>
                    <button
                      onClick={() => {
                        setCurrentNote({ title: "", content: "" });
                        setIsEditingNote(false);
                        setEditingNoteId(null);
                      }}
                      className="bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                    >
                      <FiEdit3 size={14} />
                      New Note
                    </button>
                  </div>

                  {notesLoading ? (
                    <div className="flex justify-center py-12">
                      <svg
                        className="animate-spin h-8 w-8 text-white/30"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    </div>
                  ) : notes.length === 0 ? (
                    <div className="text-center py-12 text-neutral-400">
                      <BookOpen size={48} className="mx-auto mb-4 opacity-30" />
                      <p className="leading-relaxed">
                        No notes yet. Start taking notes to remember key
                        concepts!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {notes
                        .sort(
                          (a, b) =>
                            new Date(b.timestamp).getTime() -
                            new Date(a.timestamp).getTime(),
                        )
                        .map((note) => (
                          <div
                            key={note.id}
                            className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer transform hover:scale-[1.01]"
                            onClick={() => editNote(note)}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <h4 className="font-medium text-white truncate flex-1 mr-2 text-base">
                                {note.title}
                              </h4>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteNote(note.id);
                                }}
                                className="text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                              >
                                <FiTrash2 size={14} />
                              </button>
                            </div>
                            <p className="text-neutral-400 text-sm mb-3 line-clamp-2 leading-relaxed">
                              {note.content}
                            </p>
                            <div className="flex items-center justify-between text-xs text-neutral-500">
                              <span className="bg-white/10 px-3 py-1.5 rounded-full border border-white/10">
                                {note.lessonTitle}
                              </span>
                              <span>
                                {new Date(note.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Note Editor */}
                <div className="w-1/2 flex flex-col">
                  {/* Editor Header */}
                  <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
                    <h3 className="text-lg font-medium text-white">
                      {isEditingNote ? "Edit Note" : "New Note"}
                    </h3>
                    {isEditingNote && (
                      <button
                        onClick={resetNoteForm}
                        className="text-neutral-400 hover:text-white text-sm transition-colors duration-200"
                      >
                        Cancel Edit
                      </button>
                    )}
                  </div>

                  {/* Editor Content */}
                  <div className="flex-1 flex flex-col p-6 space-y-4 overflow-hidden">
                    {/* Title Input */}
                    <div className="flex-shrink-0">
                      <label className="block text-sm font-medium text-neutral-400 mb-2">
                        Note Title
                      </label>
                      <input
                        type="text"
                        value={currentNote.title}
                        onChange={(e) =>
                          setCurrentNote((prev) => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                        placeholder="Enter note title..."
                        className="w-full bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-white/40 focus:bg-white/10 transition-all duration-200"
                      />
                    </div>

                    {/* Content Textarea */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <label className="block text-sm font-medium text-neutral-400 mb-2 flex-shrink-0">
                        Note Content
                      </label>
                      <textarea
                        value={currentNote.content}
                        onChange={(e) =>
                          setCurrentNote((prev) => ({
                            ...prev,
                            content: e.target.value,
                          }))
                        }
                        placeholder="Write your notes here..."
                        className="flex-1 bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-white/40 focus:bg-white/10 transition-all duration-200 resize-none"
                      />
                    </div>
                  </div>

                  {/* Editor Footer */}
                  <div className="flex-shrink-0 p-6 border-t border-white/10 space-y-4">
                    {/* Save Button */}
                    <button
                      onClick={saveNote}
                      disabled={
                        !currentNote.title.trim() ||
                        !currentNote.content.trim() ||
                        isSavingNote
                      }
                      className="w-full bg-white text-black hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3 rounded-full font-medium transition-all duration-200 transform cursor-pointer flex items-center gap-2 justify-center"
                    >
                      {isSavingNote ? (
                        <>
                          <svg
                            className="animate-spin h-4 w-4"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                              fill="none"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          Saving...
                        </>
                      ) : (
                        <>
                          <FiSave size={16} />
                          {isEditingNote ? "Update Note" : "Save Note"}
                        </>
                      )}
                    </button>

                    {/* Current Lesson Info */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <p className="text-sm text-neutral-400 leading-relaxed">
                        📚 Current Lesson:{" "}
                        <span className="text-white font-medium">
                          {currentSlide.title}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default LearningPage;
