#!/usr/bin/env python3
"""Renders the demo-question marking fixtures (with the coordinate ruler) and
fixtures/demo-targets.json: the wrong-symbol bounding box per error case."""
import json
import math
import random

from PIL import Image, ImageDraw, ImageFont

W, H = 900, 620
BG = "#fffdf7"
INK = "#1c2733"
RED = (229, 72, 77)
TARGETS = {}


def font(size):
    for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def page():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)


def ruler(d):
    sm = font(11)
    for x in range(100, W, 100):
        d.line([(x, 0), (x, 14)], fill=(90, 120, 200), width=1)
        d.text((x + 2, 1), str(x), fill=(60, 90, 170), font=sm)
    for y in range(100, H, 100):
        d.line([(0, y), (14, y)], fill=(90, 120, 200), width=1)
        d.text((2, y - 13), str(y), fill=(60, 90, 170), font=sm)


def save(img, d, name, target=None):
    ruler(d)
    img.save(f"fixtures/{name}.png")
    if target:
        TARGETS[name] = [int(v) for v in target]
    print(f"wrote fixtures/{name}.png" + (f"  target={TARGETS[name]}" if target else ""))



# Cases: (name, lines, target_line_index, target_substring) - target is the first wrong value.
# The substring is located by its LAST occurrence in the line.
CASES = [
    # The hero challenge: the integral of 6x sin(x²) dx from 0 to √π, result 6.
    ("ch-correct",     ["u = x², du = 2x dx", "= ∫ 3 sin u du, u from 0 to π", "= −3cos π + 3cos 0 = 6"], None, None),
    ("ch-factor",      ["u = x², du = 2x dx", "= ∫ 6 sin u du", "= 6 + 6 = 12"], 1, "6"),
    ("ch-limits",      ["u = x², du = 2x dx", "= [−3cos u] from 0 to √π"], 1, "√π"),
    ("ch-bare-wrong",  ["12"], 0, "12"),
    ("imp-correct",    ["2x + 2y dy/dx = 0", "dy/dx = −x/y", "= −3/4"], None, None),
    ("imp-chain",      ["2x + 2y = 0"], 0, "2y"),
    ("lim-correct",    ["= 1/(√(x + 1) + 2)", "= 1/(2 + 2)", "= 1/4"], None, None),
    ("lim-zero",       ["(√4 − 2)/(3 − 3) = 0"], 0, "0"),
    ("blank",          [], None, None),
    # Valid routes other than the mark scheme's first one: correct work, so no red ink.
    ("alt-lhopital",   ["1/(2√(x + 1)) ÷ 1", "= 1/(2 · 2) = 1/4"], None, None),
    ("alt-backsub",    ["−3cos(x²) from 0 to √π", "= −3cos π + 3cos 0", "= 3 + 3 = 6"], None, None),
]
QUESTION = {"ch": "q-challenge", "imp": "q-implicit", "lim": "q-limit", "blank": "q-challenge", "scribble": "q-challenge", "hand": "q-challenge"}
QUESTION_OF = {"alt-lhopital": "q-limit", "alt-backsub": "q-challenge"}

for name, lines, ti, sub in CASES:
    img, d = page()
    f = font(46)
    y = 150
    target = None
    for i, line in enumerate(lines):
        d.text((90, y), line, fill=INK, font=f)
        if i == ti:
            start = d.textlength(line[: line.rindex(sub)], font=f)
            width = d.textlength(sub, font=f)
            target = (90 + start, y, 90 + start + width, y + 50)
        y += 110
    save(img, d, name, target)

# Scribble: random lines, no target (same drawing as the POC's doodle-scribble).
img, d = page()
random.seed(3)
d.line([(300 + random.randint(-120, 120), 300 + random.randint(-90, 90)) for _ in range(26)], fill=INK, width=4, joint="curve")
save(img, d, "scribble")

# Hand-drawn cases: angular polyline glyphs (the stroke shapes demo-probe.mjs draws
# with the mouse: Z-like 2, three-stroke 5), rendered with round joins, width 5 and a
# little jitter, so the marking is tested against handwriting rather than a font.
# Glyphs are in a 110-unit-high box; (strokes, advance width).
GLYPHS = {
    "2": ([[(0, 0), (70, 0), (0, 110), (80, 110)]], 80),
    "x": ([[(0, 30), (60, 110)], [(60, 30), (0, 110)]], 60),
    "+": ([[(0, 70), (60, 70)], [(30, 40), (30, 100)]], 60),
    "5": ([[(50, 0), (0, 0), (0, 50), (45, 65), (0, 110)]], 50),
    "=": ([[(0, 55), (60, 55)], [(0, 85), (60, 85)]], 60),
    "-": ([[(0, 70), (50, 70)]], 50),
    "3": ([[(0, 0), (60, 0), (25, 50), (60, 70), (55, 100), (30, 110), (0, 100)]], 60),
    "6": ([[(55, 0), (10, 40), (0, 80), (15, 110), (50, 110), (60, 80), (45, 60), (10, 65)]], 60),
    "4": ([[(45, 110), (45, 0), (0, 75), (65, 75)]], 65),
    "1": ([[(10, 0), (10, 110)]], 20),
    "7": ([[(0, 0), (60, 0), (0, 110)]], 60),
    "(": ([[(30, 0), (5, 40), (5, 75), (30, 110)]], 30),
    ")": ([[(0, 0), (25, 40), (25, 75), (0, 110)]], 30),
    # A small raised 2, as a student writes x squared.
    "²": ([[(0, -30), (28, -30), (0, 10), (32, 10)]], 34),
    "u": ([[(0, 40), (0, 95), (15, 110), (40, 110), (55, 90)], [(55, 40), (55, 110)]], 55),
    "d": ([[(55, 60), (30, 40), (5, 55), (0, 85), (20, 110), (45, 105), (55, 85)], [(55, 0), (55, 110)]], 55),
}
# The owner's own style: 2s with a looped tail, an open-topped 4 with a long stem.
LOOPED = {
    "2": ([[(0, 25), (20, 0), (50, 0), (65, 25), (55, 55), (10, 105), (5, 92), (22, 88), (32, 106), (80, 108)]], 80),
    "4": ([[(5, 0), (0, 70), (65, 70)], [(48, 25), (48, 140)]], 65),
}
GAP, SPACE = 28, 18


def hand_line(d, text, x, y, scale, rng, glyphs=GLYPHS):
    """Draws one line of hand-drawn glyphs; returns each character's x-extent."""
    spans = []
    for ch in text:
        if ch == " ":
            spans.append((x, x))
            x += SPACE * scale
            continue
        strokes, adv = glyphs.get(ch) or GLYPHS[ch]
        for st in strokes:
            pts = [(x + px * scale + rng.uniform(-3, 3), y + py * scale + rng.uniform(-3, 3)) for px, py in st]
            d.line(pts, fill=INK, width=5, joint="curve")
            for px, py in (pts[0], pts[-1]):
                d.ellipse([px - 2.5, py - 2.5, px + 2.5, py + 2.5], fill=INK)
        spans.append((x, x + adv * scale))
        x += (adv + GAP) * scale
    return spans


HAND_CASES = [
    ("hand-wrongline",    ["3 + 3 = 7"], 1.0, 0, "7"),
    ("hand-factor",       ["6x dx = 6 du"], 0.8, 0, "6"),
    ("hand-correct-step", ["du = 2x dx"], 1.0, None, None),
    ("hand-bare-wrong",   ["12"], 1.0, 0, "12"),
    # Unfinished, off-question, and off-question-but-true lines.
    ("hand-unfinished",   ["du ="], 1.0, None, None),
    ("hand-offquestion",  ["2 + 2 = 17"], 1.0, 0, "17"),
    ("hand-offquestion-true", ["2 + 2 = 4"], 1.0, None, None),
]
for name, lines, scale, ti, sub in HAND_CASES:
    glyphs = LOOPED if name == "hand-offquestion-true" else GLYPHS
    img, d = page()
    rng = random.Random(name)
    y = 150
    target = None
    for i, line in enumerate(lines):
        spans = hand_line(d, line, 120, y, scale, rng, glyphs)
        if i == ti:
            k = line.rindex(sub)
            chars = [spans[j] for j in range(k, k + len(sub)) if line[j] != " "]
            target = (chars[0][0], y, chars[-1][1], y + 110 * scale)
        y += int(110 * scale) + 70
    save(img, d, name, target)

json.dump({"targets": TARGETS, "question": {n: QUESTION_OF.get(n) or QUESTION[n.split("-")[0]] for n in [c[0] for c in CASES] + [c[0] for c in HAND_CASES] + ["scribble"]}}, open("fixtures/demo-targets.json", "w"), indent=2)
print("wrote fixtures/demo-targets.json")
