import * as THREE from 'three';
import { BOAT } from '../config.js';
import { NOISE_GLSL } from './water-fx.js';
import { createWaterline } from './waterline.js';

// точек кольца пены = лучей контура ватерлинии
const NR = 64;
// ряды вершин точки контура: у обшивки, гребень, гребень, внешний край, гребень, верх барашков —
// три полосы (склон к борту, внешний склон, барашки), у каждой свои вершины и развёртка
const ROWS = 6;
// с, спад всплеска от удара носом о волну
const SLAM_DECAY = 0.4;

// Бурун: валик пены у носа — горб над водой по урезу, к бортам сходит на нет (волну вдоль борта рисует
// лента кильватера, wake.js). Цвета — кильватера (заливка и контур, wake.settings).
// Задним ходом буруна нет.
// Лента — по настоящему контуру пересечения корпуса с водой (waterline.js): при крене и дифференте пена идёт
// по урезу, а не по ватерлинии покоя. Кольцо замкнутое, но дальше от носа все ряды сходятся в линию — пикселей нет.
// Точка форштевня в кольце дважды (в начале и в конце): у бортов разный code, на общем четырёхугольнике
// он интерполировался бы через чужие полосы.
// Сечение: склон от обшивки к гребню, внешний склон с рваным краем на воду, над гребнем — барашки (полукруги).
// Рисунок пены стоит в воде: развёртка вдоль борта сдвигается на пройденный путь.
// hullGeo — обшивка корпуса в СК модели (boat-mesh.js, hullGeometry)
export function createBowWave(wake, hullGeo) {
  const waterline = createWaterline(hullGeo, { rays: NR });
  const rs = waterline.contour;

  const nv = (NR + 1) * ROWS;
  const pos = new Float32Array(nv * 3);
  // (развёртка, м; поперёк 0..1; полоса + 3·code; высота барашков, м); code: 0/1 — первый/второй борт по обходу
  const attr = new Float32Array(nv * 4);
  const idx = [];
  const vi = (c, r) => c * ROWS + r;
  for (let c = 0; c <= NR; c++) for (let r = 0; r < ROWS; r++) attr[vi(c, r) * 4 + 1] = r % 2;
  for (let c = 0; c < NR; c++) {
    const c1 = c + 1;
    for (const r of [0, 2, 4]) {
      const a = vi(c, r), b = vi(c1, r), cc = vi(c1, r + 1), d = vi(c, r + 1);
      idx.push(a, b, cc, a, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aAttr = new THREE.BufferAttribute(attr, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aFoam', aAttr);
  // нормаль вверх (свет как на плоской воде, см. mat); шейдер её всё равно переопределяет
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);

  // bow — сила валика; lumps — размер барашков; waterline — отладочная линия контура
  const settings = { enabled: true, bow: 1, lumps: 1, waterline: false };
  const uniforms = {
    uFoam: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uOdo: { value: 0 },
    uTime: { value: 0 },
    uCell: { value: 0.2 },
  };
  // Освещение — то же, что у воды (Lambert, нормаль вверх, как у плоской воды): цвета кильватера на пене
  // и на воде совпадают при любом солнце, в сумерках пена темнеет вместе с водой
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFoam;
        varying vec4 vFoam; varying vec3 vWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFoam = aFoam; vWorld = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uFoam, uShade, uSunDir;
        uniform float uOdo, uTime, uCell;
        varying vec4 vFoam; varying vec3 vWorld;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kind = mod(vFoam.z, 3.0), side = floor(vFoam.z / 3.0 + 0.01);
        float v = vFoam.y;
        // пена стоит в воде: корпус проходит сквозь рисунок
        float u = vFoam.x - uOdo;
        float sd = side * 41.0;
        bool shade = false;
        if (kind > 1.5) {
          // барашки: полукруги на гребне, у каждого свой радиус и «кипение»; внизу сплошная полоса.
          // Тень — серп снизу и тонкий контур (рисованный комок пены)
          float H = vFoam.w, y = v * H;
          float d = 0.25 * H - y, sh = 1.0;
          float c0 = floor(u / uCell);
          for (int k = -2; k <= 2; k++) {
            float ci = c0 + float(k);
            float h = hash12(vec2(ci, sd));
            float R = H * (0.55 + 0.45 * h) * (0.9 + 0.1 * sin(uTime * 3.0 + h * 6.28));
            vec2 c = vec2((ci + 0.5 + 0.3 * (hash12(vec2(sd, ci)) - 0.5)) * uCell, 0.0);
            vec2 q = vec2(u, y) - c;
            float dc = length(q) - R;
            if (dc < d) { d = dc; sh = length(q - vec2(-0.2, 0.35) * R) - 0.85 * R; }
          }
          if (d > 0.0) discard;
          shade = sh > 0.0 || d > -0.1 * H;
        } else if (kind > 0.5) {
          // внешний склон: край — полукруги, как барашки на гребне, но крупнее и плоские; у края — тень
          float cu = u / (2.2 * uCell), ci = floor(cu), cx = fract(cu) * 2.0 - 1.0;
          float e = 0.55 + 0.25 * hash12(vec2(ci, sd + 7.0)) + 0.2 * sqrt(max(0.0, 1.0 - cx * cx))
            + 0.05 * sin(uTime * 2.0 + ci);
          if (v > e) discard;
          shade = v > e - 0.3;
        }
        // ступенчатый свет: в тени только грани, заметно отвёрнутые от солнца
        vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (dot(fn, cameraPosition - vWorld) < 0.0) fn = -fn;
        if (dot(fn, uSunDir) < -0.2) shade = true;
        diffuseColor.rgb = shade ? uShade : uFoam;`)
      // свет как на плоской воде: нормаль вверх у всех граней, с любой стороны
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'bow-wave';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;

  // отладка: контур ватерлинии поверх сцены (галка «Ватерлиния»)
  const dbgGeo = new THREE.BufferGeometry();
  dbgGeo.setAttribute('position', new THREE.BufferAttribute(rs.pw, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineLoop(dbgGeo, new THREE.LineBasicMaterial({ color: 0xffe619, depthTest: false }));
  lines.renderOrder = 10;
  lines.frustumCulled = false;
  lines.visible = false;

  const bow = new THREE.Vector3();
  let odo = 0, slam = 0, prevImm = null;

  function drawDebug() {
    lines.visible = settings.waterline && rs.valid;
    if (lines.visible) dbgGeo.attributes.position.needsUpdate = true;
  }

  function put(c, r, x, y, z) {
    const o = vi(c, r) * 3;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
  }

  function update(dt, time, boat, waves, boatMesh, env) {
    const S = settings;
    // только передним ходом
    const speed = Math.max(0, boat.u);
    odo += boat.u * dt;
    // удар носом о волну: вода у форштевня быстро поднимается — горб на миг выше (как брызги в spray.js)
    boatMesh.bowWorld(bow);
    const imm = waves.heightAt(bow.x, bow.z) - bow.y;
    slam *= Math.exp(-dt / SLAM_DECAY);
    if (prevImm !== null && dt > 0) {
      const rate = (imm - prevImm) / dt;
      if (rate > 0.9 && imm > -0.3 && boat.u > 1) slam = Math.max(slam, THREE.MathUtils.clamp(rate * boat.u / 5, 0.2, 1) * 0.25);
    }
    prevImm = imm;

    const k = THREE.MathUtils.smoothstep(speed, 0.3, 1.2);
    const want = S.enabled && k > 0.01 && !boat.capsized;
    boatMesh.group.updateMatrixWorld();
    const M = boatMesh.group.matrixWorld;
    // без буруна и волны у борта (лента кильватера, wake.js) контур не нужен; устаревший не держим —
    // им могут пользоваться другие (брызги)
    const band = wake.settings.enabled && wake.settings.hull && k > 0.01 && !boat.capsized;
    if (want || band || S.waterline) waterline.update(M, waves); else waterline.invalidate();
    drawDebug();
    const f = Math.min(speed / BOAT.hullSpeed, 1.4);
    // высота валика на вершине; основа ширины пены
    const bowH = (S.bow * (0.04 + 0.18 * f * f) + slam) * k;
    const base = (0.12 + 0.25 * f) * k;
    mesh.visible = want;
    if (!mesh.visible) return;

    // настоящие концы ватерлинии вдоль оси корпуса (нос — −z в СК модели)
    let zmin = Infinity, zmax = -Infinity;
    for (let c = 0; c < NR; c++) { const z = rs.pl[c * 3 + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    const span = Math.max(zmax - zmin, 0.1), L = rs.len;
    for (let c = 0; c <= NR; c++) {
      // i — точка контура; c = NR — снова форштевень, со стороны второго борта
      const i = c % NR;
      const px = rs.pw[i * 3], py = rs.pw[i * 3 + 1], pz = rs.pw[i * 3 + 2];
      const nx = rs.nw[i * 2], nz = rs.nw[i * 2 + 1];
      // профиль валика по σ — доле длины ватерлинии от носа: вершина у форштевня, к бортам сходит на нет
      const sgm = (rs.pl[i * 3 + 2] - zmin) / span;
      const bowK = Math.exp(-(((sgm - 0.05) / 0.12) ** 2));
      const h = bowH * bowK;
      // развёртка — путь от носа по своему борту
      const sc = c === NR ? L : rs.s[i], o = c * ROWS * 4;
      const code = sc < L / 2 ? 0 : 1;
      for (let r = 0; r < ROWS; r++) {
        attr[o + r * 4] = Math.min(sc, L - sc);
        attr[o + r * 4 + 2] = (r >> 1) + 3 * code;
      }
      // пена взбирается на обшивку на полвысоты горба (с развалом борта — чуть наружу)
      const climb = 0.5 * h, out = 0.03 + 0.3 * climb;
      const ix = px + nx * out, iz = pz + nz * out, iy = py + 0.02 + climb;
      // ширина пены от борта до внешнего края; у самого форштевня край ближе: пена обтекает нос подушкой, а не клином
      const w = (base + 1.2 * bowH) * bowK * (0.6 + 0.4 * THREE.MathUtils.smoothstep(sgm, 0, 0.06));
      const cw = Math.min(0.06 + 0.35 * h, 0.5 * w);
      const H = S.lumps * (0.06 + 0.4 * h) * k * bowK;
      // вода под гребнем — между бортом и внешним краем (гребень близко к борту, волны длиннее метра)
      const ox = ix + nx * w, oz = iz + nz * w, ho = waterline.waterAt(ox, oz);
      put(c, 0, ix, iy, iz);
      const cx = ix + nx * cw, cz = iz + nz * cw, cy = py + (ho - py) * (cw / Math.max(w, cw)) + h;
      put(c, 1, cx, cy, cz);
      put(c, 2, cx, cy, cz);
      put(c, 3, ox, ho + 0.02, oz);
      put(c, 4, cx, cy - 0.02, cz);
      put(c, 5, cx + nx * 0.3 * H, cy + H, cz + nz * 0.3 * H);
      for (let r = 4; r < 6; r++) attr[vi(c, r) * 4 + 3] = H;
    }
    posAttr.needsUpdate = true;
    aAttr.needsUpdate = true;

    uniforms.uFoam.value.set(wake.settings.color);
    uniforms.uShade.value.set(wake.settings.edgeColor);
    uniforms.uOdo.value = odo;
    uniforms.uTime.value = time;
    uniforms.uCell.value = 0.2 * Math.max(S.lumps, 0.3);
    if (env) uniforms.uSunDir.value.copy(env.sunDir);
  }

  function reset() { odo = 0; slam = 0; prevImm = null; }

  return { mesh, lines, waterline, settings, update, reset };
}
