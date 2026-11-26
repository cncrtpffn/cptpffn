import * as THREE from 'three';
import { createSky } from './sky.js';
import { createClouds, CLOUD_TYPES } from './clouds.js';
import { mergeStatic } from './merge-static.js';

const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });

// Буй: def.kind — навигационный знак (МАМС, регион A), без kind — регатный знак цвета def.color.
//   lateral-red / lateral-green — левый (красный цилиндр) / правый (зелёный конус) край фарватера;
//   cardinal-n|s|e|w — жёлто-чёрная веха с двумя конусами (с какой стороны от опасности проходить);
//   isolated — отдельная опасность: чёрная веха с красным поясом и двумя чёрными шарами.
const BLACK = 0x22262b, YELLOW = 0xf2c230, RED = 0xd23b2e, GREEN = 0x2f9e5b;
// пояса кардинальных вех снизу вверх и конусы топовой фигуры (+1 — вершиной вверх)
const CARDINAL = {
  'cardinal-n': { bands: [YELLOW, BLACK], cones: [1, 1] },
  'cardinal-s': { bands: [BLACK, YELLOW], cones: [-1, -1] },
  'cardinal-e': { bands: [BLACK, YELLOW, BLACK], cones: [-1, 1] },
  'cardinal-w': { bands: [YELLOW, BLACK, YELLOW], cones: [1, -1] },
};
const buoyMats = new Map();
const buoyMat = (c) => buoyMats.get(c) ?? buoyMats.set(c, flat(c)).get(c);
function makeBuoy(def) {
  const g = new THREE.Group();
  const add = (geo, color, y, rx = 0) => { const m = new THREE.Mesh(geo, buoyMat(color)); m.position.y = y; m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  const k = def.kind;
  if (!k) {
    add(new THREE.CylinderGeometry(0.45, 0.55, 1.0, 8), def.color, 0.3);
    add(new THREE.ConeGeometry(0.45, 0.8, 8), def.color, 1.2);
    add(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), 0x6e4a2b, 2.2);
    const flag = add(new THREE.BoxGeometry(0.02, 0.4, 0.6), 0xf4f1e8, 2.8);
    flag.position.z = 0.3;
  } else if (k === 'lateral-red' || k === 'lateral-green') {
    const red = k === 'lateral-red', c = red ? RED : GREEN;
    add(new THREE.CylinderGeometry(0.6, 0.7, 0.8, 10), c, 0.2);
    add(red ? new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8) : new THREE.ConeGeometry(0.55, 1.4, 8), c, red ? 1.2 : 1.3);
    add(red ? new THREE.CylinderGeometry(0.22, 0.22, 0.4, 8) : new THREE.ConeGeometry(0.25, 0.4, 8), c, 2.3); // топовая фигура
  } else if (CARDINAL[k]) {
    const { bands, cones } = CARDINAL[k], hb = 2.2 / bands.length;
    add(new THREE.CylinderGeometry(0.65, 0.75, 0.6, 10), bands[0], 0.1);
    bands.forEach((c, n) => add(new THREE.CylinderGeometry(0.3, 0.38, hb, 8), c, 0.4 + hb * (n + 0.5)));
    cones.forEach((d, n) => add(new THREE.ConeGeometry(0.28, 0.4, 8), BLACK, 2.95 + n * 0.5, d > 0 ? 0 : Math.PI));
  } else if (k === 'isolated') {
    add(new THREE.CylinderGeometry(0.65, 0.75, 0.6, 10), BLACK, 0.1);
    add(new THREE.CylinderGeometry(0.3, 0.38, 0.8, 8), BLACK, 0.8);
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8), RED, 1.5);
    add(new THREE.CylinderGeometry(0.28, 0.3, 0.6, 8), BLACK, 2.1);
    for (const y of [2.7, 3.25]) add(new THREE.SphereGeometry(0.2, 8, 6), BLACK, y);
  }
  g.position.set(def.x, 0, def.z);
  mergeStatic(g); // детали одного цвета — одним мешем
  return g;
}

// Коробка тени ±range вокруг (cx, cz): солнце на расстоянии depth по sunDir. Центр квантуется по текселю
// в плоскости света (базис камеры тени: x = up × sunDir, y = sunDir × x) — при движении тень не дрожит.
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function fitShadow(sun, sunDir, cx, cz, range, depth = 400) {
  const sc = sun.shadow.camera;
  if (sc.right !== range || sc.far !== 2 * depth) {
    sc.left = -range; sc.right = range; sc.top = range; sc.bottom = -range; sc.near = 1; sc.far = 2 * depth;
    sc.updateProjectionMatrix();
  }
  const texel = 2 * range / sun.shadow.mapSize.x;
  _u.crossVectors(_up, sunDir);
  if (_u.lengthSq() < 1e-8) _u.set(1, 0, 0);
  _u.normalize();
  _v.crossVectors(sunDir, _u);
  _c.set(cx, 0, cz);
  const a = Math.round(_c.dot(_u) / texel) * texel, b = Math.round(_c.dot(_v) / texel) * texel, w = _c.dot(sunDir);
  _c.copy(_u).multiplyScalar(a).addScaledVector(_v, b).addScaledVector(sunDir, w);
  sun.target.position.copy(_c);
  sun.position.copy(_c).addScaledVector(sunDir, depth);
  return texel;
}

// cfg.shadowRange — тень вокруг камеры ±shadowRange м (по умолчанию 120); cfg.buoys — буи карты
export function createEnvironment(scene, cfg) {
  const shadowRange = cfg.shadowRange ?? 120;

  const sky = createSky();
  scene.add(sky.mesh);
  const clouds = createClouds(sky);
  scene.add(clouds.group);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2b6f9a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(cfg.shadowSize ?? 2048, cfg.shadowSize ?? 2048);
  const sc = sun.shadow.camera;
  sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 10; sc.far = 260;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xdcecf5, 140, 1100);

  const buoys = (cfg.buoys ?? []).map((d) => { const g = makeBuoy(d); scene.add(g); return { g, d }; });

  const sunDir = new THREE.Vector3(0.4, 0.8, 0.3);

  let dayPhase;
  function setTimeOfDay(t) {
    dayPhase = t;
    // на краях суток солнце уходит на 8° под горизонт — сумерки со звёздами
    const elev = (-8 + 85 * Math.pow(Math.sin(Math.PI * t), 1.5)) * Math.PI / 180;
    const az = (-80 + 160 * t) * Math.PI / 180; // восток -> запад
    sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    applyLighting();
  }

  function applyLighting() {
    const ov = clouds.state.overcast;
    const L = sky.setSun(sunDir, dayPhase, ov);
    sun.color.copy(L.sunColor);
    sun.intensity = L.sunI;
    hemi.color.copy(L.hemi);
    hemi.groundColor.copy(L.ground);
    hemi.intensity = L.hemiI;
    scene.fog.color.copy(L.fog);
    sun.shadow.intensity = L.shadow;
    // в пасмурную погоду дымка гуще
    scene.fog.near = 140 - 60 * ov;
    scene.fog.far = 1100 - 350 * ov;
    clouds.setSun(sunDir);
  }

  const tmp = new THREE.Vector3();
  function update(dt, waves, wind, boat, camera) {
    // тень вокруг камеры: центр сдвинут от лодки туда, куда смотрит камера, на полокна — лодка всегда в тени
    let cx = boat.x, cz = boat.z;
    if (camera) {
      camera.getWorldDirection(tmp);
      const l = Math.hypot(tmp.x, tmp.z);
      if (l > 1e-3) { cx += tmp.x / l * shadowRange * 0.5; cz += tmp.z / l * shadowRange * 0.5; }
    }
    sun.shadow.normalBias = fitShadow(sun, sunDir, cx, cz, shadowRange);
    sky.update(boat.x, boat.z, waves.time);
    for (const { g, d } of buoys) {
      // d.obs — препятствие (src/physics/obstacles.js): знак, сдвинутый лодкой, и крен от его скорости
      const o = d.obs, x = o ? o.x : d.x, z = o ? o.z : d.z;
      const s = waves.sample(x, z);
      g.position.set(x, s.h - 0.1, z);
      g.rotation.z = -s.sx * 0.8 - (o ? o.vx * 0.25 : 0);
      g.rotation.x = s.sz * 0.8 + (o ? o.vz * 0.25 : 0);
    }
    if (clouds.update(dt, wind, boat.x, boat.z)) applyLighting();
  }

  setTimeOfDay(cfg.timeOfDay ?? 0.5);
  const setCloudType = (name, instant) => { clouds.setType(name, instant); if (instant) applyLighting(); };
  return { update, setTimeOfDay, setCloudType, cloudTypes: Object.keys(CLOUD_TYPES), get overcast() { return clouds.state.overcast; }, sun, hemi, sunDir, buoys: buoys.map((b) => b.g), sky, clouds };
}
