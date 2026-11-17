import { G, DEG, SEA } from '../config.js';
import { wrapPi } from './wind.js';

const N = 4;                 // компонент в одной системе волн
const MAX_TRAINS = 4;        // всего систем (одна из них может догасать при переполнении)
const MAX_ACTIVE = 3;        // систем, которые затухают в обычном темпе
export const MAX_COMP = N * MAX_TRAINS;
const LAMBDA_FRAC = [1, 0.55, 0.3, 0.16];
const AMP_FRAC = [0.55, 0.3, 0.18, 0.1];
const DIR_OFFSET = [0, 25, -30, 50];
const STEEPNESS = 0.62;
const RETARGET_H = 0.02;     // м: систему ниже этой высоты можно перенастроить незаметно
const FADE_TIME = 4;         // с: быстрое гашение лишней системы
const DROP_H = 0.01;         // м: система ниже этой высоты удаляется
const STABLE_DIR = 3 * DEG;  // колебания цели в этих пределах считаются устоявшимся ветром
const STABLE_LAMBDA = 0.05;

// Волны Герстнера. Одна функция для CPU (лодка, буи) и для шейдера (uniforms).
// Море — набор систем волн. У системы направление и длина волны неизменны, меняется только
// высота: поворот k или направления сдвинул бы фазу на k·r·Δθ и всё поле «поехало» бы.
// Новый ветер рождает новую систему с нулевой высотой, старые доживают зыбью.
export class Waves {
  constructor() {
    this.time = 0;
    this.sigHeight = 0;
    this.targetHeight = 0;
    this.targetLambda = 12;
    this.windDir = 0;
    this.stableDir = 0;      // последнее устоявшееся направление ветра
    this.stableLambda = 12;  // и длина волны
    this.stableT = 0;        // сколько секунд цель не менялась
    this.trains = [];
    this._init = false;
    this.count = 0;
    this.dirX = new Float32Array(MAX_COMP);
    this.dirZ = new Float32Array(MAX_COMP);
    this.amp = new Float32Array(MAX_COMP);
    this.k = new Float32Array(MAX_COMP);
    this.phase = new Float32Array(MAX_COMP);
    this.q = new Float32Array(MAX_COMP);
    this.omega = new Float32Array(MAX_COMP);
  }

  // Задать целевое волнение: значимая высота (м), направление ветра «откуда» (рад), скорость ветра.
  configure(sigHeight, windDir, windSpeed) {
    this.targetHeight = sigHeight;
    this.targetLambda = Math.min(40, Math.max(6, 3 + 2.2 * windSpeed));
    this.windDir = windDir;
    // первая настройка — сразу установившееся море, без разгона из штиля
    if (!this._init) this.settle();
  }

  // Мгновенно установившееся волнение по текущей цели: одна система.
  settle() {
    this._init = true;
    this.stableDir = this.windDir;
    this.stableLambda = this.targetLambda;
    this.stableT = 0;
    this.trains = [this._makeTrain(this.windDir, this.targetLambda, this.targetHeight)];
    this._rebuild();
  }

  _makeTrain(dir, lambda, h) {
    const t = { dir, lambda, h, fading: false,
      dirX: new Float32Array(N), dirZ: new Float32Array(N), k: new Float32Array(N),
      omega: new Float32Array(N), phase: new Float32Array(N) };
    this._tune(t, dir, lambda);
    return t;
  }

  _tune(t, dir, lambda) {
    t.dir = dir; t.lambda = lambda;
    for (let i = 0; i < N; i++) {
      const d = dir + DIR_OFFSET[i] * DEG;
      // волны бегут по ветру: вектор «куда»
      t.dirX[i] = -Math.sin(d);
      t.dirZ[i] = Math.cos(d);
      t.k[i] = 2 * Math.PI / (lambda * LAMBDA_FRAC[i]);
      t.omega[i] = Math.sqrt(G * t.k[i]);
    }
  }

  _rebuild() {
    let e = 0;
    for (const t of this.trains) e += t.h * t.h;
    this.sigHeight = Math.sqrt(e);
    let j = 0;
    for (const t of this.trains) {
      // бюджет крутизны делится по доле энергии: Σ q·k·a = STEEPNESS без скачков
      const share = e > 1e-9 ? t.h * t.h / e : 0;
      for (let i = 0; i < N; i++, j++) {
        this.dirX[j] = t.dirX[i]; this.dirZ[j] = t.dirZ[i];
        this.k[j] = t.k[i]; this.omega[j] = t.omega[i]; this.phase[j] = t.phase[i];
        this.amp[j] = 0.5 * t.h * AMP_FRAC[i];
        const ka = this.k[j] * this.amp[j];
        this.q[j] = ka > 1e-6 ? Math.min(STEEPNESS * share / (ka * N), 1.0) : 0;
      }
    }
    this.count = j;
    for (; j < MAX_COMP; j++) { this.amp[j] = 0; this.q[j] = 0; this.k[j] = 0; this.omega[j] = 0; }
  }

  update(dt) {
    this.time += dt;
    // ждём, пока ветер устоится: протаскивание ползунка не рождает цепочку систем
    if (Math.abs(wrapPi(this.windDir - this.stableDir)) > STABLE_DIR
      || Math.abs(this.targetLambda / this.stableLambda - 1) > STABLE_LAMBDA) {
      this.stableDir = this.windDir; this.stableLambda = this.targetLambda; this.stableT = 0;
    } else {
      this.stableT += dt;
    }

    let cur = this.trains[this.trains.length - 1];
    const off = !cur || Math.abs(wrapPi(this.stableDir - cur.dir)) > SEA.newTrainAngleDeg * DEG
      || Math.abs(this.stableLambda / cur.lambda - 1) > SEA.newTrainLambdaFrac;
    if (off && this.stableT >= SEA.settleTime && this.targetHeight > DROP_H) {
      if (cur && cur.h < RETARGET_H) {
        // почти плоскую систему перенастраиваем — на воде это не видно
        this._tune(cur, this.stableDir, this.stableLambda);
      } else {
        // лишняя система — самая слабая из зыби — быстро догасает
        const swell = this.trains.filter((t) => !t.fading && t !== cur);
        if (swell.length >= MAX_ACTIVE - 1) {
          swell.reduce((a, b) => (b.h < a.h ? b : a)).fading = true;
        }
        // все слоты заняты — ждём, пока она догаснет, без рывка
        if (this.trains.length < MAX_TRAINS) {
          cur = this._makeTrain(this.stableDir, this.stableLambda, 0);
          this.trains.push(cur);
        }
      }
    }

    for (const t of this.trains) {
      let target = 0, tau;
      if (t === cur) {
        target = this.targetHeight;
        tau = t.h < target ? SEA.growTime : SEA.decayTime;
      } else {
        // зыбь: длинные волны живут дольше
        tau = t.fading ? FADE_TIME : SEA.decayTime * Math.min(3, Math.max(0.5, t.lambda / 12));
      }
      t.h += (target - t.h) * (1 - Math.exp(-dt / tau));
      for (let i = 0; i < N; i++) t.phase[i] += t.omega[i] * dt;
    }
    this.trains = this.trains.filter((t) => t === cur || t.h > DROP_H);
    this._rebuild();
  }

  // Смещение Герстнера в точке параметризации p.
  _disp(px, pz, out) {
    let dx = 0, dz = 0, y = 0;
    for (let i = 0; i < this.count; i++) {
      const th = this.k[i] * (this.dirX[i] * px + this.dirZ[i] * pz) - this.phase[i];
      const c = Math.cos(th), s = Math.sin(th);
      dx += this.q[i] * this.amp[i] * this.dirX[i] * c;
      dz += this.q[i] * this.amp[i] * this.dirZ[i] * c;
      y += this.amp[i] * s;
    }
    out.dx = dx; out.dz = dz; out.y = y;
    return out;
  }

  // Высота поверхности в мировой точке (x, z) с обратной итерацией смещения.
  heightAt(x, z) {
    const o = { dx: 0, dz: 0, y: 0 };
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) {
      this._disp(px, pz, o);
      px = x - o.dx; pz = z - o.dz;
    }
    this._disp(px, pz, o);
    return o.y;
  }

  // Высота и уклоны поверхности.
  sample(x, z) {
    const e = 0.6;
    const h = this.heightAt(x, z);
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return { h, sx: hx / (2 * e), sz: hz / (2 * e) };
  }

  maxAmplitude() {
    let a = 0;
    for (let i = 0; i < this.count; i++) a += this.amp[i];
    return a;
  }
}
