from typing import Literal

from anthropic import Anthropic
from pydantic import BaseModel, ValidationError

from app.schemas import LessonPlan, ManimCode, ScenePlan
from app.services import prompts
from app.services.voice import Sentence

PLANNER = "claude-sonnet-5-5"
TUTOR = "claude-haiku-5-5"

client = Anthropic()


def _ask[T: BaseModel](prompt: str, schema: type[T], effort: Literal["low", "medium", "high"]) -> T:
    response = client.messages.parse(
        model=PLANNER,
        max_tokens=16000,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
        output_format=schema,
    )
    if response.parsed_output is None:
        raise RuntimeError(f"Claude returned no {schema.__name__} (stop_reason={response.stop_reason})")
    return response.parsed_output


def plan_lesson(topic: str, audience: str) -> LessonPlan:
    prompt = prompts.plan_prompt(topic, audience)
    # The plan decides how good the lesson is, so it gets high effort; the code only follows its steps.
    try:
        return _ask(prompt, LessonPlan, "high")
    except ValidationError:
        # A plan that breaks a quiz rule is rare, so one more try usually gives a full lesson.
        return _ask(prompt, LessonPlan, "high")


def write_manim(scene: ScenePlan, sentences: list[Sentence]) -> str:
    return _ask(prompts.manim_prompt(scene, sentences), ManimCode, "medium").code


def fix_manim(code: str, error: str, sentences: list[Sentence]) -> str:
    return _ask(prompts.fix_prompt(code, error, sentences), ManimCode, "medium").code


def tutor_reply(system: str, messages: list[dict]) -> str:
    # Haiku 5.5 thinks before it answers, and thinking counts toward max_tokens; low effort keeps replies quick.
    response = client.with_options(timeout=30).messages.create(
        model=TUTOR, max_tokens=2000, output_config={"effort": "low"}, system=system, messages=messages
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    return text or "Sorry, I can't help with that. Try asking about the lesson."
