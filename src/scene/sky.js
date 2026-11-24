import * as THREE from 'three';
import { NOISE_GLSL } from './water-fx.js';

// Небо: купол с градиентом, зависящим от положения солнца (светлая сторона у солнца,
// тень Земли и пояс Венеры напротив), диск и ореол солнца, процедурные звёзды и луна в сумерках.
// Палитра — ключевые кадры по высоте солнца; setSun() возвращает освещение для сцены.

// высота солнца в градусах → цвета неба и света (hex в sRGB)
const KEYS = [
  { elev: -8, zenith: 0x0a1330, horizon: 0x4a5c8c, anti: 0x0f1a3c, glow: 0x7a4428, belt: 0x000000, stars: 1.0,
    sun: 0xff8a50, sunI: 0, hemi: 0x6a7cac, ground: 0x10223a, hemiI: 0.6 },
  { elev: -3, zenith: 0x1c3264, horizon: 0x9a7088, anti: 0x2c3c6a, glow: 0xd06a48, belt: 0x4a3a62, stars: 0.75,
    sun: 0xff8a50, sunI: 0, hemi: 0x7a88b8, ground: 0x16304a, hemiI: 0.55 },
  { elev: 2, zenith: 0x3a5a9a, horizon: 0xf2a070, anti: 0x6a76a4, glow: 0xff7a30, belt: 0xb88098, stars: 0.2,
    sun: 0xff9a5a, sunI: 1.3, hemi: 0xd8a8b8, ground: 0x2a4d6f, hemiI: 0.6 },
  { elev: 10, zenith: 0x5584c8, horizon: 0xf6c49a, anti: 0xaab8d2, glow: 0xff9a50, belt: 0x302028, stars: 0,
    sun: 0xffbf80, sunI: 1.9, hemi: 0xe8c8c8, ground: 0x2a5a80, hemiI: 0.65 },
  { elev: 35, zenith: 0x5aa8e4, horizon: 0xdcecf5, anti: 0xcfe4f2, glow: 0x201810, belt: 0x000000, stars: 0,
    sun: 0xfff2d8, sunI: 2.4, hemi: 0xcfe8ff, ground: 0x2b6f9a, hemiI: 0.7 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'anti', 'glow', 'belt', 'sun', 'hemi', 'ground'];
const KEYS_LIN = KEYS.map((k) => {
  const o = { ...k };
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  return o;
});

// северный полюс мира: юг — −z (там солнце в полдень), широта ~42° (Новая Англия)
const LAT = 42 * Math.PI / 180;
const POLE = new THREE.Vector3(0, Math.sin(LAT), Math.cos(LAT));

// Палитра неба — общая с водой (отражение): вода подключает те же объекты-униформы.
export const SKY_UNIFORMS_GLSL = `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uAntiHorizon;
  uniform vec3 uSunGlow; uniform vec3 uBelt; uniform float uHalo;
`;

// Цвет неба в направлении d (без звёзд). Нужны также uSunDir и uSunColor; disc — множитель диска.
export const SKY_COLOR_GLSL = `
  vec3 skyColor(vec3 d, float disc) {
    vec3 s = normalize(uSunDir);
    float hp = max(d.y, 0.0);
    // азимутальная близость к солнцу: 1 — под солнцем, 0 — напротив
    vec2 dxz = d.xz, sxz = s.xz;
    float a = (dot(dxz, dxz) > 1e-8 && dot(sxz, sxz) > 1e-8) ? dot(normalize(dxz), normalize(sxz)) * 0.5 + 0.5 : 0.5;
    vec3 hor = mix(uAntiHorizon, uHorizon, a);
    vec3 col = mix(hor, uZenith, pow(smoothstep(0.0, 0.6, hp), 0.75));
    // зарево над горизонтом со стороны солнца
    col += uSunGlow * pow(a, 3.0) * pow(1.0 - hp, 5.0);
    // пояс Венеры — розовая полоса над тенью Земли
    col += uBelt * pow(1.0 - a, 2.0) * exp(-pow((hp - 0.1) / 0.07, 2.0));
    // ореол и диск солнца
    float mu = dot(d, s);
    float m = max(mu, 0.0);
    col += uSunColor * (pow(m, 8.0) * 0.15 + pow(m, 200.0) * 0.6) * uHalo;
    float dsc = smoothstep(0.99980, 0.99987, mu) * smoothstep(-0.01, 0.0, d.y) * disc;
    return mix(col, uSunColor * 3.0 + vec3(0.4), dsc);
  }
`;

const SKY_GLSL = `
  uniform vec3 uSunDir; uniform vec3 uSunColor;
  ${SKY_UNIFORMS_GLSL}
  uniform float uDisc; uniform float uStars; uniform float uTime;
  uniform vec3 uPole; uniform float uStarAngle;
  uniform vec3 uMoonDir; uniform float uMoon; uniform float uMoonSize;
  varying vec3 vW;
  ${NOISE_GLSL}
  ${SKY_COLOR_GLSL}
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // звёзды: в 3D-ячейке вокруг точки сферы — одна звезда со случайным местом и яркостью
  vec3 starLayer(vec3 d, float scale, float density) {
    vec3 p = d * scale;
    float px = length(fwidth(p));
    vec3 c = floor(p);
    vec3 h = hash33(c);
    if (h.x > density) return vec3(0.0);
    vec3 sp = normalize(c + 0.25 + 0.5 * hash33(c + 19.19)) * scale;
    float r = max(px * 0.9, 0.04);
    float s = 1.0 - smoothstep(0.0, r, length(p - sp));
    float b = pow(h.y, 6.0) * 1.6 + 0.12;
    b *= 0.7 + 0.3 * sin(uTime * (1.5 + 3.0 * h.z) + h.y * 40.0);
    return mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.75), h.z) * s * s * b;
  }
  // Полная луна: диск радиуса uMoonSize (рад) с потемнением к краю и «морями» из шума, слабый ореол.
  // Поверх неба и звёзд с долей uMoon (под горизонтом и в пасмурную погоду — 0)
  vec3 moon(vec3 col, vec3 d) {
    // размер пикселя в радиусах луны — до ветвления: fwidth в неравномерной ветке даёт мусор (кольцо на обрезе)
    float aa = length(fwidth(d)) / uMoonSize;
    float mu = dot(d, uMoonDir);
    if (uMoon <= 0.0 || mu < cos(uMoonSize * 4.0)) return col;
    vec3 u = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), v = cross(u, uMoonDir);
    vec2 q = vec2(dot(d, u), dot(d, v)) / uMoonSize;
    float r = length(q);
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    float maria = 1.0 - 0.22 * smoothstep(0.45, 0.7, vnoise(q * 2.2 + 7.3)) - 0.1 * smoothstep(0.5, 0.8, vnoise(q * 5.0 + 1.7));
    vec3 face = vec3(1.0, 0.97, 0.9) * maria * (1.0 - 0.25 * r * r) * 1.15;
    // ореол до 4 радиусов, к краю выборки гаснет в ноль — без кольца на обрезе
    col += vec3(0.75, 0.82, 1.0) * 0.12 * exp(-r * r / 2.0) * (1.0 - smoothstep(2.5, 4.0, r)) * uMoon;
    return mix(col, face, disc * uMoon);
  }
  vec3 rotAxis(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }
`;

export function createSky({ radius = 2500 } = {}) {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uAntiHorizon: { value: new THREE.Color() },
    uSunGlow: { value: new THREE.Color() },
    uBelt: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uHalo: { value: 1 },
    uDisc: { value: 1 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uPole: { value: POLE },
    uStarAngle: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoon: { value: 0 },
    uMoonSize: { value: 0.02 },
    // искры луны на воде (SPARKLE_GLSL): цвет × сила, 0 — пока солнце не зашло
    uMoonGlint: { value: new THREE.Color(0) },
  };
  // Луна (панель «Сцена»): полная, по азимуту напротив солнца; высота = lift − высота солнца (°), так что
  // в сумерках она над горизонтом, днём под ним. size — угловой радиус, ° (настоящая 0.26°, у нас крупнее);
  // glint — сила её искр на воде
  const moonCfg = { enabled: true, lift: 12, size: 1.2, glint: 0.8 };
  const moonGlintColor = new THREE.Color(0xdfe8ff);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vW;
        void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `${SKY_GLSL}
        void main() {
          vec3 d = normalize(vW - cameraPosition);
          vec3 col = skyColor(d, uDisc);
          // звёзды — на тёмной части неба, тают к горизонту
          if (uStars > 0.0) {
            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
            float vis = uStars * (1.0 - smoothstep(0.015, 0.1, lum)) * smoothstep(0.03, 0.25, d.y);
            vec3 sd = rotAxis(d, uPole, uStarAngle);
            vec3 st = starLayer(sd, 55.0, 0.08) + starLayer(sd, 130.0, 0.07) * 0.6;
            col += st * vis;
          }
          col = moon(col, d);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  const light = {
    sunColor: new THREE.Color(), sunI: 0,
    hemi: new THREE.Color(), ground: new THREE.Color(), hemiI: 0,
    fog: new THREE.Color(), shadow: 1,
  };
  const grey = new THREE.Color();
  // затянутость: цвет к серому той же яркости, чуть темнее
  const toGrey = (c, k) => {
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    return c.lerp(grey.setRGB(l * 0.95, l, l * 1.05).multiplyScalar(0.8), k);
  };

  // dayPhase — 0..1 время суток, поворачивает звёздное небо вокруг полюса;
  // overcast — 0..1 затянутость облаками: серое небо, слабое солнце, без звёзд
  function setSun(sunDir, dayPhase = 0.5, overcast = 0) {
    uniforms.uSunDir.value.copy(sunDir);
    uniforms.uStarAngle.value = (dayPhase - 0.5) * Math.PI * 2;
    const elev = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) * 180 / Math.PI;
    let i = 0;
    while (i < KEYS_LIN.length - 2 && elev > KEYS_LIN[i + 1].elev) i++;
    const A = KEYS_LIN[i], B = KEYS_LIN[i + 1];
    const t = THREE.MathUtils.smoothstep(elev, A.elev, B.elev);
    const mix = (k, out) => out.copy(A[k]).lerp(B[k], t);
    mix('zenith', uniforms.uZenith.value);
    mix('horizon', uniforms.uHorizon.value);
    mix('anti', uniforms.uAntiHorizon.value);
    mix('glow', uniforms.uSunGlow.value);
    mix('belt', uniforms.uBelt.value);
    mix('sun', uniforms.uSunColor.value);
    uniforms.uStars.value = THREE.MathUtils.lerp(A.stars, B.stars, t);
    uniforms.uHalo.value = THREE.MathUtils.smoothstep(elev, -4, 1) * (1 - overcast);
    uniforms.uDisc.value = 1 - overcast;
    uniforms.uStars.value *= Math.max(0, 1 - 1.5 * overcast);
    toGrey(uniforms.uZenith.value, overcast);
    toGrey(uniforms.uHorizon.value, overcast);
    toGrey(uniforms.uAntiHorizon.value, overcast);
    uniforms.uSunGlow.value.multiplyScalar(1 - overcast);
    uniforms.uBelt.value.multiplyScalar(1 - overcast);

    const mElev = Math.min(85, moonCfg.lift - elev) * Math.PI / 180;
    const h = Math.hypot(sunDir.x, sunDir.z) || 1;
    uniforms.uMoonDir.value.set(-sunDir.x / h * Math.cos(mElev), Math.sin(mElev), -sunDir.z / h * Math.cos(mElev));
    const moonVis = moonCfg.enabled ? THREE.MathUtils.smoothstep(mElev * 180 / Math.PI, -1, 2) * (1 - overcast) : 0;
    uniforms.uMoon.value = moonVis;
    uniforms.uMoonSize.value = moonCfg.size * Math.PI / 180;
    // искры луны проступают, когда гаснут солнечные (uHalo: солнце ниже −4°…1°)
    uniforms.uMoonGlint.value.copy(moonGlintColor).multiplyScalar(moonCfg.glint * moonVis * (1 - THREE.MathUtils.smoothstep(elev, -4, 3)));

    // солнце под горизонтом не светит — иначе подсветка снизу
    const vis = THREE.MathUtils.smoothstep(elev, -1, 3);
    mix('sun', light.sunColor);
    light.sunI = THREE.MathUtils.lerp(A.sunI, B.sunI, t) * vis * (1 - 0.85 * overcast);
    toGrey(mix('hemi', light.hemi), overcast * 0.8);
    toGrey(mix('ground', light.ground), overcast * 0.5);
    light.hemiI = THREE.MathUtils.lerp(A.hemiI, B.hemiI, t) * (1 + 0.1 * overcast);
    light.shadow = 1 - 0.85 * overcast;
    // туман — горизонт под 90° к солнцу, между светлой и тёмной стороной
    light.fog.copy(uniforms.uAntiHorizon.value).lerp(uniforms.uHorizon.value, 0.5);
    return light;
  }

  function update(cx, cz, time) {
    mesh.position.set(cx, 0, cz);
    uniforms.uTime.value = time;
  }

  return { mesh, update, setSun, uniforms, moon: moonCfg };
}
