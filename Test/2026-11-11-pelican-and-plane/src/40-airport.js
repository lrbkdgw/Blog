// ═══════════════════════════════════════════════════════════════════════════
//  40 · 机场与地形
//  坐标：跑道沿 Z 轴，进近方向为 −Z（飞机从 −Z 飞向 +Z）；+Y 向上；
//  原点在跑道入口（接地区之前 300 m 的那个点）。单位是米。
//
//  跑道：长 3800 m（z ∈ [0, 3800]），宽 60 m；入口内 300 m 处的接地区（TDZ）。
//  与真实跑道一致的关键标线：入口横线、跑道号、中线虚线、瞄准点、接地区
//  标线、跑道边灯（白色，最后 600 m 变黄）、入口灯（绿色）、端点灯（红色）、
//  进近灯（顺序闪光）、PAPI（四个灯箱，随下滑角变红/白）、滑行道与引导线。
//  这些都在一个片元着色器里解析地画出来，没有贴图，近看不会有像素块。
// ═══════════════════════════════════════════════════════════════════════════

const RWY = {
  len: 3800,
  half: 30,          // 半宽
  tdz: 300,          // 接地区起点（距入口）
  aim: 400,          // 瞄准点（接地区中心）
  exitZ: 2560,       // 快速脱离道开口
  edgeZ0: 0,
  edgeZ1: 3800,
};

// 视锥体外的地面三角形直接剔除（草地在 4 km 外仍是平的，直接用一张大平面）
const GROUND_SIZE = 120000;

function buildGround() {
  const mb = MB();
  // 一块大平面，细分是为了让顶点着色器里的“地形起伏”有细节
  const N = 220, S = GROUND_SIZE;
  surf(mb, (u, v) => {
    // 近处细、远处粗：用二次映射把顶点密度集中到机场附近
    // 指数映射：机场附近几公里内顶点很密，往外迅速拉开，一直铺到地平线以外
    const f = (t) => Math.sign(t - 0.5) * (Math.exp(Math.abs(t - 0.5) * 2 * 5.2) - 1) / (Math.exp(5.2) - 1) * 0.5;
    const x = f(u) * S;
    const z = f(v) * S + 1800;
    return [x, 0, z];
  }, N, N, { color: [0.42, 0.5, 0.31], center: () => [0, -50, 1800] });
  return mb.build();
}

// ─── 跑道灯：用实例化的小球/灯箱，避免几万个独立的 draw call ───
function buildLights() {
  const arr = [];  // [x, y, z, kind, size]
  const push = (x, y, z, kind, size) => arr.push(x, y, z, kind, size);

  // 跑道边灯：两侧每 60 m 一盏，白 → 最后 600 m 变黄
  for (let z = 0; z <= RWY.len; z += 60) {
    const kind = z > RWY.len - 600 ? 3 : 1;
    push(-RWY.half - 1.5, 0.35, z, kind, 0.9);
    push(RWY.half + 1.5, 0.35, z, kind, 0.9);
  }
  // 入口灯（绿色，横排 8 盏）
  for (let i = 0; i < 9; i++) {
    const x = lerp(-RWY.half, RWY.half, i / 8);
    push(x, 0.4, -1.2, 4, 0.8);
  }
  // 端点灯（红色）
  for (let i = 0; i < 7; i++) {
    const x = lerp(-RWY.half, RWY.half, i / 6);
    push(x, 0.4, RWY.len + 1.2, 2, 0.8);
  }
  // 中线灯（白色，每 30 m）
  for (let z = 30; z < RWY.len - 15; z += 30) push(0, 0.3, z, 5, 0.55);

  // 进近灯：从入口向 −Z 延伸 900 m，30 m 一盏，两侧各 6 排
  for (let i = 0; i < 30; i++) {
    const z = -30 - i * 30;
    const halfW = 5 + i * 1.6;
    for (const x of [-halfW, 0, halfW]) push(x, 0.5, z, 6, 1.6);
  }
  // 顺序闪光灯（5 盏，沿进近灯中轴）
  for (let i = 0; i < 5; i++) push(0, 0.6, -30 - i * 90, 7, 2.2);

  // 滑行道灯（蓝色边灯）
  for (let z = 120; z < RWY.exitZ; z += 90) {
    push(-RWY.half - 14, 0.3, z, 8, 0.7);
    push(-RWY.half - 20, 0.3, z, 8, 0.7);
  }
  // 停机坪高杆灯
  for (const [x, z] of [[-120, 900], [-120, 1180], [-210, 1040], [-260, 900], [-260, 1180]]) {
    push(x, 26, z, 9, 3.2);
  }
  return new Float32Array(arr);
}

// ─── 实例化道具 ───
// 每实例固定 9 个 float：x y z | sx sy sz | rotY kind seed
// kind：1 航站楼 2 机库 3 塔台 4 小房子 5 针叶树 6 阔叶树
function inst(x, y, z, sx, sy, sz, rot, kind, seed) {
  return [x, y, z, sx, sy, sz, rot, kind, seed];
}

function buildPropHouses() {
  const a = [];
  // 航站楼 + 指廊（跑道西侧）
  a.push(...inst(-205, 0, 1080, 150, 21, 86, 0, 1, 0.2));
  a.push(...inst(-150, 0, 1300, 78, 16, 64, 0, 1, 0.5));
  a.push(...inst(-196, 0, 1230, 24, 13, 24, 0, 1, 0.7));
  // 机库
  a.push(...inst(-330, 0, 770, 66, 25, 74, 0, 2, 0.1));
  a.push(...inst(-330, 0, 872, 66, 25, 74, 0, 2, 0.4));
  a.push(...inst(-430, 0, 770, 60, 22, 66, 0, 2, 0.7));
  // 塔台：塔身 + 顶部指挥室
  a.push(...inst(-400, 0, 1000, 13, 44, 13, 0, 3, 0.2));
  a.push(...inst(-400, 44, 1000, 21, 9, 21, 0, 12, 0.9));
  // 消防站、货运、油罐
  a.push(...inst(-480, 0, 1050, 54, 15, 40, 0, 2, 0.3));
  a.push(...inst(-300, 0, 1420, 90, 12, 46, 0, 2, 0.6));
  for (let i = 0; i < 4; i++) a.push(...inst(-352 + i * 26, 0, 1560, 16, 13, 16, 0, 4, 0.2 + i * 0.17));
  // 跑道东侧的导航台与雷达
  a.push(...inst(150, 0, 320, 11, 8, 11, 0.4, 4, 0.2));
  a.push(...inst(120, 0, -140, 9, 6, 9, -0.3, 4, 0.6));
  a.push(...inst(210, 0, 2150, 13, 9, 13, 0.9, 4, 0.9));
  a.push(...inst(95, 0, 3800 + 60, 10, 7, 10, 0.2, 4, 0.4));
  return new Float32Array(a);
}

function buildTrees() {
  const conifer = [], round = [];
  let i = 0;
  // kind：5 = 针叶树，6 = 阔叶树（和实例化着色器里的分支一一对应）
  const put = (arr, x, z, h, w, kind) => arr.push(...inst(x, 0, z, w, h, w, hash1(i++ * 31) * 6.28, kind, hash1(i)));
  // 跑道两侧的防风林
  for (let z = -900; z < 4300; z += 30) {
    for (const side of [-1, 1]) {
      const r = hash1((z | 0) * 31 + (side > 0 ? 7 : 3));
      if (r < 0.5) continue;
      const dist = 120 + hash1((z | 0) * 17 + (side > 0 ? 91 : 5)) * 300;
      const x = side * dist;
      const h = 9 + r * 12, w = 3.4 + r * 2.6;
      const isRound = r > 0.75;
      put(isRound ? round : conifer, x, z + hash1((z | 0) * 13 + side) * 20, h, w, isRound ? 6 : 5);
    }
  }
  // 远处的树林（山脚下），绕着机场一大圈
  for (let k = 0; k < 420; k++) {
    const a = hash1(k * 137 + 11) * TAU;
    const rad = 900 + hash1(k * 311 + 7) * 2100;
    const x = Math.cos(a) * rad;
    const z = 1600 + Math.sin(a) * rad * 0.9;
    if (Math.abs(x) < 420 && z > -400 && z < 4400) continue;
    const h = 11 + hash1(k * 53 + 5) * 15, w = 3.6 + hash1(k * 97 + 9) * 3;
    const isRound = hash1(k * 11) > 0.75;
    put(isRound ? round : conifer, x, z, h, w, isRound ? 6 : 5);
  }
  return { conifer: new Float32Array(conifer), round: new Float32Array(round) };
}
