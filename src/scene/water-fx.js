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

// Отражения: небо по Френелю (у горизонта вода берёт цвет неба, под ногами — свой) и объекты из
// плоского отражения (planar-reflection.js). Диск солнца не отражаем. Нужен skyColor() из sky.js.
// k — доля отражения в точке (на пене и следе 0).
export const SKY_REFLECT_GLSL = `
  // uReflect — сила неба (0 — выкл); uFresnelPow — показатель френеля (физически 5):
  // больше — цвет воды у лодки тянется дальше к горизонту
  uniform float uReflect; uniform float uFresnelPow;
  // объекты: текстура с предумноженной альфой, проекция зеркальной камеры, сила (0 — выкл), искажение волнами
  uniform sampler2D uReflTex; uniform mat4 uReflMatrix; uniform float uPlanar; uniform float uReflDistort;
  // для объектов свой френель: с большим uFresnelPow лодка у самой лодки не отражалась бы
  const float OBJ_F0 = 0.12;
  vec3 skyReflect(vec3 col, vec3 n, vec3 p, float k) {
    vec3 v = normalize(cameraPosition - p);
    float ndv = max(dot(n, v), 0.0);
    if (uReflect > 0.0) {
      vec3 r = reflect(-v, n);
      r.y = abs(r.y); // на крутом склоне отражённый луч смотрел бы в воду
      float f = 0.02 + 0.98 * pow(1.0 - ndv, uFresnelPow);
      col = mix(col, skyColor(r, 0.0), f * k * uReflect);
    }
    if (uPlanar > 0.0) {
      vec4 c = uReflMatrix * vec4(p.x, 0.0, p.z, 1.0);
      vec2 uv = c.xy / c.w + n.xz * uReflDistort;
      vec4 o = texture2D(uReflTex, uv);
      float fo = OBJ_F0 + (1.0 - OBJ_F0) * pow(1.0 - ndv, 5.0);
      col = mix(col, o.rgb / max(o.a, 1e-3), o.a * clamp(uPlanar * fo, 0.0, 1.0) * k);
    }
    return col;
  }
`;

// Мелкая рябь — наклон поверхности для нормали по пикселю (геометрии нет): 4 октавы градиентного шума,
// вытянутого вдоль гребня. Гребни поперёк направления ветровых волн uRippleDir (вектор «куда»), октавы
// чуть разведены по углу и бегут по направлению с фазовой скоростью глубокой воды √(gλ/2π).
// Октава гаснет, когда её длина меньше ~2–4 пикселей. Нужны hash12 (NOISE_GLSL) и uTime.
export const RIPPLE_GLSL = `
  uniform float uRipple; uniform vec2 uRippleDir;
  // xy — градиент, z — значение
  vec3 vnoised(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    float k = a - b - c + d;
    return vec3(du * vec2(b - a + k * u.y, c - a + k * u.x), a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y);
  }
  // λ (м), поворот от направления волн (рад), наклон
  vec2 rippleOctave(vec2 p, float fpx, float lambda, float ang, float amp, float seed) {
    float fade = 1.0 - smoothstep(0.25, 0.6, fpx / lambda);
    if (fade <= 0.0) return vec2(0.0);
    float ca = cos(ang), sa = sin(ang);
    vec2 w = vec2(uRippleDir.x * ca - uRippleDir.y * sa, uRippleDir.x * sa + uRippleDir.y * ca);
    vec2 wp = vec2(-w.y, w.x);
    float speed = sqrt(9.81 * lambda / 6.2831853);
    // вдоль гребня растянуто в 2.5 раза
    vec2 q = vec2(dot(p, w) - uTime * speed, dot(p, wp) * 0.4) / lambda + seed;
    vec2 g = vnoised(q).xy;
    return (g.x * w + g.y * 0.4 * wp) * amp * fade;
  }
  vec2 rippleSlope(vec2 p) {
    if (uRipple <= 0.0) return vec2(0.0);
    float fpx = length(fwidth(p));
    vec2 s = rippleOctave(p, fpx, 1.6, 0.0, 0.16, 0.0);
    s += rippleOctave(p, fpx, 0.8, 0.35, 0.16, 17.3);
    s += rippleOctave(p, fpx, 0.4, -0.44, 0.14, 41.7);
    s += rippleOctave(p, fpx, 0.2, 0.21, 0.12, 73.1);
    return s * uRipple;
  }
`;

// Барашки: пороги общие для шейдера (whitecapGlsl) и брызг с гребней (crest-spray.js).
// Сила от ветра: 0 до windFrom, 1 с windFull (м/с). Есть ли пена на участке гребня — по нормированной высоте
// hn = Σ a·sin θ / √Σ a² (на гребне одной главной волны ≈ 0.9, где сходятся компоненты — до ~1.6): порог
// опускается с силой от hi до lo — барашков больше и они длиннее.
export const WHITECAP = { windFrom: 5, windFull: 15, hi: 1.55, lo: 0.62 };
export const whitecapForce = (speed) => Math.min(1, Math.max(0, (speed - WHITECAP.windFrom) / (WHITECAP.windFull - WHITECAP.windFrom)));
export const whitecapThreshold = (f) => WHITECAP.hi + (WHITECAP.lo - WHITECAP.hi) * f;

// Барашки — полосы пены вдоль гребней, цветами кильватера: заливка, контур по краю, сильная пена на фронте.
// Всё считается от гребня главной волны ветровой системы (s0 = sin θ, c0 = cos θ, гребень s0 = 1): dc — расстояние до
// гребня по ходу волн, м (плюс — передний склон, минус — задний, наветренный). Барашки ходят группами: у камеры
// (круг uWcNear: xy — центр, z — радиус) группы рождаются в точках срыва гребней (crest-spray.js → water.js, uWcGroup:
// along, across — точка гребня в координатах гребня, t0 — рождение, w — полудлина вдоль гребня; группа — фрагмент одной
// волны, на соседние гребни не заходит), дальше — пятна шума.
// Есть ли пена на этом участке гребня, решает свой цикл жизни: гребень делится на сегменты разной длины (~3–15 м, между ними зазор в полширины барашка),
// каждый сегмент сдвинут от гребня на случайные ±полширины барашка; у каждого сегмента каждого гребня свои время рождения
// и жизнь 10–15 с (растёт, 2 с держится, столько же гаснет): в группе от срыва — один раз, с задержкой до 4 с от её
// рождения, в группах по шуму — раз в 20 с (часть сегментов с ветром не горит вовсе — так задаётся количество). Высота гребня
// (на склоне берём высоту гребня: hn + a0·(1 − s0), a0 — доля главной волны) только поправка: на высоких гребнях
// полосы длиннее. От одной высоты полоса жила бы 3–5 с — гребень быстро проходит группу волн. Всё — одинаково для
// полосы и её следа и едет с гребнем (uWhitecap.y — пройденный гребнем путь, м).
// Полоса узкая, к концам сужается в линзу; наветренный край — сильная пена. Шлейф — по подветренному (переднему)
// склону, куда ветер сносит пену с гребня: цвет заливки с контуром, у гребня сплошной, дальше рвётся на пятна;
// с ветром длиннее (шире поперёк гребня); при умеренном и свежем ветре его нет (uWhitecapTrail — доля его длины).
// Возвращает x — заливку, y — контур, z — сильную пену; uWhitecapEdge — толщина контура (1 — от края до середины).
// uWhitecap.x — сила 0..1 (с ветром), 0 — выкл; z — волновое число главной волны (рад/м). Нужны NOISE_GLSL, RIPPLE_GLSL (uRippleDir), uTime.
export const whitecapGlsl = (groups) => `
  uniform vec3 uWhitecap; uniform int uWhitecapComp; uniform float uWhitecapEdge; uniform float uWhitecapTrail;
  uniform vec4 uWcGroup[${groups}]; uniform int uWcGroupN; uniform vec3 uWcNear; uniform float uWcDebug;
  // отладка (панель «Вода», «Подсвечивать группы барашков»): каждая группа от срыва — своим цветом по весу, как его
  // считает whitecap (поперёк — по самому пикселю, не по точке гребня: видна вся волна группы от подошвы до подошвы),
  // бледнеет к концу жизни; белая точка — где
  // она родилась; круги — 0.8R и R, между ними переход к группам по шуму. Возвращает цвет и долю смешивания
  vec4 whitecapGroupsDebug(vec2 p) {
    vec2 w = uRippleDir, wp = vec2(-w.y, w.x);
    float k = max(uWhitecap.z, 1e-3), cw = 6.2831853 / k;
    float al = dot(p, wp), ac = dot(p, w) - uWhitecap.y;
    float fpx = length(fwidth(p));
    // производные — вне ветвлений: цикл копит лучший вес, его цвет и жизнь, есть ли рядом точка рождения
    float best = 0.0, life = 0.0, seed = 0.0;
    vec3 c = vec3(0.0);
    for (int i = 0; i < ${groups}; i++) {
      if (i >= uWcGroupN) break;
      vec4 g = uWcGroup[i];
      float gw = (1.0 - smoothstep(0.6, 1.0, abs(al - g.x) / g.w)) * (1.0 - smoothstep(0.45 * cw, 0.5 * cw, abs(ac - g.y)));
      if (length(vec2(al - g.x, ac - g.y)) < max(0.8, 3.0 * fpx)) seed = 1.0;
      if (gw > best) {
        best = gw;
        life = 1.0 - clamp((uTime - g.z) / 20.0, 0.0, 1.0);
        c = 0.5 + 0.5 * cos(6.2831853 * (hash12(vec2(g.z, g.w)) + vec3(0.0, 0.33, 0.67)));
      }
    }
    // контур по весу 0.3 — граница, где сегменты ещё горят
    float bw = max(fwidth(best), 1e-4);
    float rim = best > 0.0 ? 1.0 - smoothstep(0.0, 2.0 * bw, abs(best - 0.3)) : 0.0;
    vec4 o = best > 0.0 ? vec4(mix(c, vec3(1.0), rim * 0.6), (0.15 + 0.35 * best + 0.4 * rim) * (0.3 + 0.7 * life)) : vec4(0.0);
    o = mix(o, vec4(1.0), seed);
    float dn = length(p - uWcNear.xy), lw = max(0.3, 1.5 * fpx);
    float ring = max(1.0 - smoothstep(0.0, lw, abs(dn - uWcNear.z)), 1.0 - smoothstep(0.0, lw, abs(dn - 0.8 * uWcNear.z)));
    return mix(o, vec4(1.0, 0.85, 0.2, 0.8), ring);
  }
  vec3 whitecap(vec2 p, float hn, float s0, float c0, float a0) {
    float f = uWhitecap.x;
    if (f <= 0.0) return vec3(0.0);
    float k = uWhitecap.z;
    // производные — до первых ветвлений
    float fpx = length(fwidth(p));
    // шлейф: длина поперёк гребня с ветром, не дальше подошвы
    // при бризе и умеренном ветре барашки мельче: ширина, шлейф и длина по гребню × sz
    float sz = mix(0.4, 1.0, smoothstep(0.0, 0.6, f));
    float lt = min(mix(0.8, 6.0, f) * sz, 2.8 / k) * uWhitecapTrail;
    // ширина барашка (полоса + шлейф): от неё зазоры между сегментами и сдвиг сегментов от гребня
    float hwb = mix(0.3, 1.0, f) * sz;
    float wc = 2.0 * hwb + lt;
    // дальше от гребня, чем бывает пена, — выход по одному s0, без atan и остального (большая часть воды)
    float dmax = max(1.6, lt * 1.4) + 0.5 * wc;
    if (k * dmax < 3.1415927 && s0 < cos(k * dmax)) return vec3(0.0);
    // до гребня по ходу волн, м: гребень — θ = π/2
    float th = atan(s0, c0) - 1.5707963;
    if (th < -3.1415927) th += 6.2831853;
    float dc = th / k;
    if (dc < -1.6 - 0.5 * wc || dc > max(lt * 1.4, 1.6 * hwb) + 0.5 * wc) return vec3(0.0);
    float thr = ${WHITECAP.hi.toFixed(3)} + ${(WHITECAP.lo - WHITECAP.hi).toFixed(3)} * f;
    float hc = hn + a0 * (1.0 - s0);
    // порог цикла жизни: с ветром полосы длиннее; поправка высоты гребня
    float sc0 = mix(0.6, 0.2, f) - (hc - thr) * 0.3;
    // даже на пике жизни не дотянет — пены нет, шум не считаем
    if (sc0 > 1.0) return vec3(0.0);
    vec2 w = uRippleDir, wp = vec2(-w.y, w.x);
    // точка гребня в координатах гребня: вдоль и поперёк за вычетом пройденного гребнем пути
    float al = dot(p, wp), ac = dot(p, w) - dc - uWhitecap.y;
    // номер гребня (гребни через λ, счёт неподвижен относительно гребней)
    float ci = floor(ac * k / 6.2831853 + 0.5);
    // сегменты вдоль гребня разной длины: границы через ~14 м, сдвинутые на ±35 % — от ~4 до ~24 м
    float u = al + hash12(vec2(ci, 3.7)) * 14.0;
    float j = floor(u / 14.0);
    float b0 = (j + 0.7 * hash12(vec2(j, ci + 0.5)) - 0.35) * 14.0;
    float b1 = (j + 0.65 + 0.7 * hash12(vec2(j + 1.0, ci + 0.5))) * 14.0;
    if (u < b0) { b1 = b0; j -= 1.0; b0 = (j + 0.7 * hash12(vec2(j, ci + 0.5)) - 0.35) * 14.0; }
    else if (u >= b1) { b0 = b1; j += 1.0; b1 = (j + 0.65 + 0.7 * hash12(vec2(j + 1.0, ci + 0.5))) * 14.0; }
    vec2 cell = vec2(j, ci);
    float h1 = hash12(cell), h2 = hash12(cell + vec2(17.1, 5.3)), h3 = hash12(cell + vec2(-9.4, 21.7));
    // чья группа у сегмента: у камеры — от точек срыва, к краю круга всё чаще по шуму (по середине сегмента —
    // без шва внутри сегмента). В группе сегменты горят почти все, между группами — пусто
    float um = 0.5 * (b0 + b1) - hash12(vec2(ci, 3.7)) * 14.0;
    vec2 pm = wp * um + w * (ac + uWhitecap.y);
    bool byGroup = hash12(cell + vec2(-2.3, 8.1)) < 1.0 - smoothstep(0.8 * uWcNear.z, uWcNear.z, length(pm - uWcNear.xy));
    float grp = 0.0, t0 = 0.0;
    if (byGroup) {
      // группы от точек срыва: фрагмент одной волны — только свой гребень (сначала отсев по гребню), вдоль — на полудлину
      float cw = 6.2831853 / k;
      for (int i = 0; i < ${groups}; i++) {
        if (i >= uWcGroupN) break;
        vec4 g = uWcGroup[i];
        float dg = abs(ac - g.y);
        if (dg > 0.5 * cw) continue;
        float gw = 1.0 - smoothstep(0.6, 1.0, abs(al - g.x) / g.w);
        if (gw > grp) { grp = gw; t0 = g.z; }
      }
      grp = smoothstep(0.0, 0.6, grp);
    } else {
      // группы по шуму — пятна ~50 м вдоль гребня и через 2–3 гребня (неподвижны относительно гребней)
      grp = smoothstep(0.3, 0.6, vnoise(vec2(al / 50.0, ci / 2.5) + 71.3));
    }
    // горит ли сегмент: с ветром и в группе — больше
    if (h1 > min(1.0, mix(0.45, 1.0, f) * 1.6 * grp)) return vec3(0.0);
    // возраст и жизнь: растёт, 2 с держится, гаснет (рост и угасание поровну); в группе от срыва — один раз,
    // с задержкой до 4 с от её рождения, по шуму — раз в 20 с
    float life = mix(10.0, 15.0, h2);
    float age = byGroup ? uTime - t0 - h3 * 4.0 : fract(uTime / 20.0 + h3) * 20.0;
    float ramp = 0.5 * (life - 2.0);
    float env = smoothstep(0.0, ramp, age) * (1.0 - smoothstep(life - ramp, life, age));
    if (env <= 0.0) return vec3(0.0);
    // между сегментами — зазор в половину ширины барашка (полоса + шлейф) при текущем ветре; концы скруглены
    float gap = 0.5 * wc;
    // растёт от середины сегмента: длина, ширина и шлейф — вместе с env
    float ue = min(u - b0, b1 - u) - 0.5 * gap - (1.0 - env * sz) * 0.5 * (b1 - b0 - gap);
    if (ue <= 0.0) return vec3(0.0);
    // скругление концов: ширина полосы и длина шлейфа — по окружности радиуса rr от конца сегмента
    float rr = 1.5 * hwb + 0.5 * lt;
    float xe = clamp(ue / rr, 0.0, 1.0);
    float rnd = sqrt(xe * (2.0 - xe));
    // сегмент сдвинут от гребня по ходу волн на случайные ±полширины барашка; ds — расстояние до его оси
    float ds = dc - (hash12(cell + vec2(5.9, -13.3)) - 0.5) * wc;
    // вперёд — шлейф или передняя половина полосы (без шлейфа)
    if (ds < -1.6 || ds > max(lt * 1.4, 1.6 * hwb)) return vec3(0.0);
    // шум — в точке гребня (p − dc·w): вдоль гребня ~9 м, поперёк — как соседние гребни
    vec2 q = vec2(al / 9.0, ac / 6.0);
    float n = vnoise(q) * 0.65 + vnoise(q * vec2(1.7, 1.3) + vec2(31.7, uTime * 0.03)) * 0.35;
    // рисунок пены едет с гребнем (pc — координаты гребня) и меняется медленно, иначе гребень пробегает по
    // неподвижному в воде шуму и пена «кипит» со скоростью волны
    vec2 pc = p - w * uWhitecap.y;
    // рваный край, мелкий шум гаснет вдали (там не считаем)
    float hf = 0.5;
    if (fpx < 0.4) hf = mix(vnoise(pc * 1.3 + vec2(0.0, uTime * 0.04)), 0.5, smoothstep(0.1, 0.4, fpx));
    // есть ли пена: 0 — нет, 1 — полная ширина
    float gp = env * clamp((0.8 + 0.2 * n - sc0) / 0.15, 0.0, 1.0);
    // полоса: полуширина 0.3 м при слабом ветре, 1 м при сильном, неровная вдоль.
    // Рваный край — только внутри участка с пеной; без пены (gp = 0) центр гребня ровно на границе — сдвиг,
    // иначе волосяная линия по всем гребням
    float hw = hwb * (0.5 + n) * rnd;
    float g = 1.0 - abs(ds) / hw - 1.1 + gp * (1.1 + (hf - 0.5) * 0.5);
    // шлейф по подветренному склону: вдоль гребня сужается к концам сегмента, как полоса; дальше от гребня дыр больше,
    // кружево едет с гребнем и медленно перетекает. Вблизи — шум бурунов прибоя (крупные разрывы ~3 м и рваный
    // край ~0.3 м, как в surfFoam), дальше — мелкое кружево, совсем вдали — среднее
    float gt = -1.0;
    if (ds > 0.0 && lt > 0.0) {
      float t = ds / max(lt * (0.7 + 0.6 * n) * rnd, 1e-3);
      // шум считается только там, где он виден: вдали — среднее 0.5, шум прибоя — только вблизи
      float lace = 0.5;
      if (fpx < 0.35) {
        float drift = uTime * 0.012;
        lace = mix(vnoise(pc * 1.1 + drift) * 0.6 + vnoise(pc * 2.6 - drift + 7.7) * 0.4, 0.5, smoothstep(0.1, 0.35, fpx));
        if (fpx < 0.12) {
          float surf = vnoise(pc * 0.35 + drift) * 0.7 + mix(vnoise(pc * 3.7 - uTime * 0.04), 0.5, smoothstep(0.08, 0.3, fpx)) * 0.3;
          lace = mix(surf, lace, smoothstep(0.05, 0.12, fpx));
        }
      }
      gt = min(1.0 - t - 1.1 + gp * 1.1, (lace - mix(0.15, 0.75, t)) * 3.0);
    }
    float gu = max(g, gt);
    // сглаживание только внутрь: снаружи строго 0, иначе вдали, где полоса уже пикселя, бледные линии по всем
    // гребням; узкие далёкие полосы сами бледнеют и гаснут без мерцания
    float aa = max(fwidth(gu), 1e-3);
    float fill = smoothstep(0.0, 2.0 * aa, gu);
    float edge = fill * (1.0 - smoothstep(uWhitecapEdge, uWhitecapEdge + 2.0 * aa, gu));
    // наветренный край полосы — сильная пена внутри контура
    float ca = max(fwidth(ds), 1e-3);
    float strong = smoothstep(0.0, 2.0 * aa, g) * (1.0 - edge) * smoothstep(ca, -ca, ds);
    return vec3(fill, edge, strong);
  }
`;
