// ═══════════════════════════════════════════════════════════════════════════
//  75 · 飞行状态
//  把剖面表接上所有可见的机构：襟翼、扰流板、反推、前轮、着陆灯、风扇、
//  副翼、方向舵、升降舵。全部只依赖时间，所以拖动时间轴时一切都会复位。
// ═══════════════════════════════════════════════════════════════════════════

function makeTimeline(traj) {
  const tEnd = traj.duration;
  const td = traj.tdTime;

  // 风扇转角必须只由时间决定（解析积分），这样拖时间轴、改倍速都不会跳：
  // 接地前 9 rad/s，接地后 2.4 s 内降到 3.4 rad/s
  const fanAngle = (t) => {
    const w0 = 9.0, w1 = 3.4;
    if (t <= td) return t * w0;
    const a = Math.min(t - td, 30);
    const k = (x) => { const u = clamp(x / 2.4, 0, 1); return 2.4 * (u * u * u - 0.5 * u * u * u * u); };
    return td * w0 + w0 * a + (w1 - w0) * k(a);
  };

  const sample = (t) => {
    const f = sampleFlight(traj, clamp(t, 0, tEnd));
    const S = { ...f };
    const tr = td >= 0 ? t - td : -1;

    S.gear = 1;                                   // 落地全程起落架放下
    // 襟翼：进近 30°，接地后 40°，滑跑末段收上
    let flap = 30;
    if (tr > 1.2) flap = 40;
    if (tr > 16) flap = lerp(40, 0, smoothstep(16, 21, tr));
    S.flap = flap;

    // 操纵面
    S.aileron = (S.roll * R2D) * 0.4 + (tr < 0 ? 0.5 * Math.sin(t * 1.2) : 0);
    S.elev = tr < 0 ? (S.h < 40 ? 7.5 : 1.8) : 2.2;
    S.rudder = tr >= 0 ? clamp(-S.yaw * R2D * 0.5, -14, 14) : 0.7 * Math.sin(t * 0.55);

    // 着陆灯：进近 + 落地全程开，脱离后关
    S.landingLights = tr < 0 ? 1 : 1 - smoothstep(17, 20, tr);

    // 时间轴/数据面板用的阶段：接地后 1.2 s 内算 touchdown
    if (tr >= 0 && tr < 1.2) S.phase = 'touchdown';
    else if (tr >= 1.2 && S.phase === 'touchdown') S.phase = 'rollout';

    S.altFt = Math.max(0, S.h * 3.28084);
    S.kts = S.vz * 1.94384;
    S.fpm = S.vy * 196.85;
    return S;
  };

  return {
    traj,
    duration: tEnd,
    tdTime: td,
    tdZ: traj.tdZ,
    rows: traj.rows,
    sample(t) {
      const S = sample(t);
      S.fanSpin = fanAngle(clamp(t, 0, tEnd));
      S.noseSpin = S.wheelSpin * 1.4;
      return S;
    },
    phaseSpans: phaseSpans(traj),
  };
}
