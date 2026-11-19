// Замеры кадра и адаптивное разрешение.
// GPU-время — EXT_disjoint_timer_query_webgl2 (результат приходит через 1–3 кадра; на iOS расширения нет),
// CPU — от начала кадра до конца отправки команд, draw call'ы и треугольники — renderer.info за все проходы кадра.

const WINDOW = 60;  // кадров в окне медианы

function median(a) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
}

export function createPerf(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  // за кадр несколько render(): тени, отражение, основной — копим сами
  renderer.info.autoReset = false;
  const gpu = [], cpu = [], dt = [], pending = [];
  let query = null, t0 = 0, last = 0;
  const stats = { gpu: NaN, cpu: NaN, frame: NaN, calls: 0, tris: 0, hasGpu: !!ext };

  function begin(now) {
    t0 = performance.now();
    if (last) { dt.push(now - last); if (dt.length > WINDOW) dt.shift(); }
    last = now;
    renderer.info.reset();
    // не больше 4 запросов в полёте: если GPU отстаёт, просто пропускаем замер
    if (ext && pending.length < 4) {
      query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    }
  }

  function end() {
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); query = null; }
    const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift();
      if (!disjoint) { gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); if (gpu.length > WINDOW) gpu.shift(); }
      gl.deleteQuery(q);
    }
    cpu.push(performance.now() - t0); if (cpu.length > WINDOW) cpu.shift();
    stats.calls = renderer.info.render.calls;
    stats.tris = renderer.info.render.triangles;
  }

  // медианы считаются по запросу (оверлей и адаптивное разрешение — несколько раз в секунду)
  function summary() {
    stats.gpu = median(gpu); stats.cpu = median(cpu); stats.frame = median(dt);
    return stats;
  }
  function resetWindow() { gpu.length = 0; cpu.length = 0; dt.length = 0; }

  return { begin, end, summary, resetWindow, stats, get samples() { return ext ? gpu.length : dt.length; } };
}

// Адаптивное разрешение: держит GPU-время кадра в бюджете, меняя pixelRatio ступенями.
// Без таймера GPU (iOS) ориентируется на интервал кадров и умеет только снижать разрешение:
// по интервалу, упёртому в vsync, запас не виден.
export function createAdaptiveResolution(renderer, perf, { max, min = 1, step = 0.25, budget = 11 }) {
  const state = { auto: true, ratio: max, max, min };
  let wait = 0;
  const apply = (r) => {
    state.ratio = r;
    renderer.setPixelRatio(r);
    perf.resetWindow();
    wait = 1.5; // с: не судить по кадрам вокруг смены размера буфера
  };
  apply(max);

  function update(dt) {
    if (!state.auto) {
      if (renderer.getPixelRatio() !== state.ratio) apply(state.ratio);
      return;
    }
    wait -= dt;
    if (wait > 0 || perf.samples < 30) return;
    const s = perf.summary();
    let next = state.ratio;
    if (s.hasGpu) {
      if (s.gpu > budget * 1.1) next = state.ratio - step;
      else if (s.gpu < budget * 0.55) next = state.ratio + step;
    } else if (s.frame > 1000 / 60 * 1.2) {
      next = state.ratio - step;
    }
    next = Math.min(state.max, Math.max(state.min, next));
    if (next !== state.ratio) apply(next); else wait = 1;
  }

  return { state, update };
}

// Оверлей (?perf=1 или панель): медианы GPU/CPU/кадра, draw call'ы, треугольники, разрешение.
export function createPerfOverlay(perf, res, renderer, { visible = false } = {}) {
  const el = document.createElement('div');
  el.id = 'perf';
  document.body.appendChild(el);
  const state = { visible };
  let acc = 0;
  function update(dt) {
    el.hidden = !state.visible;
    acc += dt;
    if (!state.visible || acc < 0.25) return;
    acc = 0;
    const s = perf.summary(), c = renderer.domElement;
    el.textContent = `GPU ${s.hasGpu ? s.gpu.toFixed(1) + ' мс' : '—'} · CPU ${s.cpu.toFixed(1)} мс · кадр ${s.frame.toFixed(1)} мс`
      + ` · ${s.calls} dc · ${(s.tris / 1000).toFixed(0)}k tri · DPR ${res.state.ratio.toFixed(2)}${res.state.auto ? ' авто' : ''}`
      + ` · ${c.width}×${c.height}`;
  }
  return { state, update };
}
