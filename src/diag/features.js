// Мягкая деградация: сломанная при создании, в кадре или при сборке шейдера фича отключается,
// игра идёт дальше; что сломалось и стек — в лог и красный тост (src/diag/diag.js).
// ?fail=<id>[:init|:tick],… — проверка: сломать шейдер / создание / обновление фичи (id — в register).

const diag = window.diag;
const FAIL = new URLSearchParams(location.search).get('fail')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const failTest = (id, stage) => {
  if (FAIL.includes(stage ? `${id}:${stage}` : id)) throw new Error(`?fail=${stage ? `${id}:${stage}` : id} — проверочная ошибка`);
};

const features = new Map(); // id → { label, roots, disable, off }

// фича: корневые объекты (по ним сломанный материал находит владельца) и как её выключить;
// disable(objects) получает объекты со сломанным шейдером, без disable они просто прячутся
export function register(id, label, roots = [], disable = null) {
  const f = { id, label, roots: roots.filter(Boolean), disable, off: false };
  for (const r of f.roots) r.userData.feature = id;
  features.set(id, f);
  return f;
}

export function disableFeature(id, err, objects = []) {
  const f = features.get(id);
  if (!f) return;
  if (f.off) { diag.error(f.label, err); return; } // уже выключена — вторая ошибка той же фичи только в лог
  f.off = true;
  try {
    if (f.disable) f.disable(objects);
    else for (const o of objects) o.visible = false;
  } catch (e) {
    diag.error(f.label, e);
  }
  diag.fail(f.label, err);
}

// создать необязательное: при ошибке — в лог и тост, вместо результата fallback() (заглушка с тем же API)
export function optional(id, label, create, fallback = () => null) {
  try {
    failTest(id, 'init');
    return create();
  } catch (e) {
    diag.fail(label, e);
    return fallback();
  }
}

// создать то, без чего игры нет: при ошибке — экран «Игра не запустилась» с логами
export function critical(id, label, create) {
  try {
    failTest(id, 'init');
    return create();
  } catch (e) {
    diag.fail(label, e, { fatal: true });
    throw diag.handled(e);
  }
}

// обновление фичи в кадре: первое исключение выключает её, дальше вызовы пропускаются
export function tick(id, fn) {
  const f = features.get(id);
  if (f?.off) return;
  try {
    failTest(id, 'tick');
    fn();
  } catch (e) {
    if (f) disableFeature(id, e);
    else diag.fail(id, e);
  }
}

// кадр целиком: ошибку в обязательной части (физика, камера, рендер) не выключить — в лог не чаще
// раза в секунду со счётчиком, тост один раз; цикл rAF при этом не останавливается
let frameErrors = 0, frameErrorAt = -Infinity;
export function guardFrame(fn) {
  try {
    fn();
  } catch (e) {
    frameErrors++;
    const now = performance.now();
    if (now - frameErrorAt < 1000) return;
    if (frameErrorAt === -Infinity) diag.fail('кадр', e);
    else diag.error('кадр', `${e?.message ?? e} (ошибок в кадре всего: ${frameErrors})`);
    frameErrorAt = now;
  }
}

// --- шейдеры ---
// three зовёт onShaderError посреди рендера, когда впервые использует программу; менять материалы там
// нельзя, поэтому ошибки копятся и разбираются после кадра (processShaderErrors)
const pending = [];

function shaderErrors(gl, shader, type) {
  const log = gl.getShaderInfoLog(shader).trim();
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) && log === '') return '';
  const m = /ERROR: 0:(\d+)/.exec(log);
  if (!m) return `${type}: ${log}`;
  // строки исходника вокруг ошибки — как в three (handleSource)
  const line = +m[1], lines = gl.getShaderSource(shader).split('\n');
  const around = [];
  for (let i = Math.max(line - 6, 0); i < Math.min(line + 6, lines.length); i++) around.push(`${i + 1 === line ? '>' : ' '} ${i + 1}: ${lines[i]}`);
  return `${type}\n${log}\n${around.join('\n')}`;
}

export function installShaderGuard(renderer) {
  renderer.debug.onShaderError = (gl, glProgram, vs, fs) => {
    const program = renderer.info.programs.find((p) => p.program === glProgram);
    const text = [
      `шейдер ${program?.name || program?.type || '?'} не собрался`,
      gl.getProgramInfoLog(glProgram).trim(),
      shaderErrors(gl, vs, 'VERTEX'),
      shaderErrors(gl, fs, 'FRAGMENT'),
    ].filter(Boolean).join('\n');
    pending.push({ glProgram, text });
  };
}

// материалы объекта, которые собраны в эту программу (у материала их несколько: с тенью, с клиппингом)
function usesProgram(renderer, material, glProgram) {
  const programs = renderer.properties.get(material).programs;
  if (!programs) return false;
  for (const p of programs.values()) if (p.program === glProgram) return true;
  return false;
}
function ownerFeature(o) {
  for (; o; o = o.parent) if (o.userData.feature) return o.userData.feature;
  return null;
}

// после компиляции и после каждого кадра: найти, чьи материалы сломаны, и выключить эти фичи
export function processShaderErrors(renderer, scene) {
  if (!pending.length) return;
  // сначала найти владельцев всех ошибок, потом выключать: выключение меняет материалы (вода — на Lambert),
  // и вторая сломанная программа той же фичи иначе уже не нашлась бы
  const found = pending.splice(0).map(({ glProgram, text }) => {
    const byFeature = new Map();
    scene.traverse((o) => {
      const mats = [o.material, o.customDepthMaterial, o.customDistanceMaterial].flat().filter(Boolean);
      if (!mats.some((m) => usesProgram(renderer, m, glProgram))) return;
      const id = ownerFeature(o) ?? '';
      if (!byFeature.has(id)) byFeature.set(id, []);
      byFeature.get(id).push(o);
    });
    return { text, byFeature };
  });
  for (const { text, byFeature } of found) {
    if (!byFeature.size) { diag.fail('шейдер', text); continue; }
    for (const [id, objects] of byFeature) {
      if (id) { disableFeature(id, text, objects); continue; }
      // ничья программа: прячем сами объекты
      for (const o of objects) o.visible = false;
      diag.fail(`шейдер (${objects.length} объект.)`, text);
    }
  }
}

// старт: собрать шейдеры всей сцены до первого кадра и сразу проверить их
// (иначе three проверяет программу только при первом использовании, посреди рендера)
export async function compileAndCheck(renderer, scene, camera) {
  injectShaderFailures();
  try {
    await renderer.compileAsync(scene, camera);
  } catch (e) {
    diag.error('компиляция шейдеров', e);
  }
  for (const p of renderer.info.programs) p.getUniforms(); // getUniforms → проверка ошибок и onShaderError
  processShaderErrors(renderer, scene);
}

// ?fail=<id> — во фрагментный шейдер материалов фичи подмешивается #error
function injectShaderFailures() {
  for (const id of FAIL) {
    const f = features.get(id);
    if (!f) continue;
    for (const r of f.roots) r.traverse((o) => {
      for (const m of [o.material].flat().filter(Boolean)) {
        if (m.userData.diagFail) continue;
        m.userData.diagFail = true;
        const before = m.onBeforeCompile, key = m.customProgramCacheKey;
        m.onBeforeCompile = (shader, r) => {
          before.call(m, shader, r);
          shader.fragmentShader = `#error diag test ?fail=${id}\n${shader.fragmentShader}`;
        };
        // своя программа: не делить сломанную с чужими материалами того же типа
        m.customProgramCacheKey = () => `${key.call(m)}|diag-fail`;
        m.needsUpdate = true;
      }
    });
  }
}
