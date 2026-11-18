import { shoreDamp } from './shore-map.js';

const RADIUS = 140;       // точки берега дальше от камеры не проверяются
const CHECKS = 160;       // проверок точек за кадр (по кругу)
const PROBE = 1.5;        // вода проверяется в стольких метрах от кромки к морю
const COOLDOWN = 0.8;     // точка не бьёт чаще, с
const STALE = 0.25;       // давнее последней проверки — высота устарела, удар не засчитываем

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

// Брызги прибоя на наветренном берегу: точки берега (shoreMap.sites) бьют, когда к ним
// подходит гребень видимой волны. Пляж — низкий веер капель к берегу; обрыв и скала —
// стена брызг вверх и клубы пыли, которые ветер уносит на сушу.
export function createShoreSpray(particles, shoreMap) {
  const S = shoreMap.sites;
  const prevH = new Float32Array(S.count);
  const seen = new Float32Array(S.count).fill(-1);   // время последней проверки
  const ready = new Float32Array(S.count);           // время, с которого точка снова может бить
  const near = [];
  let cursor = 0, time = 0;
  const stats = { near: 0, bursts: 0 };

  function burst(i, h, k, amp) {
    const x = S.x[i], z = S.z[i], nx = S.nx[i], nz = S.nz[i], steep = S.steep[i];
    const tx = -nz, tz = nx;
    // сила удара по высоте волны: в шторм выше и гуще
    const a = Math.min(1.5, 0.4 + 0.6 * amp);
    const drops = Math.round(k * (8 + 22 * steep) * a);
    const mist = Math.round(k * (3 + 9 * steep) * a);
    for (let j = 0; j < drops; j++) {
      const u = rnd(-1.5, 1.5);
      const px = x + tx * u + nx * rnd(0, 0.8), pz = z + tz * u + nz * rnd(0, 0.8);
      // пляж: вода летит на берег и невысоко вверх; круча: вверх вдоль стены
      const toShore = (1 - steep) * rnd(1, 3) + steep * rnd(0, 0.6);
      const side = rnd(-1, 1) * (0.5 + steep);
      const vy = ((1 - steep) * rnd(1.5, 3) + steep * rnd(4, 9)) * a;
      particles.drop.emit(px, h, pz, -nx * toShore + tx * side, vy, -nz * toShore + tz * side,
        rnd(1, 1.6), rnd(0.05, 0.14));
    }
    for (let j = 0; j < mist; j++) {
      const u = rnd(-1.5, 1.5);
      particles.mist.emit(x + tx * u, h + rnd(0, 1.5) * steep * a, z + tz * u,
        -nx * rnd(0, 1), rnd(0.5, 1) + steep * rnd(1, 3) * a, -nz * rnd(0, 1),
        rnd(1.5, 2.5) + steep, rnd(0.4, 0.7) + 0.3 * steep, rnd(0.6, 1.2) + steep * 0.5);
    }
    stats.bursts++;
  }

  function update(dt, waves, wind, camera) {
    if (dt <= 0) return;
    time += dt;
    const amount = particles.amount('shore');
    // прибой со брызгами — только при заметном волнении
    const sea = smooth(0.3, 1.2, waves.sigHeight);
    near.length = 0;
    stats.near = 0;
    if (!amount || !sea || !S.count) return;
    const w = wind.vector(), wl = Math.hypot(w.x, w.z) || 1;
    const wx = w.x / wl, wz = w.z / wl;
    // наветренный берег: ветер дует с моря на сушу, против нормали «от берега»
    S.query(camera.position.x, camera.position.z, RADIUS, (i) => {
      if (-(S.nx[i] * wx + S.nz[i] * wz) > 0.1) near.push(i);
    });
    stats.near = near.length;
    if (!near.length) return;
    const amp = waves.maxAmplitude();
    const n = Math.min(CHECKS, near.length);
    for (let c = 0; c < n; c++) {
      cursor = (cursor + 1) % near.length;
      const i = near[cursor];
      const px = S.x[i] + S.nx[i] * PROBE, pz = S.z[i] + S.nz[i] * PROBE;
      const h = waves.heightAt(px, pz);
      // гребень: подъём воды через порог; порог — доля амплитуды с учётом гашения у берега
      const thr = 0.3 * amp * shoreDamp(shoreMap.depthAt(px, pz));
      const fresh = time - seen[i] < STALE;
      if (fresh && prevH[i] < thr && h >= thr && time >= ready[i]) {
        const ww = -(S.nx[i] * wx + S.nz[i] * wz);
        burst(i, h, amount * sea * ww, amp);
        ready[i] = time + COOLDOWN;
      }
      prevH[i] = h;
      seen[i] = time;
    }
  }

  return { update, stats };
}
