// Сидированный 2D-шум для рельефа: градиентный шум (Perlin), fbm, ridged и искажение координат.
// Значения noise2 — примерно [−1, 1], fbm нормирован на сумму амплитуд.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise(seed = 1) {
  const rng = mulberry32(seed * 7919 + 13);
  const perm = new Uint8Array(512), gx = new Float32Array(256), gz = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = rng() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function noise2(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const fx = x - xi, fz = z - zi, X = xi & 255, Z = zi & 255;
    const dot = (h, dx, dz) => gx[h] * dx + gz[h] * dz;
    const a = dot(perm[X + perm[Z]], fx, fz), b = dot(perm[X + 1 + perm[Z]], fx - 1, fz);
    const c = dot(perm[X + perm[Z + 1]], fx, fz - 1), d = dot(perm[X + 1 + perm[Z + 1]], fx - 1, fz - 1);
    const u = fade(fx), v = fade(fz);
    return 1.41 * ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v);
  }

  // fbm: octaves октав, частота растёт в 2 раза, амплитуда падает в gain раз
  function fbm(x, z, octaves = 4, gain = 0.5) {
    let s = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      s += amp * noise2(x * f + o * 17.3, z * f - o * 9.1);
      norm += amp; amp *= gain; f *= 2.03;
    }
    return s / norm;
  }

  // ridged: острые гребни (1 − |n|)², [0, 1]
  function ridged(x, z, octaves = 4, gain = 0.5) {
    let s = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(noise2(x * f - o * 5.7, z * f + o * 11.9));
      s += amp * n * n;
      norm += amp; amp *= gain; f *= 2.03;
    }
    return s / norm;
  }

  // искажение координат: смещение (м) точки на amp при масштабе scale (м)
  function warp(x, z, scale, amp, out = { x: 0, z: 0 }) {
    out.x = x + amp * fbm(x / scale + 31.7, z / scale - 3.3, 3);
    out.z = z + amp * fbm(x / scale - 12.1, z / scale + 47.9, 3);
    return out;
  }

  return { noise2, fbm, ridged, warp };
}
