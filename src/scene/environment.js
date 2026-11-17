import * as THREE from 'three';
import { makeIsland } from './island.js';

const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });

function makeBuoy(def) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.0, 8), flat(def.color));
  body.position.y = 0.3;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 8), flat(def.color));
  top.position.y = 1.2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), flat(0x6e4a2b));
  pole.position.y = 2.2;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.6), flat(0xf4f1e8));
  flag.position.set(0, 2.8, 0.3);
  [body, top, pole, flag].forEach((m) => { m.castShadow = true; g.add(m); });
  g.position.set(def.x, 0, def.z);
  return g;
}

function makeCloud(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const s = 6 + rng() * 10;
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 5), mat);
    m.position.set((i - n / 2) * s * 0.9 + rng() * 4, rng() * 3, (rng() - 0.5) * 8);
    m.scale.y = 0.55;
    g.add(m);
  }
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

  // небо: градиентный купол
  const skyUniforms = {
    top: { value: new THREE.Color(0x6fb7e8) },
    horizon: { value: new THREE.Color(0xdcecf5) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vW;
        void main(){ float h = normalize(vW - cameraPosition).y; float t = smoothstep(-0.05, 0.45, h); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }`,
    }),
  );
  scene.add(sky);

  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(40, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c0, fog: false }));
  scene.add(sunDisc);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2b6f9a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 10; sc.far = 260;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xdcecf5, 140, 1100);

  const islands = cfg.islands.map((d) => { const g = makeIsland(d, rng); scene.add(g); return g; });
  const buoys = cfg.buoys.map((d) => { const g = makeBuoy(d); scene.add(g); return { g, d }; });
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const c = makeCloud(rng);
    c.position.set((rng() - 0.5) * 1400, 90 + rng() * 60, (rng() - 0.5) * 1400);
    scene.add(c); clouds.push(c);
  }

  const palette = {
    noon: { top: 0x6fb7e8, horizon: 0xdcecf5, sun: 0xfff2d8, sunI: 2.4, hemi: 0xcfe8ff, ground: 0x2b6f9a, fog: 0xdcecf5 },
    low: { top: 0x5a5a9a, horizon: 0xf6b07a, sun: 0xffb070, sunI: 1.7, hemi: 0xe8b8c8, ground: 0x2a4d6f, fog: 0xf2c2a0 },
  };
  const sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  const cA = new THREE.Color(), cB = new THREE.Color();
  const lerpColor = (a, b, t) => cA.set(a).lerp(cB.set(b), t).clone();

  function setTimeOfDay(t) {
    const elev = (5 + 72 * Math.sin(Math.PI * t)) * Math.PI / 180;
    const az = (-80 + 160 * t) * Math.PI / 180; // восток -> запад
    sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    const low = Math.pow(1 - Math.sin(Math.PI * t), 2.2);
    skyUniforms.top.value.copy(lerpColor(palette.noon.top, palette.low.top, low));
    skyUniforms.horizon.value.copy(lerpColor(palette.noon.horizon, palette.low.horizon, low));
    sun.color.copy(lerpColor(palette.noon.sun, palette.low.sun, low));
    sun.intensity = THREE.MathUtils.lerp(palette.noon.sunI, palette.low.sunI, low);
    hemi.color.copy(lerpColor(palette.noon.hemi, palette.low.hemi, low));
    hemi.groundColor.copy(lerpColor(palette.noon.ground, palette.low.ground, low));
    scene.fog.color.copy(lerpColor(palette.noon.fog, palette.low.fog, low));
  }

  const tmp = new THREE.Vector3();
  function update(dt, waves, wind, boat) {
    // солнце и тени следуют за лодкой
    sun.target.position.set(boat.x, 0, boat.z);
    sun.position.copy(tmp.copy(sunDir).multiplyScalar(120).add(sun.target.position));
    sunDisc.position.copy(tmp.copy(sunDir).multiplyScalar(2200).add(new THREE.Vector3(boat.x, 0, boat.z)));
    sky.position.set(boat.x, 0, boat.z);
    for (const { g, d } of buoys) {
      const s = waves.sample(d.x, d.z);
      g.position.y = s.h - 0.1;
      g.rotation.z = -s.sx * 0.8;
      g.rotation.x = s.sz * 0.8;
    }
    const w = wind.vector();
    for (const c of clouds) {
      c.position.x += w.x * dt * 2.5;
      c.position.z += w.z * dt * 2.5;
      const dx = c.position.x - boat.x, dz = c.position.z - boat.z;
      if (dx > 800) c.position.x -= 1600; if (dx < -800) c.position.x += 1600;
      if (dz > 800) c.position.z -= 1600; if (dz < -800) c.position.z += 1600;
    }
  }

  setTimeOfDay(0.4);
  return { update, setTimeOfDay, sun, sunDir, islands };
}
