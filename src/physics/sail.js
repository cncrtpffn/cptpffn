import { RHO_AIR, DEG } from '../config.js';

// Табличные коэффициенты грота по углу атаки (градусы).
const ALPHA = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120, 150, 180];
// За срывом сила почти нормальна к полотнищу: CL ≈ CN·cos α, CD ≈ CN·sin α, CN ≈ 1.25.
const CL = [0, 0.35, 0.7, 1.0, 1.2, 1.35, 1.4, 1.3, 1.1, 0.85, 0.65, 0.45, 0.22, 0.0, -0.2, -0.5, -0.6, 0];
const CD = [0.05, 0.06, 0.08, 0.1, 0.14, 0.2, 0.28, 0.4, 0.55, 0.8, 1.0, 1.15, 1.25, 1.3, 1.25, 1.1, 0.65, 0.1];

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

export function sailCoeffs(alphaRad) {
  const a = Math.abs(alphaRad) / DEG;
  return { cl: interp(ALPHA, CL, a), cd: interp(ALPHA, CD, a) };
}

function lerpArr(arr, t) {
  const i = Math.min(arr.length - 2, Math.max(0, Math.floor(t)));
  const f = Math.min(1, Math.max(0, t - i));
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}

// Грот: шкот, гик, рифы, заполаскивание, поворот фордевинд, силы.
export class Sail {
  constructor(cfg) {
    this.cfg = cfg;
    this.sheet = cfg.sheetMax;       // предельный угол гика (рад)
    this.boom = 0;                   // текущий угол гика, <0 — на левый борт
    this.reefTarget = 0;
    this.reefLevel = 0;              // непрерывный 0..2
    this.furl = 0;                   // 0..1, парус спущен (reefTarget = 3)
    this.tackSide = 1;               // 1 — ветер справа (гик слева)
    this.gybing = false;
    this.gybeImpulse = 0;            // момент крена от перелёта гика (Н·м·с), снимается лодкой
    this.gybeTimer = 0;
    this.status = 'luff';
    this.alpha = 0;
    this.flutter = 0;                // 0..1, сила заполаскивания для анимации
  }

  get areaFactor() { return lerpArr(this.cfg.reefArea, this.reefLevel); }
  get heightFactor() { return lerpArr(this.cfg.reefCeHeight, this.reefLevel); }
  get area() { return this.cfg.sailArea * this.areaFactor * (1 - this.furl); }
  get ceHeight() { return this.cfg.ceHeight * this.heightFactor; }

  // ступени: 0 — полный, 1–2 — рифы, 3 — парус спущен
  reef(delta) {
    this.reefTarget = Math.min(3, Math.max(0, this.reefTarget + delta));
  }
  // сразу поставить ступень (старт, отладка)
  setReef(n) {
    this.reefTarget = Math.min(3, Math.max(0, n));
    this.reefLevel = Math.min(2, this.reefTarget);
    this.furl = this.reefTarget > 2 ? 1 : 0;
  }

  // Обновить гик/рифы и посчитать силы в связанной СК. heel — крен (рад).
  update(dt, awa, aws, heel, sheetInput) {
    const c = this.cfg;
    // Шкот
    if (sheetInput) {
      this.sheet = Math.min(c.sheetMax, Math.max(c.sheetMin, this.sheet - sheetInput * c.sheetRate * dt));
    }
    // Рифы и спуск: парус спускают со второго рифа, поднимают до отдачи рифов
    const approach = (v, goal, step) => (Math.abs(goal - v) <= step ? goal : v + Math.sign(goal - v) * step);
    const furlGoal = this.reefTarget > 2 ? 1 : 0;
    if (this.furl !== furlGoal && (furlGoal === 0 || this.reefLevel >= 2)) this.furl = approach(this.furl, furlGoal, dt / c.furlTime);
    else this.reefLevel = approach(this.reefLevel, Math.min(2, this.reefTarget), dt / c.reefTime);

    const absAwa = Math.abs(awa);
    // Смена галса: через нос — сразу; через корму (by the lee) — только когда ветер
    // зашёл за корму больше чем на 15°, иначе парус остаётся наполненным «с той стороны».
    const side = awa > 0 ? 1 : -1;
    if (absAwa > 2 * DEG && side !== this.tackSide && absAwa < 165 * DEG) this.tackSide = side;
    const s = this.tackSide;
    const fills = absAwa > this.sheet + 1 * DEG;
    const target = -s * Math.min(this.sheet, absAwa);

    // Перекладка гика. Через корму (фордевинд) — быстро и с ударом.
    const dTarget = target - this.boom;
    const throughStern = absAwa > 90 * DEG;
    if (!this.gybing && throughStern && Math.sign(target) !== Math.sign(this.boom) && Math.abs(dTarget) > 40 * DEG && aws > 1) {
      this.gybing = true;
      this.gybeTimer = 0;
    }
    let rate = c.boomBaseRate;
    if (this.gybing) {
      rate = c.boomBaseRate * (1.5 + aws / 3);
      this.gybeTimer += dt;
    }
    const mv = rate * dt;
    if (Math.abs(dTarget) <= mv) {
      if (this.gybing) {
        this.gybing = false;
        // Импульс момента крена: пропорционален давлению ветра, площади и дуге перелёта.
        const q = 0.5 * RHO_AIR * aws * aws * this.area;
        const arc = Math.min(1, Math.abs(dTarget) / (120 * DEG) + Math.sin(this.sheet));
        this.gybeImpulse = Math.sign(target) * q * this.ceHeight * 0.16 * arc; // Н·м·с, знак: гик ушёл на этот борт — лодка кренится туда же
      }
      this.boom = target;
    } else {
      this.boom += Math.sign(dTarget) * mv;
    }

    // Угол атаки и коэффициенты
    let alpha;
    let scale = 1;
    if (this.furl > 0.5) {
      alpha = 0;
      this.status = 'down';
    } else if (this.gybing) {
      alpha = 0;
      scale = 0.25;
      this.status = 'gybe';
    } else if (!fills) {
      alpha = 0;
      this.status = 'luff';
    } else {
      alpha = Math.max(0, absAwa - Math.abs(this.boom));
      const sheetOut = this.sheet >= c.sheetMax - 2 * DEG;
      if (alpha > 38 * DEG && !sheetOut) this.status = 'stall';
      else if (absAwa > 100 * DEG) this.status = 'run';
      else if (alpha < c.luffAngle) this.status = 'luff';
      else this.status = 'ok';
    }
    this.alpha = alpha;
    const targetFlutter = (this.status === 'luff' && aws > 1.5) ? Math.min(1, aws / 8) : 0;
    this.flutter += (targetFlutter - this.flutter) * Math.min(1, dt * 6);

    const { cl, cd } = sailCoeffs(alpha);
    const cosH = Math.max(0, Math.cos(heel));
    const q = 0.5 * RHO_AIR * aws * aws * this.area * cosH * scale;
    const L = q * cl, D = q * cd;
    const sinA = Math.sin(absAwa), cosA = Math.cos(absAwa);
    // Подъёмная сила ⟂ вымпельному ветру (в подветренную сторону), сопротивление — по потоку.
    const fx = L * sinA - D * cosA;
    const fy = -s * (L * cosA + D * sinA);
    const h = this.ceHeight;
    const armH = h * Math.pow(cosH, 0.3);
    const mHeel = fy * armH;
    // Приведение к ветру: тяга приложена сбоку от ДП при крене + плечо ЦП относительно ЦТ.
    const mYaw = c.ceX * fy - h * Math.sin(heel) * fx;
    return { fx, fy, mHeel, mYaw, cl, cd, q };
  }

  takeGybeImpulse() {
    const i = this.gybeImpulse;
    this.gybeImpulse = 0;
    return i;
  }
}
