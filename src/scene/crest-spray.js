import * as THREE from 'three';
import { whitecapForce, whitecapThreshold } from './water-fx.js';

const R0 = 5, R1 = 80;     // кольцо вокруг камеры, где ищем гребни, м
const SAMPLES = 2000;      // проб в секунду при полной силе
const IN_VIEW = 0.8;       // доля проб в секторе обзора
const DROPS_FROM = 30;
// группы барашков — с самых высоких гребней: доля проб выше порога групп от слабого ветра к сильному;
// порог — скользящая квантиль высоты гребня по самим пробам (абсолютный порог брызг при умеренном ветре недостижим)
const TOP_LO = 0.015, TOP_HI = 0.045, Q_RATE = 0.01;     // ближе — только пыль: срыв гребня — это водяная пыль, крупные капли вблизи выглядят горохом

const rnd = (a, b) => a + Math.random() * (b - a);

// Срыв гребней: случайные пробы вокруг камеры. На самых высоких гребнях — точки срыва: в них рождаются группы
// барашков (water.whitecapGroups), с умеренного ветра, даже если брызг не видно. Где гребень выше порога барашков
// из шейдера воды, ветер ещё и срывает шлейф пыли и пару капель — такая точка всегда и точка группы.
export function createCrestSpray(particles, water) {
  let acc = 0, q = 1.2;
  const dir = new THREE.Vector3();
  // hits — точки брызг, q — порог групп
  const stats = { hits: 0, q: 0 };

  function update(dt, waves, wind, camera) {
    if (dt <= 0) return;
    const cx = camera.position.x, cz = camera.position.z;
    water.whitecapGroups.center(cx, cz, R1);
    const amount = particles.amount('crest');
    // сила барашков с галкой и «Количеством» (water.js) и сила брызг
    const capF = water.uniforms.uWhitecap.value.x;
    const force = THREE.MathUtils.smoothstep(wind.speed, 11, 18);
    const sprayF = force * Math.min(1, amount);
    if (!capF && !sprayF) { acc = 0; return; }
    // порог барашков из шейдера воды (без шума полос); срывается только самый верх
    const thr = whitecapThreshold(whitecapForce(wind.speed)) + 0.4;
    const top = TOP_LO + (TOP_HI - TOP_LO) * capF;
    const w = wind.vector();
    camera.getWorldDirection(dir);
    const yaw = Math.atan2(dir.z, dir.x);
    // половина горизонтального угла обзора
    const half = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    acc += SAMPLES * Math.max(capF, sprayF) * dt;
    for (; acc >= 1; acc--) {
      const a = Math.random() < IN_VIEW ? yaw + rnd(-half, half) : rnd(0, Math.PI * 2);
      // равномерно по расстоянию: ближних гребней больше, чем при равномерной площади, — их и видно
      const r = rnd(R0, R1);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const c = waves.crestAt(x, z);
      // у берега (−1) не считаем
      if (c > -1) q += c > q ? Q_RATE * (1 - top) : -Q_RATE * top;
      if (c < Math.min(q, thr)) continue;
      if (capF) water.whitecapGroups.spawn(x, z);
      if (c < thr) continue;
      stats.hits++;
      // брызги — с части точек: их поток тот же, что от одной силы брызг
      if (Math.random() * Math.max(capF, sprayF) >= sprayF) continue;
      const h = waves.heightAt(x, z);
      const k = force * amount;
      // шлейф: клубы цепочкой по ветру от гребня
      const wl = Math.hypot(w.x, w.z) || 1, ux = w.x / wl, uz = w.z / wl;
      const mist = Math.round(rnd(1, 3) * k + Math.random());
      for (let j = 0; j < mist; j++) {
        const along = rnd(0, 2.5);
        particles.mist.emit(x + ux * along + rnd(-0.4, 0.4), h + rnd(0.1, 0.4), z + uz * along + rnd(-0.4, 0.4),
          w.x * rnd(0.4, 0.7), rnd(0.5, 1.5), w.z * rnd(0.4, 0.7),
          rnd(1.5, 2.5), rnd(0.35, 0.6), rnd(0.8, 1.6));
      }
      const drops = r > DROPS_FROM ? Math.round(rnd(0, 2.5) * k) : 0;
      for (let j = 0; j < drops; j++) {
        particles.drop.emit(x + rnd(-0.5, 0.5), h + 0.1, z + rnd(-0.5, 0.5),
          w.x * rnd(0.3, 0.6), rnd(1, 2.5), w.z * rnd(0.3, 0.6),
          rnd(0.6, 1.1), rnd(0.04, 0.09));
      }
    }
    stats.q = q;
  }

  return { update, stats };
}
