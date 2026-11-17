import * as THREE from 'three';
import { BOAT, WIND, SEA, SCENE, DEG } from './config.js';
import { Wind } from './physics/wind.js';
import { Waves } from './physics/waves.js';
import { Boat } from './physics/boat.js';
import { createWater } from './scene/water.js';
import { createBoatMesh } from './scene/boat-mesh.js';
import { createWake } from './scene/wake.js';
import { createSpray } from './scene/spray.js';
import { createEnvironment } from './scene/environment.js';
import { FollowCamera } from './scene/camera.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { createWeatherPanel } from './ui/weather-panel.js';
import { createTouchControls, isTouchDevice } from './ui/touch.js';
import { makeCollapsible } from './ui/collapse.js';
import { applyIcons } from './ui/icons.js';
import './debug/polar.js';

const STEP = 1 / 120;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 5000);

// --- модель ---
const wind = new Wind(WIND);
const waves = new Waves();
const boat = new Boat(BOAT);
boat.reset(0, 0, SCENE.startHeadingDeg * DEG);
const sea = { ...SEA };

// --- сцена ---
const env = createEnvironment(scene, SCENE);
const water = createWater(waves, { size: SCENE.waterSize, segments: SCENE.waterSegments });
scene.add(water.mesh, water.far);
const boatMesh = createBoatMesh();
scene.add(boatMesh.group);
const wake = createWake();
const spray = createSpray();
scene.add(spray.mesh);
const followCam = new FollowCamera(camera, canvas);

// --- UI ---
const input = new Input();
const hud = new Hud();
let paused = false;
const actions = {
  righten: () => { if (boat.capsized) boat.righten(wind.dir); },
  resetBoat: () => { boat.reset(0, 0, SCENE.startHeadingDeg * DEG); input.crew = 0; wake.reset(); },
};
createWeatherPanel({ wind, sea, env, actions });
input.on('reef', (d) => boat.sail.reef(d));
input.on('camera', () => followCam.nextMode());
// пауза показывает справку; закрыть справку — продолжить
const setPaused = (v) => { paused = v; hud.showHelp(v); };
input.on('pause', () => setPaused(!paused));
input.on('help', () => setPaused(!paused));
input.on('escape', () => setPaused(false));
input.on('righten', actions.righten);
document.getElementById('btn-righten').addEventListener('click', actions.righten);
document.getElementById('btn-pause').addEventListener('click', () => input.trigger('pause'));
document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
document.getElementById('btn-help-close').addEventListener('click', () => setPaused(false));
document.getElementById('help').addEventListener('click', (e) => { if (e.target.id === 'help') setPaused(false); });

// тач-управление и сворачиваемые панели
applyIcons();
createTouchControls(input);
const touch = isTouchDevice();
// на таче органы управления живут в колонке над слайдером руля
if (touch) document.querySelector('#touch-ui .t-left').prepend(document.getElementById('hud-controls'));
makeCollapsible(document.getElementById('hud-main'), { key: 'main', title: 'Приборы' });
makeCollapsible(document.getElementById('hud-controls'), { key: 'controls', title: 'Органы управления', ...(touch && { defaultCollapsed: true }) });
makeCollapsible(document.getElementById('hint'), { key: 'hint', title: 'Подсказка', ...(touch && { defaultCollapsed: true }) });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- отладка через URL: ?t=30&twa=60&wind=8&cam=chase&auto=1 ---
const params = new URLSearchParams(location.search);
let simTime = 0;
const debugAuto = params.has('auto') || params.has('t');
if (params.has('wind')) wind.baseSpeed = parseFloat(params.get('wind'));
if (params.has('winddir')) wind.baseDirDeg = parseFloat(params.get('winddir'));
if (params.has('cam')) followCam.mode = params.get('cam');
if (params.has('reefs')) { boat.sail.reefTarget = boat.sail.reefLevel = parseInt(params.get('reefs'), 10); }
if (params.has('board')) boat.board = parseFloat(params.get('board'));
if (params.has('tod')) env.setTimeOfDay(parseFloat(params.get('tod')));
const autoTwa = parseFloat(params.get('twa') || '60') * DEG;
function autopilotControls() {
  const targetPsi = wind.dir - autoTwa;
  let err = targetPsi - boat.psi;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const rudderAngle = Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
  const sheetAngle = Math.abs(boat.aw.awa) - 24 * DEG;
  return { rudderAngle, sheetAngle, crew: Math.sign(boat.aw.twa || 1), board: 0, rudder: 0, sheet: 0 };
}
if (params.has('t')) {
  const secs = parseFloat(params.get('t'));
  for (let i = 0; i < secs / STEP; i++) {
    wind.update(STEP);
    waves.configure(Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) * SEA.maxHeight, wind.dir, wind.baseSpeed);
    waves.update(STEP);
    boat.step(STEP, autopilotControls(), wind, waves, SCENE.islands);
    simTime += STEP;
    wake.update(simTime, boat);
  }
  waves.sigHeight = waves.targetHeight;
  boatMesh.update(boat, 0);
  followCam.update(100, boat, boatMesh);
}
const debugLog = params.has('log');

// --- цикл ---
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    const seaState = sea.auto ? Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) : sea.state;
    if (sea.auto) sea.state = seaState;
    waves.configure(seaState * SEA.maxHeight, wind.dir, wind.baseSpeed);
    const controls = debugAuto ? autopilotControls() : input.controls;
    let n = 0;
    while (acc >= STEP && n < 12) {
      wind.update(STEP);
      waves.update(STEP);
      boat.step(STEP, controls, wind, waves, SCENE.islands);
      acc -= STEP; n++;
      simTime += STEP;
    }
    if (n === 12) acc = 0;
  }
  wake.update(simTime, boat);
  boatMesh.update(boat, simTime);
  if (!paused) spray.update(dt, boat, waves, wind, boatMesh);
  water.update(waves, boat.x, boat.z, {
    time: waves.time, sunDir: env.sunDir, sunColor: env.sun.color, windDir: wind.vector(),
    whitecap: THREE.MathUtils.clamp((wind.speed - 5) / 10, 0, 1), wake,
  });
  env.update(paused ? 0 : dt, waves, wind, boat);
  followCam.update(dt || 0.016, boat, boatMesh);
  hud.update({ boat, wind, cameraMode: followCam.mode });
  renderer.render(scene, camera);
  if (debugLog && Math.floor(simTime) !== Math.floor(simTime - dt)) {
    console.log(`[sim] t=${simTime.toFixed(1)} boat=(${boat.x.toFixed(1)},${boat.y.toFixed(2)},${boat.z.toFixed(1)}) u=${boat.u.toFixed(2)} heel=${(boat.phi / DEG).toFixed(1)} cam=(${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}) tws=${wind.speed.toFixed(1)} H=${waves.sigHeight.toFixed(2)}`);
  }
}
document.getElementById('loading').remove();
requestAnimationFrame(frame);

// отладка из консоли
window.__sim = { boat, wind, waves, sea, env, followCam, scene, wake, spray, input };
