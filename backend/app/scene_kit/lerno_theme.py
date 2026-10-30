# Runs only in the render sandbox; scenes import this instead of manim.

import json
from pathlib import Path

import manim
from manim import *  # noqa: F403

config.background_color = "#050609"

# The renderer writes when each narration sentence starts; a silent scene has no file.
TIMING_FILE = Path("timing.json")
MARKS_FILE = Path("marks.json")
SENTENCE_STARTS = json.loads(TIMING_FILE.read_text()) if TIMING_FILE.exists() else []

# One brightness for every colour, so nothing shouts and everything stays readable on the dark background.
INK = ManimColor("#f5f5f7")
MUTED = ManimColor("#a7aab8")
AXIS = ManimColor("#6b7088")
VIOLET = ManimColor("#a993ff")
SKY = ManimColor("#6cc4ff")
MINT = ManimColor("#5fd3a8")
AMBER = ManimColor("#f6c560")
CORAL = ManimColor("#ff7f7a")
APRICOT = ManimColor("#ff9d5c")
ROSE = ManimColor("#f39bdc")

# Manim's colour names now point at the palette, so generated code can keep writing BLUE, YELLOW and so on.
for family, colour in {
    "BLUE": SKY, "YELLOW": AMBER, "GREEN": MINT, "TEAL": MINT, "RED": CORAL, "MAROON": CORAL,
    "ORANGE": APRICOT, "GOLD": AMBER, "PURPLE": VIOLET, "PINK": ROSE, "GRAY": MUTED, "GREY": MUTED,
}.items():
    for name in [family, *(f"{family}_{shade}" for shade in "ABCDE")]:
        if name in globals():
            globals()[name] = colour
WHITE = INK

# Equations: Fira Math (a sans maths font made for screens) through XeLaTeX, with Geist for any words inside.
MATH_TEMPLATE = TexTemplate(
    tex_compiler="xelatex",
    output_format=".xdv",
    preamble=r"""
\usepackage{amsmath}
\usepackage{xcolor}
\usepackage{unicode-math}
\setmainfont{Geist}
\setmathfont{FiraMath-Regular.otf}
""",
)

Text.set_default(font="Geist", weight=MEDIUM, color=INK)
MarkupText.set_default(font="Geist", weight=MEDIUM, color=INK)
MathTex.set_default(tex_template=MATH_TEMPLATE, color=INK)
Tex.set_default(tex_template=MATH_TEMPLATE, color=INK)

VMobject.set_default(joint_type=LineJointType.ROUND, cap_style=CapStyleType.ROUND)
Arrow.set_default(stroke_width=4, tip_shape=StealthTip, max_tip_length_to_length_ratio=0.2)
SurroundingRectangle.set_default(corner_radius=0.12, buff=0.18)
# Graphs and points a touch heavier than stock, so they read clearly on small screens.
ParametricFunction.set_default(stroke_width=5)
Dot.set_default(radius=0.1)

AXIS_LOOK = {
    "stroke_width": 2.5,
    "include_tip": True,
    "tip_shape": StealthTip,
    "tip_width": 0.2,
    "tip_height": 0.2,
    "tick_size": 0.07,
}


class Axes(manim.Axes):
    # Axes are always quiet grey so the maths drawn on them stands out; generated code keeps every other choice.
    def __init__(self, *args, axis_config=None, **kwargs):
        super().__init__(*args, axis_config={**AXIS_LOOK, **(axis_config or {}), "color": AXIS}, **kwargs)


class NumberPlane(manim.NumberPlane):
    def __init__(self, *args, background_line_style=None, axis_config=None, **kwargs):
        lines = {"stroke_color": AXIS, "stroke_width": 1, "stroke_opacity": 0.35, **(background_line_style or {})}
        axes = {**AXIS_LOOK, "include_tip": False, **(axis_config or {}), "color": AXIS}
        super().__init__(*args, background_line_style=lines, axis_config=axes, **kwargs)


class Scene(manim.Scene):
    sentence_delay = 0.0

    # Cut-off text is the most common layout bug; failing here sends the exact problem to the fix step.
    def play(self, *args, **kwargs):
        super().play(*args, **kwargs)
        self._check_text_fits()

    def wait(self, *args, **kwargs):
        super().wait(*args, **kwargs)
        self._check_text_fits()

    def sentence(self, number):
        # Holds the picture until the voice reaches this sentence. A picture that runs late moves this sentence and
        # every later one by the same amount; the real time is kept, so the voice starts where the picture does.
        if 0 < number <= len(SENTENCE_STARTS):
            planned = SENTENCE_STARTS[number - 1]
            if planned + self.sentence_delay > self.renderer.time:
                self.wait(planned + self.sentence_delay - self.renderer.time)
            self.sentence_delay = self.renderer.time - planned
        marks = json.loads(MARKS_FILE.read_text()) if MARKS_FILE.exists() else {}
        MARKS_FILE.write_text(json.dumps({**marks, number: self.renderer.time}))

    def _check_text_fits(self):
        half_width, half_height = config.frame_width / 2, config.frame_height / 2
        for text in _texts(self.mobjects):
            left, bottom, _ = text.get_corner(DL)
            right, top, _ = text.get_corner(UR)
            if left < -half_width or right > half_width or bottom < -half_height or top > half_height:
                words = getattr(text, "original_text", None) or getattr(text, "tex_string", "")
                raise ValueError(
                    f"Text {words!r} goes off the screen. Keep all text inside x from -6 to 6 and y from -3.4 to 2.7: "
                    "shorten it, split it over two lines, or move it below the diagram."
                )


def _texts(mobjects):
    for mobject in mobjects:
        # Axis numbers on a full-screen plane sit at the edge by design.
        if isinstance(mobject, (manim.CoordinateSystem, manim.NumberLine)):
            continue
        if isinstance(mobject, (Text, MarkupText, MathTex)):
            yield mobject
        else:
            yield from _texts(mobject.submobjects)


def scene_label(text: str) -> VGroup:
    title = Text(text, font_size=30, weight=SEMIBOLD, color=INK)
    bar = RoundedRectangle(width=0.07, height=title.height + 0.12, corner_radius=0.035, stroke_width=0)
    bar.set_fill(VIOLET, 1).next_to(title, LEFT, buff=0.18)
    return VGroup(bar, title).to_corner(UL, buff=0.5)
