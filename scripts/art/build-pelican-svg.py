"""Build public/art/pelican-bike.svg — an animated pelican riding a bicycle.

Declarative SVG only (SMIL animation, no script, no external assets). Every animation
operates on a group whose contents are expressed in local coordinates, so rotation
happens about the local origin and the art renders identically in <img>, CSS
backgrounds and every browser.

    python3 scripts/art/build-pelican-svg.py            # animated deliverable
    python3 scripts/art/build-pelican-svg.py --pose 8   # frozen frame (static QA render)
"""
import math
import pathlib
import re
import sys

# ───────────── two-bone IK pre-computed from the bicycle geometry ─────────────
# Keeps the webbed feet glued to the pedals while the cranks turn.
NEAR_THIGH = [29.6, 34.8, 40.1, 45.2, 49.7, 53.3, 55.6, 56.6, 56.5, 55.4, 53.5, 50.9, 47.7, 43.8, 39.3, 34.4, 29.4, 24.7, 21.0, 18.6, 17.8, 18.8, 21.3, 25.0, 29.6]
NEAR_CALF = [74.0, 66.8, 60.1, 54.4, 50.4, 48.6, 49.3, 52.3, 57.3, 63.5, 70.6, 78.0, 85.3, 92.1, 98.1, 103.0, 106.2, 107.7, 107.2, 104.7, 100.6, 95.1, 88.6, 81.4, 74.0]
FAR_THIGH = [46.8, 42.6, 37.9, 33.1, 28.2, 23.9, 20.6, 18.8, 18.6, 20.0, 22.9, 27.1, 32.1, 37.6, 43.4, 48.9, 53.7, 57.1, 58.9, 59.1, 58.1, 56.2, 53.6, 50.5, 46.8]
FAR_CALF = [80.2, 87.3, 93.3, 98.1, 101.1, 102.2, 101.3, 98.4, 93.8, 87.8, 80.8, 73.1, 65.0, 56.9, 49.3, 42.8, 38.2, 36.4, 37.9, 42.3, 48.7, 56.2, 64.3, 72.4, 80.2]
NEAR_FOOT = [round(-(a + b), 1) for a, b in zip(NEAR_THIGH, NEAR_CALF)]
FAR_FOOT = [round(-(a + b), 1) for a, b in zip(FAR_THIGH, FAR_CALF)]

PEDAL_T = 1.1   # crank revolution, seconds
WHEEL_T = 0.78  # wheel revolution, seconds

# 用法：
#   python3 scripts/art/build-pelican-svg.py                 # 重新生成动态版
#   python3 scripts/art/build-pelican-svg.py --pose 7        # 冻结第 7 帧（24 帧一圈），仅用于校对
#   python3 scripts/art/build-pelican-svg.py --pose 7 --out /tmp/p7.svg   # 冻结帧写到别处，不覆盖作品
POSE = None
OUT = None
for _i, _arg in enumerate(sys.argv):
    if _arg == "--pose":
        POSE = int(sys.argv[_i + 1]) % 24
    elif _arg == "--out":
        OUT = sys.argv[_i + 1]


# ───────────────────────────── animation helpers ─────────────────────────────
# Each *_open() returns an opening <g ...> tag, optionally with an <animateTransform>
# child; always close that group with a matching </g>.
def rot_vals(values, dur, begin=0):
    vals = ";".join(f"{v:.2f}" for v in values)
    begin_attr = f' begin="{begin}s"' if begin else ""
    return (f'<animateTransform attributeName="transform" type="rotate" dur="{dur}s" '
            f'repeatCount="indefinite"{begin_attr} values="{vals}"/>')


def trans_vals(values, dur, begin=0):
    vals = ";".join(f"{x} {y}" for x, y in values)
    begin_attr = f' begin="{begin}s"' if begin else ""
    return (f'<animateTransform attributeName="transform" type="translate" dur="{dur}s" '
            f'repeatCount="indefinite"{begin_attr} values="{vals}"/>')


def rot_group(values, dur, begin=0):
    first = f"{values[0]:.2f}"
    if POSE is not None:
        return f'<g transform="rotate({first})">'
    return f'<g transform="rotate({first})">' + rot_vals(values, dur, begin)


def trans_group(values, dur, begin=0):
    x, y = values[0]
    if POSE is not None:
        return f'<g transform="translate({x},{y})">'
    return f'<g transform="translate({x},{y})">' + trans_vals(values, dur, begin)


def opacity_anim(values, dur, begin=0):
    vals = ";".join(f"{v}" for v in values)
    begin_attr = f' begin="{begin}s"' if begin else ""
    return (f'<animate attributeName="opacity" dur="{dur}s" '
            f'repeatCount="indefinite"{begin_attr} values="{vals}"/>')


# ───────────────────────────── geometry helpers ─────────────────────────────
def cubic(pts, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pts
    u = 1 - t
    return (u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
            u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3)


def ribbon(pts, width_fn, samples=16):
    """Filled tapering ribbon around a cubic spine (leaves, scarf tails)."""
    left, right = [], []
    for i in range(samples + 1):
        t = i / samples
        x, y = cubic(pts, t)
        x2, y2 = cubic(pts, min(1, t + 0.01))
        x0, y0 = cubic(pts, max(0, t - 0.01))
        dx, dy = x2 - x0, y2 - y0
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n, dx / n
        w = width_fn(t) / 2
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    d = f"M{left[0][0]:.1f} {left[0][1]:.1f} " + " ".join(f"L{px:.1f} {py:.1f}" for px, py in left[1:]) + " "
    d += " ".join(f"L{px:.1f} {py:.1f}" for px, py in reversed(right))
    return d + " Z"


# ───────────────────────────── bicycle ─────────────────────────────
def wheel(cx, cy, phase=0.0):
    spokes = []
    for i in range(16):
        a = math.radians(i * 22.5)
        spokes.append(f'<line x2="{57 * math.cos(a):.1f}" y2="{57 * math.sin(a):.1f}" '
                      f'stroke="#A9A395" stroke-width="1.5"/>')
    spokes.append('<line x2="57" stroke="#FF8A5B" stroke-width="3.6" stroke-linecap="round"/>')
    spokes.append('<circle cx="57" r="3" fill="#FF8A5B"/>')
    spokes.append('<path d="M-47 -32 A 57 57 0 0 1 -15 -54" fill="none" stroke="#FFFFFF" stroke-width="2.4" opacity=".5"/>')
    spokes.append('<path d="M47 32 A 57 57 0 0 1 15 55" fill="none" stroke="#FFFFFF" stroke-width="2" opacity=".22"/>')
    spin = ('<g transform="rotate(0)">' + rot_vals([0, 360], WHEEL_T, -phase * WHEEL_T)) if POSE is None else '<g>'
    return f'''<g transform="translate({cx},{cy})">
      <circle r="64" fill="none" stroke="#1E222B" stroke-width="10"/>
      <circle r="58.6" fill="none" stroke="#E6DECD" stroke-width="2" opacity=".9"/>
      <circle r="55.6" fill="none" stroke="#F7F1E3" stroke-width="4.6"/>
      {spin}{''.join(spokes)}</g>
      <circle r="7" fill="#DCD4C3" stroke="#1E222B" stroke-width="2.4"/>
      <circle r="2.2" fill="#1E222B"/>
    </g>'''


def crank_arm(near=True):
    arm = "#8C96A4" if near else "#5E6672"
    pin = "#C3CBD6" if near else "#7C8490"
    return f'''<rect x="2" y="-4.4" width="27" height="8.8" rx="4.4" fill="{arm}"/>
        <circle cx="27" cy="0" r="2.6" fill="{pin}"/>
        <g transform="translate(27,0)">
          <rect x="-11" y="2.6" width="22" height="5.4" rx="2.7" fill="#232833"/>
          <rect x="-11" y="2.2" width="22" height="2" rx="1" fill="#A8B1BE"/>
        </g>'''


# ───────────────────────────── environment ─────────────────────────────
def sand_specks(offset):
    xs = [18, 96, 158, 232, 300, 372, 455, 528, 604, 676, 742, 818, 890, 962, 1030, 1104, 1168]
    ys = [486, 500, 494, 512, 522, 490, 516, 528, 498, 508, 534, 492, 520, 506, 530, 496, 514]
    ss = [3.2, 2.4, 4.0, 2.8, 3.6, 2.2, 3.0, 4.4, 2.6, 3.4, 2.2, 3.8, 2.8, 4.2, 2.4, 3.2, 2.6]
    out = []
    for x, y, s in zip(xs, ys, ss):
        out.append(f'<ellipse cx="{x + offset}" cy="{y}" rx="{s * 1.7:.1f}" ry="{s * .7:.1f}" fill="#C99665" opacity=".45"/>')
        out.append(f'<ellipse cx="{x + offset + 7}" cy="{y - 2.6}" rx="{s * .9:.1f}" ry="{s * .45:.1f}" fill="#FFE6BF" opacity=".55"/>')
    return "".join(out)


def sea_glints():
    out = []
    for row, (y, w) in enumerate([(330, 92), (346, 70), (360, 54), (376, 44)]):
        for i, dx in enumerate((-1, 0, 1)):
            geom = (f'x="{905 - w / 2 + dx * 26}" y="{y}" width="{w - abs(dx) * 14}" '
                    f'height="3" rx="1.5" fill="#FFE0A8"')
            if POSE is not None:
                out.append(f'<rect {geom} opacity=".4"/>')
            else:
                begin = -(row * 0.6 + i * 0.5)
                out.append(f'<rect {geom} opacity=".15">' + opacity_anim([".15", ".7", ".15"], 3.4, begin) + '</rect>')
    return "".join(out)


def waves():
    out = []
    for (y, step, color, op, dur, begin) in [(310, 54, "#4A7289", .38, 16, 0),
                                             (338, 76, "#3B6076", .42, 11, -4),
                                             (378, 118, "#2F5168", .5, 7.5, -2)]:
        seg = []
        for tile in (0, 1200):
            for x in range(-40, 1240, step):
                w = 16 + (x * 7) % 24
                seg.append(f'<rect x="{x + tile}" y="{y + ((x * 13) % 7) - 3}" width="{w}" '
                           f'height="2.8" rx="1.4" fill="{color}" opacity="{op}"/>')
        out.append(trans_group([(0, 0), (-1200, 0)], dur, begin) + "".join(seg) + '</g>')
    return "".join(out)


def gulls():
    out = []
    for x, y, s, d in [(228, 132, 1.0, 0.0), (302, 166, .76, -1.4), (170, 98, .58, -2.6)]:
        flap = trans_group([(0, 0), (-15, -10), (0, 0), (14, 7), (0, 0)], 4.2, d)
        out.append(f'''<g transform="translate({x},{y}) scale({s})">
      {flap}
        <path d="M-16 0 Q-8 -7 0 0 Q8 -7 16 0" fill="none" stroke="#3A2A50" stroke-width="2.8" stroke-linecap="round" opacity=".6"/>
      </g>
    </g>''')
    return "".join(out)


def palm(x, y, s, flip=1, begin=0):
    """Coconut palm silhouette: curved trunk with ring marks + filled feathered fronds."""
    dark = "#241B39"
    fronds = []
    for ang, ln, droop, wmax in [(-182, 52, 8, 13), (-152, 64, 4, 15), (-118, 70, 0, 16),
                                 (-84, 66, 2, 15), (-50, 56, 6, 13), (-16, 40, 12, 10)]:
        a = math.radians(ang)
        ex, ey = ln * math.cos(a), ln * math.sin(a) + droop
        pts = [(0, 0), (ex * .32, ey * .32 - 20), (ex * .74, ey * .74 - 8), (ex, ey)]
        shape = ribbon(pts, lambda t: wmax * math.sin(math.pi * (0.12 + 0.88 * t) ** 0.75), 14)
        fronds.append(f'<path d="{shape}" fill="{dark}"/>')
        fronds.append(f'<path d="M0 0 C{pts[1][0]:.0f} {pts[1][1]:.0f} {pts[2][0]:.0f} {pts[2][1]:.0f} {ex:.0f} {ey:.0f}" '
                      f'fill="none" stroke="#3A2C56" stroke-width="1.4" opacity=".5"/>')
    return f'''<g transform="translate({x},{y}) scale({flip * s},{s})">
    {rot_group([-1.3, 1.5, -1.3], 6.4, begin)}
      <path d="M2 3 C-8 -44 -4 -86 3 -126 C6 -146 1 -164 -2 -182" fill="none" stroke="{dark}" stroke-width="9" stroke-linecap="round"/>
      <g stroke="#3D2F58" stroke-width="1.5" opacity=".8" fill="none">
        <path d="M-5 -22 L7 -19"/><path d="M-7 -46 L8 -43"/><path d="M-6 -70 L10 -67"/>
        <path d="M-3 -94 L12 -91"/><path d="M1 -118 L15 -115"/><path d="M2 -144 L13 -141"/>
      </g>
      <g transform="translate(-2,-180)">
        {''.join(fronds)}
        <circle cx="-5" cy="1" r="4.6" fill="{dark}"/>
        <circle cx="5" cy="-1" r="4.2" fill="{dark}"/>
        <circle cx="0" cy="6" r="3.8" fill="{dark}"/>
      </g>
    </g>
  </g>'''


# ───────────────────────────── rider: legs ─────────────────────────────
def leg(near=True):
    i = POSE or 0
    thigh_w = 30 if near else 25
    calf_w = 16 if near else 13
    skin = "#F0E4D0" if near else "#CBBB9F"
    skin2 = "#FBF3E4" if near else "#D8CBB2"
    foot = "#F2A05C" if near else "#C67A3C"
    webbing = "#FFC080" if near else "#D89055"
    th = NEAR_THIGH if near else FAR_THIGH
    ca = NEAR_CALF if near else FAR_CALF
    ft = NEAR_FOOT if near else FAR_FOOT
    return f'''<g>
      <g transform="translate({450 if near else 442},{338 if near else 333})">
        {rot_group(th, PEDAL_T)}
          <path d="M0 0 L86 0" stroke="{skin}" stroke-width="{thigh_w}" stroke-linecap="round"/>
          <path d="M6 -8 L78 -8" stroke="{skin2}" stroke-width="{thigh_w * .42:.1f}" stroke-linecap="round" opacity=".75"/>
          <g transform="translate(86,0)">
            {rot_group(ca, PEDAL_T)}
              <path d="M0 0 L88 0" stroke="{skin}" stroke-width="{calf_w}" stroke-linecap="round"/>
              <path d="M8 -4 L80 -4" stroke="{skin2}" stroke-width="{calf_w * .36:.1f}" stroke-linecap="round" opacity=".6"/>
              <g transform="translate(88,0)">
                {rot_group(ft, PEDAL_T)}
                  <path d="M-4 -4 L10 -4 L10 4 L-4 4 Z" fill="{foot}" opacity=".92"/>
                  <path d="M-2 2 C10 1 22 3 30 7 C28 12 12 12 -2 9 Z" fill="{foot}"/>
                  <path d="M2 6 C12 7 21 8 28 9" fill="none" stroke="{webbing}" stroke-width="2" opacity=".85" stroke-linecap="round"/>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>'''


# ───────────────────────────── rider: pelican ─────────────────────────────
def pelican():
    edge = "#E2D4BB"
    collar = ribbon([(0, 0), (0.5, 1), (1, 2), (1.5, 3)], lambda t: 1)  # placeholder never used
    body = f'''<g>
    {trans_group([(0, 0), (0, -3.2), (0, 0), (0, 1.2), (0, 0)], 0.55)}
      <!-- 尾羽 -->
      <g fill="#EDE2CD" stroke="{edge}" stroke-width="1.6" stroke-linejoin="round">
        <path d="M388 278 C368 262 344 256 326 260 C346 270 368 280 390 288 Z"/>
        <path d="M386 292 C358 278 332 276 312 284 C334 294 360 300 386 302 Z"/>
        <path d="M382 306 C354 300 330 306 312 318 C336 324 362 320 384 314 Z"/>
      </g>

      <!-- 身体 -->
      <path d="M372 300 C360 260 384 230 422 220 C462 209 500 226 512 258 C524 288 512 318 484 334 C452 352 400 346 380 324 C372 316 369 308 372 300 Z"
            fill="url(#birdBody)" stroke="{edge}" stroke-width="2" stroke-linejoin="round"/>
      <g stroke="#E7DAC2" stroke-width="2" fill="none" opacity=".7" stroke-linecap="round">
        <path d="M392 322 C416 334 448 336 476 326"/>
        <path d="M404 306 C426 316 454 318 480 310"/>
      </g>

      <!-- 收起的远侧翅膀 -->
      <path d="M500 250 C464 234 420 242 398 264 C418 270 450 278 488 274 Z" fill="#E4D7C1" stroke="{edge}" stroke-width="1.6" opacity=".9"/>

      <!-- 围巾的巾尾（在脖子之后）-->
      <g>
        <g transform="translate(486,258)">
          {rot_group([-5, 4, -5], 1.64, -0.2)}
            <path d="{ribbon([(0, -4), (-40, -20), (-86, -30), (-120, -34)], lambda t: 15 - 8 * t, 20)}" fill="#DE4C3C"/>
            <path d="{ribbon([(0, -2), (-40, -18), (-86, -28), (-118, -32)], lambda t: 4.2 - 1.8 * t, 20)}" fill="#F4735F" opacity=".55"/>
            <path d="{ribbon([(0, 6), (-36, 2), (-78, 4), (-112, 16)], lambda t: 12 - 6 * t, 18)}" fill="#C03A2A"/>
            <g transform="translate(-128,-16)">
              {rot_group([-9, 8, -9], 1.32, -0.5)}
                <path d="{ribbon([(0, 0), (-14, 6), (-30, 8), (-44, 18)], lambda t: 9 - 3.4 * t, 12)}" fill="#B2372A"/>
              </g>
            </g>
          </g>
        </g>
      </g>

      <!-- 脖子 + 头 -->
      <g transform="translate(492,262)">
        {rot_group([-1.1, 1.5, -1.1], 2.4, -0.4)}
        <g transform="translate(-492,-262)">
          <path d="M484 272 C476 236 492 206 522 194" fill="none" stroke="{edge}" stroke-width="38" stroke-linecap="round"/>
          <path d="M484 272 C476 236 492 206 522 194" fill="none" stroke="#FDF9F0" stroke-width="33" stroke-linecap="round"/>
          <path d="M492 268 C488 240 500 214 520 200" fill="none" stroke="#FFFCF6" stroke-width="9" opacity=".7" stroke-linecap="round"/>

          <ellipse cx="552" cy="206" rx="34" ry="29" transform="rotate(-12 552 206)" fill="#FEFBF4" stroke="{edge}" stroke-width="2"/>

          <g stroke="{edge}" stroke-width="1.4" stroke-linejoin="round">
            <path d="M522 182 C510 170 500 164 490 162 C496 172 504 182 512 190 Z" fill="#F8F1E3"/>
            <path d="M530 177 C520 161 508 150 495 145 C503 158 511 172 518 184 Z" fill="#F2E8D6"/>
            <path d="M538 176 C534 162 528 150 518 141 C520 155 524 168 529 179 Z" fill="#EBDFC9"/>
          </g>

          <!-- 上喙 -->
          <path d="M568 190 C612 184 668 190 710 202 C716 204 716 211 708 212 C662 216 604 213 572 208 Z"
                fill="url(#beak)" stroke="#D9853F" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M576 194 C616 190 664 196 702 205" fill="none" stroke="#FFDCAA" stroke-width="2.2" opacity=".9" stroke-linecap="round"/>
          <path d="M694 197 C702 199 708 202 712 205 C704 204 696 202 690 200 Z" fill="#C86A2A" opacity=".85"/>
          <ellipse cx="598" cy="198" rx="3.4" ry="1.5" fill="#B25F25" opacity=".45"/>

          <!-- 喉囊 -->
          <path d="M574 206 C590 214 618 228 648 238 C672 246 682 256 668 262 C642 272 596 258 574 240 C566 232 566 212 574 206 Z"
                fill="url(#pouch)" stroke="#C9803A" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M584 216 C600 227 622 238 646 245" fill="none" stroke="#F9C98F" stroke-width="2.2" opacity=".7" stroke-linecap="round"/>
          <path d="M590 230 C606 242 626 250 646 255" fill="none" stroke="#BC5F1C" stroke-width="2" opacity=".28" stroke-linecap="round"/>

          <!-- 眼睛 -->
          <ellipse cx="562" cy="192" rx="7.6" ry="7.2" fill="#2B241F"/>
          <circle cx="564.4" cy="189.4" r="2.5" fill="#FFFFFF"/>
          <circle cx="559.2" cy="195" r="1.3" fill="#FFFFFF" opacity=".72"/>
          <path d="M550 179 C557 174 568 174 574 180" fill="none" stroke="#D6C7AC" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M570 200 C575 203 577 207 576 211" fill="none" stroke="#DBCCB2" stroke-width="1.8" opacity=".75" stroke-linecap="round"/>

        </g>
        </g>
      </g>

      <!-- 近侧翅膀：肩 → 腕 → 翅尖握住车把 -->
      <g transform="translate(472,286)">
        {rot_group([0, -1.6, 0], 1.1)}
        <g transform="translate(-472,-286)">
          <path d="M468 286 C470 264 490 252 512 258 C536 264 554 286 570 306 C582 322 591 336 592 344
                   C586 351 574 352 566 345 C558 338 552 330 544 322 C530 310 512 304 494 306
                   C478 308 468 302 468 286 Z" fill="url(#wingNear)" stroke="#D9CBB0" stroke-width="2" stroke-linejoin="round"/>
          <path d="M480 276 C502 282 528 296 548 318" fill="none" stroke="#DCCEB4" stroke-width="2.2" opacity=".8" stroke-linecap="round"/>
          <path d="M508 266 C532 276 552 294 566 314" fill="none" stroke="#DCCEB4" stroke-width="2" opacity=".55" stroke-linecap="round"/>
          <path d="M488 298 C508 304 526 316 540 330" fill="none" stroke="#DCCEB4" stroke-width="2" opacity=".55" stroke-linecap="round"/>
          <path d="M576 330 C586 324 596 328 602 338 C598 348 584 352 574 345 Z" fill="#F5EBDA" stroke="#D9CBB0" stroke-width="1.6"/>
          <path d="M582 341 C588 343 592 346 594 350 C586 352 580 348 579 345 Z" fill="#EADFCB"/>
        </g>
        </g>
      </g>

      <!-- 围巾绕颈的颈圈（横向围在脖子根部）-->
      <g>
        <path d="M472 257 C480 264 490 270 500 272" fill="none" stroke="#B23628" stroke-width="18" stroke-linecap="round"/>
        <path d="M472 257 C480 264 490 270 500 272" fill="none" stroke="#EC5A48" stroke-width="13" stroke-linecap="round"/>
        <path d="M474 257 C482 264 490 269 498 271" fill="none" stroke="#FF9D88" stroke-width="3.4" opacity=".6" stroke-linecap="round"/>
        <g stroke="#B23628" stroke-width="1.6" opacity=".45">
          <path d="M481 259 l2 11"/><path d="M489 265 l3 9"/><path d="M496 270 l2 6"/>
        </g>
        <!-- 打结处 -->
        <ellipse cx="503" cy="273" rx="7.5" ry="6" transform="rotate(28 503 273)" fill="#D8483A" stroke="#A82F22" stroke-width="1.2"/>
        <path d="M500 270 C502 272 503 274 502 277" fill="none" stroke="#FF7F69" stroke-width="1.8" opacity=".8"/>
      </g>
    </g>
    </g>'''
    return body


def dust_puff(r, fill, begin):
    if POSE is not None:
        return f'<circle r="{r}" fill="{fill}" opacity="0"/>'
    return (f'<g><circle r="{r}" fill="{fill}" opacity="0">'
            + opacity_anim(["0", ".45", "0"], 1.1, begin)
            + f'<animateTransform attributeName="transform" type="translate" dur="1.1s" repeatCount="indefinite" begin="{begin}s" values="0 0;-70 -20"/>'
            + f'<animateTransform attributeName="transform" type="scale" dur="1.1s" repeatCount="indefinite" begin="{begin}s" values=".5;1.8" additive="sum"/>'
            + '</circle></g>')


# ───────────────────────────── scene ─────────────────────────────
SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 540" width="1200" height="540"
     role="img" aria-labelledby="pelicanTitle pelicanDesc">
  <title id="pelicanTitle">骑自行车的鹈鹕</title>
  <desc id="pelicanDesc">黄昏海边的动画：一只系着红围巾的鹈鹕骑着青绿色自行车沿海岸前行。车轮与曲柄持续转动，双腿跟着踏板踩踏，围巾向后飘动；海面波光粼粼，棕榈树随风轻摆，海鸥掠过晚霞。</desc>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2A2350"/><stop offset=".32" stop-color="#6B3A69"/>
      <stop offset=".58" stop-color="#C25A66"/><stop offset=".78" stop-color="#F09055"/>
      <stop offset="1" stop-color="#FFC97E"/>
    </linearGradient>
    <radialGradient id="sunGlow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#FFE7B0" stop-opacity=".8"/>
      <stop offset=".42" stop-color="#FFC46E" stop-opacity=".32"/>
      <stop offset="1" stop-color="#FF9A5C" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5C5A83"/><stop offset=".22" stop-color="#2E5470"/>
      <stop offset="1" stop-color="#17313F"/>
    </linearGradient>
    <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#EEC690"/><stop offset=".4" stop-color="#E9BD86"/>
      <stop offset="1" stop-color="#D8A26C"/>
    </linearGradient>
    <linearGradient id="birdBody" x1=".1" y1="0" x2=".5" y2="1">
      <stop offset="0" stop-color="#FFFDF9"/><stop offset=".55" stop-color="#FBF4E6"/>
      <stop offset="1" stop-color="#E4D8C2"/>
    </linearGradient>
    <linearGradient id="wingNear" x1=".1" y1="0" x2=".45" y2="1">
      <stop offset="0" stop-color="#FFFDFA"/><stop offset=".55" stop-color="#F5ECDA"/>
      <stop offset="1" stop-color="#DDCFB6"/>
    </linearGradient>
    <linearGradient id="beak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFC877"/><stop offset="1" stop-color="#E4873C"/>
    </linearGradient>
    <linearGradient id="pouch" x1="0" y1="0" x2=".18" y2="1">
      <stop offset="0" stop-color="#F8B76A"/><stop offset="1" stop-color="#D4712B"/>
    </linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#43ABA2"/><stop offset="1" stop-color="#1E6B72"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
  </defs>

  <!-- ════ 天空 · 落日 ════ -->
  <rect width="1200" height="540" fill="url(#sky)"/>
  <g transform="translate(905,238)">
    <circle r="212" fill="url(#sunGlow)"/>
    <circle r="76" fill="#FFE3AA" opacity=".5" filter="url(#soft)"/>
    <circle r="58" fill="#FFEDC4"/>
    <circle r="45" fill="#FFF7E2" opacity=".92"/>
  </g>

  <!-- 云带 -->
  <g opacity=".55">
    {trans_group([(0, 0), (-1200, 0)], 120)}
      <ellipse cx="160" cy="94" rx="150" ry="8" fill="#4B2F63"/>
      <ellipse cx="240" cy="116" rx="92" ry="5" fill="#5A3768"/>
      <ellipse cx="760" cy="70" rx="200" ry="7" fill="#432B5E"/>
      <ellipse cx="1010" cy="128" rx="150" ry="6" fill="#6B3F70"/>
      <ellipse cx="1360" cy="94" rx="150" ry="8" fill="#4B2F63"/>
      <ellipse cx="1440" cy="116" rx="92" ry="5" fill="#5A3768"/>
      <ellipse cx="1960" cy="70" rx="200" ry="7" fill="#432B5E"/>
      <ellipse cx="2210" cy="128" rx="150" ry="6" fill="#6B3F70"/>
    </g>
  </g>
  <g opacity=".3">
    {trans_group([(0, 0), (-1200, 0)], 170)}
      <ellipse cx="420" cy="184" rx="210" ry="4.5" fill="#FFC58A"/>
      <ellipse cx="640" cy="202" rx="130" ry="3.5" fill="#FFD6A2"/>
      <ellipse cx="1620" cy="184" rx="210" ry="4.5" fill="#FFC58A"/>
      <ellipse cx="1840" cy="202" rx="130" ry="3.5" fill="#FFD6A2"/>
    </g>
  </g>

  {gulls()}

  <!-- 远山 -->
  <path d="M0 302 L0 266 L86 252 L188 274 L262 256 L352 282 L430 264 L520 286 L610 262 L706 284 L790 266 L880 282 L980 260 L1078 280 L1160 264 L1200 272 L1200 302 Z" fill="#3A2A57" opacity=".6"/>
  <path d="M0 302 L0 284 L120 266 L244 286 L336 272 L448 290 L560 274 L680 290 L812 276 L930 290 L1052 274 L1160 288 L1200 280 L1200 302 Z" fill="#2C2145" opacity=".72"/>

  <!-- ════ 海面 ════ -->
  <rect y="300" width="1200" height="172" fill="url(#sea)"/>
  <rect y="300" width="1200" height="5" fill="#FFB877" opacity=".4"/>
  <ellipse cx="905" cy="308" rx="200" ry="9" fill="#FFD79B" opacity=".32" filter="url(#soft)"/>
  {sea_glints()}
  {waves()}
  <g transform="translate(742,384) scale(.92)">
    <path d="M0 0 L27 0 L23 7 L4 7 Z" fill="#281F3D"/>
    <path d="M13 0 L13 -31 L31 -4 Z" fill="#281F3D"/>
    <path d="M11 -2 L11 -25 L-4 -2 Z" fill="#281F3D" opacity=".75"/>
  </g>
  <rect y="462" width="1200" height="9" fill="#79C7C3" opacity=".45"/>

  <!-- ════ 沙滩 ════ -->
  <rect y="470" width="1200" height="70" fill="url(#sand)"/>
  <rect y="466" width="1200" height="11" fill="#BC8659" opacity=".5"/>
  <rect y="462" width="1200" height="3.6" fill="#FFF3D6" opacity=".8"/>
  {trans_group([(0, 0), (-1200, 0)], 11)}
    <rect y="470" width="2400" height="2.6" fill="#FFF8EA" opacity=".5"/>
  </g>
  {trans_group([(0, 0), (-1200, 0)], 4.6)}
    <g>{sand_specks(0)}</g>
    <g transform="translate(1200,0)">{sand_specks(0)}</g>
  </g>

  {palm(92, 486, .95, 1, 0)}
  {palm(190, 500, .58, 1, -1.1)}
  {palm(1122, 492, .84, -1, -.5)}

  <!-- 速度线 -->
  <g>
    <rect x="1090" y="246" width="120" height="2.8" rx="1.4" fill="#FFF3DA">
      <animate attributeName="opacity" dur="1.5s" repeatCount="indefinite" values="0;.5;0" keyTimes="0;.25;1"/>
      <animateTransform attributeName="transform" type="translate" dur="1.5s" repeatCount="indefinite" values="26 0;-280 0"/>
    </rect>
    <rect x="1090" y="286" width="84" height="2.2" rx="1.1" fill="#FFF3DA">
      <animate attributeName="opacity" dur="1.5s" begin="-.5s" repeatCount="indefinite" values="0;.45;0" keyTimes="0;.25;1"/>
      <animateTransform attributeName="transform" type="translate" dur="1.5s" begin="-.5s" repeatCount="indefinite" values="26 0;-280 0"/>
    </rect>
    <rect x="1090" y="332" width="140" height="2.8" rx="1.4" fill="#FFF3DA">
      <animate attributeName="opacity" dur="1.5s" begin="-1s" repeatCount="indefinite" values="0;.5;0" keyTimes="0;.25;1"/>
      <animateTransform attributeName="transform" type="translate" dur="1.5s" begin="-1s" repeatCount="indefinite" values="26 0;-280 0"/>
    </rect>
  </g>

  <!-- ════ 自行车 + 鹈鹕 ════ -->
  <g transform="translate(0,-22)">
    <ellipse cx="500" cy="532" rx="186" ry="12" fill="#8A5A38" opacity=".32" filter="url(#soft)"/>

    {wheel(400, 462, 0)}
    {wheel(600, 462, .35)}

    {leg(near=False)}

    <path d="M400 452 L476 456 M400 472 L476 496" fill="none" stroke="#5B6470" stroke-width="3"
          stroke-dasharray="7 5" stroke-linecap="round">
      <animate attributeName="stroke-dashoffset" dur="{PEDAL_T}s" repeatCount="indefinite" values="0;-46"/>
    </path>
    <circle cx="400" cy="462" r="8.5" fill="none" stroke="#6C7480" stroke-width="3.2"/>
    <circle cx="400" cy="462" r="2.6" fill="#3C434E"/>

    <!-- 车架 -->
    <g stroke="url(#frame)" stroke-width="10" stroke-linecap="round" fill="none">
      <path d="M476 466 L446 366"/>
      <path d="M451 374 L556 368"/>
      <path d="M476 466 L556 392"/>
      <path d="M556 364 L562 398"/>
      <path d="M562 398 L600 462"/>
      <path d="M476 466 L400 462"/>
      <path d="M446 366 L400 462"/>
    </g>
    <g stroke="#8FE0D3" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".5">
      <path d="M452 371 L554 365"/>
      <path d="M479 462 L553 389"/>
      <path d="M559 401 L596 459"/>
      <path d="M449 363 L404 457"/>
    </g>
    <path d="M556 366 L570 350" stroke="#3E454F" stroke-width="7.4" stroke-linecap="round"/>
    <path d="M570 350 C576 334 598 332 606 346 C610 353 604 360 596 362" fill="none" stroke="#2E3440" stroke-width="6.6" stroke-linecap="round"/>
    <path d="M574 348 C580 338 594 337 600 346" fill="none" stroke="#8E97A4" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M408 360 C424 349 454 347 470 353 C477 356 474 364 466 366 C444 370 414 368 406 364 Z" fill="#2B2F3A"/>
    <path d="M416 359 C432 353 452 353 464 357" fill="none" stroke="#FF8A5B" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>

    <!-- 牙盘 -->
    <g transform="translate(476,466)">
      <circle r="21" fill="none" stroke="#8E97A4" stroke-width="3" stroke-dasharray="3.4 3"/>
      <circle r="15.5" fill="none" stroke="#5B6470" stroke-width="3.2"/>
      <path d="M-15 0 L15 0 M0 -15 L0 15" stroke="#6C7480" stroke-width="3.4" stroke-linecap="round"/>
      <circle r="4.6" fill="#2E3440"/>
    </g>

    <!-- 远侧曲柄（与近侧相差 180°） -->
    <g transform="translate(476,466)">
      <g transform="rotate(180)">
        {rot_group([0, 360], PEDAL_T)}
          {crank_arm(False)}
        </g>
      </g>
    </g>
    <!-- 近侧曲柄 -->
    <g transform="translate(476,466)">
      {rot_group([0, 360], PEDAL_T)}
        {crank_arm(True)}
      </g>
    </g>

    {leg(near=True)}

    {pelican()}

    <g transform="translate(392,510)">
      {dust_puff(13, "#E4B785", 0)}
      {dust_puff(10, "#F0CD9F", -0.36)}
      {dust_puff(16, "#DCA972", -0.72)}
    </g>
  </g>

  <!-- 前景沙粒 -->
  {trans_group([(0, 0), (-1200, 0)], 1.6)}
    <g>
      <ellipse cx="120" cy="534" rx="16" ry="4" fill="#B07C4E" opacity=".4"/>
      <ellipse cx="420" cy="528" rx="22" ry="5" fill="#A97448" opacity=".35"/>
      <ellipse cx="700" cy="536" rx="14" ry="4" fill="#B07C4E" opacity=".4"/>
      <ellipse cx="960" cy="530" rx="20" ry="5" fill="#A97448" opacity=".35"/>
    </g>
    <g transform="translate(1200,0)">
      <ellipse cx="120" cy="534" rx="16" ry="4" fill="#B07C4E" opacity=".4"/>
      <ellipse cx="420" cy="528" rx="22" ry="5" fill="#A97448" opacity=".35"/>
      <ellipse cx="700" cy="536" rx="14" ry="4" fill="#B07C4E" opacity=".4"/>
      <ellipse cx="960" cy="530" rx="20" ry="5" fill="#A97448" opacity=".35"/>
    </g>
  </g>
</svg>
'''

# ───────────────────────────── validate + write ─────────────────────────────
depth = 0
for m in re.finditer(r'<(/?)g\b[^>]*?(/?)>', SVG):
    if m.group(2) == "/":
        continue
    depth += -1 if m.group(1) else 1
    if depth < 0:
        raise SystemExit(f"unbalanced </g> near: {SVG[max(0, m.start() - 200):m.start() + 40]}")
if depth != 0:
    raise SystemExit(f"unclosed <g>: {depth}")

default_out = pathlib.Path(__file__).resolve().parents[2] / "public" / "art" / "pelican-bike.svg"
# 冻结帧默认不写回作品，避免把静态校对帧误当成交付文件
out = pathlib.Path(OUT) if OUT else (default_out if POSE is None else default_out.with_name(f"pelican-bike.pose{POSE}.svg"))
out.write_text(SVG, encoding="utf-8")
print(out, len(SVG), "bytes", "pose=" + str(POSE))
