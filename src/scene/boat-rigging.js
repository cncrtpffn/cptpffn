import * as THREE from 'three';
import { DEG } from '../config.js';

// Рангоут, парус и работающий такелаж кетбота (гафельное вооружение, sailplan.gif, 7sh.jpg).
// Всё, что крутится вместе с гиком, живёт в группе rig (ось — мачта; z — назад вдоль гика, y — вверх от гика).
// Тросы — трёхгранные призмы (low-poly), их вершины пересчитываются каждый кадр.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), AX = V(1, 0, 0);

// Трос из n точек: трёхгранная призма; set(points) перестраивает вершины.
function makeRope(n, r, mat) {
  const SIDES = 3;
  const pos = new Float32Array((n - 1) * SIDES * 18);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.dynamic = true; // вершины пересчитываются каждый кадр — не сливать (merge-static.js)
  const rings = Array.from({ length: n }, () => Array.from({ length: SIDES }, () => V()));
  const t = V(), a = V(), b = V();
  let k = 0;
  const put = (p) => { pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z; };
  function set(pts) {
    for (let i = 0; i < n; i++) {
      t.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
      a.crossVectors(t, Math.abs(t.y) < 0.9 ? UP : AX).normalize();
      b.crossVectors(t, a);
      for (let s = 0; s < SIDES; s++) {
        const ang = 2 * Math.PI * s / SIDES;
        rings[i][s].copy(pts[i]).addScaledVector(a, r * Math.cos(ang)).addScaledVector(b, r * Math.sin(ang));
      }
    }
    k = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < SIDES; s++) {
        const s2 = (s + 1) % SIDES, A = rings[i][s], B = rings[i + 1][s], C = rings[i + 1][s2], D = rings[i][s2];
        put(A); put(B); put(C); put(A); put(C); put(D);
      }
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { mesh, set, n, pts: Array.from({ length: n }, () => V()) };
}
// точки троса от a до b с провисом: sag(t) — смещение в точке t (0..1), по умолчанию парабола вдоль dir
function span(rope, a, b, dir, amount) {
  const n = rope.n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    rope.pts[i].lerpVectors(a, b, t);
    if (amount) rope.pts[i].addScaledVector(dir, amount * 4 * t * (1 - t));
  }
  rope.set(rope.pts);
}

// Вымпел на штоке над клотиком: лента из SEG сегментов (low-poly), смотрит по кажущемуся ветру.
// Слабый ветер — провисает и лениво качается; сильный — вытягивается и бьётся чаще и мельче.
function createPennant(group, mat, base) {
  const SEG = 7, LEN = 2.5, HOIST = 0.3;
  const pos = new Float32Array(SEG * 18);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.userData.dynamic = true;
  mesh.position.copy(base);
  group.add(mesh);
  const top = Array.from({ length: SEG + 1 }, () => V()), bot = Array.from({ length: SEG + 1 }, () => V());
  const c = V(), t = V(), n = V(), w = V();
  let yaw = 0, last = -1;
  function update(aw, time) {
    const dt = last < 0 ? 1 : Math.min(0.1, Math.max(0, time - last));
    last = time;
    // сглаженный курс вымпела: туда, куда дует кажущийся ветер (awa > 0 — с правого борта)
    const d = Math.atan2(Math.sin(-aw.awa - yaw), Math.cos(-aw.awa - yaw));
    yaw += d * (1 - Math.exp(-dt * (2 + aw.aws * 0.6)));
    const slack = THREE.MathUtils.clamp(1 - aw.aws / 4, 0, 1);
    const freq = 3 + aw.aws * 1.3, amp = 0.05 + 0.15 * slack + 0.016 * Math.min(aw.aws, 12), kw = 5 + 0.3 * Math.min(aw.aws, 12);
    c.set(0, 0, 0);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      if (i > 0) {
        // направление сегмента: по ветру, вниз — на провисе, вбок — волна, бегущая к хвосту
        const pitch = slack * 1.25 * Math.pow(u, 0.8) + 0.08 * (1 - slack) * u;
        const wave = amp * u * Math.sin(time * freq - u * kw) + slack * 0.25 * Math.sin(time * 0.9);
        const h = yaw + wave;
        t.set(Math.sin(h) * Math.cos(pitch), -Math.sin(pitch), Math.cos(h) * Math.cos(pitch));
        c.addScaledVector(t, LEN / SEG);
      }
      // ширина ленты — в вертикальной плоскости, перпендикулярно направлению; на волне — небольшое скручивание
      n.set(Math.cos(yaw), 0, -Math.sin(yaw));
      w.set(0, 1, 0).addScaledVector(n, 0.4 * amp * Math.cos(time * freq - u * kw) * u).normalize();
      const half = HOIST * 0.5 * (1 - u * 0.97);
      top[i].copy(c).addScaledVector(w, half);
      bot[i].copy(c).addScaledVector(w, -half);
    }
    let k = 0;
    const put = (p) => { pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z; };
    for (let i = 0; i < SEG; i++) { put(top[i]); put(bot[i]); put(bot[i + 1]); put(top[i]); put(bot[i + 1]); put(top[i + 1]); }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  return { update };
}

/**
 * opts: group, add(mesh, parent), MAT, mastZ, deckAtMast, stemHead (Vector3), horse { z, hw, yEnd, h },
 *       coil (Vector3 — бухта хвоста шкота на полу кокпита), coaming (Vector3 — где хвост переваливает через комингс)
 */
export function createRig(opts) {
  const { group, add, MAT, mastZ, deckAtMast, stemHead, horse, coil, coaming } = opts;
  // то, что двигается или прячется в update, — не сливать с неподвижными деталями (merge-static.js)
  const dyn = (m) => { m.userData.dynamic = true; return m; };
  const rope = (n, r, mat = MAT.rope, parent = group) => { const R = makeRope(n, r, mat); parent.add(R.mesh); return R; };

  // мачта: шестигранник с сужением к топу
  const mastTop = 8.3;
  const mastH = mastTop - deckAtMast + 0.05;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, mastH, 6), MAT.spar)).position.set(0, deckAtMast - 0.05 + mastH / 2, mastZ);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.08, 6), MAT.darkWood)).position.set(0, mastTop + 0.04, mastZ);
  // трёхцветный ходовой огонь на клотике (МППСС, правило 25(b): парусное судно < 20 м):
  // зелёный — от носа 112.5° на правый борт, красный — так же на левый, белый — 135° за корму.
  // Сектор θ цилиндра: θ = 0 смотрит в корму (+Z), пеленг от носа β ↔ θ = π − β.
  const navY = mastTop + 0.08, navH = 0.08, navR = 0.045;
  for (const [mat, from, len] of [[MAT.navGreen, 67.5, 112.5], [MAT.navWhite, -67.5, 135], [MAT.navRed, 180, 112.5]]) {
    const seg = Math.round(len / 45);
    add(new THREE.Mesh(new THREE.CylinderGeometry(navR, navR, navH, seg, 1, true, from * DEG, len * DEG), mat)).position.set(0, navY + navH / 2, mastZ);
  }
  for (const y of [navY, navY + navH]) add(new THREE.Mesh(new THREE.CylinderGeometry(navR + 0.01, navR + 0.01, 0.015, 8), MAT.metal)).position.set(0, y, mastZ);
  // шток вымпела над огнём
  const staffH = 0.5, staffY = navY + navH + 0.008;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, staffH, 4), MAT.darkWood)).position.set(0, staffY + staffH / 2, mastZ);
  const pennant = createPennant(group, MAT.pennant, V(0, staffY + staffH - 0.15, mastZ));
  // штаг: топ — форштевень, и оковка на форштевне
  const stay = rope(2, 0.008, MAT.metal);
  span(stay, V(0, mastTop - 0.12, mastZ - 0.05), stemHead);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.08), MAT.metal)).position.copy(stemHead);
  // ходовые концы фалов вдоль мачты к утке у её основания
  for (const sx of [-1, 1]) span(rope(2, 0.009), V(sx * 0.04, mastTop - 0.25, mastZ + 0.06), V(sx * 0.07, deckAtMast + 0.35, mastZ + 0.08));
  add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), MAT.metal)).position.set(0, deckAtMast + 0.35, mastZ + 0.09);

  // гик и гафель
  const boomY = deckAtMast + 1.0;
  const rig = new THREE.Group();
  rig.position.set(0, boomY, mastZ);
  group.add(rig);
  const boomLen = 4.9;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, boomLen, 6).rotateX(Math.PI / 2), MAT.spar), rig).position.set(0, 0, 0.1 + boomLen / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14), MAT.metal), rig).position.set(0, 0, 0.05); // вертлюг гика
  const gaffLen = 3.4, GAFF_UP = 40 * DEG, GAFF_DOWN = 2 * DEG;
  const gaffPivot = new THREE.Group();
  rig.add(gaffPivot);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, gaffLen, 6).rotateX(Math.PI / 2), MAT.spar), gaffPivot).position.set(0, 0, gaffLen / 2);
  // усы гафеля охватывают мачту
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.07, 0.26), MAT.darkWood), gaffPivot).position.set(sx * 0.075, 0, -0.03);
  let gaffAngle = GAFF_UP;
  const gaffAt = (luff, t, out = V()) => out.set(0, luff + Math.sin(gaffAngle) * gaffLen * t, 0.1 + Math.cos(gaffAngle) * gaffLen * t);

  // парус — сетка NU×NV, натянута между галсом, шкотовым углом, горлом и пиком
  const NU = 9, NV = 11;
  const sailGeo = new THREE.PlaneGeometry(1, 1, NU - 1, NV - 1);
  const sail = dyn(add(new THREE.Mesh(sailGeo, MAT.sail), rig));
  const sailPos = sailGeo.attributes.position;
  const tack = V(0, 0.05, 0.12), clew = V(), throat = V(), peak = V();
  const tmpA = V(), tmpB = V(), p = V();
  const sh = { camber: 0, side: 1, flutter: 0, time: 0 };
  // точка поверхности паруса: билинейно между шкаторинами + пузо и полоскание по x
  function sailPoint(u, v, out) {
    tmpA.lerpVectors(tack, clew, u);
    tmpB.lerpVectors(throat, peak, u);
    out.lerpVectors(tmpA, tmpB, v);
    const belly = Math.sin(Math.PI * u) * Math.pow(Math.sin(Math.PI * v), 0.7);
    let x = sh.side * sh.camber * belly;
    const { flutter: f, time } = sh;
    if (f > 0) {
      x += f * 0.12 * belly * (Math.sin(time * 19 + u * 11 + v * 5) + 0.5 * Math.sin(time * 31 + v * 9));
      x += f * 0.05 * Math.sin(time * 23 + u * 20) * (1 - v) * (1 - u);
    }
    out.x = x;
    return out;
  }
  function updateSail(luff, clewZ) {
    throat.set(0, luff, 0.12);
    gaffPivot.position.set(0, luff, 0.1);
    gaffPivot.rotation.x = -gaffAngle;
    gaffAt(luff, 1, peak);
    clew.set(0, 0.05, clewZ);
    let k = 0;
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) sailPos.setXYZ(k++, ...sailPoint(i / (NU - 1), j / (NV - 1), p).toArray());
    }
    sailPos.needsUpdate = true;
    sailGeo.computeBoundingSphere();
  }

  // полки рифов: усиленные полосы поперёк паруса с риф-сезнями по обе стороны.
  // REEF_H — высота полки над пяткой полного паруса (доля передней шкаторины); совпадает с тем, насколько рифы укорачивают шкаторину
  const LUFF = 4.6, REEF_H = [0.24, 0.44];
  const REEF_PTS = 6;
  const bands = REEF_H.map(() => ({ rope: rope(NU, 0.012, MAT.rope, rig) }));
  // риф-сезни обеих полок — один InstancedMesh (REEF_PTS пар на полку); у убранной полки масштаб 0
  const instanced = (geo, mat, n) => {
    const m = dyn(add(new THREE.InstancedMesh(geo, mat, n), rig));
    m.frustumCulled = false; // инстансы двигаются, а габарит three считает один раз
    return m;
  };
  const reefPoints = instanced(new THREE.BoxGeometry(0.012, 0.16, 0.012), MAT.rope, REEF_H.length * REEF_PTS * 2);
  const m4 = new THREE.Matrix4();

  // сегарсы — кольца паруса на мачте, распределяются по длине передней шкаторины
  const HOOPS = 8;
  const hoopGeo = new THREE.TorusGeometry(0.1, 0.016, 3, 6).rotateX(Math.PI / 2);
  const hoops = instanced(hoopGeo, MAT.wood, HOOPS);

  // убранная часть паруса вдоль гика (рифы или парус спущен целиком) и сезни вокруг неё
  const bundle = dyn(add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 5).rotateX(Math.PI / 2), MAT.sail), rig));
  const tieGeo = new THREE.TorusGeometry(1, 0.08, 3, 5);
  const TIES = 6;
  const ties = instanced(tieGeo, MAT.rope, TIES);

  // фалы горла и пика (через уздечку на гафеле), топенант; блоки на топе
  const mastTopL = mastTop - boomY;
  const blockGeo = new THREE.BoxGeometry(0.05, 0.1, 0.06);
  const mBlock = V(0, mastTopL - 0.15, 0.07), tBlock = V(0, mastTopL - 0.32, 0.07);
  add(new THREE.Mesh(blockGeo, MAT.darkWood), rig).position.copy(mBlock);
  add(new THREE.Mesh(blockGeo, MAT.darkWood), rig).position.copy(tBlock);
  const bridleBlock = dyn(add(new THREE.Mesh(blockGeo, MAT.darkWood), rig));
  const throatHal = rope(9, 0.01, MAT.rope, rig);
  const peakHal = rope(9, 0.01, MAT.rope, rig);
  const bridle = rope(3, 0.009, MAT.rope, rig);
  const lift = rope(9, 0.008, MAT.rope, rig);
  const liftTop = V(0, mastTopL - 0.05, 0.05), liftEnd = V(0, 0.04, boomLen - 0.05);
  const g1 = V(), g2 = V(), bb = V(), dir = V(), slackDir = V();

  // гика-шкот: блок на гике -> погон над румпелем (П-образная рамка), хвост через комингс в бухту на полу кокпита
  const barY = horse.yEnd + horse.h, BAR = 0.03;
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(BAR, horse.h, BAR), MAT.metal)).position.set(sx * horse.hw, horse.yEnd + horse.h / 2, horse.z);
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * horse.hw + BAR, BAR, BAR), MAT.metal)).position.set(0, barY, horse.z);
  const boomBlockL = V(0, -0.08, boomLen - 0.3);
  add(new THREE.Mesh(blockGeo, MAT.darkWood), rig).position.copy(boomBlockL);
  const horseBlock = dyn(add(new THREE.Mesh(blockGeo, MAT.darkWood)));
  const sheetParts = [rope(9, 0.01), rope(9, 0.01)];
  const tail = rope(16, 0.01);
  add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 3, 7).rotateX(Math.PI / 2), MAT.rope)).position.copy(coil);
  const bB = V(), hB = V(), off = V(), down = V(0, -1, 0), windward = V();
  const coilEnd = coil.clone().add(V(0.1, 0.02, 0));
  const tailCurve = new THREE.CatmullRomCurve3([V(), coaming.clone(), coilEnd.clone()]);
  // хвост в руке рулевого: блок → (провис) → рука → бухта
  const handCurve = new THREE.CatmullRomCurve3([V(), V(), V(), V(), coilEnd.clone()]);

  // точки, на которые поглядывает рулевой (СК лодки): середина паруса (меняется с гиком) и вымпел
  const sailLook = V(), pennantLook = V(0, staffY + staffH, mastZ);
  // sheetHand (Vector3 в СК лодки или null) — где рулевой держит хвост гика-шкота
  function update(boat, time, sheetHand = null) {
    const s = boat.sail;
    pennant.update(boat.aw, time);
    const reef = s.reefLevel;
    // furl: 0 — парус поднят, 1 — спущен целиком (гафель лежит на гике)
    const furl = THREE.MathUtils.clamp(s.furl || 0, 0, 1);
    const reefLuff = LUFF * (1 - 0.24 * Math.min(reef, 1) - 0.2 * Math.max(0, reef - 1));
    const clewZ = 4.75 * (1 - 0.08 * Math.min(reef, 1) - 0.1 * Math.max(0, reef - 1));
    // спущенный парус: валик r = 0.12 на гике, гафель сверху
    const rFurl = 0.12, luffDown = 0.045 + 2 * rFurl + 0.04;
    const luff = reefLuff + (luffDown - reefLuff) * furl;
    gaffAngle = GAFF_UP + (GAFF_DOWN - GAFF_UP) * furl;
    rig.rotation.y = s.boom;
    rig.updateMatrix();
    sailLook.set(0, Math.max(0.3, 0.45 * luff), 1.8).applyMatrix4(rig.matrix);
    const side = s.boom < 0 ? -1 : 1; // пузо в подветренную сторону (туда, куда вынесен гик)
    const fill = s.status === 'luff' ? 0.2 : s.status === 'gybe' ? 0.4 : 1;
    sh.side = side;
    sh.camber = 0.42 * fill * Math.min(1, boat.aw.aws / 5 + 0.2) * (1 - furl);
    sh.flutter = s.flutter * (1 - furl);
    sh.time = time;
    updateSail(luff, clewZ);
    sail.visible = furl < 0.97;

    // полки рифов: взятые уходят в валик на гике, остальные на своей высоте
    const removed = LUFF - reefLuff;
    bands.forEach((b, k) => {
      const v = (REEF_H[k] * LUFF - removed) / reefLuff;
      const vis = v > 0.02 && furl < 0.01;
      b.rope.mesh.visible = vis;
      for (let i = 0; i < REEF_PTS * 2; i++) {
        if (vis) {
          sailPoint(0.12 + 0.76 * (i >> 1) / (REEF_PTS - 1), v, p);
          m4.makeTranslation(p.x + (i & 1 ? 0.025 : -0.025), p.y - 0.08, p.z);
        } else m4.makeScale(0, 0, 0);
        reefPoints.setMatrixAt(k * REEF_PTS * 2 + i, m4);
      }
      if (!vis) return;
      for (let i = 0; i < NU; i++) sailPoint(i / (NU - 1), v, b.rope.pts[i]);
      b.rope.set(b.rope.pts);
    });
    reefPoints.instanceMatrix.needsUpdate = true;

    // сегарсы съезжают вниз вместе с горлом; у спущенного паруса лежат стопкой
    const hoopTop = Math.max(luff - 0.08, 0.12 + HOOPS * 0.035);
    for (let i = 0; i < HOOPS; i++) hoops.setMatrixAt(i, m4.makeTranslation(0, 0.12 + (hoopTop - 0.12) * i / (HOOPS - 1), 0));
    hoops.instanceMatrix.needsUpdate = true;

    // валик на гике: толще с каждым рифом, а у спущенного паруса — весь парус
    const r = Math.max(0.05 * Math.min(reef, 2), rFurl * furl);
    bundle.visible = r > 0.004;
    ties.visible = bundle.visible;
    if (bundle.visible) {
      const len = clewZ - 0.4;
      bundle.scale.set(r * 1.3, r, len);
      bundle.position.set(0, 0.045 + r, 0.3 + len / 2);
      const ts = r + 0.05 + 0.03 * furl; // у спущенного паруса сезни охватывают и гафель
      for (let i = 0; i < TIES; i++) {
        ties.setMatrixAt(i, m4.makeScale(ts, ts, ts).setPosition(0, r * 0.9 + 0.03 * furl, 0.5 + (len - 0.4) * i / (TIES - 1)));
      }
      ties.instanceMatrix.needsUpdate = true;
    }

    // фал горла — прямо; фал пика — к блоку уздечки, сдвинутому от гафеля к топу. Спущенный парус: фалы слабые
    slackDir.set(-side * 0.35 * furl, 0, 0.25 * furl);
    span(throatHal, tBlock, throat, slackDir, 1);
    gaffAt(luff, 0.25, g1); gaffAt(luff, 0.8, g2);
    bb.addVectors(g1, g2).multiplyScalar(0.5);
    dir.subVectors(mBlock, bb).normalize();
    bb.addScaledVector(dir, 0.35);
    bridleBlock.position.copy(bb);
    span(peakHal, mBlock, bb, slackDir, 1);
    bridle.pts[0].copy(g1); bridle.pts[1].copy(bb); bridle.pts[2].copy(g2);
    bridle.set(bridle.pts);
    // топенант ослаблен и отходит на наветренную сторону, чтобы не резать пузо паруса; у спущенного паруса держит гик и выбран
    windward.set(-side * 0.3, -0.25, 0).multiplyScalar(1 - 0.85 * furl);
    span(lift, liftTop, liftEnd, windward, 1);

    // гика-шкот: нижний блок ездит по погону под гиком; провис, когда шкот потравлен больше, чем вынесен гик
    bB.copy(boomBlockL).applyMatrix4(rig.matrix);
    hB.set(THREE.MathUtils.clamp(bB.x, -0.85 * horse.hw, 0.85 * horse.hw), barY + 0.065, horse.z);
    horseBlock.position.copy(hB);
    const slack = Math.max(0, s.sheet - Math.abs(s.boom));
    const sag = 0.02 + Math.min(0.6, slack * 1.2);
    off.subVectors(bB, hB).cross(UP).normalize().multiplyScalar(0.025);
    sheetParts.forEach((sp, i) => {
      const o = i ? 1 : -1;
      span(sp, tmpA.copy(bB).addScaledVector(off, o), tmpB.copy(hB).addScaledVector(off, o), down, sag);
    });
    let curve = tailCurve;
    if (sheetHand) {
      // от блока к руке шкот натянут почти прямо с небольшим провисом, из руки свисает к бухте
      const P = handCurve.points;
      P[0].copy(hB);
      P[1].lerpVectors(hB, sheetHand, 0.5).y -= 0.04;
      P[2].copy(sheetHand);
      P[3].lerpVectors(sheetHand, coilEnd, 0.4).y -= 0.12;
      curve = handCurve;
    } else tailCurve.points[0].copy(hB);
    for (let i = 0; i < tail.n; i++) curve.getPoint(i / (tail.n - 1), tail.pts[i]);
    tail.set(tail.pts);
  }

  // sheetBlock — нижний блок гика-шкота на погоне (СК лодки), к нему тянется шкот из руки рулевого
  return { update, sheetBlock: hB, sailLook, pennantLook, rig, gaffPivot };
}
