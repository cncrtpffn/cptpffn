import { SHORE_DAMP } from './shore-map.js';

// GLSL-фрагменты для воды: шум, кильватерный след, блики. Подключаются в water.js.

export const WAKE_POINTS = 40;

export const FX_UNIFORMS_GLSL = `
  uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor;
  uniform vec2 uWindDir; uniform float uWhitecap;
  uniform vec4 uTrail[${WAKE_POINTS}]; uniform int uTrailCount; uniform vec2 uWakeCenter;
  uniform float uRipple;
  varying vec3 vWorldPos; varying vec3 vWaveN;
`;

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

// Мелкая рябь: процедурная карта нормалей. Октавы value noise с аналитическим градиентом,
// у каждой октавы своё фиксированное направление в мире: при смене ветра рисунок не поворачивается
// и не «плывёт» вдали от начала координат. Рисунок неподвижен относительно воды.
// Октава гаснет, когда пиксель становится сравним с её длиной, — иначе у горизонта «снег».
export const RIPPLE_GLSL = `
  // xy — градиент, z — значение
  vec3 vnoised(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    float k = a - b - c + d;
    return vec3(du * vec2(b - a + k * u.y, c - a + k * u.x), a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y);
  }
  // λ (м), направление гребней в мире (рад), амплитуда/λ
  vec2 rippleOctave(vec2 p, float fpx, float lambda, float ang, float amp, float seed) {
    float fade = 1.0 - smoothstep(0.25, 0.6, fpx / lambda);
    if (fade <= 0.0) return vec2(0.0);
    vec2 w = vec2(cos(ang), sin(ang));
    vec2 wp = vec2(-w.y, w.x);
    // вдоль гребня растянуто в 2.5 раза
    vec2 q = vec2(dot(p, w), dot(p, wp) * 0.4) / lambda + seed;
    vec2 g = vnoised(q).xy;
    return (g.x * w + g.y * 0.4 * wp) * amp * fade;
  }
  vec2 rippleSlope(vec2 p) {
    float fpx = length(fwidth(p));
    // направления разнесены, чтобы рисунок не выглядел полосатым в одну сторону
    vec2 s = rippleOctave(p, fpx, 2.4, 0.3, 0.16, 0.0);
    s += rippleOctave(p, fpx, 1.1, 1.45, 0.16, 17.3);
    s += rippleOctave(p, fpx, 0.45, 2.6, 0.14, 41.7);
    s += rippleOctave(p, fpx, 0.2, -0.8, 0.12, 73.1);
    return s * uRipple;
  }
`;

// След: точки uTrail (x, z, возраст, скорость) записаны у форштевня, от новой к старой.
// Усы Кельвина расходятся под ~19.5°, за кормой — турбулентная полоса.
export const WAKE_GLSL = `
  float wakeFoam(vec2 p) {
    if (uTrailCount < 2 || distance(p, uWakeCenter) > 80.0) return 0.0;
    float n = vnoise(p * 1.4 + uTime * 0.15);
    float f = 0.0;
    for (int i = 0; i < ${WAKE_POINTS - 1}; i++) {
      if (i >= uTrailCount - 1) break;
      vec4 A = uTrail[i], B = uTrail[i + 1];
      vec2 ab = B.xy - A.xy;
      float l2 = dot(ab, ab);
      if (l2 < 1e-4) continue;
      // только поперечное расстояние в пределах сегмента — иначе на концах получаются кольца
      float t = dot(p - A.xy, ab) / l2;
      if (t < -0.02 || t > 1.02) continue;
      float d = abs(ab.x * (p.y - A.y) - ab.y * (p.x - A.x)) / sqrt(l2);
      t = clamp(t, 0.0, 1.0);
      float a = mix(A.z, B.z, t), s = mix(A.w, B.w, t);
      float sk = clamp(s / 3.0, 0.0, 1.0);
      // усы
      float w = 0.5 + s * a * 0.354;
      float arm = 1.0 - smoothstep(0.0, 0.22 + 0.09 * a, abs(d - w));
      arm *= (1.0 - smoothstep(4.0, 12.0, a)) * smoothstep(0.05 * a, 0.05 * a + 0.35, n);
      // турбулентная полоса за кормой
      float wash = 1.0 - smoothstep(0.0, 0.55 + 0.14 * a, d);
      wash *= smoothstep(2.0, 3.2, s * a) * (1.0 - smoothstep(1.5, 6.0, a)) * smoothstep(0.1 * a, 0.1 * a + 0.35, n);
      f = max(f, (arm * 0.9 + wash * 0.8) * sk);
    }
    return f;
  }
`;

// Отражение неба по Френелю: у горизонта вода берёт цвет неба, под ногами — свой.
// Диск солнца не отражаем: его даёт GLINT_GLSL. Нужен skyColor() из sky.js.
export const SKY_REFLECT_GLSL = `
  // uReflect — сила отражения (0 — выкл); uFresnelPow — показатель френеля (физически 5):
  // больше — синяя вода у лодки тянется дальше к горизонту
  uniform float uReflect; uniform float uFresnelPow;
  // отражение объектов (planar-reflection.js): текстура с предумноженной альфой, проекция
  // зеркальной камеры, сила (0 — выкл) и искажение волнами
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

// Блики солнца: мягкий отблеск на гранях + мерцающие искры.
export const GLINT_GLSL = `
  {
    vec3 nf = waterN;
    vec3 vd = normalize(cameraPosition - vWorldPos);
    float rl = max(dot(reflect(-vd, nf), normalize(uSunDir)), 0.0);
    // отблеск волн — пятнами, а не по всей поверхности сразу
    float sheen = pow(rl, 300.0) * 0.45 * smoothstep(0.45, 0.75, vnoise(vWorldPos.xz * 0.08 + uTime * 0.05));
    // искра — маленькая точка в случайном месте ячейки
    vec2 g = vWorldPos.xz * 1.6;
    vec2 cell = floor(g);
    float h = hash12(cell);
    vec2 c = vec2(hash12(cell + 17.0), hash12(cell + 31.0)) * 0.6 + 0.2;
    float dot_ = 1.0 - smoothstep(0.04, 0.1, length(fract(g) - c));
    float tw = max(0.0, sin(uTime * (3.0 + h * 6.0) + h * 40.0));
    float sparkle = step(0.75, h) * dot_ * tw * pow(rl, 16.0) * 3.0;
    outgoingLight += uSunColor * (sheen + sparkle) * (1.0 - waterFoam);
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

// Прибой и мелководье по карте берега (shore-map.js). Нужны vnoise, uTime, uWindDir.
// shoreInfo: x — расстояние до берега (м, плюс — вода), y — глубина (м), zw — нормаль от берега.
export const SURF_GLSL = `
  uniform sampler2D uShoreTex; uniform vec4 uShoreBounds; uniform float uShoreRange; uniform float uShoreDepth;
  // uSurf — сила прибоя (0 — выкл), uSurfAmp — сумма амплитуд волн (м), uShallows — сила цвета мелководья
  uniform float uSurf; uniform float uSurfAmp; uniform float uShallows; uniform vec3 uLagoon;
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
