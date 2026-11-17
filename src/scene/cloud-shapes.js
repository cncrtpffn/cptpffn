// Генераторы формы облаков из «пуфов» — сплюснутых шаров {x,y,z,sx,sy,sz}.
// Координаты локальные: y=0 — нижняя кромка облака, +x — по ветру, +z — поперёк.
// Каждая функция возвращает { puffs, height, density }; density 0..1 — насколько темно дно.

const TAU = Math.PI * 2;

function puff(list, x, y, z, s, flat = 0.65, stretch = 1) {
  list.push({ x, y, z, sx: s * stretch, sy: s * flat, sz: s });
}

// кучевое хорошей погоды: плоское дно из широких пуфов и купол сверху
export function cumulus(rng, R = 30) {
  const puffs = [];
  const nb = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + rng() * 0.6;
    const r = R * (0.35 + 0.45 * rng());
    const s = R * (0.45 + 0.25 * rng());
    puff(puffs, Math.cos(a) * r, s * 0.45, Math.sin(a) * r * 0.75, s, 0.55);
  }
  puff(puffs, 0, R * 0.45, 0, R * 0.7, 0.75);
  const nt = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < nt; i++) {
    const a = rng() * TAU, r = R * 0.4 * rng();
    const s = R * (0.35 + 0.25 * rng());
    puff(puffs, Math.cos(a) * r, R * (0.55 + 0.4 * rng()), Math.sin(a) * r * 0.8, s, 0.85);
  }
  return { puffs, height: R * 1.3, density: 0.1 };
}

// слоисто-кучевое: широкая плоская гряда, вытянутая поперёк ветра
export function stratocumulus(rng, L = 220) {
  const puffs = [];
  const n = 8 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const z = (i / (n - 1) - 0.5) * L + (rng() - 0.5) * 20;
    const s = 28 + rng() * 18;
    puff(puffs, (rng() - 0.5) * 50, s * 0.25, z, s, 0.4, 1.3);
  }
  return { puffs, height: 30, density: 0.6 };
}

// башня мощного кучевого облака — общая часть грозовой ячейки и фронта
function tower(puffs, rng, cx, cz, rb, H, step = 55, perLevel = 2) {
  const levels = Math.max(2, Math.round(H / step));
  for (let k = 0; k < levels; k++) {
    const f = k / levels;
    const rk = rb * (1 - 0.55 * f);
    const n = k === 0 ? perLevel + 2 : perLevel + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = rk * 0.5 * Math.sqrt(rng());
      puff(puffs, cx + Math.cos(a) * r, k * step + rk * 0.3, cz + Math.sin(a) * r, rk * (0.6 + 0.25 * rng()), k === 0 ? 0.45 : 0.8);
    }
  }
}

// грозовая ячейка: тёмное плоское основание, главная башня с боковыми «ступенями»
// и наковальня, растянутая по ветру
export function cumulonimbus(rng, scale = 1) {
  const puffs = [];
  const R = 170 * scale, H = 560 * scale, step = 60 * scale;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + rng() * 0.4, r = R * (0.3 + 0.8 * rng());
    puff(puffs, Math.cos(a) * r, 12 * scale, Math.sin(a) * r, R * (0.45 + 0.2 * rng()), 0.3);
  }
  tower(puffs, rng, 0, 0, R, H, step, 3);
  // боковые башни пониже — ступенчатые склоны
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU;
    tower(puffs, rng, Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, R * 0.65, H * (0.45 + 0.3 * rng()), step, 2);
  }
  // наковальня: широкий плоский «гриб», сильнее вытянутый вперёд по ветру
  const ay = H + 30 * scale;
  for (let i = 0; i < 20; i++) {
    const t = rng();
    const x = (-0.3 + 1.3 * t) * R * 3.5;
    const w = R * (0.8 + 1.6 * t);
    puff(puffs, x, ay + (rng() - 0.5) * 30 * scale, (rng() - 0.5) * 2 * w,
      R * (0.6 + 0.35 * rng()), 0.28, 1.4);
  }
  return { puffs, height: ay + 40 * scale, density: 1 };
}

// холодный фронт: стена мощных облаков вдоль линии поперёк ветра, перед ней — шельф,
// позади — гряды слоисто-кучевых (над ними ещё сплошной слой, см. clouds.js)
export function coldFront(rng, L = 2400) {
  const puffs = [];
  const n = Math.round(L / 90);
  for (let i = 0; i < n; i++) {
    const z = (i / (n - 1) - 0.5) * L + (rng() - 0.5) * 30;
    const edge = 1 - Math.pow(Math.abs(z) / (L * 0.5), 3); // к концам линия ниже
    tower(puffs, rng, (rng() - 0.5) * 60, z, 70 + rng() * 40, (160 + rng() * 300) * edge + 60, 60);
  }
  // шельф — длинный тёмный валик у переднего нижнего края
  const ns = Math.round(L / 45);
  for (let i = 0; i < ns; i++) {
    const z = (i / (ns - 1) - 0.5) * L * 0.95;
    puff(puffs, 70 + (rng() - 0.5) * 16, -8, z, 30 + rng() * 10, 0.3, 1.6);
  }
  // гряды позади фронта
  for (let i = 0; i < 40; i++) {
    const s = 30 + rng() * 20;
    puff(puffs, -120 - rng() * 600, s * 0.25 + 10, (rng() - 0.5) * L * 0.9, s, 0.4, 1.4);
  }
  return { puffs, height: 480, density: 0.85 };
}
