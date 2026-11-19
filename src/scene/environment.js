import * as THREE from 'three';
import { makeIsland } from './island.js';
import { createSky } from './sky.js';
import { createClouds, CLOUD_TYPES } from './clouds.js';
import { mergeStatic } from './merge-static.js';

const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });

function makeBuoy(def) {
  const g = new THREE.Group();
  const paint = flat(def.color);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.0, 8), paint);
  body.position.y = 0.3;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 8), paint);
  top.position.y = 1.2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), flat(0x6e4a2b));
  pole.position.y = 2.2;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.6), flat(0xf4f1e8));
  flag.position.set(0, 2.8, 0.3);
  [body, top, pole, flag].forEach((m) => { m.castShadow = true; g.add(m); });
  g.position.set(def.x, 0, def.z);
  mergeStatic(g); // корпус и конус одним мешем
  return g;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEnvironment(scene, cfg) {
  const rng = mulberry32(7);

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

  const islands = cfg.islands.map((d) => { const g = makeIsland(d, rng); scene.add(g); return g; });
  const buoys = cfg.buoys.map((d) => { const g = makeBuoy(d); scene.add(g); return { g, d }; });

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
  function update(dt, waves, wind, boat) {
    // солнце и тени следуют за лодкой
    sun.target.position.set(boat.x, 0, boat.z);
    sun.position.copy(tmp.copy(sunDir).multiplyScalar(120).add(sun.target.position));
    sky.update(boat.x, boat.z, waves.time);
    for (const { g, d } of buoys) {
      const s = waves.sample(d.x, d.z);
      g.position.y = s.h - 0.1;
      g.rotation.z = -s.sx * 0.8;
      g.rotation.x = s.sz * 0.8;
    }
    if (clouds.update(dt, wind, boat.x, boat.z)) applyLighting();
  }

  setTimeOfDay(cfg.timeOfDay ?? 0.5);
  const setCloudType = (name, instant) => { clouds.setType(name, instant); if (instant) applyLighting(); };
  return { update, setTimeOfDay, setCloudType, cloudTypes: Object.keys(CLOUD_TYPES), get overcast() { return clouds.state.overcast; }, sun, hemi, sunDir, islands, buoys: buoys.map((b) => b.g), sky, clouds };
}
