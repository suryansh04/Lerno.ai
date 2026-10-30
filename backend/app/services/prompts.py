from app.config import SCENES_PER_LESSON
from app.schemas import ScenePlan
from app.services.voice import Sentence

AUDIENCES = {
    "school": "a school student",
    "high_school": "a high school student",
    "college": "a college student",
}

# Shared by the plan and the code rules, so the planner never designs a screen the code may not draw.
COLORS = "WHITE, YELLOW, BLUE, GREEN, RED, PURPLE, ORANGE, PINK, GRAY"
SCREEN_LIMITS = "at most 6 labels and equations on screen at once, each equation at most about 20 characters"

# A raw f-string: LaTeX like \vec stays intact, and literal braces are doubled.
MANIM_RULES = rf"""Write Manim Community Edition v0.19.0 code for one scene of an educational video.

Rules:
- Start with: from lerno_theme import *
  (it includes all of manim and sets Lerno's fonts, colours, background and line style; never override them)
- Define exactly one class: class LessonScene(Scene)
- Show every label, number and equation the description names, with its exact text; they carry the explanation
- Simple sequential animations only: no loops, comprehensions, custom functions, randomness or if statements
- Use only: scene_label, Text, MathTex, Axes, NumberPlane, Arrow, Line, DashedLine, Dot, Circle, Square, Rectangle,
  Polygon, SurroundingRectangle, Brace, VGroup
- Animations: Create, Write, FadeIn, FadeOut, Transform, GrowArrow, Indicate
- No images, SVGs, sounds, file access or imports other than lerno_theme
- Title: the first line of construct is title = scene_label("Scene title") in sentence case, shown with
  self.play(FadeIn(title)); never make a title with Text or put any text at the top centre
- Text and MathTex: font_size 32-44, at most 10 words per Text; {SCREEN_LIMITS}, so FadeOut text that is done
  before adding more; show longer working as short lines one after another, or Transform(old, new) so the old line
  is gone; never shrink text to fit
- Placement: never on top of a line, curve, axis number or other text; a label goes just outside its shape with
  .next_to(shape, direction, buff=0.2); equations go beside the diagram with .next_to(diagram, RIGHT, buff=0.5) or
  below it, several stacked in a VGroup with .arrange(DOWN, buff=0.4); text beside a wide diagram has little room,
  so keep it to 4 words per line or put it below; the render stops with an error if any text leaves the screen
- Numbers: show only values given in the scene description or exact simple ones; never work out new decimals;
  round any approximation to 2 decimal places and write it with \approx
- Layout: the safe area is x from -6 to 6 and y from -3.4 to 2.7; the main diagram fills most of it
  (about 9 units wide or 5 units tall) and nothing leaves it; keep the bottom-right corner empty for the logo
- Axes: only for graphs and coordinates; size them with x_length and y_length (for example x_length=10,
  y_length=5); show their numbers with axis_config={{"include_numbers": True, "font_size": 24}} and range steps
  that give at most 6 numbers per axis; place points on them with axes.c2p(x, y)
- Colors: {COLORS} (they are Lerno's palette); never set a background colour
- Arrows: Arrow(start=ORIGIN, end=[2, 1, 0], buff=0, color=YELLOW); never use scale_tips or add_tip()
- 2D points are [x, y, 0]

Example of the style (a full scene has 5 to 7 steps):
from lerno_theme import *

class LessonScene(Scene):
    def construct(self):
        title = scene_label("A vector on the plane")
        axes = Axes(x_range=[-4, 4, 2], y_range=[-2, 2, 1], x_length=10, y_length=5,
                    axis_config={{"include_numbers": True, "font_size": 24}})
        axes.shift(DOWN * 0.4)
        vector = Arrow(start=axes.c2p(0, 0), end=axes.c2p(2, 1), buff=0, color=YELLOW)
        label = MathTex(r"\vec{{v}} = (2, 1)", font_size=40).next_to(vector.get_end(), UR, buff=0.2)
        self.play(FadeIn(title), Create(axes))
        self.wait(0.5)
        self.play(GrowArrow(vector))
        self.wait(0.5)
        self.play(Write(label))
        self.wait(1)
"""


def plan_prompt(topic: str, audience: str) -> str:
    return f"""Plan a short animated lesson in the style of 3Blue1Brown that explains "{topic}" to {AUDIENCES[audience]}.

Create exactly {SCENES_PER_LESSON} scenes that build on each other:
1. Set up a concrete example the student can see, and show the first key idea on it (not only the starting picture).
2. Develop the method on that example, with real numbers worked out on screen.
3. Reach the result or general rule, with a short worked step on screen that shows why it is true.
Each scene is one visual idea that can be animated in 12-20 seconds, for example drawing two vectors from the
origin, then adding them tip to tail. Each scene shows a diagram with labels (names of the key quantities such as
"width = 1/2" or "height = x²", and axis numbers on graphs) and at least one equation or result written on screen.
Use axes only for graphs and coordinates, never for shapes like triangles or squares.
Keep each screen easy to read: {SCREEN_LIMITS}. When there are many values, write them in one equation beside the
diagram instead of a label on every shape; split longer working into short lines that appear one after another, and
fade out text that is no longer needed.

Give the whole lesson a title: a short name of at most 5 words in plain text, for example "Area under y = x²".

For each scene give:
- title: at most 5 words
- narration: read aloud to the student by a voice: 2 or 3 short sentences, 20-30 words in all, each ending with a
  full stop; say what appears and why it matters, in the order it appears; write all maths as spoken words
  ("y equals x squared", "one half"), never symbols or digits, and no abbreviations
- animation_description: 5 to 7 numbered steps in the order they are animated; for each step say what appears, its
  exact text (every label and equation), its colour (one of {COLORS}), and where it is placed (left, right of the
  diagram, below); work out every number shown and check it, so the animation never has to calculate
- mcq_question and mcq_choices: test understanding, not memory: the student applies the idea or predicts a result;
  exactly 4 choices, the wrong ones being common mistakes (for example a wrong formula or a skipped step), the
  correct one at a random position, its 0-based index in mcq_correct_index
- fr_question and fr_answer: a short question that asks the student to explain why or to work out a new case,
  and its model answer"""


def _timing(sentences: list[Sentence]) -> str:
    lines = "\n".join(
        f'{number}. starts at about {s.start:.1f} s, lasts about {s.end - s.start:.1f} s: "{" ".join(s.text.split())}"'
        for number, s in enumerate(sentences, 1)
    )
    return f"""A voice reads the narration over the video, one sentence at a time:
{lines}
Show what each sentence describes while it is spoken: put self.sentence(n) on its own line right before the animations
for sentence n, including self.sentence(1); it waits until the voice reaches that sentence. Fit each sentence's
animations into its time (a play takes 1 second unless you set run_time), use 5 to 7 self.play() calls in all, and
end with self.wait(1)."""


def manim_prompt(scene: ScenePlan, sentences: list[Sentence]) -> str:
    return (
        f"{MANIM_RULES}\n{_timing(sentences)}\n\n"
        f"Scene title: {scene.title}\nNarration: {scene.narration}\nOn screen: {scene.animation_description}"
    )


def fix_prompt(code: str, error: str, sentences: list[Sentence]) -> str:
    return (
        f"{MANIM_RULES}\n{_timing(sentences)}\n\n"
        f"This code failed to render:\n\n{code}\n\nError:\n{error}\n\nReturn the corrected full code."
    )


def tutor_prompt(topic: str, audience: str, scenes: list[dict], scene_position: int, time_seconds: float) -> str:
    lesson = "\n".join(f"Scene {i}, {scene['title']}: {scene['narration']}" for i, scene in enumerate(scenes, 1))
    minutes, seconds = divmod(int(time_seconds), 60)
    title = scenes[scene_position - 1]["title"]
    return f"""You are a friendly tutor helping {AUDIENCES[audience]} with a lesson on "{topic}".
The lesson has these scenes:
{lesson}

The student paused at {minutes}:{seconds:02d} in scene {scene_position}, "{title}". When they say "this" or "here", they mean that moment. Do not mention the time in your answer.

Answer in 2-4 short sentences of simple language and stay on this topic. Use an example or analogy when it helps.
Reply in the same language and script as the student's question: English gets English, Hinglish (Hindi in English letters) gets Hinglish, Hindi in Devanagari gets Devanagari.
Write plain text only: no markdown, bold, bullet points or headings."""
