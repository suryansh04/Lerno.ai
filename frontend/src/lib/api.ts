import { supabase } from "@/lib/supabase";

export type Level = "school" | "high_school" | "college";
export type Status = "queued" | "generating" | "ready" | "failed";

export interface Lesson {
  id: string;
  topic: string;
  title: string | null;
  audience: Level;
  status: Status;
  step: number;
  error: string | null;
  created_at: string;
}

export interface Scene {
  position: number;
  title: string;
  narration: string;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  // When each narration word is spoken, one per space-separated word; null for silent scenes.
  word_starts_ms: number[] | null;
  mcq_question: string;
  mcq_choices: string[];
  mcq_correct_index: number;
  fr_question: string;
  fr_answer: string;
}

export interface Usage {
  used: number;
  limit: number;
  tries: number;
  try_limit: number;
}

export const LEVELS: Record<Level, string> = { school: "School", high_school: "High school", college: "College" };

export type LessonWithScenes = Lesson & { scenes: Scene[] };

export const isMaking = (lesson: Lesson) => lesson.status === "queued" || lesson.status === "generating";

// status is 0 when the server could not be reached at all.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Errors carry the server's own message, which is already written for people.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
    });
  } catch {
    throw new ApiError("Couldn't reach Lerno. Check your connection and try again.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.detail === "string" ? body.detail : "Something went wrong. Please try again.";
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
