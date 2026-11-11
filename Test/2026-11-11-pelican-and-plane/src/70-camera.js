// ═══════════════════════════════════════════════════════════════════════════
//  70 · 镜头
//  每个机位都是 (时间, 飞行状态) → (相机位置, 看向点, 焦距) 的纯函数。
//  之所以坚持“纯函数”，是因为时间轴可以任意拖动：画面必须只由 t 决定。
//
//  导播（auto）按阶段剪辑，切换时用一次 0.6 s 的插值把“新机位的视角”
//  从“上一机位的视角”拉过来，看起来像一次运镜而不是硬切。
// ═══════════════════════════════════════════════════════════════════════════

const CAMS = [
  { key: 'auto', label: '导播', title: '自动切换机位' },
  { key: 'chase', label: '追尾', title: '机尾后上方' },
  { key: 'side', label: '伴飞', title: '左侧伴飞' },
  { key: 'spot', label: '跑道边', title: '跑道边长焦' },
  { key: 'tower', label: '塔台', title: '塔台俯瞰' },
  { key: 'nose', label: '机头', title: '驾驶舱视角' },
  { key: 'orbit', label: '环绕', title: '拖动画面可自由环绕' },
];

const planeWorld = (S) => [S.x, S.h - AC.gearY, S.z];

// 分镜表：按整段动画的进度取机位
const AUTOCUT = [
  { at: 0.00, cam: 'chase', arg: { dist: 56, up: 15 } },
  { at: 0.11, cam: 'spot', arg: { side: -1, z: 210, lat: 96 } },
  { at: 0.26, cam: 'side', arg: { dist: 62, up: 4.0 } },
  { at: 0.42, cam: 'tower', arg: {} },
  { at: 0.57, cam: 'spot', arg: { side: -1, z: 120, lat: 70 } },
  { at: 0.70, cam: 'chase', arg: { dist: 58, up: 14 } },
  { at: 0.84, cam: 'spot', arg: { side: 1, z: 150, lat: 64 } },
  { at: 0.93, cam: 'orbit', arg: { yaw: 2.5, rad: 68, up: 14 } },
];

function autoCamAt(t, T) {
  const dur = Math.max(T.duration, 0.001);
  const p = clamp(t / dur, 0, 1);
  let idx = 0;
  for (let i = 0; i < AUTOCUT.length; i++) if (p >= AUTOCUT[i].at) idx = i;
  const startT = AUTOCUT[idx].at * dur;
  // 从第一个分镜开始就视为“已经切换完成”：否则 t=0 时会把上一机位
  // （不存在）和追尾机位混在一起，相机可能正好落在机身里。
  const blend = idx === 0 ? 1 : clamp((t - startT) / 0.7, 0, 1);
  const cur = AUTOCUT[idx];
  const out = { cam: cur.cam, arg: cur.arg, blend, prev: idx > 0 ? AUTOCUT[idx - 1] : null };
  // 最后一段：缓慢环绕，画面不至于停住
  if (idx === AUTOCUT.length - 1) {
    const k = clamp((t - startT) / Math.max(dur - startT, 0.001), 0, 1);
    out.arg = { yaw: 2.35 + k * 0.75, rad: 46 + k * 16, up: 10 + k * 8 };
  }
  return out;
}

function cameraAt(T, t, ui) {
  const S = T.flight || T.sample(t);
  const P = planeWorld(S);
  let cam = { pos: [0, 0, 0], target: [0, 0, 0], fov: 40, roll: 0 };

  if (ui.cam === 'auto') {
    const m = autoCamAt(t, T);
    const a = CAMF[m.cam](P, S, t, m.arg, ui);
    cam.pos = a.pos; cam.target = a.target; cam.fov = a.fov; cam.roll = a.roll || 0;
    if (m.prev && m.blend < 1) {
      const b = CAMF[m.prev.cam](P, S, t, m.prev.arg, ui);
      const k = easeInOut(m.blend);
      cam.pos = vlerp(b.pos, cam.pos, k);
      cam.target = vlerp(b.target, cam.target, k);
      cam.fov = lerp(b.fov, cam.fov, k);
      cam.roll = lerp(b.roll || 0, cam.roll, k);
    }
  } else if (ui.cam === 'debug' && window.__plane && window.__plane.__override) {
    const o = window.__plane.__override;
    cam.pos = o.eye; cam.target = o.tgt; cam.fov = 30; cam.ortho = o.ortho;
  } else {
    const a = CAMF[ui.cam] ? CAMF[ui.cam](P, S, t, {}, ui) : CAMF.orbit(P, S, t, {}, ui);
    cam.pos = a.pos; cam.target = a.target; cam.fov = a.fov; cam.roll = a.roll || 0;
  }
  return cam;
}

const CAMF = {
  // 追尾：机身后上方，带一点点随速度变化的抖动
  // 追尾：机尾后上方跟着走。距离按视野估过 —— 机身 38 m，视野 45° 时
  // 65 m 左右刚好占满画面高度的八成。
  chase(P, S, t, arg) {
    const dist = arg.dist || 62, up = arg.up || 15;
    const yaw = S.yaw * 0.7;
    const shake = 0.10 * Math.sin(t * 2.3) * sat(S.vz / 60);
    return {
      pos: [P[0] - Math.sin(yaw) * 4 + shake, P[1] + up + shake * 0.6, P[2] + dist],
      // 视线指向机身中心稍前方：不要用远处的点，否则机身会掉到画面外
      target: [P[0] + Math.sin(yaw) * 3, P[1] + 1.2, P[2] - 12],
      fov: 34 + sat(S.vz / 90) * 6,
    };
  },

  // 伴飞：左舷后上方，缓慢漂移，像直升机航拍
  side(P, S, t, arg) {
    const dist = arg.dist || 62, up = arg.up || 4.0;
    const drift = Math.sin(t * 0.22) * 7;
    return {
      pos: [P[0] - dist - drift * 0.15, P[1] + up + Math.sin(t * 0.37) * 0.7, P[2] - 4 + drift],
      target: [P[0], P[1] + 1.0, P[2] - 1.0],
      fov: 33,
    };
  },

  // 跑道边：固定机位 + 长焦，飞机从远处飞来，掠过镜头，落地
  // 跑道边的长焦：机位相对飞机的前后位置固定（跟着走），这样从进近到滑跑
  // 飞机都保持在画面里，不会越飞越小。arg.z 是“机位在飞机后方的距离”。
  spot(P, S, t, arg) {
    const side = arg.side == null ? -1 : arg.side;
    const back = arg.z == null ? 130 : arg.z;
    const lat = arg.lat == null ? 78 : arg.lat;
    const pos = [side * (RWY.half + lat), arg.h == null ? 6.5 : arg.h, P[2] - back];
    return {
      pos,
      target: [P[0], P[1] + 1.2, P[2] - 6],
      fov: 22,
    };
  },

  // 塔台：从塔台顶上俯瞰，长焦跟随，能看到整条跑道
  // 塔台：从塔顶（指挥室上方）往下看。距离太远飞机会变成几个像素，
  // 所以用长焦，并把视线压在飞机和跑道之间；竖屏再收紧一点。
  // 塔台：机位放在指挥室正前方（z 再往 −Z 挪 34 m），否则俯视时机身
  // 正下方的指挥室屋顶会是一块占满画面下缘的斜板。焦距也收紧，飞机才不像个点。
  tower(P, S, t, arg, ui) {
    const portrait = ui && ui.aspect < 1.05;
    return {
      pos: [-380, 90, 940],
      target: [P[0] * (portrait ? 0.85 : 0.55), P[1] * 0.25 + 2, P[2] * (portrait ? 0.97 : 0.93) + (portrait ? 14 : 26)],
      fov: portrait ? 8.6 : 9.6,
    };
  },


  // 机头：驾驶舱视角，一下滑道灯就在正前方
  // 机鼻相机：贴在机头上方、对着前方，机鼻会露在画面下缘 —— 这样一眼就能
  // 看出是“从飞机上看出去”，而不是一张空的风景照。
  nose(P, S, t) {
    const yaw = S.yaw;
    const fwd = [Math.sin(yaw), 0, Math.cos(yaw)];
    const pitch = S.pitch;
    // 机头在模型里是 z = -19（模型坐标系），这里换算到世界坐标
    const p = [P[0] - fwd[0] * 17.4, P[1] + 3.55, P[2] - fwd[2] * 17.4];
    const ahead = 240;
    return {
      pos: p,
      // 视线比机头轴线略低一点，跑道和进近灯就落在画面里
      target: [p[0] - fwd[0] * ahead, p[1] - Math.tan(pitch) * ahead - 2.2, p[2] - fwd[2] * ahead],
      fov: 62,
      roll: S.roll * 0.6,
    };
  },


  // 环绕：可以拖动；默认绕到右前方
  orbit(P, S, t, arg, ui) {
    const yaw = (arg.yaw == null ? 2.4 : arg.yaw) + (ui.orbitYaw || 0);
    const rad = arg.rad || 66;
    const up = (arg.up || 12) + (ui.orbitPitch || 0);
    return {
      pos: [P[0] + Math.cos(yaw) * rad, P[1] + up, P[2] + Math.sin(yaw) * rad],
      target: [P[0], P[1] + 1.4, P[2]],
      fov: 36,
    };
  },
};
