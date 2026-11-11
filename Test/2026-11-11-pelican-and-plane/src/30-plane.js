// ═══════════════════════════════════════════════════════════════════════════
//  30 · 飞机
//  模型坐标：机头朝 −Z，+Y 向上，+X 指向右翼，原点在重心。
//  侧影尺寸按一架单通道双发客机取：全长 38 m，翼展 34.3 m，机身直径 4 m。
//  动态部件各自是一份网格 + 一个“铰链”（点 + 轴向），绘制时绕铰链转。
//  左侧部件不复制网格：直接用 x 取负的矩阵绘制（法线矩阵会一并取反）。
// ═══════════════════════════════════════════════════════════════════════════

const AC = {
  L: 38.0,
  noseZ: -16.5,
  R: 2.0,
  span: 17.15,
  gearY: -3.86,          // 停机时轮胎最低点（模型坐标）
  contact: {             // 三个轮子的接地点（模型坐标）
    mainL: [-3.6, -3.86, 1.75],
    mainR: [3.6, -3.86, 1.75],
    nose: [0, -3.86, -11.9],
  },
  gearMain: { x: 3.6, y: -3.86 + 0.56, z: 1.75, r: 0.56 },
  gearNose: { x: 0, y: -3.86 + 0.40, z: -11.9, r: 0.40 },
};

// ─── 机身外形：[距机头站位移, 半径, 中心线高度] ───
const FUSE = [
  [0.00, 0.030, -0.34], [0.35, 0.235, -0.32], [0.80, 0.510, -0.30],
  [1.40, 0.800, -0.27], [2.20, 1.080, -0.23], [3.20, 1.360, -0.18],
  [4.30, 1.610, -0.13], [5.60, 1.820, -0.08], [7.20, 1.945, -0.03],
  [9.20, 1.995, 0.00], [20.0, 2.000, 0.00], [24.5, 1.985, 0.03],
  [27.5, 1.925, 0.10], [29.5, 1.815, 0.19], [31.2, 1.660, 0.32],
  [32.8, 1.445, 0.48], [34.2, 1.175, 0.68], [35.4, 0.875, 0.87],
  [36.5, 0.560, 1.02], [37.4, 0.255, 1.12], [38.0, 0.040, 1.16],
];
const zOfS = (s) => AC.noseZ + s;
function fuseAt(s) {
  s = clamp(s, 0, AC.L);
  const n = FUSE.length;
  if (s <= 0) return [FUSE[0][1], FUSE[0][2]];
  if (s >= AC.L) return [FUSE[n - 1][1], FUSE[n - 1][2]];
  let i = 0;
  while (i < n - 2 && s > FUSE[i + 1][0]) i++;
  const t = smoothstep(0, 1, (s - FUSE[i][0]) / (FUSE[i + 1][0] - FUSE[i][0]));
  return [lerp(FUSE[i][1], FUSE[i + 1][1], t), lerp(FUSE[i][2], FUSE[i + 1][2], t)];
}
function fusePt(s, ang, k) {
  const [r, cy] = fuseAt(s);
  const rr = r * (k == null ? 1 : k);
  return [rr * Math.sin(ang), cy + rr * Math.cos(ang), zOfS(s)];
}
const fuseAxis = (s) => { const r = fuseAt(s); return [0, r[1], zOfS(s)]; };

// ─── 机翼参数 ───
const WING = {
  xRoot: 1.55, xTip: 17.15,
  sLERoot: 13.15, sweep: Math.tan(25.5 * D2R),
  yRoot: -1.36, dihedral: Math.tan(5.0 * D2R),
  cRoot: 7.40, cKink: 5.70, xKink: 6.6, cTip: 1.55,
  thRoot: 0.152, thTip: 0.100,
  camber: 0.022, twistRoot: 2.0 * D2R, twistTip: -0.6 * D2R,
  qHinge: 0.690,
};
const wingT = (x) => sat((Math.abs(x) - WING.xRoot) / (WING.xTip - WING.xRoot));
function wingSec(x) {
  const a = Math.abs(x) + 1e-9;
  const t = wingT(a);
  const chord = a <= WING.xKink
    ? lerp(WING.cRoot, WING.cKink, sat((a - WING.xRoot) / (WING.xKink - WING.xRoot)))
    : lerp(WING.cKink, WING.cTip, sat((a - WING.xKink) / (WING.xTip - WING.xKink)));
  return {
    a, t, chord,
    sLE: WING.sLERoot + WING.sweep * (a - WING.xRoot),
    y: WING.yRoot + WING.dihedral * (a - WING.xRoot),
    th: lerp(WING.thRoot, WING.thTip, t),
    camber: lerp(WING.camber, 0.005, t),
    twist: lerp(WING.twistRoot, WING.twistTip, t),
  };
}
// NACA 四位翼型 + 抛物面弯度；返回上下表面相对弦线的偏移（相对弦长）
function airfoil(th, camber, q, up) {
  q = clamp(q, 0, 1);
  const yt = 5 * th * (0.2969 * Math.sqrt(q) - 0.126 * q - 0.3516 * q * q + 0.2843 * q ** 3 - 0.1036 * q ** 4);
  const p = 0.42;
  const yc = q < p ? (camber / (p * p)) * (2 * p * q - q * q) : (camber / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * q - q * q);
  return up ? yc + yt : yc - yt;
}
function wingPoint(g, q, up) {
  const a = q * g.chord;
  const b = airfoil(g.th, g.camber, q, up) * g.chord;
  const ca = Math.cos(g.twist), sa = Math.sin(g.twist);
  const a2 = a * ca + b * sa;
  const b2 = -a * sa + b * ca;
  return [Math.sign(g.a) * Math.abs(g.a), g.y + b2, zOfS(g.sLE + a2)];
}
function wingChordPoint(g, q) {
  const ca = Math.cos(g.twist), sa = Math.sin(g.twist);
  const a2 = q * g.chord * ca;
  const b2 = -q * g.chord * sa;
  return [Math.sign(g.a) * Math.abs(g.a), g.y + b2, zOfS(g.sLE + a2)];
}

// 环向参数 u∈[0,1) 绕翼型一周：0=前缘 → 0.5=后缘 → 1=前缘
const loopT = (u) => (u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5);
const loopQ = (u) => 0.5 * (1 - Math.cos(Math.PI * loopT(u)));

// 通用“翼面管”：沿展向 x0→x1 扫掠；截面是 qA..qB 的环向回路（0=前缘，1=后缘）
// secFn(x) → 截面参数；ptFn(g, q, upper) → 三维点；chordFn(g, q) → 弦线上的点（用于判定朝向）
// u 从 1（后缘）经 0（前缘）再回到 1 —— 这样绕序与展向 +x 配合，法线朝外。
function tubeSurf(mb, secFn, ptFn, chordFn, x0, x1, qA, qB, nSpan, nLoop, colorFn, opts) {
  // 接缝放在前缘（翼型在那里是尖的，法线几乎一致），视觉上看不出来
  const at = (g, u) => {
    const uu = u + 0.5 - Math.floor(u + 0.5);
    const q = lerp(qA, qB, loopQ(1 - uu));
    return ptFn(g, q, loopT(1 - uu) > 0.5);
  };
  const centerAt = (g, u) => {
    const uu = u + 0.5 - Math.floor(u + 0.5);
    const q = lerp(qA, qB, loopQ(1 - uu));
    return chordFn(g, q);
  };
  return surf(mb, (u, v) => at(secFn(lerp(x0, x1, v)), u), nLoop, nSpan, Object.assign({
    closedU: true,
    center: (u, v) => centerAt(secFn(lerp(x0, x1, v)), u),
    colorFn: colorFn || null,
  }, opts || {}));
}

// ─── 水平尾翼 ───
const STAB = { xRoot: 0.9, xTip: 6.55, sLE: 32.0, sweep: Math.tan(30 * D2R), y: 0.68, dihedral: Math.tan(6.5 * D2R), cRoot: 3.55, cTip: 1.22, th: 0.10, qHinge: 0.635 };
function stabSec(x) {
  const a = Math.abs(x) + 1e-9;
  const t = sat((a - STAB.xRoot) / (STAB.xTip - STAB.xRoot));
  return { a, t, chord: lerp(STAB.cRoot, STAB.cTip, t), sLE: STAB.sLE + STAB.sweep * (a - STAB.xRoot), y: STAB.y + STAB.dihedral * (a - STAB.xRoot), th: lerp(STAB.th, 0.085, t), camber: 0.004, twist: 0 };
}

// ─── 垂直尾翼 ───
const FIN = { yRoot: 1.25, yTip: 7.15, sLE: 28.9, sweep: Math.tan(36.5 * D2R), cRoot: 7.10, cTip: 2.40, qHinge: 0.615 };
function finSec(y) {
  const t = sat((y - FIN.yRoot) / (FIN.yTip - FIN.yRoot));
  return { y, t, chord: lerp(FIN.cRoot, FIN.cTip, Math.pow(t, 0.8)), sLE: FIN.sLE + FIN.sweep * (y - FIN.yRoot), th: lerp(0.105, 0.072, t) };
}

// ─── 发动机（轴线平行 Z） ───
const ENG = { x: 6.2, y: -2.40, zc: -1.9, r: 1.10 };

// ══════════════════════════════════════════════════════════════════════════
//  构建：返回 { solid, parts: [{name, raw, pivot, axis}] }
// ══════════════════════════════════════════════════════════════════════════
function buildPlane() {
  const solid = MB();      // 中线上、左右对称的部件
  const sideR = MB();      // 只在右舷建的部件，最后会镜像出一份左舷的
  const parts = [];
  const addPart = (name, mb, pivot, axis) => parts.push({ name, raw: mb.build(), pivot, axis });

  // ══ 机身 ══
  let fuseIdxRange = null;
  {
    const n = FUSE.length, seg = 48;
    const i0 = solid.idx.length;
    surf(solid, (u, v) => {
      const f = v * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const t = f - i;
      const s = lerp(FUSE[i][0], FUSE[i + 1][0], t);
      const r = lerp(FUSE[i][1], FUSE[i + 1][1], t);
      const cy = lerp(FUSE[i][2], FUSE[i + 1][2], t);
      const a = u * TAU;
      // 截面做成略扁的椭圆（舱段宽度 > 高度），更像真机
      // 截面：宽度略大于高度（1.06 : 0.97），并把下腹部压平一点
      const x = r * 1.06 * Math.sin(a);
      const y = cy + r * (0.97 * Math.cos(a) - 0.05 * Math.max(0, -Math.cos(a)));
      return [x, y, zOfS(s)];
    }, seg, 64, {
      closedU: true,
      color: C_WHITE,
      uv: (u, v) => [u, v],
      center: (u, v, p) => {
        const s = v * AC.L;
        return fuseAxis(s);
      },
    });
    // 机身外壳的索引区间到此为止（不含下面的风挡/封口，它们也用涂装色）
    const i1 = solid.idx.length;
    fuseIdxRange = [i0, i1];
    // 驾驶舱风挡：贴着机头上方的一块深色曲面，三片之间留出窗框
    {
      const panes = [[-0.62, -0.20], [-0.17, 0.17], [0.20, 0.62]];
      for (const [a0, a1] of panes) {
        surf(solid, (u, v) => {
          const sPos = lerp(2.35, 4.30, v);
          const ang = lerp(a0, a1, u);
          const r = fuseAt(sPos)[0];
          const cy = fuseAt(sPos)[1];
          const k = 1.012 + 0.012 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
          return [r * k * 1.06 * Math.sin(ang), cy + r * k * 0.97 * Math.cos(ang), zOfS(sPos)];
        }, 5, 6, { color: [0.045, 0.055, 0.065], center: (u, v) => fuseAxis(lerp(2.35, 4.30, v)), flip: false });
      }
    }
    // 机头封口（半径本来就接近 0）、机尾封口
    // 机尾不能用一个平面盖板：追尾机位正对着它，平面法线一照亮就是一块死白的圆饼。
    // 收成一小段圆润的尾锥（APU 整流罩），再在末端点一块深色排气口。
    const tailRing = [];
    for (let i = 0; i < 24; i++) tailRing.push(fusePt(AC.L - 0.10, (i / 24) * TAU));
    surf(solid, (u, v) => {
      const sPos = AC.L - 0.10 + v * 0.44;
      const ang = u * TAU;
      const [r0, cy0] = fuseAt(AC.L - 0.10);
      // 半径沿轴向快速收拢成圆顶，法线自然过渡，不会再出现整片同色
      const k = Math.cos(v * Math.PI * 0.5) * 0.94 + 0.06;
      const r = r0 * k;
      return [r * Math.sin(ang), cy0 + r * Math.cos(ang), zOfS(sPos)];
      // 尾锥末端的 UV 必须收敛到机背中线（v=0, u=0.5），否则整圈顶点会各取一段
      // 圆柱展开图 —— 从正后方看就是一块杂乱的白斑。
    }, 24, 8, { closedU: true, color: C_WHITE, uv: (u, v) => [lerp(0.5, u, 1.0 - v * v), v * 0.06] });
  }

  // ══ 机翼：环向管 + 翼尖封口 ══
  const wingColor = (u, v) => {
    // 前缘一小段用金属色，其余白色；下表面略暗
    const q = loopQ(u);
    if (q < 0.045) return [0.78, 0.80, 0.84];
    if (u > 0.5) return [0.90, 0.915, 0.94];
    return [0.965, 0.97, 0.978];
  };
  const wingPt = (g, q, up) => wingPoint(g, q, up);
  tubeSurf(sideR, wingSec, wingPt, wingChordPoint, WING.xRoot, WING.xTip, 0, 1, 30, 44, wingColor, {});
  // 翼尖封口
  {
    const ring = [];
    for (let i = 0; i < 30; i++) ring.push(wingPoint(wingSec(WING.xTip), loopQ(i / 30), i / 30 < 0.5));
    capFan(sideR, ring, [1, 0, 0]);
  }

  // ══ 翼梢小翼（融合式，向上过渡） ══
  {
    const wl = MB();
    const nv = 18;
    const gTip = wingSec(WING.xTip);
    // 从翼尖截面开始，向上、略向外、略向后掠
    const secAt = (v) => {
      const h = v * 2.55;
      return {
        chord: lerp(1.55, 0.62, Math.pow(v, 0.9)),
        sLE: gTip.sLE + 1.02 + h * 0.30,
        x: WING.xTip + 0.10 + h * 0.16,
        y: gTip.y + h,
        th: lerp(0.10, 0.065, v),
        camber: 0.004, twist: -0.02,
      };
    };
    const secFn = (v) => ({
      a: secAt(v).x, t: v, chord: secAt(v).chord, sLE: secAt(v).sLE,
      y: secAt(v).y, th: secAt(v).th, camber: 0.004, twist: -0.02,
    });
    surf(wl, (u, v) => {
      const g = secFn(v);
      const t = u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5;
      const q = 0.5 * (1 - Math.cos(Math.PI * t));
      const pt = wingPoint(g, q, u < 0.5);
      return [g.a, pt[1], pt[2]];
    }, 30, nv, {
      closedU: true,
      color: C_LIVERY,
      center: (u, v) => { const g = secFn(v); return [g.a, g.y, zOfS(g.sLE + 0.5 * g.chord)]; },
    });
    // 顶端封口
    const ring = [];
    for (let i = 0; i < 30; i++) {
      const g = secFn(1);
      const t = i / 30 < 0.5 ? (i / 30) / 0.5 : 1 - (i / 30 - 0.5) / 0.5;
      const q = 0.5 * (1 - Math.cos(Math.PI * t));
      const pt = wingPoint(g, q, i / 30 < 0.5);
      ring.push([g.a, pt[1], pt[2]]);
    }
    capFan(wl, ring, [0, 1, 0]);
    sideR.add(wl.build());
  }

  // ══ 前缘缝翼（可动：向下前方平移） ══
  {
    const sl = MB();
    tubeSurf(sl, wingSec, wingPt, wingChordPoint, WING.xRoot + 0.3, WING.xTip - 0.08, 0, 0.16, 22, 16,
      (u) => (loopQ(u) < 0.012 ? [0.80, 0.82, 0.86] : [0.96, 0.965, 0.975]), {});
    // 内侧端面
    const ring = [];
    for (let i = 0; i < 16; i++) ring.push(wingPoint(wingSec(WING.xRoot + 0.3), loopQ(i / 16) * 0.16, i / 16 < 0.5));
    capFan(sl, ring, [-1, 0, 0]);
    addPart('slat', sl, [0, 0, 0], [1, 0, 0]);
  }

  // ══ 后缘：内襟翼 / 外襟翼 / 副翼 ══
  {
    const defs = [
      ['flapIn', 2.05, 7.05],
      ['flapOut', 7.55, 12.80],
      ['aileron', 13.25, 16.50],
    ];
    for (const [nm, x0, x1] of defs) {
      const mb = MB();
      tubeSurf(mb, wingSec, wingPt, wingChordPoint, x0, x1, WING.qHinge, 1.0, 10, 20,
        (u) => (u > 0.5 ? [0.89, 0.905, 0.93] : [0.96, 0.965, 0.975]), {});
      // 两端封口
      // 铰链（枢轴）取铰链线上的一个点
      const g0 = wingSec(x0);
      const pivot = wingPoint(g0, WING.qHinge, true);
      const ringA = [], ringB = [];
      for (let i = 0; i < 20; i++) {
        const t = i / 20 < 0.5 ? (i / 20) / 0.5 : 1 - (i / 20 - 0.5) / 0.5;
        const q = lerp(WING.qHinge, 1.0, 0.5 * (1 - Math.cos(Math.PI * t)));
        ringA.push(wingPoint(wingSec(x0), q, i / 20 < 0.5));
        ringB.push(wingPoint(wingSec(x1), q, i / 20 < 0.5));
      }
      capFan(mb, ringA, [-1, 0, 0]);
      capFan(mb, ringB, [1, 0, 0]);
      addPart(nm, mb, pivot, [1, 0, 0]);
    }
  }

  // ══ 扰流板（三块，贴在上翼面，绕前缘翻起） ══
  {
    const defs = [[2.45, 5.30], [5.65, 8.35], [8.70, 11.30]];
    defs.forEach(([x0, x1], k) => {
      const mb = MB();
      surf(mb, (u, v) => {
        const x = lerp(x0, x1, v);
        const g = wingSec(x);
        const q = lerp(0.46, WING.qHinge, u);
        const p = wingPoint(g, q, true);
        // 微微上拱
        return [p[0], p[1] + 0.02 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), p[2]];
      }, 4, 6, { color: [0.80, 0.82, 0.85], center: (u, v) => wingChordPoint(wingSec(lerp(x0, x1, v)), 0.55) });
      const g0 = wingSec(x0);
      addPart('spoiler' + (k + 1), mb, wingPoint(g0, 0.46, true), [1, 0, 0]);
    });
  }

  // ══ 襟翼滑轨整流罩 ══
  {
    for (const x of [3.7, 8.7, 12.3]) {
      const g = wingSec(x);
      const mb = MB();
      // 沿 +Z（气流方向）的细长水滴：前后 2.6 m，最宽处 0.34 m
      revolveZ(mb, [[1.45, 0.02], [1.15, 0.13], [0.6, 0.22], [0.0, 0.26], [-0.75, 0.22], [-1.5, 0.12], [-1.85, 0.02]], 14,
        { color: [0.90, 0.915, 0.94] });
      const m = m4();
      m4compose(m, [g.a, g.y - 0.20, zOfS(g.sLE + g.chord * 0.80)], [0, 0, 0], [0.82, 0.72, 1]);
      sideR.add(mb.build(), m);
    }
  }

  // ══ 垂直尾翼 ══
  {
    // 尾翼做成左右两片对称翼型的管
    const finPt = (g, q, up) => {
      const a = q * g.chord;
      const half = airfoil(g.th, 0, q, up) * g.chord * 0.95;
      return [half, g.y, zOfS(g.sLE + a)];
    };
    const finChord = (g, q) => [0, g.y, zOfS(g.sLE + q * g.chord)];
    // 右侧 (y-z 平面内，用 x 表示厚度)
    surf(solid, (u, v) => {
      const g = finSec(lerp(FIN.yRoot, FIN.yTip, v));
      const t = u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5;
      const q = 0.5 * (1 - Math.cos(Math.PI * t));
      return finPt(g, q, u < 0.5);
    }, 34, 20, {
      closedU: true, color: C_LIVERY,
      center: (u, v) => { const g = finSec(lerp(FIN.yRoot, FIN.yTip, v)); return finChord(g, 0.5); },
    });
    // 顶端封口
    const ring = [];
    for (let i = 0; i < 24; i++) {
      const t = i / 24 < 0.5 ? (i / 24) / 0.5 : 1 - (i / 24 - 0.5) / 0.5;
      ring.push(finPt(finSec(FIN.yTip), 0.5 * (1 - Math.cos(Math.PI * t)), i / 24 < 0.5));
    }
    capFan(solid, ring, [0, 1, 0]);
    // 方向舵
    const rud = MB();
    surf(rud, (u, v) => {
      const g = finSec(lerp(FIN.yRoot + 0.12, FIN.yTip - 0.04, v));
      const t = u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5;
      const q = lerp(FIN.qHinge, 1.0, 0.5 * (1 - Math.cos(Math.PI * t)));
      return finPt(g, q, u < 0.5);
    }, 20, 14, {
      closedU: true, color: C_LIVERY,
      center: (u, v) => { const g = finSec(lerp(FIN.yRoot + 0.12, FIN.yTip - 0.04, v)); return finChord(g, (FIN.qHinge + 1) / 2); },
    });
    // 两端封口
    for (const yy of [FIN.yRoot + 0.12, FIN.yTip - 0.04]) {
      const ring = [];
      for (let i = 0; i < 20; i++) {
        const t = i / 20 < 0.5 ? (i / 20) / 0.5 : 1 - (i / 20 - 0.5) / 0.5;
        ring.push(finPt(finSec(yy), lerp(FIN.qHinge, 1, 0.5 * (1 - Math.cos(Math.PI * t))), i / 20 < 0.5));
      }
      capFan(rud, ring, [0, yy > 4 ? 1 : -1, 0]);
    }
    const g0 = finSec(FIN.yRoot + 0.12);
    addPart('rudder', rud, [0, g0.y, zOfS(g0.sLE + FIN.qHinge * g0.chord)], [0, 1, 0]);
  }

  // ══ 水平尾翼 + 升降舵 ══
  {
    const stabPt = (g, q, up) => {
      const a = q * g.chord;
      const b = airfoil(g.th, g.camber, q, up) * g.chord;
      return [g.a, g.y + b, zOfS(g.sLE + a)];
    };
    const stabChord = (g, q) => [g.a, g.y, zOfS(g.sLE + q * g.chord)];
    tubeSurf(sideR, stabSec, stabPt, stabChord, STAB.xRoot, STAB.xTip, 0, 1, 14, 26,
      (u) => (u > 0.5 ? [0.90, 0.915, 0.94] : [0.965, 0.97, 0.978]), {});
    const ringT = [];
    for (let i = 0; i < 26; i++) ringT.push(stabPt(stabSec(STAB.xTip), loopQ(i / 26), i / 26 < 0.5));
    capFan(sideR, ringT, [1, 0, 0]);

    const el = MB();
    tubeSurf(el, stabSec, stabPt, stabChord, STAB.xRoot + 0.06, STAB.xTip - 0.04, STAB.qHinge, 1, 10, 18,
      (u) => (u > 0.5 ? [0.90, 0.915, 0.94] : [0.96, 0.965, 0.975]), {});
    const g0 = stabSec(STAB.xRoot + 0.06);
    addPart('elev', el, stabPt(g0, STAB.qHinge, true), [1, 0, 0]);
  }

  // ══ 发动机短舱 + 挂架 ══
  {
    const nac = MB();
    const prof = [
      [3.30, 1.02], [3.45, 1.10], [3.35, 1.17], [3.05, 1.215], [2.35, 1.245],
      [1.30, 1.265], [0.10, 1.27], [-1.10, 1.245], [-2.10, 1.17], [-2.85, 1.05], [-3.20, 0.94],
    ];
    revolveZ(nac, prof, 40, { color: [0.955, 0.96, 0.97], cx: ENG.x, cy: ENG.y });
    // 进气道内壁（深色）
    revolveZ(nac, [[3.05, 1.213], [2.98, 1.12], [2.90, 1.03], [2.84, 0.99]], 40, { color: [0.10, 0.105, 0.12], cx: ENG.x, cy: ENG.y });
    // 尾喷口
    revolveZ(nac, [[-2.85, 1.00], [-3.25, 0.92], [-3.60, 0.82], [-3.72, 0.76]], 32, { color: [0.30, 0.31, 0.33], cx: ENG.x, cy: ENG.y });
    // 反推罩色带
    revolveZ(nac, [[-1.10, 1.253], [-2.10, 1.178]], 40, { color: [0.80, 0.82, 0.86], cx: ENG.x, cy: ENG.y });
    // 挂架：一块从短舱顶部斜插到机翼下表面的薄板
    {
      const x = ENG.x, hx = 0.15;
      const yT = WING.yRoot + WING.dihedral * (ENG.x - WING.xRoot) - 0.28;
      const yB = ENG.y + 1.12;
      const zA = ENG.zc + 3.45, zB = ENG.zc - 0.6;
      const P = (sx, y, z) => [x + sx * hx, y, z];
      const tri = (a, b, c, n) => {
        const ia = sideR.vert(a, n, [0, 0], C_WHITE), ib = sideR.vert(b, n, [0, 0], C_WHITE), ic = sideR.vert(c, n, [0, 0], C_WHITE);
        sideR.tri(ia, ib, ic);
      };
      const quad = (a, b, c, d, n) => {
        const ia = sideR.vert(a, n, [0, 0], C_WHITE), ib = sideR.vert(b, n, [0, 0], C_WHITE);
        const ic = sideR.vert(c, n, [0, 0], C_WHITE), id = sideR.vert(d, n, [0, 0], C_WHITE);
        sideR.quad(ia, ib, ic, id);
      };
      // 右舷 / 左舷两片（法线大致 ±X）
      const a1 = P(1, yT, zA), a2 = P(1, yB, zB), a3 = P(1, yB, zB + 2.2), a4 = P(1, yT, zA + 0.5);
      quad(a1, a2, a3, a4, [1, 0.35, 0]);
      const b1 = P(-1, yT, zA), b2 = P(-1, yB, zB), b3 = P(-1, yB, zB + 2.2), b4 = P(-1, yT, zA + 0.5);
      quad(b4, b3, b2, b1, [-1, 0.35, 0]);
      // 前缘斜面、上下闭合
      quad(a1, b1, b2, a2, [0, 0.6, -0.8]);
      quad(a4, a3, b3, b4, [0, -0.6, 0.8]);
      quad(a3, a2, b2, b3, [0, -1, 0]);
      quad(a1, a4, b4, b1, [0, 1, 0]);
    }
    sideR.add(nac.build());
  }

  // ══ 风扇（转） ══
  {
    const fan = MB();
    // 整流锥
    revolveZ(fan, [[1.9, 0.02], [1.72, 0.20], [1.50, 0.34], [1.28, 0.42], [1.12, 0.44]], 24, { color: [0.72, 0.74, 0.78], cx: 0, cy: 0 });
    // 22 片桨叶
    for (let i = 0; i < 22; i++) {
      const a0 = (i / 22) * TAU;
      const bl = MB();
      surf(bl, (u, v) => {
        const r = lerp(0.30, 0.99, v);
        const w = 0.10 / Math.max(r, 0.25);
        const twist = 0.55 * v;
        const ang = a0 + (u - 0.5) * w + twist;
        return [Math.cos(ang) * r, Math.sin(ang) * r, 1.30 - u * 0.02 + v * 0.16];
      }, 2, 3, { color: [0.26, 0.27, 0.30] });
      fan.add(bl.build());
    }
    // 挪到短舱轴线上（模型坐标系），这样绘制时的铰链变换就是 T(p)·R·T(−p)
    {
      const m = m4();
      m4compose(m, [ENG.x, ENG.y, ENG.zc], [0, 0, 0], [1, 1, 1]);
      const placed = MB();
      placed.add(fan.build(), m);
      addPart('fan', placed, [ENG.x, ENG.y, ENG.zc], [0, 0, 1]);
    }
  }

  // ══ 起落架：支柱 + 轮子分开建模（轮子要转） ══
  {
    const g = AC.gearNose;
    const yTop = -1.30;
    const strut = MB();
    box(strut, [0, (yTop + g.y) / 2, g.z], [0.19, yTop - g.y, 0.23], [0.88, 0.90, 0.93]);
    box(strut, [0, (yTop + g.y) / 2 + 0.25, g.z + 0.24], [0.10, 1.25, 0.10], [0.87, 0.89, 0.91]);
    box(strut, [0, g.y, g.z], [0.62, 0.09, 0.09], [0.55, 0.57, 0.60]);   // 轮轴
    box(strut, [0.26, yTop - 0.42, g.z - 0.30], [0.42, 0.85, 0.05], [0.93, 0.94, 0.96], [0, 0.25, 0]);
    box(strut, [-0.26, yTop - 0.42, g.z - 0.30], [0.42, 0.85, 0.05], [0.93, 0.94, 0.96], [0, -0.25, 0]);
    solid.add(strut.build());

    const wheel = MB();
    revolveX(wheel, [[-0.15, 0.0], [-0.145, 0.16], [-0.11, 0.27], [0.0, 0.315], [0.11, 0.27], [0.145, 0.16], [0.15, 0.0]], 20,
      { color: [0.070, 0.073, 0.082] });
    revolveX(wheel, [[-0.09, 0.08], [0.0, 0.095], [0.09, 0.08]], 14, { color: [0.60, 0.62, 0.66] });
    const wb = wheel.build();
    const noseWheels = MB();
    for (const dx of [-0.27, 0.27]) {
      const m = m4();
      m4compose(m, [dx, 0, 0], [0, 0, 0], [1.05, 1.05, 1.05]);
      noseWheels.add(wb, m);
    }
    {
      const m = m4();
      m4compose(m, [0, g.y, g.z], [0, 0, 0], [1, 1, 1]);
      const placed = MB();
      placed.add(noseWheels.build(), m);
      addPart('wheelNose', placed, [0, g.y, g.z], [1, 0, 0]);
    }
  }

  {
    const g = AC.gearMain;
    const yTop = -1.00;
    const strut = MB();
    box(strut, [g.x, (yTop + g.y) / 2 + 0.12, g.z], [0.27, yTop - g.y - 0.12, 0.31], [0.88, 0.90, 0.93]);
    box(strut, [g.x, g.y + 0.55, g.z + 0.34], [0.14, 1.15, 0.13], [0.60, 0.62, 0.66], [0.34, 0, 0]);
    box(strut, [g.x - 0.33, (yTop + g.y) / 2 + 0.35, g.z - 0.30], [0.12, 1.5, 0.12], [0.86, 0.88, 0.91]);
    box(strut, [g.x, g.y, g.z], [1.05, 0.11, 0.11], [0.55, 0.57, 0.60]);   // 小车轴
    box(strut, [g.x + 0.55, yTop - 0.15, g.z + 0.55], [0.07, 0.9, 1.3], [0.92, 0.93, 0.95], [0, 0.1, 0.12]);
    solid.add(strut.build());

    const wheel = MB();
    revolveX(wheel, [[-0.21, 0.0], [-0.20, 0.23], [-0.14, 0.42], [0.0, 0.50], [0.14, 0.42], [0.20, 0.23], [0.21, 0.0]], 22,
      { color: [0.068, 0.072, 0.080] });
    revolveX(wheel, [[-0.12, 0.12], [0.0, 0.15], [0.12, 0.12]], 16, { color: [0.58, 0.60, 0.64] });
    const wb = wheel.build();
    const mainWheels = MB();
    for (const dx of [-0.62, -0.24, 0.24, 0.62]) {
      const m = m4();
      m4compose(m, [dx, 0, 0], [0, 0, 0], [1, 1, 1]);
      mainWheels.add(wb, m);
    }
    {
      const m = m4();
      m4compose(m, [g.x, g.y, g.z], [0, 0, 0], [1, 1, 1]);
      const placed = MB();
      placed.add(mainWheels.build(), m);
      addPart('wheelMain', placed, [g.x, g.y, g.z], [1, 0, 0]);
    }
  }

  // ══ 小细节：天线、机腹整流罩 ══
  {
    box(solid, [0, 1.05, 0.8], [0.06, 0.42, 0.30], [0.9, 0.91, 0.93]);
    box(solid, [0, 1.02, -4.2], [0.05, 0.30, 0.26], [0.9, 0.91, 0.93]);
    // 机腹起落架舱整流罩
    surf(solid, (u, v) => {
      const z = lerp(-6.0, 6.0, v);
      const w = 1.55 * Math.sin(Math.PI * sat((v - 0.02) / 0.96)) ** 0.6;
      const a = u * Math.PI;
      return [Math.cos(a) * w, -1.86 - Math.sin(a) * 0.34, z];
    }, 12, 12, { color: [0.93, 0.94, 0.955], center: (u, v) => [0, -1.55, lerp(-6, 6, v)] });
  }

  // 右舷部件原样合并，再镜像出一份左舷的
  const sr = sideR.build();
  solid.add(sr);
  solid.add(mirrorX(sr));

  return { solid: solid.build(), parts, fuseIdxRange };
}

// 沿 X 轴镜像：位置与法线的 x 取反，三角形绕序翻转（否则背面朝外）
function mirrorX(d) {
  const pos = new Float32Array(d.pos);
  const nrm = new Float32Array(d.nrm);
  for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nrm[i] = -nrm[i]; }
  const idx = new Uint32Array(d.idx.length);
  for (let i = 0; i < d.idx.length; i += 3) { idx[i] = d.idx[i]; idx[i + 1] = d.idx[i + 2]; idx[i + 2] = d.idx[i + 1]; }
  return { pos, nrm, uv: d.uv, col: d.col, idx };
}

// ══════════════════════════════════════════════════════════════════════════
//  第二步：把机身单独拆出来（它要用涂装贴图），并给所有网格算顶点色
//  ══════════════════════════════════════════════════════════════════════════
function splitFuselage(geo) {
  // 机身段的索引区间由 buildPlane 直接记录 —— 不要再靠“48×64×6”去猜，
  // 机身的细分数一变，猜出来的切点就会把别的东西劈开。
  const d = geo.solid;
  const idx = d.idx;
  const r = geo.fuseIdxRange || [0, 0];
  const fuseIdx = idx.slice(r[0], r[1]);
  const restIdx = new Uint32Array(idx.length - (r[1] - r[0]));
  restIdx.set(idx.subarray(0, r[0]), 0);
  restIdx.set(idx.subarray(r[1]), r[0]);

  const pick = (indices) => {
    const map = new Map();
    const pos = [], nrm = [], uv = [], col = [], out = [];
    for (let i = 0; i < indices.length; i++) {
      const o = indices[i];
      let ni = map.get(o);
      if (ni === undefined) {
        ni = pos.length / 3;
        map.set(o, ni);
        pos.push(d.pos[o * 3], d.pos[o * 3 + 1], d.pos[o * 3 + 2]);
        nrm.push(d.nrm[o * 3], d.nrm[o * 3 + 1], d.nrm[o * 3 + 2]);
        uv.push(d.uv[o * 2], d.uv[o * 2 + 1]);
        col.push(d.col[o * 3], d.col[o * 3 + 1], d.col[o * 3 + 2]);
      }
      out.push(ni);
    }
    return {
      pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv),
      col: new Float32Array(col), idx: new Uint32Array(out),
    };
  };
  return { fuselage: pick(fuseIdx), rest: pick(restIdx) };
}

// 用“天空色 / 地面色”对顶点色做环境光调制：朝上的面被天光照亮、朝下的面
// 带地面反光。这样即使是纯顶点色，机体也有体积感。
function bakeVertexLight(d) {
  const n = d.pos.length / 3;
  const out = new Float32Array(n * 3);
  const SKY = [1.02, 1.06, 1.16];
  const GND = [0.66, 0.64, 0.58];
  for (let i = 0; i < n; i++) {
    const nx = d.nrm[i * 3], ny = d.nrm[i * 3 + 1], nz = d.nrm[i * 3 + 2];
    const k = sat(ny * 0.62 + 0.5);
    for (let c = 0; c < 3; c++) {
      const amb = lerp(GND[c], SKY[c], k);
      // 侧向的面略微压暗，做出圆柱的体积
      const side = 1 - 0.10 * Math.abs(nx) - 0.04 * Math.abs(nz);
      out[i * 3 + c] = d.col[i * 3 + c] * amb * side;
    }
  }
  return { ...d, col: out };
}
