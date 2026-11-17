import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from './water-fx.js';
import { cumulus, stratocumulus, cumulonimbus, coldFront } from './cloud-shapes.js';

// Облака трёх видов, всего три отрисовки:
//  • объёмные — «пуфы» (бугристые икосаэдры) всех облаков одним непрозрачным InstancedMesh;
//  • сплошной слой (пасмурно, за фронтом, вокруг грозы) — сетка, опущенная шумом;
//  • перистые — полупрозрачные квады с прожилками вдоль ветра.
// Освещение своё: мягкий переход от солнца, самозатенение по высоте, свет неба, кайма против солнца.

const MAX_PUFFS = 900;
const MAX_CIRRUS = 16;
const DRIFT = 2.5;        // облака идут быстрее ветра у воды
const NEAR_WRAP = 1400;   // полупериод переноса кучевых вокруг лодки
const FAR_WRAP = 2600;    // для фронта и грозовых ячеек
const CIRRUS_WRAP = 2800;
const DECK_Y = 230;
const CLOUD_SCALE = 1.3;  // общий масштаб объёмных облаков

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// кучевые, разбросанные по всему квадрату переноса
function scatter(rng, add, n, R0, R1, y0 = 110) {
  for (let i = 0; i < n; i++) {
    add(cumulus(rng, R0 + rng() * (R1 - R0)), (rng() - 0.5) * 2 * NEAR_WRAP, (rng() - 0.5) * 2 * NEAR_WRAP, y0 + rng() * 40);
  }
}

// spawn(rng, add, at): add(shape, dx, dz, baseY, opts) — смещение от лодки; at(вдоль ветра, поперёк) → [dx, dz]
export const CLOUD_TYPES = {
  'Ясно': { overcast: 0, cirrus: 0, deck: null, spawn: (rng, add) => scatter(rng, add, 3, 16, 24) },
  'Кучевые': { overcast: 0.05, cirrus: 3, deck: null, spawn: (rng, add) => scatter(rng, add, 30, 24, 46) },
  'Перистые': { overcast: 0.1, cirrus: 14, deck: null, spawn: (rng, add) => scatter(rng, add, 3, 16, 24) },
  'Пасмурно': {
    overcast: 0.85, cirrus: 0, deck: { cover: 1, dark: 0.7 },
    spawn(rng, add) {
      for (let i = 0; i < 40; i++) {
        add(stratocumulus(rng), (rng() - 0.5) * 2 * NEAR_WRAP, (rng() - 0.5) * 2 * NEAR_WRAP, 120 + rng() * 30, { windAligned: true });
      }
    },
  },
  'Холодный фронт': {
    overcast: 0.45, cirrus: 5, deck: { cover: 0.95, dark: 0.8, mask: 1 },
    spawn(rng, add, at) {
      add(coldFront(rng), ...at(-1200, 0), 110, { far: true, main: true, windAligned: true });
      for (let i = 0; i < 8; i++) add(cumulus(rng, 22 + rng() * 18), ...at(-600 + rng() * 1800, (rng() - 0.5) * 2600), 120 + rng() * 30);
    },
  },
  'Гроза': {
    overcast: 0.5, cirrus: 0, deck: null,
    spawn(rng, add, at) {
      add(cumulonimbus(rng, 1), ...at(-1300, 300), 120, { far: true, main: true, windAligned: true });
      add(cumulonimbus(rng, 0.6), ...at(-1900, -1200), 130, { far: true, windAligned: true });
      scatter(rng, add, 10, 22, 36);
    },
  },
};

const PUFF_VERT = `
  attribute vec3 aCloud; // низ облака, толщина, плотность
  varying vec3 vN; varying vec3 vW; varying float vHc; varying float vDens;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    // нормаль при неравномерном масштабе: R·S·(n/s²) = R·S⁻¹·n
    mat3 im = mat3(instanceMatrix);
    vec3 s2 = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    vN = normalize(mat3(modelMatrix) * im * (normal / max(s2, vec3(1e-6))));
    vW = wp.xyz;
    vHc = clamp((wp.y - aCloud.x) / aCloud.y, 0.0, 1.0);
    vDens = aCloud.z;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const LIGHT_UNIFORMS_GLSL = `
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI;
  uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon;
  uniform float uFogNear; uniform float uFogFar;
  vec3 skyBehind(vec3 dir) { return mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.6, dir.y)); }
`;

const PUFF_FRAG = `
  ${LIGHT_UNIFORMS_GLSL}
  varying vec3 vN; varying vec3 vW; varying float vHc; varying float vDens;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    vec3 s = normalize(uSunDir);
    // свет рассеивается в облаке — без резкого терминатора
    float wrap = pow(dot(n, s) * 0.5 + 0.5, 1.5);
    // самозатенение: чем плотнее облако, тем темнее дно
    float self = mix(mix(0.6, 0.15, vDens), 1.0, smoothstep(0.0, 1.0, pow(vHc, 1.0 + vDens)));
    vec3 sky = mix(uSkyHorizon, uSkyZenith, n.y * 0.5 + 0.5);
    vec3 albedo = vec3(0.96, 0.97, 1.0) * mix(1.0, 0.6, vDens);
    vec3 col = albedo * (uSunColor * uSunI * wrap * self + sky * (0.5 + 0.5 * self) * 0.9);
    // серебристая кайма, когда смотрим в сторону солнца
    float rim = pow(1.0 - abs(dot(n, v)), 3.0);
    col += uSunColor * uSunI * rim * pow(max(dot(-v, s), 0.0), 4.0) * 0.6 * (1.0 - 0.7 * vDens);
    // мягкий силуэт и дымка — к цвету неба за облаком
    vec3 behind = skyBehind(-v);
    col = mix(col, behind, rim * rim * 0.12);
    col = mix(col, behind, smoothstep(uFogNear, uFogFar, length(vW - cameraPosition)));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DECK_VERT = `
  uniform vec2 uOffset; uniform float uCover; uniform float uY;
  uniform vec2 uMaskPos; uniform vec2 uMaskDir; uniform float uMaskType;
  varying vec3 vW; varying float vC;
  ${NOISE_GLSL}
  float field(vec2 q) { return vnoise(q * 0.0016) * 0.6 + vnoise(q * 0.005 + 7.3) * 0.3 + vnoise(q * 0.015) * 0.1; }
  float mask(vec2 p) {
    if (uMaskType < 0.5) return 1.0;
    // 1 — только позади линии фронта (с наветра)
    return 1.0 - smoothstep(-500.0, -60.0, dot(p - uMaskPos, uMaskDir));
  }
  void main() {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec2 q = wp.xz - uOffset;
    float c = smoothstep(0.88 - uCover, 1.12 - uCover, field(q)) * mask(wp.xz);
    wp.y = uY - c * (30.0 + 70.0 * vnoise(q * 0.01));
    vW = wp; vC = c;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const DECK_FRAG = `
  ${LIGHT_UNIFORMS_GLSL}
  uniform float uDark; uniform float uY;
  varying vec3 vW; varying float vC;
  void main() {
    if (vC < 0.01) discard;
    // гранёное дно слоя, как у low-poly воды
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    if (n.y > 0.0) n = -n;
    float thick = clamp((uY - vW.y) / 100.0, 0.0, 1.0);
    float facet = 0.88 + 0.12 * dot(n, normalize(vec3(uSunDir.x, -0.4, uSunDir.z)));
    vec3 sky = mix(uSkyHorizon, uSkyZenith, 0.35);
    vec3 col = sky * mix(1.0, 1.0 - 0.6 * uDark, thick) * facet + uSunColor * uSunI * 0.06 * (1.0 - thick);
    vec3 v = normalize(cameraPosition - vW);
    col = mix(col, skyBehind(-v), smoothstep(uFogNear, uFogFar, length(vW - cameraPosition)));
    float a = smoothstep(0.0, 0.3, vC) * (1.0 - smoothstep(2200.0, 3000.0, length(vW.xz - cameraPosition.xz)));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CIRRUS_VERT = `
  varying vec3 vW; varying vec2 vUv;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz; vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CIRRUS_FRAG = `
  ${LIGHT_UNIFORMS_GLSL}
  uniform vec2 uWindDir; uniform vec2 uOffset;
  varying vec3 vW; varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vec2 q = vW.xz - uOffset;
    float along = dot(q, uWindDir), across = dot(q, vec2(-uWindDir.y, uWindDir.x));
    // тонкие прожилки вдоль ветра, собранные в пряди
    float d = vnoise(vec2(along * 0.003, across * 0.05)) * 0.6 + vnoise(vec2(along * 0.0015 + 3.1, across * 0.006)) * 0.4;
    float edge = 1.0 - smoothstep(0.35, 1.0, length((vUv - 0.5) * 2.0));
    float a = smoothstep(0.5, 0.8, d) * edge * 0.75 * (1.0 - smoothstep(2000.0, 2700.0, length(vW.xz - cameraPosition.xz)));
    if (a < 0.003) discard;
    vec3 col = vec3(0.96) * (uSunColor * uSunI * 0.6 + mix(uSkyHorizon, uSkyZenith, 0.5) * 0.8);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makePuffGeometry() {
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  // бугристость: смещение по детерминированной функции позиции — общие вершины смещаются одинаково
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.055 * (Math.sin(3.1 * x + 1.3) + Math.sin(2.7 * y + 0.4) + Math.sin(3.3 * z + 2.1))
      + 0.04 * Math.sin(7.3 * x + 5.1 * z + 3 * y);
    p.setXYZ(i, x * d, y * d, z * d);
  }
  g.computeVertexNormals();
  return g;
}

export function createClouds(sky) {
  // общие с небом объекты цветов: облака подхватывают палитру без копирования
  const light = () => ({
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: sky.uniforms.uSunColor,
    uSunI: { value: 2 },
    uSkyZenith: sky.uniforms.uZenith,
    uSkyHorizon: sky.uniforms.uHorizon,
    uFogNear: { value: 900 },
    uFogFar: { value: 3200 },
  });

  const group = new THREE.Group();

  // --- объёмные облака ---
  const puffGeo = makePuffGeometry();
  const aCloud = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
  puffGeo.setAttribute('aCloud', aCloud);
  const puffU = light();
  const puffs = new THREE.InstancedMesh(puffGeo, new THREE.ShaderMaterial({
    uniforms: puffU, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
  }), MAX_PUFFS);
  puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  puffs.frustumCulled = false;
  puffs.count = 0;
  group.add(puffs);

  // --- сплошной слой ---
  const DECK_SIZE = 6000, DECK_SEG = 96;
  const deckU = {
    ...light(),
    uOffset: { value: new THREE.Vector2() }, uCover: { value: 0 }, uY: { value: DECK_Y }, uDark: { value: 0.7 },
    uMaskPos: { value: new THREE.Vector2() }, uMaskDir: { value: new THREE.Vector2(1, 0) },
    uMaskType: { value: 0 },
  };
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(DECK_SIZE, DECK_SIZE, DECK_SEG, DECK_SEG).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: deckU, vertexShader: DECK_VERT, fragmentShader: DECK_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  deck.frustumCulled = false;
  deck.visible = false;
  group.add(deck);

  // --- перистые ---
  const cirrusU = { ...light(), uWindDir: { value: new THREE.Vector2(1, 0) }, uOffset: deckU.uOffset };
  const cirrus = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: cirrusU, vertexShader: CIRRUS_VERT, fragmentShader: CIRRUS_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }),
    MAX_CIRRUS,
  );
  cirrus.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cirrus.frustumCulled = false;
  cirrus.count = 0;
  group.add(cirrus);

  let clouds = [];    // { x, z, baseY, start, count, local: Float32Array, far }
  let wisps = [];     // { x, z, y, local: Matrix4 }
  let main = null;    // облако, за которым следует маска слоя
  let pending = 'Кучевые';
  let type = CLOUD_TYPES[pending];
  let target = type.overcast;
  const state = { overcast: target };

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qs = new THREE.Quaternion();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

  function build(name, w, cx, cz) {
    type = CLOUD_TYPES[name];
    target = type.overcast;
    const sp = Math.hypot(w.x, w.z);
    const wd = sp > 0.05 ? { x: w.x / sp, z: w.z / sp } : { x: 1, z: 0 };
    // поворот вокруг Y, переводящий локальную +x в направление ветра
    const windYaw = Math.atan2(-wd.z, wd.x);
    const at = (along, across) => [wd.x * along - wd.z * across, wd.z * along + wd.x * across];
    const rng = mulberry32(Object.keys(CLOUD_TYPES).indexOf(name) * 977 + 13);

    clouds = []; main = null;
    let used = 0;
    const add = (shape, dx, dz, baseY, opts = {}) => {
      const n = Math.min(shape.puffs.length, MAX_PUFFS - used);
      if (n <= 0) return;
      const yaw = opts.windAligned ? windYaw : rng() * Math.PI * 2;
      q.setFromAxisAngle(Y, yaw);
      const c = { x: cx + dx, z: cz + dz, baseY, start: used, count: n, local: new Float32Array(n * 16), far: !!opts.far };
      for (let i = 0; i < n; i++) {
        const p = shape.puffs[i];
        pos.set(p.x, p.y, p.z).multiplyScalar(CLOUD_SCALE).applyQuaternion(q);
        qs.setFromAxisAngle(Y, (rng() - 0.5) * 0.6).premultiply(q);
        m4.compose(pos, qs, scl.set(p.sx, p.sy, p.sz).multiplyScalar(CLOUD_SCALE));
        c.local.set(m4.elements, i * 16);
        aCloud.setXYZ(used + i, baseY, shape.height * CLOUD_SCALE, shape.density);
      }
      used += n;
      clouds.push(c);
      if (opts.main) main = c;
    };
    type.spawn(rng, add, at);
    puffs.count = used;
    aCloud.needsUpdate = true;

    const d = type.deck;
    deck.visible = !!d;
    if (d) {
      deckU.uCover.value = d.cover;
      deckU.uDark.value = d.dark;
      deckU.uMaskType.value = main ? (d.mask || 0) : 0;
      deckU.uMaskDir.value.set(wd.x, wd.z);
    }

    wisps = [];
    for (let i = 0; i < type.cirrus; i++) {
      const len = 700 + rng() * 500, wid = 250 + rng() * 200;
      const lm = new THREE.Matrix4().compose(new THREE.Vector3(), q.setFromAxisAngle(Y, windYaw + (rng() - 0.5) * 0.3), new THREE.Vector3(len, 1, wid));
      wisps.push({ x: cx + (rng() - 0.5) * 2 * CIRRUS_WRAP, z: cz + (rng() - 0.5) * 2 * CIRRUS_WRAP, y: 700 + rng() * 200, local: lm });
    }
    cirrus.count = wisps.length;
    cirrusU.uWindDir.value.set(wd.x, wd.z);
  }

  const wrapAxis = (v, c, W) => (v - c > W ? v - 2 * W : v - c < -W ? v + 2 * W : v);

  // возвращает true, пока меняется затянутость (сцене нужно пересчитать свет)
  function update(dt, wind, cx, cz) {
    const w = wind.vector();
    if (pending) { build(pending, w, cx, cz); pending = null; }
    const mx = w.x * dt * DRIFT, mz = w.z * dt * DRIFT;

    const arr = puffs.instanceMatrix.array;
    for (const c of clouds) {
      const W = c.far ? FAR_WRAP : NEAR_WRAP;
      c.x = wrapAxis(c.x + mx, cx, W);
      c.z = wrapAxis(c.z + mz, cz, W);
      // у границы переноса облако «тает» (сжимается), чтобы не появляться скачком
      const edge = Math.max(Math.abs(c.x - cx), Math.abs(c.z - cz));
      const f = Math.max(1e-3, 1 - THREE.MathUtils.smoothstep(edge, W * 0.8, W));
      const L = c.local;
      for (let i = 0; i < c.count; i++) {
        const j = (c.start + i) * 16, o = i * 16;
        for (let k = 0; k < 12; k++) arr[j + k] = L[o + k] * f;
        arr[j + 12] = c.x + L[o + 12] * f;
        arr[j + 13] = c.baseY + L[o + 13] * f;
        arr[j + 14] = c.z + L[o + 14] * f;
        arr[j + 15] = 1;
      }
    }
    puffs.instanceMatrix.needsUpdate = true;

    deckU.uOffset.value.x += mx; deckU.uOffset.value.y += mz;
    if (deck.visible) {
      const cell = DECK_SIZE / DECK_SEG;
      deck.position.set(Math.round(cx / cell) * cell, 0, Math.round(cz / cell) * cell);
      if (main) deckU.uMaskPos.value.set(main.x, main.z);
    }

    for (let i = 0; i < wisps.length; i++) {
      const s = wisps[i];
      s.x = wrapAxis(s.x + mx, cx, CIRRUS_WRAP);
      s.z = wrapAxis(s.z + mz, cz, CIRRUS_WRAP);
      m4.copy(s.local).setPosition(s.x, s.y, s.z);
      cirrus.setMatrixAt(i, m4);
    }
    if (wisps.length) cirrus.instanceMatrix.needsUpdate = true;

    const prev = state.overcast;
    state.overcast += (target - prev) * (1 - Math.exp(-dt / 1.5));
    if (Math.abs(target - state.overcast) < 1e-3) state.overcast = target;
    return state.overcast !== prev;
  }

  function setSun(sunDir) {
    const elev = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) * 180 / Math.PI;
    const dim = 1 - 0.7 * state.overcast;
    for (const u of [puffU, deckU, cirrusU]) u.uSunDir.value.copy(sunDir);
    // облака высоко — солнце для них садится позже, чем для воды; перистые горят дольше всех
    puffU.uSunI.value = 2.4 * THREE.MathUtils.smoothstep(elev, -5, 8) * dim;
    deckU.uSunI.value = puffU.uSunI.value;
    cirrusU.uSunI.value = 2.2 * THREE.MathUtils.smoothstep(elev, -12, 4) * dim;
  }

  return {
    group, update, setSun, state,
    // instant — без плавного перехода затянутости (при старте)
    setType(name, instant = false) {
      if (!CLOUD_TYPES[name]) return;
      pending = name;
      if (instant) state.overcast = target = CLOUD_TYPES[name].overcast;
    },
    get type() { return Object.keys(CLOUD_TYPES).find((k) => CLOUD_TYPES[k] === type); },
  };
}
