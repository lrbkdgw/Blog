// ═══════════════════════════════════════════════════════════════════════════
//  20 · 网格构造
//  × 所有几何都由参数曲面生成：surf() 采样 (u,v)，法线用叉乘求，再用
//    “中心点”把法线统一朝外 —— 这样闭合的翼型、旋转体都不用担心绕序。
//  × 顶点格式：pos(3) nrm(3) uv(2) col(3)
// ═══════════════════════════════════════════════════════════════════════════

function MB() {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  let vc = 0;
  const api = {
    idx,
    get vcount() { return vc; },
    tri(a, b, c) { idx.push(a, b, c); return api; },
    vert(p, n, t, c) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      uv.push(t ? t[0] : 0, t ? t[1] : 0);
      const cc = c || C_WHITE;
      col.push(cc[0], cc[1], cc[2]);
      return vc++;
    },
    quad(a, b, c, d) { idx.push(a, b, c, a, c, d); },
    build() {
      return {
        pos: new Float32Array(pos), nrm: new Float32Array(nrm),
        uv: new Float32Array(uv), col: new Float32Array(col),
        idx: new Uint32Array(idx),
      };
    },
    /** 并入另一份网格（可带 4×4 变换） */
    add(d, m) {
      if (!d) return api;
      const base = vc;
      const n = d.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const p = [d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]];
        const q = [d.nrm[i * 3], d.nrm[i * 3 + 1], d.nrm[i * 3 + 2]];
        api.vert(m ? m4point(m, p) : p, m ? vnorm(m4dir(m, q)) : q,
          [d.uv[i * 2], d.uv[i * 2 + 1]], [d.col[i * 3], d.col[i * 3 + 1], d.col[i * 3 + 2]]);
      }
      for (let i = 0; i < d.idx.length; i++) idx.push(d.idx[i] + base);
      return api;
    },
  };
  return api;
}
const C_WHITE = [0.905, 0.915, 0.940];
const C_LIVERY = [0.042, 0.085, 0.34];

/**
 * 参数曲面。
 *   fn(u,v) → [x,y,z]        u/v 都在 [0,1]
 *   o.closedU                u 方向环绕（接缝处法线连续）
 *   o.center(u,v,p)          “内部点”，用法线朝外判定朝向
 *   o.flip                   强制反向
 *   o.color / o.colorFn      颜色
 *   o.uv                     自定义 uv
 *   o.skipU(u) → bool        跳过某些列（例如翼型后缘处不要面）
 */
function surf(mb, fn, nu, nv, o) {
  o = o || {};
  const cu = !!o.closedU;
  const NU = nu, NV = nv, du = 1 / NU, dv = 1 / NV;
  const col = o.color || C_WHITE;
  const colFn = o.colorFn || null;
  const uvFn = o.uv || null;
  const centerFn = o.center || null;
  const base = mb.vcount;
  const at = (u, v) => fn(cu ? u - Math.floor(u) : u, v);

  // 采样 (NU+1)×(NV+1) 个点
  const P = new Array((NU + 1) * (NV + 1));
  for (let j = 0; j <= NV; j++) {
    for (let i = 0; i <= NU; i++) P[j * (NU + 1) + i] = at(i / NU, j / NV);
  }
  const gp = (i, j) => P[clamp(j, 0, NV) * (NU + 1) + clamp(i, 0, NU)];

  for (let j = 0; j <= NV; j++) {
    for (let i = 0; i <= NU; i++) {
      const p = P[j * (NU + 1) + i];
      const ip = cu ? (i === NU ? 0 : gp(i + 1, j)) : gp(i + 1, j);
      const im = cu ? (i === 0 ? NU : i - 1) : gp(i - 1, j);
      const jp = gp(i, j + 1), jm = gp(i, j - 1);
      const dpu = i === 0 && !cu ? vsub(gp(1, j), p) : i === NU && !cu ? vsub(p, gp(NU - 1, j)) : vsub(ip, im);
      const dpv = j === 0 ? vsub(jp, p) : j === NV ? vsub(p, jm) : vsub(jp, jm);
      let n = vcross(dpu, dpv);
      if (o.flip) n = vmul(n, -1);
      const l = vlen(n);
      n = l > 1e-12 ? vmul(n, 1 / l) : [0, 1, 0];
      if (centerFn) {
        const c = centerFn(i / NU, j / NV, p);
        if (vdot(n, vsub(p, c)) < 0) n = vmul(n, -1);
      }
      mb.vert(p, n, uvFn ? uvFn(i / NU, j / NV, p) : [i / NU, j / NV], colFn ? colFn(i / NU, j / NV, p) : col);
    }
  }
  const W = NU + 1;
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      if (o.skipU && o.skipU(i / NU + du * 0.5, j / NV + dv * 0.5)) continue;
      const a = base + j * W + i;
      mb.quad(a, a + 1, a + W + 1, a + W);
    }
  }
  return mb;
}

/** 绕（平行于 Z 的）轴线旋转的旋转体：prof = [[z, r], …]，圆心可偏移 (cx, cy) */
function revolveZ(mb, prof, seg, o) {
  o = o || {};
  const n = prof.length;
  const cx = o.cx || 0, cy = o.cy || 0;
  const col = o.color || null;
  return surf(mb, (u, v) => {
    const f = v * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;
    const z = lerp(prof[i][0], prof[i + 1][0], t);
    const r = lerp(prof[i][1], prof[i + 1][1], t);
    const a = u * TAU;
    return [cx + r * Math.sin(a), cy + r * Math.cos(a), z];
  }, seg, n - 1, {
    closedU: true,
    color: col || C_WHITE,
    center: (u, v) => {
      const f = v * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const t = f - i;
      return [cx, cy, lerp(prof[i][0], prof[i + 1][0], t)];
    },
    colorFn: o.colorFn || null,
    uv: o.uv || null,
  });
}

/** 绕 X 轴的旋转体：prof = [[x, r], …] */
function revolveX(mb, prof, seg, o) {
  o = o || {};
  const n = prof.length;
  return surf(mb, (u, v) => {
    const f = v * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;
    const x = lerp(prof[i][0], prof[i + 1][0], t);
    const r = lerp(prof[i][1], prof[i + 1][1], t);
    const a = u * TAU;
    return [x, r * Math.cos(a), r * Math.sin(a)];
  }, seg, n - 1, {
    closedU: true,
    color: o.color || C_WHITE,
    center: (u, v) => {
      const f = v * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      return [lerp(prof[i][0], prof[i + 1][0], f - i), 0, 0];
    },
  });
}

/** 圆环面片封口：ring 为按顺序排列的一圈点，法线显式给出 */
function capFan(mb, ring, normal, color) {
  const c = [0, 0, 0];
  for (const p of ring) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= ring.length; c[1] /= ring.length; c[2] /= ring.length;
  const ci = mb.vert(c, normal, [0.5, 0.5], color);
  const ids = ring.map((p) => mb.vert(p, normal, [0, 0], color));
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], b = ids[(i + 1) % ids.length];
    mb.tri(ci, a, b);
  }
  return mb;
}

/** 盒子（可绕原点旋转）；法线显式给出，不受 center 影响 */
function box(mb, c, s, color, rot) {
  const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
  const R = rot ? rotMat(rot) : null;
  const put = (p) => (R ? vadd(c, [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]]) : vadd(c, p));
  const dir = (p) => (R ? [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]] : p);
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  for (const [nn, pts] of faces) {
    const n = dir(nn);
    const ids = pts.map((p, k) => mb.vert(put(p), n, [k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1], color));
    mb.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  return mb;
}

function rotMat(r) {
  const cx = Math.cos(r[0]), sx = Math.sin(r[0]);
  const cy = Math.cos(r[1]), sy = Math.sin(r[1]);
  const cz = Math.cos(r[2]), sz = Math.sin(r[2]);
  // R = Ry·Rx·Rz（行主序）
  return [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
}

/** 绕任意轴（过 a，方向 d）旋转 ang：T(a)·R·T(−a) */
function m4axisAngle(out, a, dx, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  const l = Math.hypot(dx[0], dx[1], dx[2]) || 1;
  const x = dx[0] / l, y = dx[1] / l, z = dx[2] / l;
  out[0] = t * x * x + c; out[1] = t * x * y + s * z; out[2] = t * x * z - s * y; out[3] = 0;
  out[4] = t * x * y - s * z; out[5] = t * y * y + c; out[6] = t * y * z + s * x; out[7] = 0;
  out[8] = t * x * z + s * y; out[9] = t * y * z - s * x; out[10] = t * z * z + c; out[11] = 0;
  out[12] = a[0] - (out[0] * a[0] + out[4] * a[1] + out[8] * a[2]);
  out[13] = a[1] - (out[1] * a[0] + out[5] * a[1] + out[9] * a[2]);
  out[14] = a[2] - (out[2] * a[0] + out[6] * a[1] + out[10] * a[2]);
  out[15] = 1;
  return out;
}

/** 分段线性查表：tbl = [[x, a, b, …], …] → [a, b, …] */
function tblLookup(tbl, x) {
  const n = tbl.length;
  if (x <= tbl[0][0]) return tbl[0].slice(1);
  if (x >= tbl[n - 1][0]) return tbl[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && x > tbl[i + 1][0]) i++;
  const t = (x - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
  const out = [];
  for (let k = 1; k < tbl[i].length; k++) out.push(lerp(tbl[i][k], tbl[i + 1][k], t));
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
//  网格 → GPU
// ══════════════════════════════════════════════════════════════════════════
// 顶点格式：pos(3) nrm(3) uv(2) col(3) = 11 个 float
function uploadRaw(a, b) {
  // 允许 uploadRaw(gl, mesh) 这种写法：第一个参数不是网格就往后挪一个
  const d = b && b.pos ? b : a;
  if (!d || !d.pos) { console.warn('uploadRaw: 空网格'); return null; }
  const gl = glc.gl;
  const n = d.pos.length / 3;
  const buf = new Float32Array(n * 11);
  for (let i = 0; i < n; i++) {
    const o = i * 11;
    buf[o] = d.pos[i * 3]; buf[o + 1] = d.pos[i * 3 + 1]; buf[o + 2] = d.pos[i * 3 + 2];
    buf[o + 3] = d.nrm[i * 3]; buf[o + 4] = d.nrm[i * 3 + 1]; buf[o + 5] = d.nrm[i * 3 + 2];
    buf[o + 6] = d.uv[i * 2]; buf[o + 7] = d.uv[i * 2 + 1];
    buf[o + 8] = d.col[i * 3]; buf[o + 9] = d.col[i * 3 + 1]; buf[o + 10] = d.col[i * 3 + 2];
  }
  return makeVAO(gl, [{
    buffer: buf, stride: 11,
    attribs: [{ loc: 0, size: 3 }, { loc: 1, size: 3 }, { loc: 2, size: 2 }, { loc: 3, size: 3 }],
  }], d.idx);
}
