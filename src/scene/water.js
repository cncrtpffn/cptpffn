import * as THREE from 'three';
import { MAX_COMP } from '../physics/waves.js';
import { NOISE_GLSL, SHORE_DAMP_GLSL, SURF_GLSL, WAKE_GLSL, SKY_REFLECT_GLSL, RIPPLE_GLSL, whitecapGlsl, whitecapForce } from './water-fx.js';
import { G } from '../config.js';
import { wrapPi } from '../physics/wind.js';
import { SKY_UNIFORMS_GLSL, SKY_COLOR_GLSL } from './sky.js';

// групп барашков в униформах (WHITECAP_GLSL); жизнь группы, с: сегменты зажигаются за 4 с и живут до 15 с
const WC_GROUPS = 32, WC_GROUP_LIFE = 20;

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

// Поле волн по пикселю — общее для ближней воды и дальнего кольца, в начале color_fragment (по нему же барашки).
// Аналитически по всем компонентам в точке параметризации vWaveP: короткие волны, которых нет в геометрии,
// видны в свете, а вдали, где геометрии волн нет вовсе, свет рисует их на плоскости. Компоненты, меняющиеся
// быстрее пикселя (k·fwidth > 1..3), гаснут — без ряби; у горизонта гаснут все. У берега гаснут по глубине.
// waveNd — наклон для нормали; waveHn — нормированная высота Σ a·sin θ / √Σ a² (гребень — барашки);
// waveS0, waveC0 — sin и cos фазы главной волны ветровой системы (uWhitecapComp), waveA0 — её доля в waveHn: по ним барашки.
const WAVE_FIELD_GLSL = `
  vec3 waveNd = vec3(0.0);
  float waveHn, waveS0 = 0.0, waveC0 = 0.0, waveA0 = 0.0, waveDamp = shoreDampAt(vWaveP);
  {
    float fw = length(fwidth(vWaveP));
    float h = 0.0, e = 0.0;
    for (int i = 0; i < ${MAX_COMP}; i++) {
      if (i >= uWaveCount) break;
      float a = uWaveA[i] * (1.0 - smoothstep(1.0, 3.0, uWaveK[i] * fw));
      if (a == 0.0) continue;
      float wa = uWaveK[i] * a;
      float th = uWaveK[i] * dot(uWaveDir[i], vWaveP) - uWavePhase[i];
      float s = sin(th), c = cos(th);
      if (i == uWhitecapComp) { waveS0 = s; waveC0 = c; waveA0 = a; }
      waveNd.xz += uWaveDir[i] * wa * c;
      waveNd.y += uWaveQ[i] * wa * s;
      h += a * s; e += a * a;
    }
    waveNd *= waveDamp;
    waveHn = e > 1e-8 ? h / sqrt(e) : 0.0;
    waveA0 = e > 1e-8 ? waveA0 / sqrt(e) : 0.0;
  }`;

// Нормаль по готовому полю волн (WAVE_FIELD_GLSL). Сверху — мелкая рябь (RIPPLE_GLSL) с долей rippleK:
// её объявляет шейдер (на пене ряби нет); у берега не гаснет. waterN — мировая нормаль, по ней же отражения.
const WAVE_NORMAL_GLSL = `
  vec3 waterN;
  {
    vec3 nd = waveNd;
    nd.xz += rippleSlope(vWaveP) * rippleK;
    waterN = normalize(vec3(-nd.x, 1.0 - nd.y, -nd.z));
    normal = normalize((viewMatrix * vec4(waterN, 0.0)).xyz);
  }`;

// Вода: один цвет, только рассеянный свет (Lambert, без бликов), без текстур (эксперимент, панель «Вода»).
// Отражения неба и объектов (SKY_REFLECT_GLSL, панель «Отражения») — по той же нормали по пикселю. У берегов — прибой и бирюза мелководья (SURF_GLSL, панель «Прибой»).
// Вершинный шейдер Герстнера с теми же параметрами, что в физике: лодка качается на тех же волнах,
// свет ложится по аналитическим нормалям, так что волны видны по затенению.
// shoreMap — из bakeShoreMap: по глубине волны гаснут у берега, по расстоянию до кромки — пена прибоя.
// Тень на воде своя (встроенная выключена): цвет и сила задаются отдельно, у отбрасывающего предмета
// тень плотная и чёткая, дальше от него — прозрачнее и мягче (PCSS по карте теней солнца).
// shadowCamera — камера тени солнца (ортографическая): её размеры переводят карту в метры.
// shadowTaps — выборок карты на каждый из двух проходов (поиск заслона и размытие).
// focus — шаг сетки в центре относительно равномерного (size / segments): у лодки сетка гуще,
// к краю реже, число вершин то же.
// wake — кильватерный след (wake.js): лента «кружевом» за кормой на ближней воде.
// sky — из createSky: его униформы палитры подключаются по ссылке; planar — из createPlanarReflection.
export function createWater(waves, { size = 440, segments = 176, focus = 0.35, shoreMap, shadowCamera, shadowTaps = 12, wake, sky, planar } = {}) {
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
    uWhitecap: { value: new THREE.Vector3() },
    uWhitecapComp: { value: 0 },
    uWhitecapEdge: { value: 0.25 },
    uWhitecapTrail: { value: 0 },
    uWcGroup: { value: Array.from({ length: WC_GROUPS }, () => new THREE.Vector4()) },
    uWcGroupN: { value: 0 },
    uWcNear: { value: new THREE.Vector3() },
    uWcDebug: { value: 0 },
  };
  // палитра неба и солнце — те же объекты, что у неба (uTime у воды свой)
  for (const k of ['uZenith', 'uHorizon', 'uAntiHorizon', 'uSunGlow', 'uBelt', 'uHalo', 'uSunDir', 'uSunColor']) uniforms[k] = sky.uniforms[k];
  // shadowFade — метров от предмета до воды, за которые тень слабеет в e раз;
  // shadowBlur — на сколько метров растёт радиус размытия на метр от предмета
  // wireframe — показать сетку волн (каркас того же материала); ripple — мелкая рябь, её сила растёт с ветром (выключена);
  // whitecaps — барашки на гребнях с умеренного ветра, whitecapAmount — множитель их силы,
  // whitecapGroups — подсветить их группы от точек срыва (отладка)
  const settings = { color: '#2f86b5', shadowColor: '#0b2a44', shadowStrength: 0.85, shadowFade: 10, shadowBlur: 0.08, wireframe: false,
    ripple: false, rippleStrength: 1, whitecaps: true, whitecapAmount: 1, whitecapGroups: false };
  // прибой у берегов и бирюза мелководья (панель «Прибой»)
  const surf = { enabled: true, strength: 1, shallows: true };
  // отражения (панель «Отражения»): небо по Френелю; объекты — вторым рендером (planar-reflection.js),
  // resolution — его доля разрешения; облака по умолчанию не отражаем: с френелем объектов они светятся у лодки
  const reflection = { sky: true, strength: 0.3, fresnel: 19, objects: true, objectStrength: 1, distort: 0.03, resolution: 0.5, clouds: false };

  const WAVE_UNIFORMS = `
    uniform vec2 uWaveDir[${MAX_COMP}]; uniform float uWaveA[${MAX_COMP}]; uniform float uWaveK[${MAX_COMP}];
    uniform float uWavePhase[${MAX_COMP}]; uniform float uWaveQ[${MAX_COMP}]; uniform int uWaveCount;
    varying vec2 vWaveP;`;
  // прибой: униформы карты берега даёт SHORE_DAMP_GLSL
  const SURF_PARS = `uniform float uTime; uniform vec2 uWindDir; ${NOISE_GLSL} ${SURF_GLSL} ${RIPPLE_GLSL} ${whitecapGlsl(WC_GROUPS)}`;
  const WAKE_PARS = `${WAKE_GLSL} uniform vec3 uWakeColor; uniform vec3 uWakeEdgeColor;`;
  const REFLECT_PARS = `uniform vec3 uSunDir; uniform vec3 uSunColor; ${SKY_UNIFORMS_GLSL} ${SKY_COLOR_GLSL} ${SKY_REFLECT_GLSL}`;
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
        ${WAVE_FIELD_GLSL}
        vec4 sh = shoreInfo(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLagoon, shallowMix(sh));
        float surfLines = 1.0 - smoothstep(uRadius * 0.6, uRadius * 0.9, length(vWaveP - uCenter));
        float waterFoam = surfFoam(vWaveP, sh, surfLines);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, waterFoam);
        // барашки цветами кильватера; гаснут там, где у берега гаснут волны: там пена — дело прибоя
        vec3 wc = whitecap(vWaveP, waveHn, waveS0, waveC0, waveA0) * smoothstep(0.7, 1.0, waveDamp);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeColor, wc.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeEdgeColor, wc.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, wc.z);
        waterFoam = max(waterFoam, wc.x);
        if (uWcDebug > 0.5) { vec4 wg = whitecapGroupsDebug(vWaveP); diffuseColor.rgb = mix(diffuseColor.rgb, wg.rgb, wg.a); }
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
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          outgoingLight = mix(outgoingLight, uShadowColor, waterShadow());
        #endif
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
        ${WAVE_UNIFORMS} ${SHORE_DAMP_GLSL} ${SURF_PARS} ${REFLECT_PARS} uniform vec3 uWakeColor; uniform vec3 uWakeEdgeColor;`)
      // мелководье и пена у кромки — как у ближней воды, без бурунов
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${WAVE_FIELD_GLSL}
        vec4 sh = shoreInfo(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLagoon, shallowMix(sh));
        float farFoam = surfFoam(vWaveP, sh, 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, farFoam);
        vec3 wc = whitecap(vWaveP, waveHn, waveS0, waveC0, waveA0) * smoothstep(0.7, 1.0, waveDamp);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeColor, wc.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeEdgeColor, wc.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, wc.z);
        farFoam = max(farFoam, wc.x);
        if (uWcDebug > 0.5) { vec4 wg = whitecapGroupsDebug(vWaveP); diffuseColor.rgb = mix(diffuseColor.rgb, wg.rgb, wg.a); }
        float rippleK = 1.0 - farFoam;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${WAVE_NORMAL_GLSL}`)
      // те же отражения, иначе на стыке с ближней водой видна граница яркости
      .replace('#include <opaque_fragment>', `
        outgoingLight = skyReflect(outgoingLight, waterN, vec3(vWaveP.x, -0.08, vWaveP.y), 1.0 - farFoam);
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

  // рябь: направление за ветровыми волнами (без скачка при рождении новой системы), сила за ветром с порывами
  const ripple = { ang: null, k: 0, time: 0 };
  function updateRipple(w, windDir) {
    const dt = Math.min(0.1, Math.max(0, w.time - ripple.time));
    ripple.time = w.time;
    const target = w.windSeaDir;
    const f = Math.min(1, Math.max(0.05, (Math.hypot(windDir.x, windDir.z) - 1) / 9));
    if (ripple.ang === null) { ripple.ang = target; ripple.k = f; }
    ripple.ang += wrapPi(target - ripple.ang) * (1 - Math.exp(-dt / 2));
    ripple.k += (f - ripple.k) * (1 - Math.exp(-dt / 0.5));
    // «откуда» → вектор «куда», как у компонент волн
    uniforms.uRippleDir.value.set(-Math.sin(ripple.ang), Math.cos(ripple.ang));
    uniforms.uRipple.value = settings.ripple ? settings.rippleStrength * ripple.k : 0;
  }

  // барашки: сила за ветром с порывами; шум полос едет вместе с гребнем главной волны текущей системы —
  // путь копится по шагам, иначе при смене длины волны рисунок прыгнул бы
  const caps = { k: null, off: 0, time: 0 };
  function updateWhitecaps(w, windDir) {
    const dt = Math.min(0.1, Math.max(0, w.time - caps.time));
    caps.time = w.time;
    const f = whitecapForce(Math.hypot(windDir.x, windDir.z));
    if (caps.k === null) caps.k = f;
    caps.k += (f - caps.k) * (1 - Math.exp(-dt / 1.5));
    const lambda = w.windSeaLambda;
    caps.off += Math.sqrt(G * lambda / (2 * Math.PI)) * dt;
    const k = settings.whitecaps ? Math.min(1, caps.k * settings.whitecapAmount) : 0;
    uniforms.uWhitecap.value.set(k, caps.off, 2 * Math.PI / lambda);
    uniforms.uWhitecapComp.value = w.windSeaComp;
    // шлейф — с сильного ветра: до 10.7 м/с (свежий) его нет, к 13 м/с полный (по ветру, без «Количества»)
    uniforms.uWhitecapTrail.value = THREE.MathUtils.smoothstep(caps.k, 0.57, 0.8);
    uploadGroups(w);
  }

  // Группы барашков рождаются в точках срыва гребней (crest-spray.js). Группа хранится в координатах гребня:
  // along — вдоль гребня, across — положение её гребня поперёк (минус пройденный гребнем путь), как точка гребня
  // в шейдере, — и едет вместе с гребнем. Дальше radius от камеры шейдер рисует прежние группы по шуму.
  const groups = [];
  const near = { x: 0, z: 0, r: 80 };
  const groupStats = { spawned: 0, merged: 0, get alive() { return groups.length; } };
  let lastW = null;
  function spawnGroup(x, z) {
    const w = lastW;
    if (!w || !caps.k) return;
    const c = w.windSeaComp, k = uniforms.uWhitecap.value.z;
    if (c >= w.count || !k) return;
    const d = uniforms.uRippleDir.value;
    // до гребня по ходу волн, м — как dc в шейдере
    const th = w.k[c] * (w.dirX[c] * x + w.dirZ[c] * z) - w.phase[c];
    let a = Math.atan2(Math.sin(th), Math.cos(th)) - Math.PI / 2;
    if (a < -Math.PI) a += 2 * Math.PI;
    const along = -d.y * x + d.x * z;
    const across = d.x * x + d.y * z - a / k - caps.off;
    const f = uniforms.uWhitecap.value.x;
    const radius = (12 + 18 * f) * (0.75 + 0.5 * Math.random());
    // группа — фрагмент одной волны: на этом же гребне уже есть группа рядом — новую не заводим, иначе они перекрываются и сегменты
    // на стыке перескакивают с возраста одной на возраст другой
    for (const g of groups) {
      if (Math.abs(g.across - across) * k / (2 * Math.PI) < 0.5 && Math.abs(g.along - along) < 0.8 * (g.radius + radius)) {
        groupStats.merged++;
        return;
      }
    }
    if (groups.length >= WC_GROUPS) groups.shift();
    groups.push({ along, across, t0: w.time, radius });
    groupStats.spawned++;
  }
  function uploadGroups(w) {
    lastW = w;
    const d = uniforms.uRippleDir.value, off = caps.off;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      // точка гребня группы в мире
      const gx = -d.y * g.along + d.x * (g.across + off), gz = d.x * g.along + d.y * (g.across + off);
      if (w.time - g.t0 > WC_GROUP_LIFE || Math.hypot(gx - near.x, gz - near.z) > near.r + g.radius + 20) groups.splice(i, 1);
    }
    const u = uniforms.uWcGroup.value;
    groups.forEach((g, i) => u[i].set(g.along, g.across, g.t0, g.radius));
    uniforms.uWcGroupN.value = groups.length;
    uniforms.uWcNear.value.set(near.x, near.z, near.r);
    uniforms.uWcDebug.value = settings.whitecapGroups ? 1 : 0;
  }
  const whitecapGroups = {
    spawn: spawnGroup,
    // круг вокруг камеры, где ищутся точки срыва: в нём группы от них, дальше — по шуму
    center(x, z, r) { near.x = x; near.z = z; near.r = r; },
    stats: groupStats,
    list: groups,
  };

  // windDir — вектор ветра {x, z}: наветренный берег пенится сильнее, рябь сильнее
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
    uniforms.uShadowStrength.value = settings.shadowStrength;
    uniforms.uShadowFade.value = settings.shadowFade;
    uniforms.uShadowBlur.value = settings.shadowBlur;
    uniforms.uTime.value = w.time;
    if (Math.hypot(windDir.x, windDir.z) > 0.01) uniforms.uWindDir.value.set(windDir.x, windDir.z).normalize();
    uniforms.uSurf.value = surf.enabled ? surf.strength : 0;
    uniforms.uShallows.value = surf.shallows ? 1 : 0;
    uniforms.uSurfAmp.value = w.maxAmplitude();
    updateRipple(w, windDir);
    updateWhitecaps(w, windDir);
    uniforms.uReflect.value = reflection.sky ? reflection.strength : 0;
    uniforms.uFresnelPow.value = reflection.fresnel;
    uniforms.uPlanar.value = reflection.objects ? reflection.objectStrength : 0;
    uniforms.uReflDistort.value = reflection.distort;
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
    // сильная пена: бурун за кормой, фронт барашков, прибой
    uniforms.uFoam.value.set(ws.foamColor);
  }

  return { mesh, far, update, edgeAt, uniforms, settings, surf, reflection, whitecapGroups };
}
