import * as THREE from 'three';
import { MAX_COMP } from '../physics/waves.js';
import { NOISE_GLSL, SHORE_DAMP_GLSL, SURF_GLSL, WAKE_GLSL, SKY_REFLECT_GLSL, RIPPLE_GLSL, SPARKLE_GLSL } from './water-fx.js';
import { wrapPi } from '../physics/wind.js';
import { SKY_UNIFORMS_GLSL, SKY_COLOR_GLSL } from './sky.js';

// Тень на воде по карте теней солнца (three r170: глубина упакована в RGBA, камера ортографическая —
// глубина линейна, (z воды − z заслона) · uShadowDepth = метры от предмета до воды).
// Два прохода по диску Фогеля, повёрнутому шумом по пикселю: поиск заслона (средняя глубина) и PCF
// с радиусом, растущим с расстоянием до него. Возвращает долю смешивания с цветом тени.
const WATER_SHADOW_GLSL = (taps) => `
  uniform vec3 uShadowColor; uniform float uShadowStrength; uniform float uShadowFade;
  uniform float uShadowBlur; uniform float uShadowSpan; uniform float uShadowDepth;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  vec2 vogel(int i, float rot) {
    float r = sqrt((float(i) + 0.5) / ${taps}.0);
    float a = float(i) * 2.39996323 + rot;
    return r * vec2(cos(a), sin(a));
  }
  float waterShadow() {
    // тень на воде выключена (галка «Тень на воде») — без выборок
    if (uShadowStrength <= 0.0) return 0.0;
    vec3 sc = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
    // к краю карты тень гаснет — без обрыва на границе
    float border = min(min(sc.x, sc.y), min(1.0 - sc.x, 1.0 - sc.y));
    if (border <= 0.0 || sc.z > 1.0) return 0.0;
    float zr = sc.z - 0.0005;
    float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    // поиск должен накрывать размытие от далёких предметов, иначе тень обрезается
    float search = max(1.5, 0.15 + uShadowBlur * 15.0) / uShadowSpan;
    float sum = 0.0, cnt = 0.0;
    for (int i = 0; i < ${taps}; i++) {
      float z = unpackRGBAToDepth(texture2D(directionalShadowMap[0], sc.xy + vogel(i, rot) * search));
      if (z < zr) { sum += z; cnt += 1.0; }
    }
    if (cnt == 0.0) return 0.0;
    float d = (sc.z - sum / cnt) * uShadowDepth;
    float radius = (0.15 + uShadowBlur * d) / uShadowSpan;
    float s = 0.0;
    for (int i = 0; i < ${taps}; i++) {
      float z = unpackRGBAToDepth(texture2D(directionalShadowMap[0], sc.xy + vogel(i, rot + 1.7) * radius));
      s += z < zr ? 1.0 : 0.0;
    }
    // shadowIntensity — ослабление тени облачностью (environment.js)
    return s / ${taps}.0 * uShadowStrength * exp(-d / uShadowFade)
      * directionalLightShadows[0].shadowIntensity * smoothstep(0.0, 0.08, border);
  }
  #endif
`;

// Нормаль волн по пикселю — общая для ближней воды и дальнего кольца. Аналитически по всем компонентам
// в точке параметризации vWaveP: короткие волны, которых нет в геометрии, видны в свете, а вдали, где
// геометрии волн нет вовсе, свет рисует их на плоскости. Компоненты, меняющиеся быстрее пикселя
// (k·fwidth > 1..3), гаснут — без ряби; у горизонта гаснут все. У берега гаснут по глубине.
// Сверху — мелкая рябь (RIPPLE_GLSL) с долей rippleK: её объявляет шейдер (на пене ряби нет); у берега не гаснет.
// Сила ряби rippleMod — по положению на волне (компоненты длиннее uRippleModMin): на гребне и наветренном
// склоне сильнее (uRippleHigh), в ложбине и на подветренном — слабее (uRippleLow); uRippleModH — доля высоты
// против склона. Высота и склон нормированы суммой амплитуд, так что у берега и вдали не зависят от гашения.
// waterN — мировая нормаль, по ней же отражения.
const WAVE_NORMAL_GLSL = `
  vec3 waterN;
  float rippleMod;
  {
    float fw = length(fwidth(vWaveP));
    vec3 nd = vec3(0.0);
    float hs = 0.0, asum = 0.0, ak = 0.0; vec2 gs = vec2(0.0);
    float kMod = 6.2831853 / max(uRippleModMin, 1e-3);
    for (int i = 0; i < ${MAX_COMP}; i++) {
      if (i >= uWaveCount) break;
      float fade = 1.0 - smoothstep(1.0, 3.0, uWaveK[i] * fw);
      float wa = uWaveK[i] * uWaveA[i] * fade;
      if (wa == 0.0) continue;
      float th = uWaveK[i] * dot(uWaveDir[i], vWaveP) - uWavePhase[i];
      float c = cos(th), s = sin(th);
      nd.xz += uWaveDir[i] * wa * c;
      nd.y += uWaveQ[i] * wa * s;
      if (uWaveK[i] <= kMod) {
        float a = uWaveA[i] * fade;
        hs += a * s; asum += a;
        gs += uWaveDir[i] * wa * c; ak += wa;
      }
    }
    nd *= shoreDampAt(vWaveP);
    float hn = asum > 1e-5 ? hs / asum : 0.0;
    float sn = ak > 1e-5 ? dot(gs, uRippleDir) / ak : 0.0;
    float rt = clamp(0.5 + 0.5 * (uRippleModH * hn + (1.0 - uRippleModH) * sn), 0.0, 1.0);
    rippleMod = mix(uRippleLow, uRippleHigh, smoothstep(0.0, 1.0, rt));
    nd.xz += rippleSlope(vWaveP) * rippleK * rippleMod;
    waterN = normalize(vec3(-nd.x, 1.0 - nd.y, -nd.z));
    normal = normalize((viewMatrix * vec4(waterN, 0.0)).xyz);
  }`;

// Отладка: линии гребней и дна ложбин (галка «Гребни и ложбины» в панели «Вода»). По тем же компонентам,
// что нормаль (короткие, мельче пикселя, гаснут), в точке параметризации — гребень Герстнера, смещённый
// по горизонтали, получается сам. Гессиан высоты H и градиент g; e — главное направление кривизны
// (собственный вектор H с наибольшим |λ|). Линия — где g·e = 0: λ < 0 — гребень, λ > 0 — ложбина.
// Расстояние до линии в метрах |g·e| / |λ| — без fwidth от e (знак e скачет между пикселями).
// Компоненты короче uRidgeMin (м) не учитываются, иначе мелкие волны дробят линии; слабая кривизна
// (пологие места на стыке систем) отсекается порогом от средней кривизны поля.
// Штрихи по наветренному склону — цветом гребня, через uRidgeHatch метров (0 — нет): прямые по направлению
// ветровых волн uRippleDir (RIPPLE_GLSL), т. е. поперёк гребня, пока гребень поперёк ветрового волнения.
// Наветренный склон — где вода поднимается по ходу волн (g·dir > 0): от дна ложбины до гребня.
const RIDGE_GLSL = `
  uniform float uRidges; uniform float uRidgeWidth; uniform float uRidgeMin; uniform float uRidgeHatch;
  uniform vec3 uCrestColor; uniform vec3 uTroughColor;
  vec3 ridgeOverlay(vec3 col, vec2 p) {
    if (uRidges <= 0.0) return col;
    float fpx = max(length(fwidth(p)), 1e-4);
    vec2 g = vec2(0.0); vec3 h = vec3(0.0); float kk = 0.0, gk = 0.0; // h = (Hxx, Hxy, Hzz)
    for (int i = 0; i < ${MAX_COMP}; i++) {
      if (i >= uWaveCount) break;
      if (uWaveK[i] * uRidgeMin > 6.2831853) continue;
      float a = uWaveA[i] * (1.0 - smoothstep(1.0, 3.0, uWaveK[i] * fpx));
      if (a == 0.0) continue;
      vec2 d = uWaveDir[i];
      float th = uWaveK[i] * dot(d, p) - uWavePhase[i];
      g += d * a * uWaveK[i] * cos(th);
      gk += a * uWaveK[i];
      float c2 = -a * uWaveK[i] * uWaveK[i];
      h += c2 * sin(th) * vec3(d.x * d.x, d.x * d.y, d.y * d.y);
      kk += -c2;
    }
    float m = 0.5 * (h.x + h.z), r = length(vec2(0.5 * (h.x - h.z), h.y));
    float lam = m < 0.0 ? m - r : m + r;
    vec2 e1 = vec2(h.y, lam - h.x), e2 = vec2(lam - h.z, h.y);
    vec2 e = dot(e1, e1) > dot(e2, e2) ? e1 : e2;
    if (uRidgeHatch > 0.0 && gk > 0.0) {
      vec2 tang = vec2(-uRippleDir.y, uRippleDir.x);
      float hd = abs(fract(dot(p, tang) / uRidgeHatch + 0.5) - 0.5) * uRidgeHatch;
      float hatch = 1.0 - smoothstep(0.5 * uRidgeWidth, 0.5 * uRidgeWidth + 1.0, hd / fpx);
      hatch *= smoothstep(0.05, 0.15, dot(g, uRippleDir) / gk);
      col = mix(col, uCrestColor, hatch * uRidges);
    }
    if (dot(e, e) < 1e-12 || kk <= 0.0) return col;
    e = normalize(e);
    float dist = abs(dot(g, e)) / max(abs(lam), 1e-6);
    float line = 1.0 - smoothstep(0.5 * uRidgeWidth, 0.5 * uRidgeWidth + 1.0, dist / fpx);
    line *= smoothstep(0.15, 0.35, abs(lam) / kk);
    return mix(col, lam < 0.0 ? uCrestColor : uTroughColor, line * uRidges);
  }`;

// Вода: один цвет, только рассеянный свет (Lambert, без бликов), без текстур (эксперимент, панель «Вода»).
// Отражения неба и объектов (SKY_REFLECT_GLSL, панель «Отражения») — по той же нормали по пикселю. У берегов — прибой и бирюза мелководья (SURF_GLSL, панель «Прибой»).
// Вершинный шейдер Герстнера с теми же параметрами, что в физике: лодка качается на тех же волнах,
// свет ложится по аналитическим нормалям, так что волны видны по затенению.
// shoreMap — из bakeShoreMap: по глубине волны гаснут у берега, по расстоянию до кромки — пена прибоя.
// Тень на воде своя (встроенная выключена): цвет и сила задаются отдельно, у отбрасывающего предмета
// тень плотная и чёткая, дальше от него — прозрачнее и мягче (PCSS по карте теней солнца).
// shadowCamera — камера тени солнца (ортографическая): её размеры переводят карту в метры.
// shadowTaps — выборок карты на каждый из двух проходов (поиск заслона и размытие); тень — самое дорогое в воде
// (~0.12 мс на выборку за проход на M4 при DPR 2), 8 вместо 12 — край размытия чуть зернистее, docs/changes/perf-audit-water.
// focus — шаг сетки в центре относительно равномерного (size / segments): у лодки сетка гуще,
// к краю реже, число вершин то же.
// wake — кильватерный след (wake.js): лента «кружевом» за кормой на ближней воде.
// sky — из createSky: его униформы палитры подключаются по ссылке; planar — из createPlanarReflection.
export function createWater(waves, { size = 440, segments = 176, focus = 0.35, shoreMap, shadowCamera, shadowTaps = 8, wake, sky, planar } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const cell = size / segments;
  // Квадратные кольца сетки раздвигаются по h(m) = focus·m + (1 − focus)·m³, m — доля полуразмера
  // (по максимуму |x|, |z|, край остаётся квадратом). aCell — местный шаг сетки, cell·h'(m):
  // по нему шейдер убирает из геометрии волны, которые эта сетка не передаст.
  const half = size / 2, pos = geo.attributes.position;
  const aCell = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const m = Math.max(Math.abs(x), Math.abs(z)) / half;
    const s = focus + (1 - focus) * m * m; // h(m) / m
    pos.setXYZ(i, x * s, 0, z * s);
    aCell[i] = cell * (focus + 3 * (1 - focus) * m * m);
  }
  geo.setAttribute('aCell', new THREE.BufferAttribute(aCell, 1));
  // сетка едет за лодкой шагом центральной ячейки: вблизи вершины не «плывут» по волне
  const step = cell * focus;

  const uniforms = {
    uWaveDir: { value: Array.from({ length: MAX_COMP }, () => new THREE.Vector2()) },
    uWaveA: { value: new Float32Array(MAX_COMP) },
    uWaveK: { value: new Float32Array(MAX_COMP) },
    uWavePhase: { value: new Float32Array(MAX_COMP) },
    uWaveQ: { value: new Float32Array(MAX_COMP) },
    uWaveCount: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: size * 0.5 },
    uShoreTex: { value: shoreMap.texture },
    uShoreBounds: { value: shoreMap.bounds },
    uShoreDepth: { value: shoreMap.maxDepth },
    uShoreRange: { value: shoreMap.range },
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0, 1) },
    uSurf: { value: 1 },
    uSurfAmp: { value: 0.3 },
    uShallows: { value: 1 },
    uLagoon: { value: new THREE.Color(0x3fc4c0) },
    uFoam: { value: new THREE.Color(0xf4fbff) },
    uShadowColor: { value: new THREE.Color() },
    uShadowStrength: { value: 0 },
    uShadowFade: { value: 1 },
    uShadowBlur: { value: 0 },
    uShadowSpan: { value: shadowCamera.right - shadowCamera.left },
    uShadowDepth: { value: shadowCamera.far - shadowCamera.near },
    uWakeA: { value: wake.a },
    uWakeB: { value: wake.b },
    uWakeG: { value: wake.groups },
    uWakeCap: { value: wake.caps },
    uWakeCount: { value: 0 },
    uWakeIn: { value: wake.inner },
    uWakeHullN: { value: 0 },
    uWakeSeg: { value: 0 },
    uWakeTail: { value: wake.tail },
    uWakeBox: { value: wake.box },
    uWakeW: { value: new THREE.Vector2() },
    uWakeEdge: { value: 0 },
    uWakeRim: { value: 0 },
    uWakeOn: { value: 1 },
    uWakeLace: { value: 1 },
    uWakeColor: { value: new THREE.Color() },
    uWakeEdgeColor: { value: new THREE.Color() },
    uReflect: { value: 0 },
    uFresnelPow: { value: 19 },
    uReflTex: { value: planar.texture },
    uReflMatrix: { value: planar.matrix },
    uPlanar: { value: 0 },
    uReflDistort: { value: 0 },
    uRipple: { value: 0 },
    uRippleDir: { value: new THREE.Vector2(0, 1) },
    uRippleLow: { value: 1 },
    uRippleHigh: { value: 1 },
    uRippleModH: { value: 0.5 },
    uRippleModMin: { value: 4 },
    uRippleShow: { value: 0 },
    uRippleShowRange: { value: new THREE.Vector2(0.3, 1.5) },
    uSparkle: { value: 0 },
    uSparkleCount: { value: 0.25 },
    uPath: { value: 0 },
    uGlitterSlope: { value: 0.05 },
    uRidges: { value: 0 },
    uRidgeWidth: { value: 2 },
    uRidgeMin: { value: 0 },
    uRidgeHatch: { value: 0 },
    uCrestColor: { value: new THREE.Color() },
    uTroughColor: { value: new THREE.Color() },
  };
  // палитра неба и солнце — те же объекты, что у неба (uTime у воды свой)
  for (const k of ['uZenith', 'uHorizon', 'uAntiHorizon', 'uSunGlow', 'uBelt', 'uHalo', 'uSunDir', 'uSunColor', 'uMoonDir', 'uMoonGlint', 'uSunPathK', 'uMoonPathK']) uniforms[k] = sky.uniforms[k];
  // shadow — тень на воде (выкл — шейдер её не считает, тени на лодке и суше остаются);
  // shadowFade — метров от предмета до воды, за которые тень слабеет в e раз;
  // shadowBlur — на сколько метров растёт радиус размытия на метр от предмета
  // wireframe — показать сетку волн (каркас того же материала); ripple — мелкая рябь, её сила растёт с ветром;
  // rippleLow / rippleHigh — множитель ряби в ложбине и на подветренном склоне / на гребне и наветренном,
  // rippleModH — доля высоты против склона (1 — только высота), rippleModMin — волны короче (м) не учитываются,
  // контраст полный до rippleContrastFrom (м/с, лёгкий бриз), дальше убывает до доли rippleContrastStorm при rippleContrastTo;
  // rippleCalmPow — степень роста силы ряби до 10 м/с; rippleStormGain — сила при rippleStormWind (м/с)
  // относительно 10 м/с, rippleStormExp — крутизна экспоненты между ними;
  // rippleShow — отладка: множитель цветом (синий — rippleLow, красный — rippleHigh);
  // ridges — отладочные линии гребней и дна ложбин (RIDGE_GLSL): ridgeWidth в пикселях, ridgeMin — минимальная длина волны, м;
  // ridgeHatch — штрихи поперёк гребня по наветренному склону, ridgeHatchStep — шаг штрихов, м
  const settings = { color: '#2f86b5', shadow: true, shadowColor: '#0b2a44', shadowStrength: 0.85, shadowFade: 10, shadowBlur: 0.08, wireframe: false,
    ripple: true, rippleStrength: 1, rippleLow: 0, rippleHigh: 1.5, rippleModH: 0.5, rippleModMin: 4,
    rippleContrastFrom: 3.3, rippleContrastTo: 19, rippleContrastStorm: 0.5, rippleCalmPow: 1.5, rippleStormGain: 2.5, rippleStormExp: 1.5, rippleStormWind: 19, rippleShow: false,
    ridges: false, ridgeWidth: 2, ridgeMin: 3, ridgeHatch: true, ridgeHatchStep: 10, crestColor: '#ffd400', troughColor: '#ff2bd6' };
  // прибой у берегов и бирюза мелководья (панель «Прибой»)
  const surf = { enabled: true, strength: 1, shallows: true };
  // отражения (панель «Отражения»): небо по Френелю; объекты — вторым рендером (planar-reflection.js),
  // resolution — его доля разрешения; облака по умолчанию не отражаем: с френелем объектов они светятся у лодки;
  // sparkles — мерцающие искры солнца на дорожке (SPARKLE_GLSL). Сила по ветру линейно от sparkleCalmStrength
  // в штиль до sparkleStormStrength при sparkleStormWind (м/с), дальше не растёт. Количество: до sparkleCalm (м/с,
  // верх «умеренного») четверть ячеек, дальше растёт на sparkleGrowth (доля) за каждый м/с
  const reflection = { sky: true, strength: 0.3, fresnel: 19, objects: true, objectStrength: 1, distort: 0.03, resolution: 0.5, clouds: false,
    // path — дорожка из искр у низкого солнца и луны: сила, ширина — множитель разброса наклона граней
    path: true, pathStrength: 3, pathWidth: 1,
    sparkles: true, sparkleCalmStrength: 0.1, sparkleStormStrength: 3, sparkleStormWind: 19, sparkleCalm: 8, sparkleGrowth: 0.03 };

  const WAVE_UNIFORMS = `
    uniform vec2 uWaveDir[${MAX_COMP}]; uniform float uWaveA[${MAX_COMP}]; uniform float uWaveK[${MAX_COMP}];
    uniform float uWavePhase[${MAX_COMP}]; uniform float uWaveQ[${MAX_COMP}]; uniform int uWaveCount;
    varying vec2 vWaveP;`;
  // прибой: униформы карты берега даёт SHORE_DAMP_GLSL
  const SURF_PARS = `uniform float uTime; uniform vec2 uWindDir; ${NOISE_GLSL} ${SURF_GLSL} ${RIPPLE_GLSL}`;
  const WAKE_PARS = `${WAKE_GLSL} uniform vec3 uWakeColor; uniform vec3 uWakeEdgeColor;`;
  const REFLECT_PARS = `uniform vec3 uSunDir; uniform vec3 uSunColor; ${SKY_UNIFORMS_GLSL} ${SKY_COLOR_GLSL} ${SKY_REFLECT_GLSL} ${SPARKLE_GLSL} ${RIDGE_GLSL}`;
  const mat = new THREE.MeshLambertMaterial({ color: settings.color });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${WAVE_UNIFORMS} uniform vec2 uCenter; uniform float uRadius; attribute float aCell;
        varying vec3 vWaterPos;
        ${SHORE_DAMP_GLSL}`)
      // beginnormal_vertex идёт раньше begin_vertex: здесь и смещение, и аналитическая нормаль
      .replace('#include <beginnormal_vertex>', `
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        float edge = 1.0 - smoothstep(uRadius * 0.72, uRadius * 0.98, length(wp.xz - uCenter));
        // у берега волны затухают по глубине (как waves.damp на CPU): не выходят пластами на пляж
        edge *= shoreDampAt(wp.xz);
        vec3 disp = vec3(0.0); vec3 nd = vec3(0.0);
        for (int i = 0; i < ${MAX_COMP}; i++) {
          if (i >= uWaveCount) break;
          float th = uWaveK[i] * dot(uWaveDir[i], wp.xz) - uWavePhase[i];
          float c = cos(th), s = sin(th);
          // волны короче ~2 местных ячеек сетка не передаёт (Найквист: λ = 2·шаг) — вершины ловят их
          // вразнобой и гребень зубчатый. В геометрии они гаснут, в свете остаются (нормаль по пикселю)
          float a = uWaveA[i] * (1.0 - smoothstep(0.5, 1.0, uWaveK[i] * aCell / 3.14159265));
          float wa = uWaveK[i] * a;
          disp.xz += uWaveQ[i] * a * uWaveDir[i] * c;
          disp.y += a * s;
          nd.xz += uWaveDir[i] * wa * c;
          nd.y += uWaveQ[i] * wa * s;
        }
        // сетка только сдвигается, так что нормаль в объекте = мировая
        vec3 objectNormal = normalize(vec3(-nd.x * edge, 1.0 - nd.y * edge, -nd.z * edge));
        vWaveP = wp.xz;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position) + disp * edge;
        vWaterPos = wp + disp * edge;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${WAVE_UNIFORMS} uniform vec2 uCenter; uniform float uRadius; varying vec3 vWaterPos;
        ${SHORE_DAMP_GLSL} ${SURF_PARS} ${WAKE_PARS} ${REFLECT_PARS}`)
      // мелководье и пена прибоя; буруны гаснут к краю ближней воды — за ним дальняя вода рисует только кромку
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 sh = shoreInfo(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLagoon, shallowMix(sh));
        float surfLines = 1.0 - smoothstep(uRadius * 0.6, uRadius * 0.9, length(vWaveP - uCenter));
        float waterFoam = surfFoam(vWaveP, sh, surfLines);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, waterFoam);
        // кильватер: светлая лента с контуром перемычек, у кормы — белый бурун
        vec4 wk = wakeMask(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeColor, wk.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeEdgeColor, wk.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, wk.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.25, 0.3), wk.w);
        // на пене и следе нет ни отражений, ни ряби
        waterFoam = clamp(max(waterFoam, max(wk.x, max(wk.y, wk.z))), 0.0, 1.0);
        float rippleK = 1.0 - waterFoam;`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
        ${WATER_SHADOW_GLSL(shadowTaps)}`)
      // нормаль по пикселю, а не по вершинам: сетка короче коротких компонент не передаёт,
      // интерполяция давала грани. Точка параметризации интерполируется линейно — для света хватает.
      // К краю сетки гаснет только смещение, свет волн продолжается в дальнем кольце без шва
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${WAVE_NORMAL_GLSL}`)
      // отражения — до тени: тень на воде остаётся читаемой
      .replace('#include <opaque_fragment>', `
        outgoingLight = skyReflect(outgoingLight, waterN, vWaterPos, 1.0 - waterFoam);
        outgoingLight += sparkle(waterN, vWaterPos, 1.0 - waterFoam);
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          outgoingLight = mix(outgoingLight, uShadowColor, waterShadow());
        #endif
        // отладка — поверх света и тени, чтобы линии читались
        outgoingLight = rippleModOverlay(outgoingLight, rippleMod * rippleK);
        outgoingLight = ridgeOverlay(outgoingLight, vWaveP);
        #include <opaque_fragment>`);
  };
  // чтобы кэш шейдера различал материал с инъекцией
  mat.customProgramCacheKey = () => `cozy-water-${shadowTaps}`;

  const mesh = new THREE.Mesh(geo, mat);
  // встроенную тень не берём: её считает waterShadow()
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  // после остальной непрозрачной сцены: крышка кокпита лодки (renderOrder 1) уже записала глубину
  mesh.renderOrder = 2;
  // «дырка» внутри открытых лодок: их крышка по ватерлинии (waterline.js) пишет 1 в стенсил — там воды нет
  Object.assign(mat, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });

  // Дальняя вода — плоское кольцо до горизонта, растворяется в тумане. Кольцо с дырой под ближней
  // водой: сплошная плоскость торчала бы из ложбин волн плоским полигоном. Волны здесь только в свете
  // (та же нормаль по пикселю): издали силуэт волн не виден, а затенение — да, и геометрия не нужна.
  const farMat = new THREE.MeshLambertMaterial({ color: settings.color });
  farMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec2 vWaveP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWaveP = (modelMatrix * vec4(position, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${WAVE_UNIFORMS} ${SHORE_DAMP_GLSL} ${SURF_PARS} ${REFLECT_PARS}`)
      // мелководье и пена у кромки — как у ближней воды, без бурунов
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 sh = shoreInfo(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLagoon, shallowMix(sh));
        float farFoam = surfFoam(vWaveP, sh, 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, farFoam);
        float rippleK = 1.0 - farFoam;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${WAVE_NORMAL_GLSL}`)
      // те же отражения, иначе на стыке с ближней водой видна граница яркости
      .replace('#include <opaque_fragment>', `
        outgoingLight = skyReflect(outgoingLight, waterN, vec3(vWaveP.x, -0.08, vWaveP.y), 1.0 - farFoam);
        outgoingLight += sparkle(waterN, vec3(vWaveP.x, -0.08, vWaveP.y), 1.0 - farFoam);
        outgoingLight = rippleModOverlay(outgoingLight, rippleMod * rippleK);
        outgoingLight = ridgeOverlay(outgoingLight, vWaveP);
        #include <opaque_fragment>`);
  };
  farMat.customProgramCacheKey = () => 'cozy-water-far';
  const far = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.5 * 0.97, 3000, 64, 1).rotateX(-Math.PI / 2),
    farMat,
  );
  far.position.y = -0.08;
  far.receiveShadow = false;
  // как у ближней воды — после масок открытых лодок (renderOrder 1): вода внутри них не проходит тест глубины
  far.renderOrder = 2;

  // доля волны, которую показывает ближняя вода в точке (x, z): к краю сетки смещение гаснет (как edge в шейдере,
  // без затухания у берега — его даёт waves.damp). Что плавает далеко от лодки, садится на heightAt × edgeAt,
  // иначе в ложбинах тонет под плоским дальним кольцом
  function edgeAt(x, z) {
    const r = uniforms.uRadius.value, d = Math.hypot(x - uniforms.uCenter.value.x, z - uniforms.uCenter.value.y);
    const t = Math.min(1, Math.max(0, (d - r * 0.72) / (r * 0.26)));
    return 1 - t * t * (3 - 2 * t);
  }

  // рябь: направление за ветровыми волнами (без скачка при рождении новой системы), сила за ветром с порывами.
  // Сила: от 1 до 10 м/с растёт до 1 по ((v − 1)/9)^rippleCalmPow (в слабый ветер рябь едва видна), дальше
  // по экспоненте (e^(a·x) − 1)/(e^a − 1), a = rippleStormExp, до rippleStormGain при rippleStormWind, выше не растёт.
  // Контраст гребень/ложбина — по ветру, сглаженному τ = 2 с (порыв не мигает пятнами): полный в штиль и лёгкий
  // бриз (до rippleContrastFrom: гладкие ложбины, рябь на гребнях), дальше линейно до доли rippleContrastStorm
  // при rippleContrastTo; low/high тянутся к 1 (ровная рябь) пропорционально
  const ripple = { ang: null, k: 0, wind: 0, time: 0 };
  function updateRipple(w, windDir) {
    const dt = Math.min(0.1, Math.max(0, w.time - ripple.time));
    ripple.time = w.time;
    const target = w.windSeaDir;
    const v = Math.hypot(windDir.x, windDir.z);
    const storm = Math.max(10.01, settings.rippleStormWind);
    const a = Math.max(0.01, settings.rippleStormExp);
    const f = v <= 10 ? Math.max(0.02, Math.pow(Math.max(0, (v - 1) / 9), settings.rippleCalmPow))
      : 1 + (settings.rippleStormGain - 1) * Math.expm1(a * Math.min(1, (v - 10) / (storm - 10))) / Math.expm1(a);
    if (ripple.ang === null) { ripple.ang = target; ripple.k = f; ripple.wind = v; }
    ripple.ang += wrapPi(target - ripple.ang) * (1 - Math.exp(-dt / 2));
    ripple.k += (f - ripple.k) * (1 - Math.exp(-dt / 0.5));
    ripple.wind += (v - ripple.wind) * (1 - Math.exp(-dt / 2));
    const from = settings.rippleContrastFrom, to = Math.max(from + 0.1, settings.rippleContrastTo);
    const c = 1 - (1 - settings.rippleContrastStorm) * Math.min(1, Math.max(0, (ripple.wind - from) / (to - from)));
    // «откуда» → вектор «куда», как у компонент волн
    uniforms.uRippleDir.value.set(-Math.sin(ripple.ang), Math.cos(ripple.ang));
    uniforms.uRipple.value = settings.ripple ? settings.rippleStrength * ripple.k : 0;
    uniforms.uRippleLow.value = 1 + (settings.rippleLow - 1) * c;
    uniforms.uRippleHigh.value = 1 + (settings.rippleHigh - 1) * c;
    uniforms.uRippleShowRange.value.set(settings.rippleLow, settings.rippleHigh);
    uniforms.uRippleModH.value = settings.rippleModH;
    uniforms.uRippleModMin.value = settings.rippleModMin;
    uniforms.uRippleShow.value = settings.rippleShow ? 1 : 0;
  }

  // искры: сила и количество от ветра; ветер сглажен — порыв не мигает всей дорожкой
  const sparkleWind = { v: null, time: 0 };
  function updateSparkle(w, windDir) {
    const dt = Math.min(0.1, Math.max(0, w.time - sparkleWind.time));
    sparkleWind.time = w.time;
    const v = Math.hypot(windDir.x, windDir.z), R = reflection;
    sparkleWind.v = sparkleWind.v === null ? v : sparkleWind.v + (v - sparkleWind.v) * (1 - Math.exp(-dt / 2));
    const t = Math.min(1, sparkleWind.v / Math.max(0.1, R.sparkleStormWind));
    uniforms.uSparkle.value = R.sparkles ? R.sparkleCalmStrength + (R.sparkleStormStrength - R.sparkleCalmStrength) * t : 0;
    uniforms.uPath.value = R.path ? R.pathStrength : 0;
    // разброс наклона граней дорожки: шире с ветром
    uniforms.uGlitterSlope.value = Math.max(0.005, R.pathWidth * (0.03 + 0.004 * sparkleWind.v));
    uniforms.uSparkleCount.value = Math.min(1, 0.25 * (1 + R.sparkleGrowth * Math.max(0, sparkleWind.v - R.sparkleCalm)));
  }

  // windDir — вектор ветра {x, z}: наветренный берег пенится сильнее, рябь сильнее, искр больше
  function update(w, cx, cz, windDir) {
    const sx = Math.round(cx / step) * step, sz = Math.round(cz / step) * step;
    mesh.position.set(sx, 0, sz);
    far.position.set(sx, -0.08, sz);
    uniforms.uCenter.value.set(sx, sz);
    uniforms.uWaveCount.value = w.count;
    for (let i = 0; i < MAX_COMP; i++) {
      uniforms.uWaveDir.value[i].set(w.dirX[i], w.dirZ[i]);
      uniforms.uWaveA.value[i] = w.amp[i];
      uniforms.uWaveK.value[i] = w.k[i];
      uniforms.uWavePhase.value[i] = w.phase[i];
      uniforms.uWaveQ.value[i] = w.q[i];
    }
    mat.color.set(settings.color); farMat.color.copy(mat.color);
    mat.wireframe = settings.wireframe;
    uniforms.uShadowColor.value.set(settings.shadowColor);
    uniforms.uShadowStrength.value = settings.shadow ? settings.shadowStrength : 0;
    uniforms.uShadowFade.value = settings.shadowFade;
    uniforms.uShadowBlur.value = settings.shadowBlur;
    uniforms.uTime.value = w.time;
    if (Math.hypot(windDir.x, windDir.z) > 0.01) uniforms.uWindDir.value.set(windDir.x, windDir.z).normalize();
    uniforms.uSurf.value = surf.enabled ? surf.strength : 0;
    uniforms.uShallows.value = surf.shallows ? 1 : 0;
    uniforms.uSurfAmp.value = w.maxAmplitude();
    updateRipple(w, windDir);
    uniforms.uRidges.value = settings.ridges ? 1 : 0;
    uniforms.uRidgeWidth.value = settings.ridgeWidth;
    uniforms.uRidgeMin.value = settings.ridgeMin;
    uniforms.uRidgeHatch.value = settings.ridgeHatch ? settings.ridgeHatchStep : 0;
    uniforms.uCrestColor.value.set(settings.crestColor);
    uniforms.uTroughColor.value.set(settings.troughColor);
    uniforms.uReflect.value = reflection.sky ? reflection.strength : 0;
    uniforms.uFresnelPow.value = reflection.fresnel;
    uniforms.uPlanar.value = reflection.objects ? reflection.objectStrength : 0;
    uniforms.uReflDistort.value = reflection.distort;
    updateSparkle(w, windDir);
    const ws = wake.settings;
    uniforms.uWakeOn.value = ws.enabled ? 1 : 0;
    uniforms.uWakeLace.value = ws.lace ? 1 : 0;
    uniforms.uWakeCount.value = wake.count;
    uniforms.uWakeHullN.value = wake.hullCount;
    uniforms.uWakeSeg.value = ws.segments ? 1 : 0;
    uniforms.uWakeW.value.set(ws.life, ws.holes);
    uniforms.uWakeEdge.value = ws.edge;
    uniforms.uWakeRim.value = ws.rim;
    uniforms.uWakeColor.value.set(ws.color);
    uniforms.uWakeEdgeColor.value.set(ws.edgeColor);
  }

  return { mesh, far, update, edgeAt, uniforms, settings, surf, reflection };
}
