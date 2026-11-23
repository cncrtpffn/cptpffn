import * as THREE from 'three';
import { MAX_COMP } from '../physics/waves.js';
import { NOISE_GLSL, SHORE_DAMP_GLSL, SURF_GLSL, WAKE_GLSL } from './water-fx.js';

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

// Нормаль волн по пикселю — общая для ближней воды и дальнего кольца. Аналитически по всем компонентам
// в точке параметризации vWaveP: короткие волны, которых нет в геометрии, видны в свете, а вдали, где
// геометрии волн нет вовсе, свет рисует их на плоскости. Компоненты, меняющиеся быстрее пикселя
// (k·fwidth > 1..3), гаснут — без ряби; у горизонта гаснут все. У берега гаснут по глубине.
const WAVE_NORMAL_GLSL = `
  {
    float fw = length(fwidth(vWaveP));
    vec3 nd = vec3(0.0);
    for (int i = 0; i < ${MAX_COMP}; i++) {
      if (i >= uWaveCount) break;
      float wa = uWaveK[i] * uWaveA[i] * (1.0 - smoothstep(1.0, 3.0, uWaveK[i] * fw));
      if (wa == 0.0) continue;
      float th = uWaveK[i] * dot(uWaveDir[i], vWaveP) - uWavePhase[i];
      nd.xz += uWaveDir[i] * wa * cos(th);
      nd.y += uWaveQ[i] * wa * sin(th);
    }
    nd *= shoreDampAt(vWaveP);
    normal = normalize((viewMatrix * vec4(-nd.x, 1.0 - nd.y, -nd.z, 0.0)).xyz);
  }`;

// Вода: один цвет, только рассеянный свет (Lambert, без бликов), без текстур и отражений
// (эксперимент, панель «Вода»). У берегов — прибой и бирюза мелководья (SURF_GLSL, панель «Прибой»).
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
export function createWater(waves, { size = 440, segments = 176, focus = 0.35, shoreMap, shadowCamera, shadowTaps = 12, wake } = {}) {
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
  };
  // shadowFade — метров от предмета до воды, за которые тень слабеет в e раз;
  // shadowBlur — на сколько метров растёт радиус размытия на метр от предмета
  // wireframe — показать сетку волн (каркас того же материала)
  const settings = { color: '#2f86b5', shadowColor: '#0b2a44', shadowStrength: 0.85, shadowFade: 10, shadowBlur: 0.08, wireframe: false };
  // прибой у берегов и бирюза мелководья (панель «Прибой»)
  const surf = { enabled: true, strength: 1, shallows: true };

  const WAVE_UNIFORMS = `
    uniform vec2 uWaveDir[${MAX_COMP}]; uniform float uWaveA[${MAX_COMP}]; uniform float uWaveK[${MAX_COMP}];
    uniform float uWavePhase[${MAX_COMP}]; uniform float uWaveQ[${MAX_COMP}]; uniform int uWaveCount;
    varying vec2 vWaveP;`;
  // прибой: униформы карты берега даёт SHORE_DAMP_GLSL
  const SURF_PARS = `uniform float uTime; uniform vec2 uWindDir; ${NOISE_GLSL} ${SURF_GLSL}`;
  const WAKE_PARS = `${WAKE_GLSL} uniform vec3 uWakeColor; uniform vec3 uWakeEdgeColor;`;
  const mat = new THREE.MeshLambertMaterial({ color: settings.color });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${WAVE_UNIFORMS} uniform vec2 uCenter; uniform float uRadius; attribute float aCell;
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
        vec3 transformed = vec3(position) + disp * edge;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${WAVE_UNIFORMS} uniform vec2 uCenter; uniform float uRadius; ${SHORE_DAMP_GLSL} ${SURF_PARS} ${WAKE_PARS}`)
      // мелководье и пена прибоя; буруны гаснут к краю ближней воды — за ним дальняя вода рисует только кромку
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 sh = shoreInfo(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLagoon, shallowMix(sh));
        float surfLines = 1.0 - smoothstep(uRadius * 0.6, uRadius * 0.9, length(vWaveP - uCenter));
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, surfFoam(vWaveP, sh, surfLines));
        // кильватер: светлая лента с контуром перемычек, у кормы — белый бурун
        vec4 wk = wakeMask(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeColor, wk.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWakeEdgeColor, wk.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, wk.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.25, 0.3), wk.w);`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
        ${WATER_SHADOW_GLSL(shadowTaps)}`)
      // нормаль по пикселю, а не по вершинам: сетка короче коротких компонент не передаёт,
      // интерполяция давала грани. Точка параметризации интерполируется линейно — для света хватает.
      // К краю сетки гаснет только смещение, свет волн продолжается в дальнем кольце без шва
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${WAVE_NORMAL_GLSL}`)
      .replace('#include <opaque_fragment>', `
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
        ${WAVE_UNIFORMS} ${SHORE_DAMP_GLSL} ${SURF_PARS}`)
      // мелководье и пена у кромки — как у ближней воды, без бурунов
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 sh = shoreInfo(vWaveP);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLagoon, shallowMix(sh));
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, surfFoam(vWaveP, sh, 0.0));`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${WAVE_NORMAL_GLSL}`);
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

  // windDir — вектор ветра {x, z}: наветренный берег пенится сильнее
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

  return { mesh, far, update, edgeAt, uniforms, settings, surf };
}
