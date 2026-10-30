import array
import base64
import io
import logging
import re
import wave
from typing import NamedTuple

import httpx

from app.config import MURF_API_KEY

MURF_URL = "https://api.murf.ai/v1/speech/generate"
MURF_SECONDS = 60
VOICE = {"voiceId": "en-IN-isha", "locale": "en-IN", "style": "Narration"}
SAMPLE_RATE = 24000
PAUSE_SECONDS = 0.6
PAUSE = array.array("h", bytes(2 * int(SAMPLE_RATE * PAUSE_SECONDS)))
# Isha's pace in our tests; the Manim code is written from this estimate while Murf speaks.
WORDS_PER_SECOND = 3.3
# -35 dB: quieter than this is silence, the level our Murf tests used.
LOUD = 32768 * 10 ** (-35 / 20)
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
PUNCTUATION = re.compile(r"^[\s.,!?;:()\"'“”‘’-]+$")
log = logging.getLogger(__name__)


class Sentence(NamedTuple):
    text: str
    # Planned place on the track, in seconds: the sentences back to back with a pause between them.
    start: float
    end: float


class Voice(NamedTuple):
    sentences: list[Sentence]
    # Each sentence's speech with Murf's silence cut, and where its words start in it.
    clips: list[array.array]
    word_ms: list[list[int]]
    # False if Murf's words did not match ours, so there is no word highlight.
    matched: bool


class Track(NamedTuple):
    wav: bytes
    seconds: float
    word_starts_ms: list[int] | None


def _sentences(narration: str) -> list[str]:
    return SENTENCE_END.split(narration.strip())


def estimate(narration: str) -> list[Sentence]:
    sentences, at = [], 0.0
    for text in _sentences(narration):
        length = len(text.split()) / WORDS_PER_SECOND
        sentences.append(Sentence(text, at, at + length))
        at += length + PAUSE_SECONDS
    return sentences


def _post(body: dict) -> dict:
    response = httpx.post(MURF_URL, headers={"api-key": MURF_API_KEY}, json=body, timeout=MURF_SECONDS)
    response.raise_for_status()
    return response.json()


def _speak(text: str) -> tuple[array.array, list[int]]:
    body = {**VOICE, "text": text, "format": "WAV", "sampleRate": SAMPLE_RATE, "encodeAsBase64": True,
            "wordDurationsAsOriginalText": True}
    try:
        data = _post(body)
    except httpx.HTTPError:
        data = _post(body)
    with wave.open(io.BytesIO(base64.b64decode(data["encodedAudio"]))) as clip:
        samples = array.array("h", clip.readframes(clip.getnframes()))
    # Murf returns punctuation as words of its own.
    starts = [word["startMs"] for word in data["wordDurations"] if not PUNCTUATION.match(word["word"])]
    return samples, starts


def _speech(samples: array.array) -> tuple[int, int]:
    # Murf pads each clip with silence; cut it so every gap between sentences is our pause.
    window = SAMPLE_RATE // 100
    loud = [i for i in range(0, len(samples), window) if max(map(abs, samples[i:i + window])) > LOUD]
    return loud[0], loud[-1] + window


def _narrate(narration: str) -> Voice:
    # One Murf call per sentence: a sentence start inside a longer clip comes back about 0.2 s early.
    sentences, clips, word_ms, matched, at = [], [], [], True, 0
    for text in _sentences(narration):
        samples, starts = _speak(text)
        first, last = _speech(samples)
        lead_ms = first * 1000 / SAMPLE_RATE
        # Murf puts the first word at 0 ms, inside the silence we cut.
        word_ms.append([round(max(ms - lead_ms, 0)) for ms in starts])
        matched &= len(starts) == len(text.split())
        clips.append(samples[first:last])
        sentences.append(Sentence(text, at / SAMPLE_RATE, (at + last - first) / SAMPLE_RATE))
        at += last - first + len(PAUSE)
    if not matched:
        log.warning("Murf words did not match the narration, so no word highlight: %s", narration[:80])
    return Voice(sentences, clips, word_ms, matched)


def narrate(narration: str) -> Voice | None:
    if not MURF_API_KEY:
        return None
    # A scene without a voice is still worth keeping.
    try:
        return _narrate(narration)
    except Exception:
        log.exception("Voice failed, so the scene stays silent")
        return None


def track(voice: Voice, marks: dict[int, float]) -> Track:
    # Each sentence starts where the video reached it; a late picture only makes the pause before it longer.
    samples, starts = array.array("h"), []
    for number, (sentence, clip, word_ms) in enumerate(zip(voice.sentences, voice.clips, voice.word_ms), 1):
        at = max(round(marks.get(number, sentence.start) * SAMPLE_RATE), len(samples))
        samples.extend(array.array("h", bytes(2 * (at - len(samples)))))
        starts += [round(at * 1000 / SAMPLE_RATE) + ms for ms in word_ms]
        samples.extend(clip)
        samples.extend(PAUSE)
    wav = io.BytesIO()
    with wave.open(wav, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(samples.tobytes())
    return Track(wav.getvalue(), len(samples) / SAMPLE_RATE, starts if voice.matched else None)
