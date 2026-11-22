import * as THREE from 'three';
import { MAX_COMP } from '../physics/waves.js';
import { SHORE_DAMP_GLSL } from './water-fx.js';

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

// Вода: один цвет, только рассеянный свет (Lambert, без бликов), без текстур, пены и отражений
// (эксперимент, панель «Вода»).
// Вершинный шейдер Герстнера с теми же параметрами, что в физике: лодка качается на тех же волнах,
// свет ложится по аналитическим нормалям, так что волны видны по затенению.
// shoreMap — из bakeShoreMap: по глубине волны гаснут у берега.
// Тень на воде своя (встроенная выключена): цвет и сила задаются отдельно, у отбрасывающего предмета
// тень плотная и чёткая, дальше от него — прозрачнее и мягче (PCSS по карте теней солнца).
// shadowCamera — камера тени солнца (ортографическая): её размеры переводят карту в метры.
// shadowTaps — выборок карты на каждый из двух проходов (поиск заслона и размытие).
// focus — шаг сетки в центре относительно равномерного (size / segments): у лодки сетка гуще,
// к краю реже, число вершин то же.
export function createWater(waves, { size = 440, segments = 176, focus = 0.35, shoreMap, shadowCamera, shadowTaps = 12 } = {}) {
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
    uShadowColor: { value: new THREE.Color() },
    uShadowStrength: { value: 0 },
    uShadowFade: { value: 1 },
    uShadowBlur: { value: 0 },
    uShadowSpan: { value: shadowCamera.right - shadowCamera.left },
    uShadowDepth: { value: shadowCamera.far - shadowCamera.near },
  };
  // shadowFade — метров от предмета до воды, за которые тень слабеет в e раз;
  // shadowBlur — на сколько метров растёт радиус размытия на метр от предмета
  // wireframe — показать сетку волн (каркас того же материала)
  const settings = { color: '#2f86b5', shadowColor: '#0b2a44', shadowStrength: 0.85, shadowFade: 10, shadowBlur: 0.08, wireframe: false };

  const WAVE_UNIFORMS = `
    uniform vec2 uWaveDir[${MAX_COMP}]; uniform float uWaveA[${MAX_COMP}]; uniform float uWaveK[${MAX_COMP}];
    uniform float uWavePhase[${MAX_COMP}]; uniform float uWaveQ[${MAX_COMP}]; uniform int uWaveCount;
    varying vec2 vWaveP; varying float vWaveEdge;`;
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
        vWaveP = wp.xz; vWaveEdge = edge;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position) + disp * edge;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${WAVE_UNIFORMS}`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
        ${WATER_SHADOW_GLSL(shadowTaps)}`)
      // нормаль по пикселю, а не по вершинам: сетка 2.5 м короче коротких компонент не передаёт,
      // интерполяция давала грани. Точка параметризации интерполируется линейно — для света хватает.
      // Компоненты, которые меняются быстрее пикселя (вдали), гаснут — без ряби
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float fw = length(fwidth(vWaveP));
          vec3 nd = vec3(0.0);
          for (int i = 0; i < ${MAX_COMP}; i++) {
            if (i >= uWaveCount) break;
            float th = uWaveK[i] * dot(uWaveDir[i], vWaveP) - uWavePhase[i];
            float wa = uWaveK[i] * uWaveA[i] * (1.0 - smoothstep(1.0, 3.0, uWaveK[i] * fw));
            nd.xz += uWaveDir[i] * wa * cos(th);
            nd.y += uWaveQ[i] * wa * sin(th);
          }
          nd *= vWaveEdge;
          normal = normalize((viewMatrix * vec4(-nd.x, 1.0 - nd.y, -nd.z, 0.0)).xyz);
        }`)
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

  // Дальняя вода без волн — до горизонта, растворяется в тумане. Кольцо с дырой под ближней водой:
  // сплошная плоскость торчала бы из ложбин волн плоским полигоном. К краю ближней воды волны
  // гаснут (edge → 0), нормали там уже смотрят вверх — шва по освещению нет.
  const farMat = new THREE.MeshLambertMaterial({ color: settings.color });
  const far = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.5 * 0.97, 3000, 64, 1).rotateX(-Math.PI / 2),
    farMat,
  );
  far.position.y = -0.08;
  far.receiveShadow = false;

  function update(w, cx, cz) {
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
  }

  return { mesh, far, update, uniforms, settings };
}
