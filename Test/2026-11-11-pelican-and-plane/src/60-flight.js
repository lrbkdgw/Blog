// ═══════════════════════════════════════════════════════════════════════════
//  60 · 飞行剖面
//  进近 → 拉平 → 接地 → 减速滑跑 → 脱离跑道，一次性数值积分，存成表。
//  之后任意时刻只查表，所以时间轴可以随便拖，画面也完全可重复。
//
//  单位：米 / 秒 / 弧度。z 沿跑道（入口 0，向 +Z 落地），h 是主轮离地高度。
//  主要数字（都能在 FLIGHT 里改）：
//    · 起始在入口前 1250 m、约 250 ft，地速 68 m/s（132 kt）
//    · 3° 下滑道 → 下降率 3.6 m/s（700 ft/min）
//    · 主轮离地 11 m 开始拉平，接地时下沉率 0.45 m/s
//    · 接地点在入口后约 300 m（瞄准点），随后全减速到滑行速度
//    · 滑跑 600 m 后从快速脱离道转出
// ═══════════════════════════════════════════════════════════════════════════

const FLIGHT = {
  dt: 1 / 120,
  z0: -1250,
  vApp: 68.0,          // 进近地速 m/s
  glide: Math.tan(3.0 * D2R),
  hThresh: 13.0,       // 过入口时的主轮高度
  flareH: 11.0,        // 开始拉平的轮高
  kFlare: 0.85,        // 拉平的指数衰减率
  vTouch: 0.45,        // 接地下沉率 m/s
  exitZ: 620,          // 快速脱离道开口
  exitYaw: -32 * D2R,
  taxiV: 7.5,
  maxT: 48,
};

// 阶段：approach → flare → touchdown（瞬间）→ rollout → exit
const PHASES = [
  { key: 'approach', name: '进近 · 3° 下滑道', en: 'APPROACH' },
  { key: 'flare', name: '拉平 · 收油门', en: 'FLARE' },
  { key: 'touchdown', name: '主轮接地', en: 'TOUCHDOWN' },
  { key: 'rollout', name: '减速滑跑 · 反推', en: 'ROLLOUT' },
  { key: 'exit', name: '脱离跑道', en: 'VACATING' },
];

function buildTrajectory() {
  const dt = FLIGHT.dt;
  const tab = [];
  let t = 0;
  let z = FLIGHT.z0;
  let h = FLIGHT.glide * -FLIGHT.z0 + FLIGHT.hThresh;
  let vz = FLIGHT.vApp;
  let vy = -vz * FLIGHT.glide;
  let pitch = 8.2 * D2R;
  let tdTime = -1;
  let x = 0, yaw = 0, roll = 0;
  let spoiler = 0, rev = 0, brake = 0, noseDown = 0;
  let wheelSpin = 0;
  let phase = 'approach';
  let exitDist = 0;

  for (let n = 0; t < FLIGHT.maxT; n++) {
    const onGround = tdTime >= 0;
    const tr = onGround ? t - tdTime : -1;

    // ── 沿跑道方向的速度 ──
    if (!onGround) {
      const vT = FLIGHT.vApp + 0.5 * Math.sin(t * 0.8);
      vz += (vT - vz) * (1 - Math.exp(-2.0 * dt));
    } else {
      // 反推 + 刹车 + 扰流板一起给减速度；出跑道后收到滑行速度
      const dec = 0.55 * spoiler + 2.35 * rev + 3.1 * brake;
      const vTarget = phase === 'exit' ? FLIGHT.taxiV : 0;
      vz = Math.max(vTarget, vz - dec * dt);
      if (phase !== 'exit' && vz < 1.2) vz = FLIGHT.taxiV;
    }

    // ── 垂直方向 ──
    if (!onGround) {
      let vyT;
      if (h > FLIGHT.flareH) {
        vyT = -vz * FLIGHT.glide;
      } else {
        if (phase === 'approach') phase = 'flare';
        vyT = -Math.max(FLIGHT.vTouch, FLIGHT.kFlare * Math.max(h - 0.15, 0));
      }
      const maxA = h > FLIGHT.flareH ? 6.0 : 1.6;
      const lim = maxA * dt;
      vy += clamp(vyT - vy, -lim, lim);
      h += vy * dt;
      z += vz * dt;
      if (h <= 0) { h = 0; vy = 0; tdTime = t; phase = 'touchdown'; }
    } else {
      h = 0; vy = 0;
      // 到达快速脱离道后开始转弯
      if (z >= FLIGHT.exitZ && yaw > FLIGHT.exitYaw) {
        const rate = 2.9 * D2R;
        yaw = Math.max(FLIGHT.exitYaw, yaw - rate * dt);
        phase = 'exit';
      }
      const step = vz * dt;
      z += step * Math.cos(yaw);
      x += step * Math.sin(yaw);
      if (phase === 'exit') exitDist += step;
      if (phase === 'touchdown' && tr > 1.2) phase = 'rollout';
    }

    // ── 俯仰 ──
    let pitchT;
    if (!onGround) {
      const fp = Math.atan2(vy, Math.max(vz, 2));
      // 迎角：进近 5.4°，拉平时逐渐增大到 8° 左右（“抬头”）
      const aoa = (5.4 + 2.6 * smoothstep(FLIGHT.flareH, 0.5, h)) * D2R;
      pitchT = -fp + aoa;
      pitchT += 0.18 * D2R * Math.sin(t * 2.1) * smoothstep(60, 2, h);
    } else if (tr < 0.3) {
      pitchT = pitch;
    } else {
      // 主轮先接地 → 前轮在 2.6 s 内放下
      noseDown = sat((tr - 0.35) / 2.4);
      pitchT = lerp(9.4 * D2R, 0.55 * D2R, easeInOut(noseDown));
    }
    pitch += (pitchT - pitch) * (1 - Math.exp(-5.0 * dt));

    // ── 接地后的机翼机构 ──
    if (onGround) {
      spoiler = sat((tr - 0.15) / 0.75);
      const noseOn = noseDown > 0.85;
      rev = sat((tr - 1.0) / 0.9) * sat((vz - FLIGHT.taxiV - 1) / 6);
      brake = noseOn ? sat((tr - 2.9) / 1.0) * sat((vz - FLIGHT.taxiV - 0.5) / 3) : 0;
      if (vz > 6) wheelSpin += (vz / 0.56) * dt * sat(tr / 0.16);
    }

    // 侧倾：滑行转弯往内侧压一点点坡度
    roll += ((onGround ? yaw * 0.05 : 0.2 * D2R * Math.sin(t * 0.8)) - roll) * (1 - Math.exp(-3.2 * dt));

    tab.push({ t, z, x, h, vz, vy, pitch, yaw, roll, spoiler, rev, brake, wheelSpin, noseDown, phase });

    // 结束时再滑一小段
    if (phase === 'exit' && yaw <= FLIGHT.exitYaw + 1e-5) {
      if (exitDist > 70) { t += dt; break; }
    }
    t += dt;
  }

  const rows = tab;
  const last = rows[rows.length - 1];
  const tdRow = rows.find((r) => r.phase === 'touchdown') || last;
  return {
    rows,
    duration: last.t,
    tdTime: tdTime >= 0 ? tdTime : last.t,
    tdZ: tdRow.z,
    last,
  };
}

// 线性插值取样：先按时间猜下标再微调（表是等步长的，平均两步就能命中）
function sampleFlight(T, t) {
  const rows = T.rows;
  if (t <= rows[0].t) return rows[0];
  const last = rows[rows.length - 1];
  if (t >= last.t) return last;
  let i = clamp(Math.floor((t - rows[0].t) / FLIGHT.dt), 0, rows.length - 2);
  while (i > 0 && rows[i].t > t) i--;
  while (i < rows.length - 2 && rows[i + 1].t < t) i++;
  const a = rows[i], b = rows[i + 1];
  const f = (t - a.t) / Math.max(b.t - a.t, 1e-9);
  const out = {};
  for (const k in a) {
    const va = a[k], vb = b[k];
    out[k] = typeof va === 'number' ? lerp(va, vb, f) : (f < 0.5 ? va : vb);
  }
  out.t = t;
  return out;
}

// 每个阶段的时间区间（时间轴刻度用）
function phaseSpans(T) {
  const rows = T.rows;
  const spans = [];
  let cur = rows[0].phase, start = rows[0].t;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].phase !== cur) { spans.push({ key: cur, t0: start, t1: rows[i].t }); cur = rows[i].phase; start = rows[i].t; }
  }
  spans.push({ key: cur, t0: start, t1: rows[rows.length - 1].t });
  // touchdown 只有一瞬间，并进 rollout
  const out = [];
  for (const s of spans) {
    const p = out[out.length - 1];
    if (p && (s.key === 'touchdown' || p.key === 'touchdown')) { p.t1 = s.t1; if (s.key !== 'touchdown') p.key = s.key; continue; }
    out.push({ ...s });
  }
  return out.filter((s) => s.t1 - s.t0 > 0.25);
}
