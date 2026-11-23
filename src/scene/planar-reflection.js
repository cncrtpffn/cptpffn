import * as THREE from 'three';

// Плоское отражение: сцена рендерится из камеры, зеркальной относительно y = 0, в текстуру.
// Зеркальная камера и косая плоскость отсечения — как в Reflector из three: подводное
// не попадает в кадр. В рендер-таргет three не применяет тонмаппинг, так что значения
// линейные — как outgoingLight в шейдере воды. Фон прозрачный: в текстуре только объекты,
// небо в воде даёт skyColor().
// Слой отражения: зеркальная камера видит только его. Крупное (острова без травы, буи, корпус, парус)
// включают через markReflected; вода, небо и брызги в слой не попадают и в отражение не рисуются.
// Свет тоже фильтруется по слою — источники света включаются в слой вместе с объектами.
export const REFLECT_LAYER = 1;

// root — что пометить; minRadius — меши мельче (по радиусу габарита геометрии) пропускаются;
// userData.noReflect — не отражать, userData.reflect — отражать всегда (геометрия до первого кадра пустая).
// Маски без цвета (крышки кокпита и ватерлинии) не отражаются: в отражении воды нет, заслонять нечего
export function markReflected(root, { minRadius = 0 } = {}) {
  root.traverse((o) => {
    if (o.isLight) { o.layers.enable(REFLECT_LAYER); return; }
    if (!o.isMesh || o.userData.noReflect || o.material.colorWrite === false) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.userData.reflect || o.geometry.boundingSphere.radius >= minRadius) o.layers.enable(REFLECT_LAYER);
  });
}

export function createPlanarReflection(renderer, { scale = 0.5 } = {}) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const matrix = new THREE.Matrix4();
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(REFLECT_LAYER);
  const state = { scale };

  const normal = new THREE.Vector3(0, 1, 0);
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const camPos = new THREE.Vector3();
  const view = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const buf = new THREE.Vector2();
  const clearColor = new THREE.Color();
  const vis = [];

  // hide — объекты слоя, которые в этом кадре отражать не надо (облака по настройке).
  // false — камера под водой, отражение не обновлено
  function render(scene, camera, hide = []) {
    renderer.getDrawingBufferSize(buf);
    const w = Math.max(1, Math.round(buf.x * state.scale)), h = Math.max(1, Math.round(buf.y * state.scale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0) return false;
    // отражённые позиция и точка взгляда + lookAt: обход граней не переворачивается
    view.copy(camPos).negate().reflect(normal).negate();
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.copy(look).negate().reflect(normal).negate();
    cam.position.copy(view);
    cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    cam.lookAt(tgt);
    cam.near = camera.near; cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    matrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // косая near-plane по плоскости воды
    plane.setFromNormalAndCoplanarPoint(normal, tgt.set(0, 0, 0)).applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = cam.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    vis.length = 0;
    for (const o of hide) { vis.push(o.visible); o.visible = false; }
    const oldTarget = renderer.getRenderTarget();
    renderer.getClearColor(clearColor);
    const oldAlpha = renderer.getClearAlpha();
    const oldShadow = renderer.shadowMap.autoUpdate;
    // тени — с прошлого кадра
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(clearColor, oldAlpha);
    renderer.shadowMap.autoUpdate = oldShadow;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    return true;
  }

  return { texture: target.texture, matrix, render, state };
}
