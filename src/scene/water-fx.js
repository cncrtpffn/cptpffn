import { SHORE_DAMP } from './shore-map.js';

// GLSL-фрагменты: шум (небо, облака, прибой), гашение волн и прибой у берега (вода).

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
