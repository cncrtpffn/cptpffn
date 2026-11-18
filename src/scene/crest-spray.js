import * as THREE from 'three';

const R0 = 5, R1 = 80;     // кольцо вокруг камеры, где ищем гребни, м
const SAMPLES = 2000;      // проб в секунду при полной силе
const IN_VIEW = 0.8;       // доля проб в секторе обзора
const DROPS_FROM = 30;     // ближе — только пыль: срыв гребня — это водяная пыль, крупные капли вблизи выглядят горохом

const rnd = (a, b) => a + Math.random() * (b - a);

// Срыв гребней в сильный ветер: случайные пробы вокруг камеры; где гребень круче порога
// барашков (как в шейдере воды), ветер срывает с него шлейф пыли и пару капель.
export function createCrestSpray(particles) {
  let acc = 0;
  const dir = new THREE.Vector3();
  const stats = { hits: 0 };

  function update(dt, waves, wind, camera) {
    if (dt <= 0) return;
    const amount = particles.amount('crest');
    const force = THREE.MathUtils.smoothstep(wind.speed, 11, 18);
    if (!amount || !force) { acc = 0; return; }
    // порог барашков из шейдера воды: lo = mix(0.36, 0.2, whitecap); срывается только самый верх
    const whitecap = THREE.MathUtils.clamp((wind.speed - 5) / 10, 0, 1);
    const thr = THREE.MathUtils.lerp(0.36, 0.2, whitecap) + 0.05;
    const w = wind.vector();
    camera.getWorldDirection(dir);
    const yaw = Math.atan2(dir.z, dir.x);
    // половина горизонтального угла обзора
    const half = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const cx = camera.position.x, cz = camera.position.z;
    acc += SAMPLES * force * Math.min(1, amount) * dt;
    for (; acc >= 1; acc--) {
      const a = Math.random() < IN_VIEW ? yaw + rnd(-half, half) : rnd(0, Math.PI * 2);
      // равномерно по расстоянию: ближних гребней больше, чем при равномерной площади, — их и видно
      const r = rnd(R0, R1);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (waves.steepAt(x, z) < thr) continue;
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
      stats.hits++;
    }
  }

  return { update, stats };
}
