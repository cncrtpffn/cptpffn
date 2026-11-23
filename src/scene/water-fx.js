import { SHORE_DAMP } from './shore-map.js';

// GLSL-фрагменты: шум (небо, облака, прибой), гашение волн и прибой у берега, кильватер (вода).

export const WAKE_POINTS = 64;
// сегменты следа группами: у группы описанный круг с шириной ленты, шейдер заходит только в близкие группы
export const WAKE_GROUP = 8;
// круги концов светлой сердцевины следа (по два на пробег)
export const WAKE_CAPS = 8;
// точек корпуса в начале следа (волна у борта, wake.js): лента продлена от кормы к носу
export const WAKE_HULL = 12;

export const NOISE_GLSL = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

// Гашение волн у берега для вершинного шейдера: синхронно с shoreDamp в shore-map.js.
export const SHORE_DAMP_GLSL = `
  uniform sampler2D uShoreTex; uniform vec4 uShoreBounds; uniform float uShoreDepth;
  float shoreDampAt(vec2 p) {
    vec2 uv = (p - uShoreBounds.xy) / uShoreBounds.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
    float depth = texture2D(uShoreTex, uv).g * uShoreDepth;
    return ${SHORE_DAMP.min.toFixed(3)} + ${(1 - SHORE_DAMP.min).toFixed(3)} * smoothstep(0.0, ${SHORE_DAMP.depth.toFixed(3)}, depth);
  }
`;

// Прибой и мелководье по карте берега (shore-map.js). Нужны SHORE_DAMP_GLSL (униформы карты), NOISE_GLSL,
// uTime, uWindDir. shoreInfo: x — расстояние до берега (м, плюс — вода), y — глубина (м), zw — нормаль от берега.
export const SURF_GLSL = `
  uniform float uShoreRange;
  // uSurf — сила прибоя (0 — выкл), uSurfAmp — сумма амплитуд волн (м), uShallows — сила цвета мелководья
  uniform float uSurf; uniform float uSurfAmp; uniform float uShallows; uniform vec3 uLagoon; uniform vec3 uFoam;
  vec4 shoreInfo(vec2 p) {
    vec2 uv = (p - uShoreBounds.xy) / uShoreBounds.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(uShoreRange, uShoreDepth, 0.0, 0.0);
    vec4 t = texture2D(uShoreTex, uv);
    return vec4((t.r * 2.0 - 1.0) * uShoreRange, t.g * uShoreDepth, t.ba * 2.0 - 1.0);
  }
  // доля бирюзы мелководья
  float shallowMix(vec4 sh) {
    float k = 1.0 - sh.y / uShoreDepth;
    return uShallows * 0.55 * k * k;
  }
  // мелкая пена: пузырьки — дырочка в случайном месте ячейки, 0 в дырочке, 1 — пена
  float bubbles(vec2 g) {
    vec2 c = floor(g);
    float h = hash12(c);
    vec2 o = vec2(hash12(c + 17.0), hash12(c + 31.0)) * 0.6 + 0.2;
    float r = 0.12 + 0.18 * h;
    return smoothstep(r * 0.6, r, length(fract(g) - o));
  }
  // покрытие 0.65..1, две октавы ~3 и ~7 на метр; вдали сглаживается, иначе «снег»
  float fineFoam(vec2 p, float fpx) {
    vec2 drift = vec2(uTime * 0.05, -uTime * 0.03);
    float b = bubbles(p * 3.0 + drift) * 0.5 + bubbles(p * 7.0 - drift * 1.7 + 13.1) * 0.5;
    return mix(mix(0.65, 1.0, b), 0.85, smoothstep(0.04, 0.25, fpx));
  }
  // lines = 0 — только пена у кромки (дальняя вода)
  float surfFoam(vec2 p, vec4 sh, float lines) {
    float d = sh.x;
    if (uSurf <= 0.0 || d > uShoreRange - 1.0) return 0.0;
    float fpx = length(fwidth(p));
    // ww: 1 — наветренный берег, 0 — подветренный. С подветра пены меньше, но не намного,
    // а с наветра пенная полоса втрое шире (reach)
    float ww = smoothstep(-0.3, 0.6, dot(sh.zw, -uWindDir));
    float expo = mix(0.7, 1.0, ww);
    float reach = mix(1.0, 3.0, ww);
    float sea = smoothstep(0.03, 0.6, uSurfAmp * expo);
    // мелкий шум гаснет вдали, иначе пена мерцает
    float hf = mix(vnoise(p * 3.7 - uTime * 0.3), 0.5, smoothstep(0.08, 0.3, fpx));
    float rag = vnoise(p * 1.1 + uTime * 0.12) * 0.6 + hf * 0.4;

    // кромка: заплески «дышат» не в такт по всему берегу
    float breathe = 0.5 + 0.5 * sin(uTime * 0.85 + vnoise(p * 0.04) * 12.0);
    float edgeW = (0.4 + (0.4 + 0.9 * breathe) * (0.25 + sea)) * reach;
    float edge = smoothstep(-1.2, -0.2, d) * (1.0 - smoothstep(edgeW * 0.35, edgeW, d));
    edge *= smoothstep(0.3, 0.55, rag + edge * 0.25);
    // накат над сушей — сплошная мелкая пена, при любом волнении и с любой стороны
    float swash = (1.0 - smoothstep(-0.8, 0.3, d)) * fineFoam(p, fpx);

    // буруны: рушатся там, где глубина меньше ~1.3 высоты волны, и бегут к берегу
    float foamLines = 0.0;
    if (lines > 0.0) {
      // склоны у островов крутые: глубина 4 м уже в ~10 м от кромки
      float hb = 0.4 + 2.6 * uSurfAmp;
      float zone = 1.0 - smoothstep(hb * 0.7, hb + 0.3, sh.y);
      // длина зоны бурунов от кромки: с наветра втрое больше
      float lz = (3.0 + 3.0 * uSurfAmp) * reach;
      zone *= 1.0 - smoothstep(lz * 0.7, lz, d);
      float lam = 2.2 + 2.0 * uSurfAmp;
      float ph = d / lam + uTime * (0.12 + 0.08 * uSurfAmp) + vnoise(p * 0.07) * 1.5;
      float fr = fract(ph);
      // резкий передний край со стороны берега, хвост пены — в сторону моря
      float w = 0.4;
      float l = (1.0 - smoothstep(0.0, w, fr)) + smoothstep(0.96, 1.0, fr);
      l *= smoothstep(0.3, 0.55, vnoise(p * 0.35 + sh.zw * uTime * 0.3) * 0.7 + hf * 0.3);
      // тоньше пикселя — гасим; у кромки сливаются с ней
      l *= 1.0 - smoothstep(0.3, 1.0, fpx / (lam * w));
      foamLines = l * zone * smoothstep(0.0, 1.0, d) * sea * lines;
    }
    return clamp(max(max(edge, swash), foamLines * 0.9) * uSurf, 0.0, 1.0);
  }
`;

// Кильватер «кружевом» (как в рисованных фильмах): светлая лента с дырами цвета воды, перемычки с контуром.
// Фигура открытая: с возрастом дыры растут, прорывают край и сливаются с водой вокруг, хвост рассыпается.
// Точки uWakeA (x, z, одометр, доля жизни 0..1) и uWakeB (полуширина, скорость, до границы сердцевины, номер круга её конца) —
// от кормы к хвосту, uWakeCap — круги концов сердцевины (x, z, радиус) (wake.js).
// uWakeG — описанные круги групп по WAKE_GROUP сегментов (x, z, радиус²). Нужны NOISE_GLSL, uTime.
// uWakeW: x — жизнь (с), y — длина ячейки (м). uWakeRim — ширина края у кормы (в ячейках, по шуму от 1× до 3×).
// Первые uWakeHullN сегментов — вдоль корпуса (волна у борта): uWakeIn — доля полуширины под корпусом; волнистый край
// там только у пены снаружи корпуса, дыр и буруна нет. За началом следа (самое широкое место корпуса) доля корпуса
// уходит в 0 на uWakeTail.z метров (uWakeTail: одометр начала, доля корпуса там, длина перехода) — край волнуется плавно.
export const WAKE_GLSL = `
  uniform vec4 uWakeA[${WAKE_POINTS}]; uniform vec4 uWakeB[${WAKE_POINTS}]; uniform vec3 uWakeCap[${WAKE_CAPS}]; uniform int uWakeCount;
  uniform vec3 uWakeG[${WAKE_POINTS / WAKE_GROUP}];
  uniform float uWakeIn[${WAKE_HULL + 1}]; uniform int uWakeHullN; uniform vec3 uWakeTail;
  uniform float uWakeSeg;
  uniform vec4 uWakeBox; uniform vec2 uWakeW; uniform float uWakeEdge; uniform float uWakeRim; uniform float uWakeOn; uniform float uWakeLace;
  // Дыры кружева — круги случайного радиуса вокруг узлов сетки ячеек (в q поперёк сжато — в мире овалы),
  // соседние сливаются в волнистые. x — расстояние до ближайшей дыры (минус — внутри).
  // grow — во сколько раз дыры больше; узлы медленно гуляют — кружево живое.
  // Дыра рождается цветом контура и заливается водой из своей точки внутри (у каждой свои точка и срок):
  // y — расстояние до залитой части (минус — вода). Круг воды растёт до радиуса, что накрывает всю дыру
  // вместе с расширением off (в ячейках); дальше от дыры остаётся тонкий контур.
  // Пока обод держит край (keep), дыра не выходит за |q.y| = qLim: у края она меньше или её нет — без обрубков
  vec2 wakeHoles(vec2 q, float grow, float life, float off, float qLim, float keep) {
    vec2 c = floor(q), f = fract(q);
    float h = 8.0, wt = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = vec2(hash12(c + g), hash12(c + g + 19.7));
      vec2 o = 0.5 + 0.3 * sin(uTime * 0.25 + 6.2831 * r);
      float R = (0.22 + 0.16 * hash12(c + g + 41.3)) * grow;
      R = mix(R, min(R, qLim - abs(c.y + g.y + o.y) - off), keep);
      if (R < 0.08) continue;
      float d = length(g + o - f) - R;
      h = min(h, d);
      // точка залива — до 0.6 радиуса от центра; заливка начинается в 8–20 % жизни, идёт 20–30 %
      vec2 sr = vec2(hash12(c + g + 7.1), hash12(c + g + 63.9));
      vec2 s = 0.6 * sqrt(sr.x) * vec2(cos(6.2831 * sr.y), sin(6.2831 * sr.y));
      float t0 = 0.08 + 0.12 * hash12(c + g + 88.4);
      float k = clamp((life - t0) / (0.2 + 0.1 * hash12(c + g + 31.6)), 0.0, 1.0);
      k = 1.0 - (1.0 - k) * (1.0 - k);
      float rho = k * (R * (1.0 + length(s)) + off) + 0.02;
      float sd = length(g + o + s * R - f) - rho;
      // k = 0 — воды нет; иначе вода — круг залива внутри своей дыры (с расширением)
      wt = min(wt, k > 0.0 ? max(d - off, sd) : 8.0);
    }
    return vec2(h, wt);
  }
  // край ленты в долях полуширины: без кружева хвост в последней четверти жизни сужается до нуля
  // (иначе обрыв), с кружевом не сужается — хвост съедают дыры, фигура не замыкается
  float wakeRim(float life) { return uWakeLace > 0.0 ? 1.0 : 1.0 - smoothstep(0.75, 1.0, life); }
  // x — заливка ленты, y — контур, z — бурун за кормой, w — границы сегментов (отладка, uWakeSeg)
  vec4 wakeMask(vec2 p) {
    if (uWakeOn <= 0.0 || uWakeCount < 2 || any(lessThan(p, uWakeBox.xy)) || any(greaterThan(p, uWakeBox.zw))) return vec4(0.0);
    // ближайшее место на ломаной в долях ширины ленты (там, где лента перекрывает себя на повороте, выигрывает
    // тот участок, что накрывает точку, — край без ступенек): поперёк со знаком, одометр, возраст, скорость.
    // На стыках — расстояние до самой точки: на внешней стороне поворота лента без щелей
    // волнистый край — шум в мировых координатах: непрерывен и на стыках сегментов, где одометр постоянен
    // (внешняя сторона поворота). Лента с возрастом шире — край медленно плывёт по шуму
    float wob = 1.0 + 0.2 * (vnoise(p * 0.3) * 2.0 - 1.0) + 0.08 * (vnoise(p * 0.9 + 3.1) * 2.0 - 1.0);
    // поперёк ~2 ряда ячеек; расстояния до краёв — в единицах ячеек
    float rows = 2.0;
    float bv = 1.3, bu = 0.0, ba = 0.0, bs = 0.0, bi = 0.0;
    bool bh = false;
    // до ближайшей точки следа вдоль сегмента, м: линия поперёк ленты на каждой точке
    float bd = 10.0;
    // светлая сердцевина — по всем участкам, что накрывают точку (где лента наложилась сама на себя, светлее
    // берётся верх, без шва): до её края, в единицах ячеек
    float core = -10.0;
    for (int g = 0; g < ${WAKE_POINTS / WAKE_GROUP}; g++) {
      if (g * ${WAKE_GROUP} >= uWakeCount - 1) break;
      vec2 gd = p - uWakeG[g].xy;
      if (dot(gd, gd) > uWakeG[g].z) continue;
      for (int j = 0; j < ${WAKE_GROUP}; j++) {
        int i = g * ${WAKE_GROUP} + j;
        if (i >= uWakeCount - 1) break;
        vec4 A = uWakeA[i], B = uWakeA[i + 1];
        vec4 wa = uWakeB[i], wb = uWakeB[i + 1];
        vec2 ab = B.xy - A.xy, ap = p - A.xy;
        // дальше длины сегмента (по одометру) и его ширины в долях уже найденного — мимо, без корней
        float reach = (A.z - B.z) + abs(bv) * max(wa.x, wb.x);
        if (dot(ap, ap) > reach * reach) continue;
        float l2 = dot(ab, ab);
        if (l2 < 1e-4) continue;
        float cr = (ab.x * ap.y - ab.y * ap.x) / sqrt(l2);
        float t = dot(ap, ab) / l2;
        // за самой старой точкой — полуокружность: так лента начинается при разгоне
        bool cap = t > 1.0 && i == uWakeCount - 2;
        if (t > 1.0 && !cap) continue;
        float a, u; vec4 w;
        if (cap) { a = B.w; w = wb; u = B.z; cr = length(p - B.xy) * sign(cr + 1e-6); }
        else if (t >= 0.0) {
          a = mix(A.w, B.w, t); u = mix(A.z, B.z, t);
          // номер круга не смешивается: берём у точки, что ближе к границе сердцевины
          w = vec4(mix(wa.xyz, wb.xyz, t), wa.z < wb.z ? wa.w : wb.w);
        }
        else { a = A.w; w = wa; u = A.z; cr = length(ap) * sign(cr + 1e-6); }
        float v = cr / max(w.x, 1e-3);
        if (abs(v) >= 1.3 || a >= 1.0) continue;
        // доля корпуса: вдоль борта — по точкам, за началом следа — спадает по пути от него; край = корпус + волнистая пена
        bool hs = i < uWakeHullN;
        float inr = hs ? mix(uWakeIn[i], uWakeIn[i + 1], clamp(t, 0.0, 1.0))
          : uWakeTail.y * (1.0 - smoothstep(0.0, uWakeTail.z, uWakeTail.x - u));
        if (abs(v) < abs(bv)) { bv = v; bu = u; ba = a; bs = w.y; bi = inr; bh = hs; bd = min(abs(t), abs(1.0 - t)) * sqrt(l2); }
        // сердцевина — только на пробегах выше ~1.5 уз (wake.js), внутри тонкого контура (uWakeEdge);
        // концы пробега — круги радиусом в полуширину ленты (uWakeCap), без круга — по расстоянию вдоль следа
        if (w.z > 0.0) {
          float rim = mix(wob, 1.0, inr) * wakeRim(a);
          float cc = (rim - abs(v)) * rows - uWakeEdge;
          if (w.w >= 0.0) {
            vec3 C = uWakeCap[int(w.w + 0.5)];
            if (w.z < C.z) cc = min(cc, (C.z * rim - length(p - C.xy)) / w.x * rows);
          } else {
            float c = clamp(1.0 - w.z / w.x, 0.0, 1.0);
            cc = min(cc, (sqrt(1.0 - c * c) * rim - abs(v)) * rows);
          }
          core = max(core, cc);
        }
      }
    }
    float life = ba;
    if (life >= 1.0 || abs(bv) >= 1.3) return vec4(0.0);
    float v = bv;
    float rimOut = mix(wob, 1.0, bi) * wakeRim(ba);
    // вдоль борта — сплошная полоса: без дыр и буруна
    bool lace = uWakeLace > 0.0 && !bh;
    // по центру ячейки крупнее; ячейки растягиваются вместе с лентой — дыры-овалы
    vec2 q = vec2(bu / uWakeW.y, v * (0.6 + 0.4 * abs(v)) * rows);
    float n = vnoise(q * 1.7 + 5.0);
    // с возрастом дыры растут, перемычки тоньше и рвутся на обрывки (у каждого куска свой срок),
    // к концу жизни дыры сливаются и хвост рассыпается
    float fade = 1.0 - life;
    float off = 0.3 * life * (0.4 + n) + 1.2 * smoothstep(0.7, 1.0, life);
    // обод держит край только у кормы: дальше дыры прорывают его и открываются в воду за лентой
    float keep = uWakeLace > 0.0 ? 1.0 - smoothstep(0.1, 0.45, life) : fade;
    // куда дыре можно доходить, пока обод держится: внутренняя граница самого толстого обода с контуром и зазором, в q
    float vIn = rimOut - (uWakeRim * keep * 1.5 + uWakeEdge + 0.1) / rows;
    float qLim = vIn * (0.6 + 0.4 * vIn) * rows;
    // gLace — дыры целиком (вокруг них контур), gWater — их залитая водой часть; пока не залита — цвет контура
    // без кружева (uWakeLace = 0) — сплошная лента с ободом
    // дыры рождаются мелкими (0.4 от базового радиуса) и к концу жизни вырастают в 2.2 раза
    vec2 hw = lace
      ? wakeHoles(q, 0.4 + 1.8 * life, life, 0.3 * life * 1.4 + 1.2 * smoothstep(0.7, 1.0, life), qLim, keep) : vec2(10.0);
    float gLace = hw.x - off;
    float gWater = max(hw.y, gLace);
    float e = (rimOut - abs(v)) * rows; // до внешнего края, в единицах ячеек
    float rimW = uWakeRim * keep * (0.5 + n);
    // когда обод сошёл на нет, уводим его в минус — иначе по краю остаётся линия толщиной в пиксель
    float gRim = rimW - abs(e - rimW) - 0.3 * (1.0 - keep);
    float g = min(max(gLace, gRim), e);
    float gw = min(max(gWater, gRim), e);
    float aa = clamp(fwidth(gw), 1e-4, 0.3);
    float fill = smoothstep(-aa, aa, gw);
    // вне сердцевины участок весь цветом контура; контур есть и вокруг дыр, и в ещё не залитой их части.
    // Белая пена на полном ходу — потом
    float gc = min(g - uWakeEdge, core);
    // на скачке между участками (сердцевина есть / нет) fwidth огромен — ограничиваем, иначе шов полупрозрачными точками
    float ac = clamp(fwidth(gc), 1e-4, 0.3);
    float edge = fill * (1.0 - smoothstep(-ac, ac, gc));
    // вдали ячейки мельче пикселя — средняя заливка без мерцания
    float far = smoothstep(0.25, 0.7, length(fwidth(q)));
    float inside = step(0.0, e);
    fill = mix(fill, (lace ? 0.45 * fade : 1.0) * inside, far);
    edge = mix(edge, (core > 0.0 ? 0.0 : 1.0) * fill, far);
    // бурун: рваная белая пена первые секунды за кормой, сильнее на ходу
    float churn = (1.0 - smoothstep(0.4, 2.2, ba * uWakeW.x)) * (1.0 - smoothstep(0.35, 0.75, abs(v)));
    churn *= smoothstep(0.42, 0.58, vnoise(p * 2.3 + uTime * 0.6) * 0.6 + vnoise(p * 5.1 - uTime * 0.9) * 0.4);
    churn *= smoothstep(1.0, 3.5, bs) * (bh ? 0.0 : 1.0);
    float seg = 0.0;
    if (uWakeSeg > 0.0) seg = (1.0 - smoothstep(0.0, 1.5 * fwidth(bd), bd)) * inside;
    return vec4(fill, edge, churn, seg);
  }
`;
