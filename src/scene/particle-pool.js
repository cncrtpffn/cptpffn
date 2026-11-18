// Пул частиц без Three.js: SoA-массивы, баллистика с уводом к ветру.
// gravity — ускорение вниз (м/с²), drag — как быстро скорость частицы уходит к скорости воздуха (1/с).
export function createPool(max, { gravity, drag }) {
  const p = {
    max, alive: 0,
    px: new Float32Array(max), py: new Float32Array(max), pz: new Float32Array(max),
    vx: new Float32Array(max), vy: new Float32Array(max), vz: new Float32Array(max),
    life: new Float32Array(max), maxLife: new Float32Array(max),
    size: new Float32Array(max), grow: new Float32Array(max),
  };
  const F = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'grow'].map((k) => p[k]);

  // grow — рост размера, м/с (клубы пыли расплываются); false — пул полон
  p.emit = (x, y, z, vx, vy, vz, life, size, grow = 0) => {
    if (p.alive >= max) return false;
    const i = p.alive++;
    p.px[i] = x; p.py[i] = y; p.pz[i] = z;
    p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz;
    p.life[i] = p.maxLife[i] = life;
    p.size[i] = size; p.grow[i] = grow;
    return true;
  };

  // kill(i) → true — убрать частицу (уже сдвинутую на этом шаге); мёртвые вытесняются перестановкой
  p.step = (dt, windX, windZ, kill) => {
    const k = Math.exp(-drag * dt);
    let j = 0;
    for (let i = 0; i < p.alive; i++) {
      p.life[i] -= dt;
      p.vy[i] -= gravity * dt;
      p.vx[i] = windX + (p.vx[i] - windX) * k;
      p.vz[i] = windZ + (p.vz[i] - windZ) * k;
      p.px[i] += p.vx[i] * dt; p.py[i] += p.vy[i] * dt; p.pz[i] += p.vz[i] * dt;
      p.size[i] += p.grow[i] * dt;
      if (p.life[i] <= 0 || (kill && kill(i))) continue;
      if (j !== i) for (const a of F) a[j] = a[i];
      j++;
    }
    p.alive = j;
  };

  p.clear = () => { p.alive = 0; };
  return p;
}
