# Генератор SVG-схем для manual.html. Заменяет <figure class="todo"> по порядку.
# Цифры — из прогонов run-polar.mjs / runCase при 7 м/с (см. summary.md).
import math, re, sys

D = math.radians
def f(x): return f'{x:.1f}'.rstrip('0').rstrip('.')

# ---------- общие элементы ----------
HULL = "M0,-20 C6,-17 9,-8 9,2 C9,10 8,16 7.5,20 L-7.5,20 C-8,16 -9,10 -9,2 C-9,-8 -6,-17 0,-20 Z"

def boat(x, y, heading, boom=None, scale=1.0, luff=False, label=None, crew=None, cls=''):
    """Лодка сверху. heading — курс по часовой от «вверх», boom — угол гика от ДП (+ на правый борт, − на левый)."""
    s = [f'<g transform="translate({f(x)},{f(y)}) rotate({f(heading)}) scale({scale})" class="{cls}">',
         f'<path d="{HULL}" class="hull"/>']
    if crew is not None:
        s.append(f'<circle cx="{f(crew)}" cy="8" r="2.6" class="crew"/>')
    if boom is not None:
        L = 30
        bx, by = L * math.sin(D(boom)), -14 + L * math.cos(D(boom))
        if luff:
            # полощущий парус — волнистая линия
            mx, my = (bx) / 2, (-14 + by) / 2
            nx, ny = -(by + 14) / L * 4, bx / L * 4
            s.append(f'<path d="M0,-14 Q{f(mx/2+nx)},{f(-14+(my+14)/2+ny)} {f(mx)},{f(my)} T{f(bx)},{f(by)}" class="sail-luff"/>')
        else:
            # наполненный парус — дуга в подветренную сторону
            side = 1 if boom >= 0 else -1
            mx, my = bx / 2, (-14 + by) / 2
            nx, ny = (by + 14) / L, -bx / L
            k = 5 * side
            s.append(f'<path d="M0,-14 Q{f(mx + nx * k)},{f(my + ny * k)} {f(bx)},{f(by)}" class="sail-top"/>')
        s.append(f'<line x1="0" y1="-14" x2="{f(bx)}" y2="{f(by)}" class="spar thin"/>')
    s.append('<circle cx="0" cy="-14" r="2.2" class="mast"/>')
    s.append('</g>')
    if label:
        s.append(label)
    return ''.join(s)

def text(x, y, t, anchor='middle', cls='', size=None):
    st = f' style="font-size:{size}px"' if size else ''
    return f'<text x="{f(x)}" y="{f(y)}" text-anchor="{anchor}" class="{cls}"{st}>{t}</text>'

def arrow(x1, y1, x2, y2, cls='wind'):
    return f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" class="{cls}"/>'

def lead(x1, y1, x2, y2):
    return f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" class="lead"/>'

def svg(w, h, body, label):
    return (f'<svg viewBox="0 0 {w} {h}" class="d" role="img" aria-label="{label}" style="max-width:{round(w * 1.2)}px">' + body + '</svg>')

def wind_from_top(x, y, length=60, label='ветер'):
    return arrow(x, y, x, y + length, 'wind') + text(x, y - 8, label, cls='w')

# ---------- 1. Части лодки, вид сбоку ----------
def fig_parts():
    b = []
    wl = 300
    b.append(f'<rect x="0" y="{wl}" width="480" height="140" class="sea"/>')
    # шверт и руль под водой (рисуем до корпуса)
    b.append('<path d="M286,318 L318,318 L304,398 L292,396 Z" class="board"/>')
    b.append('<path d="M44,262 L66,262 L66,344 Q44,350 30,336 L30,276 Z" class="board"/>')
    # корпус
    b.append('<path d="M66,262 L420,250 Q430,262 424,288 Q400,318 330,322 L120,322 Q80,320 66,306 Z" class="hull"/>')
    b.append(f'<line x1="60" y1="{wl}" x2="430" y2="{wl}" class="wl"/>')
    # кокпит
    b.append('<path d="M110,262 L250,257 L250,272 L110,276 Z" class="cockpit"/>')
    # румпель
    b.append('<line x1="56" y1="262" x2="140" y2="270" class="spar thin"/>')
    # парус
    b.append('<path d="M386,240 L386,92 L196,40 Q150,150 92,238 Z" class="sail"/>')
    # мачта, гафель, гик
    b.append('<line x1="388" y1="252" x2="388" y2="46" class="spar"/>')
    b.append('<line x1="386" y1="94" x2="192" y2="38" class="spar"/>')
    b.append('<line x1="388" y1="240" x2="84" y2="240" class="spar"/>')
    # шкот
    b.append('<path d="M120,240 L112,262" class="rope"/><path d="M150,240 L118,262" class="rope"/>')
    # штаг
    b.append('<line x1="388" y1="50" x2="426" y2="252" class="rope"/>')
    # подписи
    L = [
        (388, 46, 430, 30, 'мачта', 'start'),
        (290, 66, 300, 22, 'гафель', 'middle'),
        (280, 160, 280, 160, 'грот', 'middle'),
        (200, 240, 210, 222, 'гик', 'middle'),
        (116, 250, 70, 200, 'шкот', 'middle'),
        (408, 150, 452, 150, 'штаг', 'middle'),
        (200, 266, 230, 352, 'кокпит', 'middle'),
        (100, 268, 110, 352, 'румпель', 'middle'),
        (40, 320, 30, 420, 'руль', 'start'),
        (300, 380, 352, 420, 'шверт', 'start'),
        (424, 270, 452, 230, 'нос', 'middle'),
        (70, 270, 40, 246, 'корма', 'middle'),
        (440, 300, 470, 334, 'ватерлиния', 'end'),
    ]
    for (x1, y1, x2, y2, t, a) in L:
        if (x1, y1) != (x2, y2):
            b.append(lead(x1, y1, x2, y2 - 5 if y2 > y1 else y2 + 4))
        b.append(text(x2, y2, t, a, 'on-sail' if t in ('грот', 'гик') else ''))
    return svg(480, 440, ''.join(b), 'Кэтбот сбоку: мачта, гафель, грот, гик, шкот, кокпит, руль, шверт')

# ---------- 1б. Вид сверху ----------
def fig_top():
    b = []
    cx, cy, k = 240, 170, 6.0
    b.append(f'<line x1="{cx}" y1="{cy - 160}" x2="{cx}" y2="{cy + 160}" class="dp"/>')
    b.append(text(cx + 6, cy - 150, 'ДП', 'start', 'soft'))
    b.append(f'<g transform="translate({cx},{cy}) scale({k})"><path d="{HULL}" class="hull" style="stroke-width:{1.5 / k}"/>'
             f'<path d="M-5.5,-2 L5.5,-2 L5.5,15 L-5.5,15 Z" class="cockpit" style="stroke-width:{1 / k}"/>'
             f'<rect x="-5.5" y="-2" width="2" height="17" class="bench"/><rect x="3.5" y="-2" width="2" height="17" class="bench"/>'
             f'<circle cx="0" cy="-14" r="1.6" class="mast" style="stroke-width:{0.8 / k}"/></g>')
    # гик на левом борту под 25°
    bx, by = cx - 150 * math.sin(D(25)), cy - 84 + 150 * math.cos(D(25))
    b.append(f'<line x1="{cx}" y1="{cy - 84}" x2="{f(bx)}" y2="{f(by)}" class="spar"/>')
    b.append(text(bx - 6, by + 18, 'гик', 'end'))
    b.append(text(cx, cy - 132, 'нос', cls='b'))
    b.append(text(cx, cy + 142, 'корма', cls='b'))
    b.append(text(cx + 80, cy, 'правый борт', 'start'))
    b.append(text(cx - 80, cy + 30, 'левый борт', 'end'))
    b.append(lead(cx + 32, cy + 50, cx + 76, cy + 60) + text(cx + 80, cy + 65, 'банка', 'start'))
    b.append(lead(cx, cy - 84, cx + 60, cy - 100) + text(cx + 64, cy - 96, 'мачта', 'start'))
    return svg(480, 330, ''.join(b), 'Кэтбот сверху: нос, корма, правый и левый борт, ДП, банки')

# ---------- 2. Треугольник ветров ----------
def fig_wind():
    # 7 м/с, курс 60° к истинному ветру, скорость лодки 5,6 уз = 2,88 м/с
    tws, twa, bs = 7.0, 60, 2.88
    s = 26  # px на м/с
    ox, oy = 110, 300
    ut = (math.sin(D(twa)), -math.cos(D(twa)))
    T = (ox + tws * s * ut[0], oy + tws * s * ut[1])
    A = (T[0], T[1] - bs * s)
    awx, awy = tws * ut[0], tws * ut[1] - bs
    aws = math.hypot(awx, awy)
    awa = math.degrees(math.atan2(awx, -awy))
    b = []
    b.append(boat(ox, oy + 6, 0, boom=-(awa - 24), scale=2.2))
    b.append(f'<line x1="{ox}" y1="{oy + 60}" x2="{ox}" y2="{oy - 230}" class="dp"/>')
    b.append(text(ox - 6, oy - 220, 'курс лодки', 'end', 'soft'))
    b.append(arrow(A[0], A[1], T[0], T[1], 'induced'))
    b.append(arrow(T[0], T[1], ox + 6 * ut[0], oy + 6 * ut[1], 'wind'))
    b.append(arrow(A[0], A[1], ox + 4 * awx / aws, oy + 4 * awy / aws, 'app'))
    b.append(text(T[0] + 10, T[1] - 4, 'истинный', 'start', 'w') + text(T[0] + 10, T[1] + 14, f'{f(tws)} м/с, {twa}°', 'start', 'w'))
    b.append(text(A[0] + 10, (A[1] + T[1]) / 2 + 5, f'от хода {str(round(bs, 1)).replace(".", ",")} м/с', 'start', 'soft'))
    b.append(text(A[0] + 10, A[1] - 22, 'вымпельный', 'start', 'a') + text(A[0] + 10, A[1] - 4, f'{str(round(aws, 1)).replace(".", ",")} м/с, {round(awa)}°', 'start', 'a'))
    # дуги углов
    def arc(r, a1, a2, cls):
        p1 = (ox + r * math.sin(D(a1)), oy - r * math.cos(D(a1)))
        p2 = (ox + r * math.sin(D(a2)), oy - r * math.cos(D(a2)))
        return f'<path d="M{f(p1[0])},{f(p1[1])} A{r},{r} 0 0,1 {f(p2[0])},{f(p2[1])}" class="{cls}"/>'
    b.append(arc(70, 0, awa, 'angle-a'))
    b.append(arc(92, 0, twa, 'angle-t'))
    return svg(400, 380, ''.join(b), 'Треугольник ветров: истинный ветер плюс встречный поток от хода дают вымпельный'), awa, aws

# ---------- 3. Роза курсов ----------
BOOM7 = {30: 12, 45: 12, 60: 19, 90: 44, 110: 63, 135: 88, 150: 88, 180: 88}
def fig_rose():
    cx, cy, R = 240, 262, 168
    b = []
    def pt(a, r): return (cx + r * math.sin(D(a)), cy - r * math.cos(D(a)))
    def sector(a1, a2, r, cls):
        p1, p2 = pt(a1, r), pt(a2, r)
        large = 1 if a2 - a1 > 180 else 0
        return f'<path d="M{cx},{cy} L{f(p1[0])},{f(p1[1])} A{r},{r} 0 {large},1 {f(p2[0])},{f(p2[1])} Z" class="{cls}"/>'
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{R - 26}" class="ring"/>')
    b.append(sector(-20, 20, R - 26, 'zone-dead'))
    b.append(sector(20, 60, R - 26, 'zone-close'))
    b.append(sector(-60, -20, R - 26, 'zone-close'))
    b.append(sector(160, 200, R - 26, 'zone-run'))
    # реальный мёртвый угол
    for a in (-45, 45):
        p = pt(a, R - 26)
        b.append(f'<line x1="{cx}" y1="{cy}" x2="{f(p[0])}" y2="{f(p[1])}" class="real"/>')
    p = pt(45, R - 20)
    b.append(text(p[0] + 2, p[1] - 4, '45°*', 'start', 'f', 13))
    b.append(arrow(cx, 6, cx, 40, 'wind') + text(cx + 10, 22, 'ветер', 'start', 'w'))
    # лодки
    for a in (30, 60, 90, 135, 180):
        x, y = pt(a, R)
        b.append(boat(x, y, a, boom=BOOM7[a], scale=1.0))
        if a != 180:
            x2, y2 = pt(-a, R)
            b.append(boat(x2, y2, -a, boom=-BOOM7[a], scale=1.0))
    x, y = pt(0, R - 6)
    b.append(boat(x, y, 0, boom=0, luff=True))
    # подписи секторов
    lab = [(0, 34, 'мёртвый угол', '±20°'), (45, 108, 'бейдевинд', '25–60°'), (90, 104, 'галфвинд', '90°'),
           (135, 104, 'бакштаг', '110–160°'), (180, 100, 'фордевинд', '180°')]
    for a, r, t, sub in lab:
        x, y = pt(a, r)
        b.append(text(x, y, t, cls='b') + text(x, y + 16, sub, cls='soft', size=13))
    for a, r, t in [(-45, 108, 'бейдевинд'), (-90, 104, 'галфвинд'), (-135, 104, 'бакштаг')]:
        x, y = pt(a, r)
        b.append(text(x, y, t, cls='b'))
    x, y = pt(-90, 60)
    b.append(text(cx - 230, cy + 182, 'правый галс', 'start', 'soft', 13))
    b.append(text(cx + 230, cy + 182, 'левый галс', 'end', 'soft', 13))
    return svg(480, 450, ''.join(b), 'Роза курсов: мёртвый угол, бейдевинд, галфвинд, бакштаг, фордевинд на обоих галсах')

# ---------- 4. Поляра ----------
POLAR7 = [(20, 3.0), (25, 3.8), (30, 4.4), (35, 4.9), (40, 5.1), (45, 5.3), (50, 5.4), (60, 5.6), (75, 5.7),
          (90, 5.7), (110, 5.6), (135, 5.2), (150, 4.9), (165, 4.8), (180, 4.8)]
def fig_polar():
    cx, cy, k = 70, 225, 33
    b = []
    def pt(a, v): return (cx + v * k * math.sin(D(a)), cy - v * k * math.cos(D(a)))
    for v in (2, 4, 6):
        p1, p2 = pt(0, v), pt(180, v)
        b.append(f'<path d="M{f(p1[0])},{f(p1[1])} A{v * k},{v * k} 0 0,1 {f(p2[0])},{f(p2[1])}" class="ring"/>')
        b.append(text(cx - 6, cy - v * k + 5, f'{v} уз', 'end', 'soft', 13))
    for a in range(0, 181, 30):
        p = pt(a, 6.6)
        b.append(f'<line x1="{cx}" y1="{cy}" x2="{f(p[0])}" y2="{f(p[1])}" class="ring"/>')
        q = pt(a, 7.1)
        b.append(text(q[0], q[1] + 5, f'{a}°', 'middle', 'soft', 13))
    # мёртвый угол
    p1, p2 = pt(0, 6.6), pt(20, 6.6)
    b.append(f'<path d="M{cx},{cy} L{f(p1[0])},{f(p1[1])} A{6.6 * k},{6.6 * k} 0 0,1 {f(p2[0])},{f(p2[1])} Z" class="zone-dead"/>')
    pts = [pt(a, v) for a, v in POLAR7]
    d = 'M' + ' L'.join(f'{f(x)},{f(y)}' for x, y in pts)
    b.append(f'<path d="{d}" class="polar"/>')
    for x, y in pts:
        b.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="2.6" class="polar-dot"/>')
    # лучшая VMG: 35°, 4,9 уз; максимум: 75–90°, 5,7 уз
    x, y = pt(35, 4.9)
    b.append(f'<line x1="{f(x)}" y1="{f(y)}" x2="{cx}" y2="{f(y)}" class="vmg"/>')
    b.append(text(x + 8, y - 6, 'лучшая VMG: 35°, 4,9 уз', 'start', 'b', 14))
    x, y = pt(90, 5.7)
    b.append(text(x - 4, y + 34, 'максимум 5,7 уз', 'end', 'b', 14))
    x, y = pt(180, 4.8)
    b.append(text(x + 10, y + 18, '4,8 уз', 'start', 'soft', 13))
    b.append(arrow(340, 10, 340, 44, 'wind') + text(330, 22, 'ветер 7 м/с', 'end', 'w'))
    return svg(410, 470, ''.join(b), 'Поляра скоростей кэтбота при ветре 7 м/с')

# ---------- 5. Силы на парусе и шверте ----------
def fig_forces():
    ox, oy = 250, 230
    b = []
    awa = 27
    # лодка крупно, курс вверх
    sc = 5.2
    b.append(f'<g transform="translate({ox},{oy}) scale({sc})"><path d="{HULL}" class="hull" style="stroke-width:{1.5 / sc}"/></g>')
    mast = (ox, oy - 14 * sc)
    boom = 12
    L = 30 * sc
    be = (mast[0] - L * math.sin(D(boom)), mast[1] + L * math.cos(D(boom)))
    mid = ((mast[0] + be[0]) / 2, (mast[1] + be[1]) / 2)
    b.append(f'<path d="M{f(mast[0])},{f(mast[1])} Q{f(mid[0] - 16)},{f(mid[1] - 2)} {f(be[0])},{f(be[1])}" class="sail-top big"/>')
    b.append(f'<line x1="{f(mast[0])}" y1="{f(mast[1])}" x2="{f(be[0])}" y2="{f(be[1])}" class="spar"/>')
    b.append(f'<circle cx="{f(mast[0])}" cy="{f(mast[1])}" r="5" class="mast"/>')
    # вымпельный ветер — набегает справа-спереди
    flow = (-math.sin(D(awa)), math.cos(D(awa)))
    for dx in (-30, 0, 30):
        sx, sy = mid[0] + 230 * math.sin(D(awa)) + dx * math.cos(D(awa)), mid[1] - 230 * math.cos(D(awa)) + dx * math.sin(D(awa))
        b.append(arrow(sx, sy, sx + 90 * flow[0], sy + 90 * flow[1], 'app'))
    b.append(text(mid[0] + 230 * math.sin(D(awa)) + 10, mid[1] - 230 * math.cos(D(awa)) - 14, 'вымпельный ветер', 'middle', 'a'))
    # сила паруса
    cl, cd = 1.35, 0.2
    liftd = (-math.cos(D(awa)), -math.sin(D(awa)))
    F = (cl * liftd[0] + cd * flow[0], cl * liftd[1] + cd * flow[1])
    s = 82
    ce = (mid[0] - 6, mid[1])
    end = (ce[0] + F[0] * s, ce[1] + F[1] * s)
    b.append(arrow(ce[0], ce[1], ce[0] + liftd[0] * cl * s, ce[1] + liftd[1] * cl * s, 'force-soft'))
    b.append(text(ce[0] + liftd[0] * cl * s - 6, ce[1] + liftd[1] * cl * s - 12, 'подъёмная сила', 'end', 'f', 14))
    b.append(arrow(ce[0], ce[1], end[0], end[1], 'force'))
    b.append(text(end[0] - 8, end[1] + 22, 'сила паруса', 'end', 'f'))
    # разложение
    b.append(arrow(ce[0], ce[1], ce[0], ce[1] + F[1] * s, 'force-dash'))
    b.append(text(ce[0] + 8, ce[1] + F[1] * s + 6, 'тяга', 'start', 'f'))
    b.append(arrow(ce[0], ce[1], ce[0] + F[0] * s, ce[1], 'force-dash'))
    b.append(text(ce[0] + F[0] * s + 4, ce[1] + 22, 'боковая сила', 'middle', 'f', 14))
    # шверт
    bd = (ox, oy + 3 * sc)
    b.append(f'<rect x="{f(bd[0] - 3)}" y="{f(bd[1] - 18)}" width="6" height="36" rx="3" class="board"/>')
    b.append(arrow(bd[0] + 4, bd[1], bd[0] + 4 - F[0] * s, bd[1], 'force'))
    b.append(text(bd[0] - F[0] * s + 12, bd[1] + 5, 'сила шверта', 'start', 'f'))
    b.append(lead(bd[0], bd[1] + 18, bd[0] + 40, bd[1] + 60) + text(bd[0] + 44, bd[1] + 66, 'шверт', 'start'))
    # курс и путь с дрейфом (увеличен)
    b.append(f'<line x1="{ox}" y1="{oy + 120}" x2="{ox}" y2="{oy - 190}" class="dp"/>')
    lw = 8
    b.append(f'<line x1="{ox}" y1="{oy + 110}" x2="{f(ox - 300 * math.sin(D(lw)))}" y2="{f(oy + 110 - 300 * math.cos(D(lw)))}" class="track"/>')
    b.append(text(ox - 300 * math.sin(D(lw)) - 4, oy + 110 - 300 * math.cos(D(lw)) + 2, 'путь', 'end', 'soft', 13))
    b.append(text(ox + 6, oy - 178, 'курс (ДП)', 'start', 'soft', 13))
    b.append(text(ox + 10, oy + 134, 'дрейф 3° (на схеме увеличен)', 'start', 'soft', 13))
    return svg(480, 400, ''.join(b), 'Силы на бейдевинде: подъёмная сила паруса раскладывается на тягу и боковую силу, шверт гасит боковую силу')

# ---------- 6. ЦП и ЦБС ----------
def fig_balance():
    b = []
    def one(ox, title, boom, ceoff, turn):
        sc = 4.0
        g = [f'<g transform="translate({ox},200) scale({sc})"><path d="{HULL}" class="hull" style="stroke-width:{1.5 / sc}"/></g>']
        mast = (ox, 200 - 14 * sc)
        L = 30 * sc
        be = (mast[0] - L * math.sin(D(boom)), mast[1] + L * math.cos(D(boom)))
        g.append(f'<line x1="{f(mast[0])}" y1="{f(mast[1])}" x2="{f(be[0])}" y2="{f(be[1])}" class="spar"/>')
        g.append(f'<circle cx="{f(mast[0])}" cy="{f(mast[1])}" r="4" class="mast"/>')
        clr = (ox, 200 + 4)
        ce = (ox - ceoff, 200 - 12)
        g.append(f'<line x1="{ox}" y1="70" x2="{ox}" y2="320" class="dp"/>')
        g.append(arrow(ce[0], ce[1], ce[0], ce[1] - 70, 'force'))
        g.append(text(ce[0] - 6, ce[1] - 54, 'тяга', 'end', 'f', 14))
        g.append(arrow(clr[0], clr[1], clr[0], clr[1] + 60, 'line'))
        g.append(text(clr[0] + 8, clr[1] + 56, 'сопротивление', 'start', 'soft', 13))
        g.append(f'<circle cx="{f(ce[0])}" cy="{f(ce[1])}" r="6" class="ce"/>')
        g.append(f'<path d="M{clr[0]},{clr[1] - 7} L{clr[0] + 6},{clr[1]} L{clr[0]},{clr[1] + 7} L{clr[0] - 6},{clr[1]} Z" class="clr"/>')
        if turn:
            r = 46 if turn > 1 else 30
            g.append(f'<path d="M{ox - r * 0.5},{200 - 120} A{r * 2},{r * 2} 0 0,1 {ox + r},{200 - 120 + r * 0.25}" class="turn{" big" if turn > 1 else ""}"/>')
        g.append(text(ox, 350, title, cls='b'))
        return ''.join(g)
    b.append(arrow(460, 30, 420, 70, 'wind') + text(468, 24, 'ветер', 'end', 'w'))
    b.append(one(130, 'без крена', 20, 6, 1))
    b.append(one(350, 'крен, гик за бортом', 35, 38, 2))
    b.append(text(240, 384, '● ЦП  ◆ ЦБС  — стрелка у носа: лодка приводится', cls='soft', size=13))
    return svg(480, 395, ''.join(b), 'ЦП уходит за подветренный борт при крене, пара сил тяги и сопротивления приводит лодку к ветру')

# ---------- 7. Крен и откренка (вид с кормы) ----------
def fig_heel():
    b = []
    cx, wl = 240, 250
    b.append(f'<rect x="0" y="{wl}" width="480" height="130" class="sea"/>')
    heel = -18  # крен на левый (подветренный) борт, ветер справа
    g = [f'<g transform="rotate({heel} {cx} {wl})">']
    g.append(f'<path d="M{cx - 80},{wl - 22} L{cx + 80},{wl - 22} Q{cx + 82},{wl + 30} {cx},{wl + 36} Q{cx - 82},{wl + 30} {cx - 80},{wl - 22} Z" class="hull"/>')
    g.append(f'<path d="M{cx - 6},{wl + 34} L{cx + 6},{wl + 34} L{cx + 4},{wl + 110} L{cx - 4},{wl + 110} Z" class="board"/>')
    g.append(f'<line x1="{cx}" y1="{wl - 22}" x2="{cx}" y2="{wl - 230}" class="spar"/>')
    g.append(f'<path d="M{cx - 2},{wl - 40} L{cx - 2},{wl - 220} Q{cx - 30},{wl - 130} {cx - 2},{wl - 40} Z" class="sail"/>')
    # экипаж на наветренном борту
    g.append(f'<circle cx="{cx + 92}" cy="{wl - 52}" r="9" class="crew"/>')
    g.append(f'<path d="M{cx + 80},{wl - 22} L{cx + 92},{wl - 44}" class="crew-line"/>')
    g.append('</g>')
    b.append(''.join(g))
    def rot(x, y):
        a = D(heel)
        dx, dy = x - cx, y - wl
        return (cx + dx * math.cos(a) - dy * math.sin(a), wl + dx * math.sin(a) + dy * math.cos(a))
    ce = rot(cx - 10, wl - 130)
    b.append(arrow(ce[0], ce[1], ce[0] - 110, ce[1], 'force'))
    b.append(text(ce[0] - 112, ce[1] + 22, 'боковая сила паруса', 'start', 'f', 14))
    bd = rot(cx, wl + 80)
    b.append(arrow(bd[0], bd[1], bd[0] + 100, bd[1], 'force'))
    b.append(text(bd[0] + 104, bd[1] + 5, 'сила шверта', 'start', 'f', 14))
    cr = rot(cx + 92, wl - 52)
    b.append(arrow(cr[0], cr[1] + 10, cr[0], cr[1] + 80, 'line'))
    b.append(text(cr[0] + 10, cr[1] + 4, 'вес экипажа', 'start', 'b', 14))
    b.append(text(cr[0] + 10, cr[1] + 20, 'на наветренном борту', 'start', 'soft', 13))
    b.append(arrow(470, 120, 400, 120, 'wind') + text(470, 108, 'ветер', 'end', 'w'))
    top = rot(cx, wl - 200)
    b.append(f'<line x1="{cx}" y1="{wl}" x2="{cx}" y2="{wl - 215}" class="dp"/>')
    b.append(f'<path d="M{cx},{wl - 200} A200,200 0 0,0 {f(top[0])},{f(top[1])}" class="turn"/>')
    b.append(text(cx + 8, wl - 206, 'крен', 'start', 'b'))
    b.append(text(240, 372, 'вид с кормы', cls='soft', size=13))
    return svg(480, 380, ''.join(b), 'Вид с кормы: боковая сила паруса и шверта кренят лодку, вес экипажа на наветренном борту выпрямляет')

# ---------- 8. Оверштаг ----------
def fig_tack():
    b = []
    b.append(arrow(240, 4, 240, 40, 'wind') + text(250, 22, 'ветер', 'start', 'w'))
    pts = [(90, 330, 35, 12, False, -7, '1'), (165, 220, 20, 12, False, -7, '2'), (200, 150, 0, 0, True, 0, '2'),
           (250, 170, -30, -12, False, 7, '3'), (320, 120, -35, -12, False, 7, '4')]
    b.append('<path d="M60,380 L130,280 Q180,190 202,152 Q220,130 250,168 L350,90" class="track"/>')
    for x, y, h, bm, lf, crew, n in pts:
        b.append(boat(x, y, h, boom=bm, luff=lf, scale=1.5, crew=crew))
    labels = [(90, 330, '1', 'ход на бейдевинде'), (165, 220, '2', 'приводимся'), (200, 150, '', 'нос через ветер, парус полощет'),
              (250, 170, '3', 'экипаж на другой борт'), (320, 120, '4', 'разгон на новом галсе')]
    off = {0: (20, 10), 1: (24, 10), 2: (0, -38), 3: (26, 22), 4: (0, -36)}
    for i, (x, y, n, t) in enumerate(labels):
        dx, dy = off[i]
        anchor = 'start' if dx > 0 else 'middle'
        tt = (f'<tspan class="num">{n}</tspan> ' if n else '') + t
        b.append(text(x + dx, y + dy, tt, anchor, size=14))
    b.append(text(20, 395, 'левый галс', 'start', 'soft', 13))
    b.append(text(470, 70, 'правый галс', 'end', 'soft', 13))
    return svg(480, 405, ''.join(b), 'Поворот оверштаг: лодка проходит носом через линию ветра')

# ---------- 9. Фордевинд ----------
def fig_gybe():
    b = []
    b.append(arrow(240, 4, 240, 40, 'wind') + text(250, 22, 'ветер', 'start', 'w'))
    b.append('<path d="M70,70 Q150,170 190,230 Q220,290 310,360" class="track"/>')
    pts = [(90, 100, 150, 80, '1', 'бакштаг, гик справа'), (160, 180, 170, 30, '2', 'выбираем шкот'),
           (200, 255, 200, -30, '3', 'ветер за кормой — гик перелетел'), (280, 335, 215, -80, '4', 'травим шкот, экипаж на другой борт')]
    for x, y, h, bm, n, t in pts:
        crew = -7 if bm > 0 else 7
        b.append(boat(x, y, h, boom=bm, scale=1.5, crew=crew))
    b.append(text(115, 108, '<tspan class="num">1</tspan> бакштаг, гик справа', 'start', size=14))
    b.append(text(185, 186, '<tspan class="num">2</tspan> выбираем шкот', 'start', size=14))
    b.append(text(236, 254, '<tspan class="num">3</tspan> ветер за кормой — гик перелетел', 'start', size=14))
    b.append(text(250, 345, '<tspan class="num">4</tspan> травим шкот,', 'end', size=14))
    b.append(text(250, 363, 'экипаж на другой борт', 'end', size=14))
    return svg(480, 400, ''.join(b), 'Поворот фордевинд: лодка проходит кормой через линию ветра, гик перелетает')

if __name__ == '__main__':
    path = sys.argv[1]
    s = open(path).read()
    wind_svg, awa, aws = fig_wind()
    figs = [
        (fig_parts(), 'Кэтбот сбоку. Мачта в самом носу, один гафельный грот, шверт под днищем, руль на транце.'),
        (wind_svg, f'Курс 60° к ветру 7 м/с, лодка идёт 5,6 уз. Вымпельный ветер сильнее истинного ({str(round(aws, 1)).replace(".", ",")} м/с) и дует ближе к носу — под {round(awa)}°.'),
        (fig_rose(), 'Курсы на обоих галсах и положение гика на каждом. Красный сектор — мёртвый угол в игре, пунктир — у настоящего кэтбота.'),
        (fig_polar(), 'Скорость нашей лодки на разных курсах при ветре 7 м/с (прогон физики игры). Пунктир — продвижение к ветру на лучшем курсе.'),
        (fig_forces(), 'Бейдевинд, вид сверху. Сила паруса направлена почти вбок; шверт гасит боковую часть, остаётся тяга.'),
        (fig_balance(), 'Тяга приложена в ЦП, сопротивление воды — в ЦБС на ДП. Чем дальше ЦП за бортом, тем сильнее лодку разворачивает к ветру.'),
        (fig_heel(), 'Парус и шверт кренят лодку, вес рулевого на наветренном борту выпрямляет её.'),
        (fig_tack(), 'Поворот оверштаг: номера соответствуют шагам в списке.'),
        (fig_gybe(), 'Поворот фордевинд: номера соответствуют шагам в списке.'),
    ]
    todos = list(re.finditer(r'<figure class="todo">[^<]*</figure>', s))
    assert len(todos) == 9, len(todos)
    # на место первой заглушки — два рисунка: сбоку и сверху
    out, last = [], 0
    for i, m in enumerate(todos):
        svgc, cap = figs[i]
        fig = f'<figure>{svgc}<figcaption>{cap}</figcaption></figure>'
        if i == 0:
            fig += f'\n      <figure>{fig_top()}<figcaption>Вид сверху: борта считают, глядя с кормы на нос.</figcaption></figure>'
        out.append(s[last:m.start()]); out.append(fig); last = m.end()
    out.append(s[last:])
    open(path, 'w').write(''.join(out))
    print('ok')
