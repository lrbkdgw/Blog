
'use strict';
(() => {
// ═══════════════════════════════════════════════════════════════════════════
//  10 · 基础工具：数学 / 随机数 / WebGL 封装
//  这里只做纯计算与资源创建，不碰界面，出错时容易单独定位。
// ═══════════════════════════════════════════════════════════════════════════

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sat = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smoothstep = (a, b, x) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// 整数散列 → [0,1)。场景里的“随机”全部由它生成，所以每次打开都完全一样。
function hash1(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) | 0;
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const hash2 = (x, y) => hash1(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263));

// ─── 3 维向量（用数组，够短够快） ───
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ─── 4x4 矩阵（列主序，与 WebGL 一致） ───
// out[0..3]=第 0 列，out[4..7]=第 1 列 …… 空间变换用 M·v。
const m4 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const m4id = (o) => {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
};
function m4mul(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}
function m4perspect(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}
function m4ortho(out, l, r, b, t, n, f) {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}
function m4lookAt(out, eye, center, up) {
  const f = vnorm(vsub(center, eye));
  let s = vcross(f, up);
  if (vlen(s) < 1e-6) s = vcross(f, [0, 0, 1]);
  s = vnorm(s);
  const u = vcross(s, f);
  out[0] = s[0]; out[1] = u[0]; out[2] = -f[0]; out[3] = 0;
  out[4] = s[1]; out[5] = u[1]; out[6] = -f[1]; out[7] = 0;
  out[8] = s[2]; out[9] = u[2]; out[10] = -f[2]; out[11] = 0;
  out[12] = -vdot(s, eye); out[13] = -vdot(u, eye); out[14] = vdot(f, eye); out[15] = 1;
  return out;
}
function m4invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return m4id(out);
  const d = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return out;
}
const m4point = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const m4dir = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
];

// 位置 + 欧拉角 + 缩放 → 世界矩阵。旋转顺序 R = Ry(yaw) · Rz(roll) · Rx(pitch)：
// 对飞机而言就是“先抬头、再压坡度、再改航向”。
function m4compose(out, pos, rot, scl) {
  const cx = Math.cos(rot[0]), sx = Math.sin(rot[0]);
  const cy = Math.cos(rot[1]), sy = Math.sin(rot[1]);
  const cz = Math.cos(rot[2]), sz = Math.sin(rot[2]);
  const kx = scl ? scl[0] : 1, ky = scl ? scl[1] : 1, kz = scl ? scl[2] : 1;
  //           列 0 (R00,R10,R20)            列 1 (R01,R11,R21)             列 2 (R02,R12,R22)
  out[0] = cy * cz * kx; out[1] = sz * kx; out[2] = -sy * cz * kx;
  out[3] = 0;
  out[4] = (sy * sx - cy * sz * cx) * ky;
  out[5] = cz * cx * ky;
  out[6] = (sy * sz * cx + cy * sx) * ky;
  out[7] = 0;
  out[8] = (cy * sz * sx + sy * cx) * kz;
  out[9] = -cz * sx * kz;
  out[10] = (cy * cx - sy * sz * sx) * kz;
  out[11] = 0;
  out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
  return out;
}
function m4child(out, parent, pos, rot, scl) {
  return m4mul(out, parent, m4compose(m4(), pos, rot || [0, 0, 0], scl));
}

// ─── 帧率无关的一阶跟随 ───
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// ═══════════════════════════════════════════════════════════════════════════
//  WebGL2 小封装
// ═══════════════════════════════════════════════════════════════════════════

// 全局的 WebGL 上下文（初始化后所有绘制函数都从这里拿）
const glc = {
  gl: null,
  canvas: null,
  init(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    if (!gl) return null;
    this.gl = gl;
    this.canvas = canvas;
    return gl;
  },
};

function glCompile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    const lines = src.split('\n');
    let ctx = '';
    const m = /:(\d+):/.exec(log);
    if (m) {
      const n = parseInt(m[1], 10);
      for (let i = Math.max(0, n - 7); i < Math.min(lines.length, n + 3); i++) ctx += `${i + 1}: ${lines[i]}\n`;
    }
    gl.deleteShader(sh);
    throw new Error(`[${label}] 着色器编译失败\n${log}\n${ctx}`);
  }
  return sh;
}

const programCache = new Map();
function getProgram(name, vsSrc, fsSrc, uniforms) {
  if (programCache.has(name)) return programCache.get(name);
  const gl = glc.gl;
  const vs = glCompile(gl, gl.VERTEX_SHADER, vsSrc, name + '.vert');
  const fs = glCompile(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.frag');
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[${name}] 链接失败: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (const n of uniforms || []) u[n] = gl.getUniformLocation(p, n);
  const rec = { p, u, name };
  programCache.set(name, rec);
  return rec;
}

// layout: [{buffer, attribs:[{loc,size}], divisor}]，索引可为 null
function makeVAO(gl, layout, indexData) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = [];
  for (const part of layout) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, part.buffer, gl.STATIC_DRAW);
    buffers.push(b);
    let off = 0;
    const stride = part.stride || 0;
    for (const a of part.attribs) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride * 4, off * 4);
      if (part.divisor) gl.vertexAttribDivisor(a.loc, part.divisor);
      off += a.size;
    }
  }
  let ibo = null, count = 0, type = gl.UNSIGNED_INT;
  if (indexData) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
    count = indexData.length;
    type = indexData instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  return { vao, buffers, ibo, count, type };
}

function drawMesh(m) {
  if (!m || !m.count) return;
  const gl = glc.gl;
  gl.bindVertexArray(m.vao);
  gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
}

function texParams(gl, t, opts) {
  const f = opts.filter || gl.LINEAR;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mips === false ? f : gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS || gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT || gl.CLAMP_TO_EDGE);
  if (opts.mips !== false) gl.generateMipmap(gl.TEXTURE_2D);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso && opts.aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(opts.aniso, max));
  }
}

// 用 Canvas2D 现场画一张贴图；全部内容都是程序化生成的，没有任何外部文件
function canvasTexture(gl, w, h, draw, opts) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!(opts && opts.flipY));
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  texParams(gl, t, opts || {});
  return t;
}

function dataTexture(gl, w, h, data, opts) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  texParams(gl, t, opts || {});
  return t;
}
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
// ═══════════════════════════════════════════════════════════════════════════
//  50 · 着色器
//  所有 GLSL 都写在这里。天空、地面、飞机共用同一段“公共函数”（大气、
//  太阳、噪声、雾），这样机身反射出来的天空和背景是同一片天。
// ═══════════════════════════════════════════════════════════════════════════

const GLSL_COMMON = `
precision highp float;

uniform vec3  uSunDir;        // 指向太阳（单位向量）
uniform vec3  uSunCol;        // 阳光颜色 × 强度
uniform vec3  uSkyZenith;
uniform vec3  uSkyHorizon;
uniform vec3  uGroundCol;
uniform vec3  uFogCol;
uniform float uFogDensity;
uniform float uTime;
uniform float uNight;
uniform vec3  uAmbSky;        // 天空环境光
uniform vec3  uAmbGnd;        // 地面反射光

// 所有颜色都是按 sRGB 手调出来的，进光照计算前要先转成线性
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = p * 2.03 + vec2(11.3, 7.7);
    a *= 0.5;
  }
  return s;
}
float fbm4(vec2 p) { return fbm(p, 4); }

// 天空的底色。
// 注意：渐变必须在 sRGB（“调色板”）空间里混合 —— 线性空间里地平线的橙
// （0.79）比天顶的蓝（0.0004）亮两千倍，直接混会让整片天都变成橙色。
vec3 skyGradient(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  float k  = pow(1.0 - h, 30.0);             // 紧贴地平线的一条暖带（要窄）
  float k2 = pow(1.0 - h, 9.0);              // 中层：橙 → 灰紫的过渡
  // 中层是“橙与蓝之间带一点粉”的暮光色
  vec3 mid = mix(mix(uSkyHorizon, uSkyZenith, 0.82), uSkyHorizon, 0.16);
  vec3 c = mix(uSkyZenith, mid, k2);
  c = mix(c, uSkyHorizon, k);
  if (d.y < 0.0) c = mix(uSkyHorizon, uGroundCol, smoothstep(0.0, -0.3, d.y));
  return c;                                   // 仍是 sRGB
}

vec3 skyBase(vec3 d) {
  vec3 c = toLin(skyGradient(d));
  float sd = max(dot(d, uSunDir), 0.0);
  float lowSun = 1.0 - clamp(uSunDir.y * 2.2, 0.0, 1.0);
  // 太阳附近的散射：只加在线性空间，且只落在太阳方位上
  c += uSunCol * (0.05 * pow(sd, 20.0) + 0.035 * lowSun * pow(sd, 5.0));
  c += uSunCol * 0.9 * pow(sd, 900.0);
  return c;
}

// 指数平方雾：远处的跑道灯会被空气“糊”成一片暖光
float fogAmount(vec3 p, vec3 cam) {
  float d = length(p - cam);
  float x = d * uFogDensity;
  return 1.0 - exp(-x * x);
}
vec3 applyFog(vec3 col, vec3 p, vec3 cam) {
  return mix(col, toLin(uFogCol), fogAmount(p, cam));
}

// 太阳表面的软盘（画盘状高光用）
float sunDisc(vec3 d) {
  return smoothstep(0.99965, 0.99992, dot(d, uSunDir));
}
`;

// ───────────────────────────── 全屏三角形 ─────────────────────────────
const VS_FULL = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// ───────────────────────────── 天空 ─────────────────────────────
const FS_SKY = `#version 300 es
${GLSL_COMMON}
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uCloudCover;
uniform float uMountainFade;
in vec2 vUv;
out vec4 oCol;

// 一层云：把视线投到高度 h 的平面上，再用 fbm 生成团块
vec4 cloudLayer(vec3 d, float h, float scale, float cover, float soft, float drift) {
  if (d.y < 0.035) return vec4(0.0);
  // 靠近地平线的云被大气压扁，直接淡出，免得变成一条脏带
  float horizonFade = smoothstep(0.035, 0.20, d.y);
  float t = (h - uCamPos.y) / max(d.y, 0.02);
  if (t < 0.0 || t > 60000.0) return vec4(0.0);
  vec2 p = uCamPos.xz + d.xz * t;
  p = p / scale + vec2(uTime * drift, uTime * drift * 0.35);
  float n = fbm4(p);
  float n2 = fbm(vec2(p.x * 3.1 + 20.0, p.y * 3.1 - 9.0), 3);
  float dens = smoothstep(cover, cover + soft, n * 0.78 + n2 * 0.30);
  // 越远的云越淡（受大气影响）
  float dist = length(d.xz) * t;
  float fade = exp(-dist / 22000.0);
  dens *= fade * horizonFade;
  // 云底受光：太阳方向上的“边缘发光”
  float lit = clamp(dot(normalize(vec3(d.x, 0.55, d.z)), uSunDir) * 0.5 + 0.62, 0.0, 1.0);
  // 云的明暗也用 sRGB 调色，最后一起转线性
  vec3 shadow = mix(uSkyHorizon * 0.55 + uSkyZenith * 0.45, uSkyZenith, 0.25) * 0.85;
  vec3 bright = mix(uSkyHorizon, vec3(1.0), 0.55) * (0.75 + 0.45 * lit);
  vec3 cS = mix(shadow, bright, lit * (0.45 + 0.55 * dens));
  cS += uSkyHorizon * pow(max(dot(d, uSunDir), 0.0), 8.0) * 0.5 * dens;
  return vec4(toLin(cS), dens * 0.96);
}

// 远山：按方位角解析出山脊高度
float ridge(vec3 d, float seed, float amp, float freq) {
  float az = atan(d.z, d.x);
  float a = sin(az * freq + seed) * 0.5 + 0.5;
  a = pow(a, 2.2);
  float b = sin(az * freq * 2.7 + seed * 2.3 + 1.7) * 0.5 + 0.5;
  float c = pow(sin(az * freq * 5.3 + seed * 4.1) * 0.5 + 0.5, 3.0);
  return (a * 0.62 + b * 0.27 + c * 0.11) * amp;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 d = normalize(far.xyz / far.w - uCamPos);
  vec3 c = skyBase(d);

  // 星空（夜里才看得到，且只在地平线以上）
  // 每格只放一颗“点”星：用格内的小圆而不是整格 —— 否则靠近地平线时
  // 被透视压扁的格子会变成一条条竖直白条。
  if (uNight > 0.02) {
    vec2 gx = d.xz / max(abs(d.y), 0.06) * 0.35;   // 以天顶角为尺度的“天球”网格
    vec2 id = floor(gx);
    vec2 f = fract(gx) - 0.5;
    float st = hash12(id + 7.31);
    vec2 jit = vec2(hash12(id + 1.7), hash12(id + 4.9)) - 0.5;
    float dd = length((f - jit * 0.6) * vec2(1.0, 1.0));
    float dot0 = smoothstep(0.10, 0.0, dd);
    float tw = 0.65 + 0.35 * sin(uTime * 2.1 + st * 50.0);
    float star = dot0 * step(0.988, st) * smoothstep(0.02, 0.30, d.y);
    c += vec3(0.85, 0.9, 1.0) * star * tw * uNight * 0.55;
    // 月亮
    vec3 moonDir = normalize(vec3(-0.35, 0.42, -0.84));
    float md = dot(d, moonDir);
    c += vec3(0.95, 0.96, 1.0) * smoothstep(0.99955, 0.99985, md) * 1.6 * uNight;
    c += vec3(0.55, 0.62, 0.8) * pow(max(md, 0.0), 260.0) * 0.25 * uNight;
  }

  // 太阳本体
  c += uSunCol * sunDisc(d) * 6.0;
  // 太阳周围很亮的光晕，同时压暗日轮的边缘
  c = mix(c, uSunCol * 3.0 + 0.6, sunDisc(d) * 0.65);

  // 远山（两层，用大气的颜色和雾把它们推远）
  float mt1 = ridge(d, 1.7, 0.035, 3.1);
  float mt2 = ridge(d, 4.3, 0.075, 1.9);
  if (d.y < mt2) {
    float h2 = smoothstep(mt2, mt2 - 0.012, d.y);
    vec3 mc = toLin(skyGradient(normalize(vec3(d.x, 0.09, d.z))) * 0.80);
    float shade = 0.70 + 0.55 * clamp(dot(normalize(vec3(d.x, 0.12, d.z)), uSunDir), 0.0, 1.0);
    c = mix(c, mc * shade, h2 * 0.90 * uMountainFade);
  }
  if (d.y < mt1) {
    float h1 = smoothstep(mt1, mt1 - 0.008, d.y);
    vec3 mc = toLin(skyGradient(normalize(vec3(d.x, 0.05, d.z))) * 0.55);
    float shade = 0.62 + 0.6 * clamp(dot(normalize(vec3(d.x, 0.1, d.z)), uSunDir), 0.0, 1.0);
    c = mix(c, mc * shade, h1 * 0.80 * uMountainFade);
  }

  // 云：两层，高的卷云 + 低的层积云
  vec4 cir = cloudLayer(d, 7200.0, 900.0, 0.52, 0.30, 0.55);
  vec4 cl = cloudLayer(d, 2400.0, 420.0, 0.50, 0.22, 1.0);
  // 夜里云要几乎看不见：只留一点轮廓
  float cloudDim = mix(1.0, 0.16, clamp(uNight, 0.0, 1.0));
  c = mix(c, cir.rgb * cloudDim, cir.a * 0.75 * uCloudCover);
  c = mix(c, cl.rgb * cloudDim, cl.a * uCloudCover);

  // 地平线雾带：用很窄的指数衰减，并且只“提亮到雾色”，不能比天空更亮
  float hz = exp(-abs(d.y) * 160.0);
  vec3 fogL = toLin(uFogCol);
  c = mix(c, min(fogL, c * 1.35 + fogL * 0.10), hz * 0.40);

  oCol = vec4(c, 1.0);
}`;

// ───────────────────────────── 地面 / 跑道 ─────────────────────────────
const VS_GROUND = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vPos;
out vec3 vNormal;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vNormal = vec3(0.0, 1.0, 0.0);
  gl_Position = uViewProj * wp;
}`;

const FS_GROUND = `#version 300 es
${GLSL_COMMON}
uniform vec3 uCamPos;
uniform float uTerrainDetail;
uniform sampler2D uNumNear;     // 近端跑道号（18）
uniform sampler2D uNumFar;      // 远端跑道号（36）
in vec3 vPos;
in vec3 vNormal;
out vec4 oCol;

const float RWY_L = 3800.0;
const float RWY_H = 30.0;
const float RWY_TDZ = 300.0;

// 距离场辅助：一条直线的“到中心的有符号距离”
float sdSeg(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 pa = p - a, ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}
// 抗锯齿掩码：|d| 小于半宽 w 时为 1
float band(float d, float w, float aa) {
  return 1.0 - smoothstep(w - aa, w + aa, abs(d));
}
float rect(vec2 p, vec2 c, vec2 h, float aa) {
  vec2 d = abs(p - c) - h;
  return 1.0 - smoothstep(-aa, aa, max(d.x, d.y));
}

// 跑道与滑行道的“路面”距离场（负值在路面内）
float taxiDist(vec2 p, out float t) {
  float d1 = sdSeg(p, vec2(-25.0, 1560.0), vec2(-215.0, 1265.0), t);
  float t2;
  float d2 = sdSeg(p, vec2(-215.0, 1265.0), vec2(-300.0, 960.0), t2);
  return min(d1, d2);
}

void main() {
  vec2 p = vPos.xz;
  float camDist = length(vPos - uCamPos);
  // 像素在世界空间里覆盖多大 —— 用它来淡出过细的细节，避免闪烁
  float px = max(length(fwidth(p)), 0.0008);
  float aa = px * 1.1;

  // ── 地面：草皮，带大尺度的色块和细碎的杂草 ──
  float big = fbm4(p * 0.0016 + vec2(3.1, 7.7));
  float mid = fbm4(p * 0.011);
  float fine = vnoise(p * 0.9);
  vec3 grass = mix(vec3(0.145, 0.215, 0.095), vec3(0.255, 0.315, 0.135), big);
  grass = mix(grass, vec3(0.30, 0.34, 0.16), mid * 0.55);
  grass *= 0.86 + fine * 0.24;
  // 割草的条纹（机场特有的大片条带）
  float mow = step(0.5, fract(p.x * 0.5 / 40.0 + 0.0)) * 0.04 - 0.02;
  grass *= 1.0 + mow * (1.0 - smoothstep(80.0, 400.0, camDist));
  // 干一点的土斑
  grass = mix(grass, vec3(0.34, 0.30, 0.19), smoothstep(0.62, 0.9, mid) * 0.35);

  // ── 跑道 ──
  float onRwy = step(abs(p.x), RWY_H) * step(0.0, p.y + abs(p.y) * 0.0 + 0.0);
  float rwyMask = rect(p, vec2(0.0, RWY_L * 0.5), vec2(RWY_H, RWY_L * 0.5), aa);
  // 沥青底色 + 补丁
  float asph = fbm4(p * 0.06);
  float grain = vnoise(p * 2.1) * 0.5 + vnoise(p * 7.0) * 0.25;
  vec3 asphalt = mix(vec3(0.145, 0.152, 0.16), vec3(0.21, 0.216, 0.225), asph);
  asphalt *= 0.9 + grain * 0.20;
  // 跑道中线附近被轮子磨得发亮
  asphalt = mix(asphalt, asphalt * 1.16, band(p.x, 5.0, aa * 2.0) * 0.35);

  // ── 滑行道 & 停机坪 ──
  float tt;
  float td = taxiDist(p, tt);
  float taxiMask = 1.0 - smoothstep(11.0 - aa, 11.0 + aa, td);
  float apronMask = rect(p, vec2(-395.0, 1115.0), vec2(132.0, 220.0), aa);
  float taxiCol = 1.0;
  vec3 taxiA = mix(vec3(0.22, 0.225, 0.235), vec3(0.27, 0.275, 0.285), fbm4(p * 0.09));
  taxiA *= 0.92 + grain * 0.16;

  // 夜里草地偏冷的灰绿，去掉白天那种饱和的绿
  grass = mix(grass, vec3(dot(grass, vec3(0.30, 0.55, 0.15))) * vec3(0.78, 0.86, 1.02), uNight * 0.65);
  grass = toLin(grass);
  taxiA = toLin(taxiA);
  asphalt = toLin(asphalt);
  // 把地面颜色按掩码混合
  vec3 surf = grass;
  surf = mix(surf, taxiA, max(taxiMask, apronMask) * 0.96);
  surf = mix(surf, asphalt, rwyMask);

  // ── 停机坪的夜间照明：高杆灯在地上留下暖色光池 ──
  if (uNight > 0.02 && apronMask > 0.001) {
    vec3 lamp = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      vec2 lp = i == 0 ? vec2(-120.0, 900.0) : i == 1 ? vec2(-120.0, 1180.0)
             : i == 2 ? vec2(-210.0, 1040.0) : i == 3 ? vec2(-260.0, 900.0)
             : vec2(-260.0, 1180.0);
      float d = length(p - lp);
      lamp += vec3(1.0, 0.80, 0.52) * exp(-d * d / 3400.0);
    }
    surf += lamp * 0.55 * uNight * apronMask * 0.55;
  }

  // ── 标线（全部解析计算，配抗锯齿） ──
  float mark = 0.0;      // 白色标线
  float yellow = 0.0;    // 黄色引导线
  float z = p.y;
  float x = p.x;
  // 只有跑道范围内才画跑道标线
  float onR = rwyMask;
  // 中线虚线：30 m 实线 + 20 m 间隔（真实跑道的规格）
  float dash = step(0.0, z) * step(z, RWY_L);
  float ph = mod(z - 6.0, 50.0);
  mark += band(x, 0.45, aa) * step(ph, 30.0) * dash;
  // 跑道入口“钢琴键”：8 条 3 m 宽、30 m 长的白条
  {
    float stripe = band(mod(x + RWY_H, 7.2) - 3.6, 1.5, aa);
    float zz = step(6.0, z) * step(z, 36.0);
    mark += stripe * zz * step(abs(x), RWY_H - 1.5);
  }
  // 瞄准点：两块大矩形（300 m 处，距中线 9~16.5 m）
  mark += rect(vec2(abs(x), z), vec2(12.75, 400.0), vec2(3.75, 22.5), aa);
  // 接地区标线：从 150 m 起，每 150 m 一对，条数随距离增加
  {
    float zz = z - 150.0;
    float row = floor(zz / 150.0 + 0.5);
    float inRow = step(abs(zz - row * 150.0), 22.5);
    float bars = clamp(row + 1.0, 1.0, 3.0);
    float idx = floor((abs(x) - 9.0) / 3.4 + 0.5);
    float ok = step(0.0, idx) * step(idx, bars - 1.0);
    float bar = band(mod(abs(x) - 9.0, 3.4) - 1.2, 1.2, aa) * ok;
    mark += inRow * bar * step(row, 3.0) * step(z, 1150.0);
  }
  // 跑道边线（两侧细白线）
  mark += band(abs(x) - (RWY_H - 1.2), 0.45, aa) * dash;
  // 距离记号（每隔 300 m 的一组小横线，跑道北侧）
  mark += rect(vec2(x, z), vec2(-RWY_H + 9.0, 0.0), vec2(0.45, 4.5), aa) * 0.0;
  // 轮胎印：接地点附近两条黑带
  float tyre = band(abs(x) - 3.6, 1.9, aa) * smoothstep(240.0, 320.0, z) * (1.0 - smoothstep(500.0, 900.0, z));
  tyre *= 0.35 + 0.35 * fbm4(vec2(x * 0.8, z * 0.02));
  surf *= 1.0 - tyre * 0.45;
  // 滑行道中线（黄色）
  {
    float w = 1.0 - smoothstep(0.30 - aa, 0.30 + aa, td);
    yellow += w * step(td, 0.0 + 999.0) * max(taxiMask, 0.0);
    // 跑道上的出口引导线
    float t3;
    float d3 = sdSeg(p, vec2(0.0, 1560.0), vec2(-215.0, 1265.0), t3);
    yellow += (1.0 - smoothstep(0.3 - aa, 0.3 + aa, d3)) * step(0.0, p.x) * step(p.x, 0.0 + 0.1) * 0.0;
  }
  // 停机位线
  yellow += rect(vec2(x, z), vec2(-395.0, 1115.0), vec2(120.0, 0.25), aa) * 0.0;

  // 远处（一个像素比标线还宽）时把标线整体淡掉，否则会闪成一片麻点。
  // px 是“一个像素在世界里有多宽”，标线窄的约 1 m，所以超过 ~0.9 m/px 就淡出。
  float farFade = 1.0 - smoothstep(0.55, 1.25, px);
  mark *= farFade;
  float whiteMask = clamp(mark, 0.0, 1.0) * onR;
  vec3 paint = toLin(vec3(0.88, 0.89, 0.88));
  surf = mix(surf, paint, whiteMask * 0.92);
  surf = mix(surf, toLin(vec3(0.88, 0.68, 0.12)), clamp(yellow, 0.0, 1.0) * 0.9);

  // ── 跑道号：入口内约 70 m 与远端各一块（18 / 36）──
  {
    // 近端：从进近方向（−Z）看是正的
    vec2 nr = vec2(x / 9.6, (z - 78.0) / 13.0);
    if (abs(nr.x) < 1.0 && abs(nr.y) < 1.0) {
      vec4 t = texture(uNumNear, vec2(nr.x * 0.5 + 0.5, 0.5 - nr.y * 0.5));
      surf = mix(surf, toLin(t.rgb), t.a * 0.95);
    }
    // 远端：从 +Z 方向看是正的
    vec2 fr = vec2(x / 9.6, (z - (RWY_L - 78.0)) / 13.0);
    if (abs(fr.x) < 1.0 && abs(fr.y) < 1.0) {
      vec4 t = texture(uNumFar, vec2(0.5 - fr.x * 0.5, 0.5 + fr.y * 0.5));
      surf = mix(surf, toLin(t.rgb), t.a * 0.95);
    }
  }

  // ── 光照 ──
  float ndl = max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);
  vec3 amb = mix(uAmbGnd, uAmbSky, 0.5);
  vec3 lit = surf * (uSunCol * ndl + amb);
  // 湿滑的沥青有一点高光
  vec3 V = normalize(uCamPos - vPos);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(H.y, 0.0), 60.0) * (1.0 - rwyMask * 0.4) * 0.35;
  lit += uSunCol * spec * (0.15 + whiteMask * 0.5);

  lit = applyFog(lit, vPos, uCamPos);
  oCol = vec4(lit, 1.0);
}`;

// ───────────────────────────── 实例化道具 ─────────────────────────────
// 几何是“单位盒”（y ∈ [0,1]）；在顶点着色器里按 kind 变形成锥形的树。
const VS_INST = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in float aTop;      // 1 = 顶面
layout(location = 3) in vec4 iA;         // x y z sx
layout(location = 4) in vec4 iB;         // sy sz rotY kind
layout(location = 5) in float iSeed;
uniform mat4 uViewProj;
uniform vec2 uWin;                       // 屏幕分辨率（用于树的细碎抖动）
out vec3 vPos;
out vec3 vNrm;
out vec3 vLocal;
out float vKind;
out float vSeed;
out float vTop;
void main() {
  float kind = iB.w;
  vec3 sz = vec3(iA.w, iB.x, iB.y);
  vec3 p = aPos;
  vec3 n = aNrm;
  float s = sin(iB.z), c = cos(iB.z);
  vec3 sp = p * sz;
  vec3 rp = vec3(sp.x * c + sp.z * s, sp.y, -sp.x * s + sp.z * c);
  vPos = rp + iA.xyz;
  vec3 nn = n / max(sz, vec3(0.01));
  vNrm = normalize(vec3(nn.x * c + nn.z * s, nn.y, -nn.x * s + nn.z * c));
  vLocal = p;
  vKind = kind;
  vSeed = iSeed;
  vTop = aTop;
  gl_Position = uViewProj * vec4(vPos, 1.0);
}`;

const FS_INST = `#version 300 es
${GLSL_COMMON}
uniform vec3 uCamPos;
in vec3 vPos;
in vec3 vNrm;
in vec3 vLocal;
in float vKind;
in float vSeed;
in float vTop;
out vec4 oCol;

// 3D 值噪声，给树冠一点起伏
float h31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 N = normalize(vNrm);
  vec3 base = vec3(0.62, 0.63, 0.64);
  vec3 emit = vec3(0.0);
  float gloss = 0.0;

  if (vKind < 1.5) {
    // 航站楼：玻璃幕墙 + 金属屋面
    float u = abs(N.x) > abs(N.z) ? vLocal.z : vLocal.x;
    if (vTop > 0.5) {
      base = vec3(0.55, 0.57, 0.60);
    } else {
      // 玻璃幕墙：窗格要够暗，黄昏的低角度太阳才不会把整面墙晒成一块白板
      float mull = step(0.10, fract(u * 34.0));
      float floorL = step(0.18, fract(vLocal.y * 3.2));
      float paneVar = 0.55 + 0.45 * h31(vec3(floor(u * 34.0), floor(vLocal.y * 3.2), vSeed * 17.0 + 5.0));
      base = mix(vec3(0.055, 0.085, 0.115), vec3(0.20, 0.29, 0.36), 0.40 + 0.35 * mull);
      base *= (0.62 + 0.38 * floorL) * paneVar;
      // 竖向的窗框（不反光）
      float frame = step(fract(u * 34.0), 0.10);
      base = mix(base, vec3(0.30, 0.31, 0.33), frame * 0.85);
      gloss = 0.6 * (1.0 - frame);
      // 夜里的室内灯：玻璃幕墙整片亮起来，一格一格的灯带
      float cell = h31(vec3(floor(u * 34.0), floor(vLocal.y * 3.2), vSeed * 30.0));
      // 灯要“散”：一半的格子亮、并且按楼层整层随机明暗，避免连成一整条光带
      float floorLit = 0.30 + 0.70 * h31(vec3(7.0, floor(vLocal.y * 3.2), vSeed * 30.0 + 3.0));
      float lit = step(0.46, cell) * floorLit * (0.30 + 0.70 * step(0.22, fract(vLocal.y * 3.2)));
      emit += vec3(1.0, 0.86, 0.62) * lit * uNight * 0.40;
    }
  } else if (vKind < 2.5) {
    // 机库：波纹钢板 + 半开的门
    base = mix(vec3(0.56, 0.58, 0.61), vec3(0.72, 0.74, 0.77), step(0.5, fract(vLocal.x * 44.0)));
    base *= 0.78 + 0.28 * smoothstep(0.0, 0.7, vLocal.y);
    if (vTop > 0.5) base = vec3(0.48, 0.50, 0.53);
    else {
      float door = step(abs(N.z), 0.2) * step(0.25, vLocal.x) * step(vLocal.x, 0.75) * step(vLocal.y, 0.62);
      base = mix(base, vec3(0.06, 0.07, 0.08), door * 0.85);
    }
  } else if (vKind < 3.5) {
    // 塔台：混凝土塔身 + 顶部玻璃
    base = mix(vec3(0.70, 0.71, 0.72), vec3(0.52, 0.53, 0.55), vLocal.y);
    if (vTop > 0.5) base = vec3(0.44, 0.45, 0.47);
    float band = step(0.5, fract(vLocal.y * 5.0)) * 0.08;
    base += band;
  } else if (vKind < 4.5) {
    // 小房子：屋顶 + 墙面
    base = vTop > 0.5 ? vec3(0.42, 0.30, 0.26) : vec3(0.74, 0.73, 0.70);
    float win = step(0.3, fract(vLocal.x * 4.0)) * step(fract(vLocal.y * 6.0), 0.7) * step(abs(N.y), 0.3);
    base = mix(base, vec3(0.09, 0.12, 0.15), win * 0.9);
    emit += vec3(1.0, 0.8, 0.5) * win * step(0.5, h31(vec3(floor(vLocal.x * 4.0), floor(vLocal.y * 6.0), vSeed * 9.0))) * uNight * 0.6;
  } else if (vKind > 11.5) {
    // 塔台顶部的指挥室
    base = mix(vec3(0.12, 0.16, 0.19), vec3(0.30, 0.39, 0.44), 0.55);
    gloss = 0.5;
    emit += vec3(0.75, 0.85, 0.95) * uNight * 0.75;
  } else {
    // 树：叶簇的噪声 + 顶部受光
    float n = h31(vLocal * 9.0 + vSeed * 40.0);
    vec3 dark = vec3(0.115, 0.185, 0.085);
    vec3 lite = vec3(0.34, 0.47, 0.19);
    base = mix(dark, lite, 0.30 + 0.70 * n);
    if (vKind > 5.5) base = mix(vec3(0.16, 0.23, 0.09), vec3(0.42, 0.50, 0.20), 0.3 + 0.7 * n);
    base *= 0.72 + 0.50 * clamp(vLocal.y, 0.0, 1.0);
  }

  base = toLin(base);
  emit = toLin(emit);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 amb = mix(uAmbGnd, uAmbSky, N.y * 0.5 + 0.5);
  // 朝太阳的立面在低太阳高度角下会被“晒白”：玻璃幕墙本身几乎不漫反射阳光，
  // 这里对玻璃单独把直射项压到三成，否则黄昏塔台/自动 35 s 那一大片是全白的。
  // 白天玻璃正常反光（不然整面墙发黑）；日落后低角度的太阳才会把它晒成白板，
  // 于是按 uNight 在两者之间过渡。
  float glass = (vKind < 1.5 && vTop < 0.5) ? 1.0 : 0.0;
  float sunK = mix(1.0, 0.16, glass * smoothstep(0.02, 0.32, uNight));
  vec3 col = base * (uSunCol * ndl * sunK + amb * mix(1.0, 0.75, glass * uNight));
  // 玻璃的太阳高光
  if (gloss > 0.0) {
    vec3 V = normalize(uCamPos - vPos);
    vec3 H = normalize(V + uSunDir);
    // 高光要收着：掠射角下 pow(·,90) 仍可能整面墙齐亮，压一下峰值
    col += min(uSunCol * pow(max(dot(N, H), 0.0), 140.0) * gloss, vec3(1.6));
  }
  col += emit;
  col = applyFog(col, vPos, uCamPos);
  oCol = vec4(col, 1.0);
}`;

// ───────────────────────────── 灯光（点精灵） ─────────────────────────────
const VS_LIGHT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;   // x,y,z,kind
layout(location = 1) in vec4 aB;   // size, index, halo, mode
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uViewportH;
uniform float uNight;
uniform vec3 uPapiA, uPapiB, uPapiC, uPapiD;
out vec3 vCol;
out float vGlow;
out float vCore;

struct L { vec3 col; float glow; };

L lightCol(float kind, float idx, vec3 wp, float halo) {
  L l;
  l.col = vec3(1.0);
  l.glow = 1.0;
  if (kind < 1.5) {                 // 跑道边灯 白
    l.col = vec3(1.0, 0.96, 0.86);
    l.glow = 0.55;
  } else if (kind < 2.5) {          // 端点灯 红
    l.col = vec3(1.0, 0.12, 0.08);
    l.glow = 1.1;
  } else if (kind < 3.5) {          // 后段边灯 黄
    l.col = vec3(1.0, 0.78, 0.22);
    l.glow = 0.8;
  } else if (kind < 4.5) {          // 入口灯 绿
    l.col = vec3(0.18, 1.0, 0.45);
    l.glow = 1.1;
  } else if (kind < 5.5) {          // 中线灯 白
    l.col = vec3(1.0, 0.98, 0.92);
    l.glow = 0.35;
  } else if (kind < 6.5) {          // 进近灯
    l.col = vec3(1.0, 0.95, 0.82);
    l.glow = 1.35;
  } else if (kind < 7.5) {          // 顺序闪光灯
    float ph = fract(uTime * 1.6 - idx * 0.12);
    float pulse = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.10, 0.5, ph));
    l.col = vec3(1.0, 0.98, 0.90);
    l.glow = 1.0 + pulse * 5.0;
  } else if (kind < 8.5) {          // 滑行道边灯 蓝
    l.col = vec3(0.22, 0.42, 1.0);
    l.glow = 0.85;
  } else if (kind < 9.5) {          // 高杆灯
    l.col = vec3(1.0, 0.82, 0.55);
    l.glow = 2.2;
  } else if (kind < 10.5) {         // PAPI：按视角算红/白
    // PAPI 装在左侧，判断观察者相对每个灯箱的下滑角
    float d = length(uCamPos.xz - wp.xz);
    float ang = atan(uCamPos.y - 1.0, max(d, 1.0));
    float ref = 3.0 + (idx - 1.5) * 0.32;
    float white = step(ang, ref * 0.0174533);
    l.col = mix(vec3(1.0, 0.10, 0.06), vec3(1.0, 0.96, 0.9), white);
    l.glow = 1.5;
  }
  if (kind < 9.5) {
    // 夜里灯更亮
    l.glow *= mix(0.35, 1.0, clamp(uNight, 0.0, 1.0));
  }
  return l;
}

void main() {
  vec3 wp = aA.xyz;
  float kind = aA.w;
  float size = aB.x;
  float idx = aB.y;
  float halo = aB.z;
  L l = lightCol(kind, idx, wp, halo);
  vec4 clip = uViewProj * vec4(wp, 1.0);
  gl_Position = clip;
  float dist = max(length(uCamPos - wp), 0.5);
  float baseSize = halo > 0.5 ? size * 9.0 : size * 1.35;
  float px = baseSize * uViewportH * 0.9 / dist;
  // 远处的灯不缩得太小，保证看得见
  float minPx = halo > 0.5 ? 3.0 : 1.6;
  gl_PointSize = clamp(px, minPx, halo > 0.5 ? 220.0 : 34.0);
  // 超过一定距离后，小灯直接不画（防止远处噪点）
  float fade = 1.0 - smoothstep(5200.0, 9000.0, dist);
  vCol = l.col * (halo > 0.5 ? 0.35 : 1.0) * fade;
  vGlow = l.glow;
  vCore = halo > 0.5 ? 0.0 : 1.0;
}`;

const FS_LIGHT = `#version 300 es
precision highp float;
in vec3 vCol;
in float vGlow;
in float vCore;
uniform float uExposure;
out vec4 oCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  float core = exp(-r2 * 26.0);
  float glow = exp(-r2 * 3.2) * (1.0 - r);
  float a = core * vCore + glow * (1.0 - vCore * 0.85);
  // 横向的星芒（灯在镜头里的横向光斑）
  float spike = exp(-abs(q.y) * 20.0) * exp(-abs(q.x) * 2.2) * 0.14;
  a += spike * (1.0 - vCore);
  vec3 c = vCol * vGlow * a;
  oCol = vec4(c, a * 0.9);
}`;

// ───────────────────────────── 飞机 ─────────────────────────────
const VS_PLANE = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aCol;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat4 uLightVP;
uniform mat3 uNormalMat;
out vec3 vPos;
out vec3 vNrm;
out vec2 vUV;
out vec3 vCol;
out vec4 vShadow;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vNrm = normalize(uNormalMat * aNrm);
  vUV = aUV;
  vCol = aCol;
  vShadow = uLightVP * wp;
  gl_Position = uViewProj * wp;
}`;

const FS_PLANE = `#version 300 es
${GLSL_COMMON}
uniform vec3 uCamPos;
uniform sampler2D uPaint;
uniform sampler2D uShadowMap;
uniform float uUsePaint;
uniform vec3 uTint;
uniform float uRough;
uniform float uMetal;
uniform float uShadowTexel;
in vec3 vPos;
in vec3 vNrm;
in vec2 vUV;
in vec3 vCol;
in vec4 vShadow;
out vec4 oCol;

float shadowFactor() {
  // vShadow 是正交投影后的齐次坐标：先除 w 落到 NDC（[-1,1]），再换到 [0,1]
  vec3 s = vShadow.xyz / vShadow.w;
  if (s.z > 1.0 || s.z < -1.0 || abs(s.x) > 1.0 || abs(s.y) > 1.0) return 1.0;
  vec2 uv = s.xy * 0.5 + 0.5;
  float depth = s.z * 0.5 + 0.5;
  float bias = 0.0015;
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float d = texture(uShadowMap, uv + vec2(float(x), float(y)) * uShadowTexel).r;
      sum += (depth - bias <= d) ? 1.0 : 0.0;
    }
  }
  return sum / 9.0;
}

// 天空的环境反射：只要渐变 + 太阳，够用且便宜
vec3 skyReflect(vec3 d, float rough) {
  vec3 c = skyBase(normalize(vec3(d.x, abs(d.y) * 0.7 + 0.06, d.z)));
  return mix(toLin(uFogCol), c, 1.0 - rough * 0.7);
}

void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCamPos - vPos);
  if (dot(N, V) < 0.0) N = normalize(N - V * (2.0 * dot(N, V)));   // 背面兜底，避免黑面
  vec3 base = vCol * uTint;
  float rough = uRough;
  float metal = uMetal;
  if (uUsePaint > 0.5) {
    vec4 t = texture(uPaint, vUV);
    base = t.rgb;
    // 涂装里用不同深浅暗示粗糙度差异（越亮的漆越光滑）
    rough = mix(rough, 0.22, smoothstep(0.55, 0.95, t.r));
  }
  base = toLin(base);
  // 机腹比机背暗一点（环境光遮蔽的近似）
  float ao = mix(0.50, 1.0, smoothstep(-0.95, 0.35, N.y));
  // 追尾机位正对机尾时，机身只是一个白椭圆 —— 补一点点纵向明暗，
  // 让那块白面有“圆管”的读感，而不是一张贴纸。
  if (uUsePaint > 0.5) {
    ao *= 0.86 + 0.14 * smoothstep(0.0, 0.55, abs(N.x));
  }
  float sh = shadowFactor();
  float ndl = max(dot(N, uSunDir), 0.0) * sh;

  vec3 sunCol = uSunCol;
  vec3 amb = mix(uAmbGnd, uAmbSky, N.y * 0.5 + 0.5);

  // 漆面：天光偏冷、阳光偏暖，让机身上的明暗有冷暖过渡
  // 漆面的颜色略微“加深”，避免白色天空把纯色洗淡
  vec3 pig = pow(base, vec3(1.25));
  vec3 diffuse = pig * (sunCol * ndl + amb * ao * 1.15);

  // 高光：用 Blinn-Phong 近似 GGX，粗糙度控制指数
  vec3 H = normalize(V + uSunDir);
  float specPow = mix(6.0, 220.0, 1.0 - rough);
  float spec = pow(max(dot(N, H), 0.0), specPow) * (1.0 - rough) * sh;
  // 金属/清漆：反射天空
  vec3 R = reflect(-V, N);
  vec3 env = skyReflect(R, rough);
  float fres = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 3.0);
  // 高光只占很小一部分：Blinn-Phong 的峰值恒为 1，乘太大就会在弧面上炸成白斑
  vec3 specCol = mix(vec3(1.0), base, metal) * (spec * sunCol * 0.42 * (0.25 + 0.75 * fres) + env * (0.015 + 0.20 * metal + fres * 0.10));

  vec3 col = diffuse + specCol;
  // 轮廓光：只有真正逆光（视线朝着太阳）时，边缘才被照亮。
  // 指数要大、强度要小 —— 否则像垂尾这种正对镜头的平面会整体发白。
  float rim = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 7.0);
  float back = max(dot(-V, uSunDir), 0.0);
  col += uSunCol * rim * 0.22 * back * back * ao;

  col = applyFog(col, vPos, uCamPos);
  oCol = vec4(col, 1.0);
}`;

// 影子贴图只写深度
const VS_DEPTH = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uLightVP;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}`;
const FS_DEPTH = `#version 300 es
precision highp float;
void main() { }`;

// ───────────────────────────── 粒子（轮胎烟 / 灯光尘埃） ─────────────────────────────
const VS_PART = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;  // x,y,z,size
layout(location = 1) in vec4 aB;  // alpha, r, g, b
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uViewportH;
out float vAlpha;
out vec3 vCol;
out float vSoft;
void main() {
  vec4 clip = uViewProj * vec4(aA.xyz, 1.0);
  gl_Position = clip;
  float dist = max(length(uCamPos - aA.xyz), 0.5);
  gl_PointSize = clamp(aA.w * uViewportH / dist, 1.0, 900.0);
  vAlpha = aB.x;
  vCol = aB.yzw;
  vSoft = 1.0;
}`;

const FS_PART = `#version 300 es
precision highp float;
in float vAlpha;
in vec3 vCol;
in float vSoft;
out vec4 oCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 2.6) * vAlpha;
  oCol = vec4(pow(max(vCol, 0.0), vec3(2.2)) * a, a);
}`;

// ───────────────────────────── 后期：泛光 + 色调映射 ─────────────────────────────
const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 oCol;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  // 4 点盒式降采样，避免闪烁
  c += texture(uTex, vUv + vec2(uTexel.x, uTexel.y)).rgb;
  c += texture(uTex, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  c += texture(uTex, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  c += texture(uTex, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
  c /= 5.0;
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  oCol = vec4(c * k, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
in vec2 vUv;
out vec4 oCol;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
  c += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
  oCol = vec4(c, 1.0);
}`;

const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform float uBloom;
uniform float uExposure;
uniform float uTime;
uniform vec2 uRes;
uniform float uFade;
in vec2 vUv;
out vec4 oCol;

// ACES 的解析拟合（Narkowicz 2015）—— 高光滚降自然，不会一片死白
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
// 所有颜色都是按 sRGB 手调出来的，进光照计算前要先转成线性
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = vUv;
  // 边缘一点点色散
  vec2 dc = (uv - 0.5) * 0.0016;
  vec3 c;
  c.r = texture(uScene, uv + dc).r;
  c.g = texture(uScene, uv).g;
  c.b = texture(uScene, uv - dc).b;

  vec3 b1 = texture(uBloom1, uv).rgb;
  vec3 b2 = texture(uBloom2, uv).rgb;
  c += (b1 * 0.45 + b2 * 0.75) * uBloom;

  c *= uExposure;
  c = aces(c);
  // 暗角
  float v = smoothstep(1.30, 0.30, length((uv - 0.5) * vec2(1.0, 1.05)) * 1.32);
  c *= mix(0.76, 1.0, v);
  c *= uFade;
  // 抖动，压掉天空渐变里的色带
  c += (hash12(uv * uRes + fract(uTime) * 137.0) - 0.5) / 255.0;
  oCol = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;


// ═══════════════════════════════════════════════════════════════════════════
//  51 · 涂装与贴图
//  飞机机身、尾部标志、跑道号、滑行道牌……全部用 Canvas2D 现画，
//  再上传成纹理。没有一张外部图片，所以离线打开也不会缺素材。
// ═══════════════════════════════════════════════════════════════════════════

// 机身涂装：圆柱展开图。u 绕机身一圈（0 = 正上方，0.25 = 右舷，0.5 = 机腹），
// v 是站位移（0 = 机头，1 = 机尾）。
function paintFuselage(ctx, W, H) {
  const BLUE = '#1d3a8f';
  const BLUE_D = '#152a6b';
  const LINE = '#cfd6e2';
  const px = (deg) => (deg / 360) * W;
  const py = (s) => (s / AC.L) * H;

  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);

  // ── 机腹蓝：上下边界随站位收窄 ──
  // 机腹蓝色区域的半角（从机身正下方量起，单位度）：前段窄、中段宽、尾部收拢
  const bnd = [
    [0.0, 26], [1.5, 40], [4.0, 52], [7.0, 58], [12.0, 62], [18.0, 64],
    [24.0, 65], [27.5, 66], [30.0, 68], [32.0, 72], [33.8, 80],
    [35.2, 96], [36.4, 118], [37.4, 145], [38.0, 180],
  ];
  const angAt = (s) => {
    if (s <= bnd[0][0]) return bnd[0][1];
    for (let i = 0; i < bnd.length - 1; i++) {
      if (s <= bnd[i + 1][0]) {
        const t = (s - bnd[i][0]) / (bnd[i + 1][0] - bnd[i][0]);
        return lerp(bnd[i][1], bnd[i + 1][1], smoothstep(0, 1, t));
      }
    }
    return bnd[bnd.length - 1][1];
  };
  const g = ctx.createLinearGradient(0, py(2), 0, py(24));
  g.addColorStop(0, BLUE);
  g.addColorStop(1, BLUE_D);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(px(180 - angAt(0)), py(0));
  for (let s = 0; s <= AC.L; s += 0.4) ctx.lineTo(px(180 - angAt(s)), py(s));
  ctx.lineTo(px(180), py(AC.L));
  ctx.lineTo(px(180), py(0));
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px(180), py(0));
  ctx.lineTo(px(180), py(AC.L));
  for (let s = AC.L; s >= 0; s -= 0.4) ctx.lineTo(px(180 + angAt(s)), py(s));
  ctx.closePath();
  ctx.fill();

  // 蓝白之间的银色细线
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.lineWidth = Math.max(1.5, W * 0.0022);
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    for (let s = 0; s <= AC.L; s += 0.4) {
      const a = 180 + sgn * angAt(s);
      if (s === 0) ctx.moveTo(px(a), py(s)); else ctx.lineTo(px(a), py(s));
    }
    ctx.stroke();
  }

  // ── 舷窗：右舷 116°、左舷镜像 ──
  const winW = W * 0.0115, winH = H * 0.0062;
  for (const mirror of [0, 1]) {
    const aWin = mirror ? 360 - 116 : 116;
    for (let s = 6.4; s < 30.6; s += 0.535) {
      const x = px(aWin) - winW / 2;
      const y = py(s) - winH / 2;
      ctx.fillStyle = 'rgba(24,32,44,.94)';
      roundRect(ctx, x, y, winW, winH, winH * 0.46);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      roundRect(ctx, x + winW * 0.13, y + winH * 0.16, winW * 0.74, winH * 0.28, winH * 0.14);
      ctx.fill();
    }
  }
  // ── 舱门 ──
  for (const [s, hh] of [[5.6, 1.05], [14.4, 1.05], [25.2, 1.05], [33.4, 0.85]]) {
    for (const mirror of [0, 1]) {
      const a = mirror ? 360 - 121 : 121;
      const w2 = W * 0.026, h2 = (hh / AC.L) * H;
      const x = px(a) - w2 / 2, y = py(s) - h2 / 2;
      ctx.strokeStyle = 'rgba(70,84,104,.40)';
      ctx.lineWidth = Math.max(1, W * 0.0013);
      roundRect(ctx, x, y, w2, h2, h2 * 0.07);
      ctx.stroke();
      ctx.fillStyle = 'rgba(34,44,58,.65)';
      roundRect(ctx, x + w2 * 0.08, y + h2 * 0.1, w2 * 0.84, h2 * 0.2, h2 * 0.04);
      ctx.fill();
    }
  }
  // ── 雷达罩分界 ──
  ctx.strokeStyle = 'rgba(120,130,146,.45)';
  ctx.lineWidth = Math.max(1, W * 0.0012);
  ctx.beginPath();
  ctx.moveTo(0, py(4.55));
  ctx.lineTo(W, py(4.55));
  ctx.stroke();
  // ── 静压孔、防撞灯 ──
  for (const mirror of [0, 1]) {
    const a = mirror ? 360 - 111 : 111;
    ctx.fillStyle = 'rgba(34,44,58,.8)';
    ctx.beginPath();
    ctx.arc(px(a), py(4.2), W * 0.0045, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px(a), py(29.5), W * 0.0038, 0, TAU);
    ctx.fill();
  }
  // ── 机头检修口盖（细线） ──
  ctx.strokeStyle = 'rgba(150,158,170,.35)';
  ctx.lineWidth = Math.max(1, W * 0.0011);
  for (const s of [6.4, 7.6]) {
    ctx.beginPath();
    ctx.moveTo(px(150), py(s));
    ctx.lineTo(px(210), py(s));
    ctx.stroke();
  }
  // ── 尾锥：环向接缝 + 尾端的 APU 排气口 ──
  // 追尾机位正对机尾时，后机身顶部是一大片纯白，很容易缩成一块“死白的圆饼”。
  // 这里补两道环向接缝和尾端的排气口，让它在任何角度都有形体提示。
  for (const s of [33.0, 35.6]) {
    ctx.strokeStyle = 'rgba(120,132,150,.30)';
    ctx.lineWidth = Math.max(1, W * 0.0011);
    ctx.beginPath();
    ctx.moveTo(0, py(s));
    ctx.lineTo(W, py(s));
    ctx.stroke();
  }
  {
    const sApu = 37.5;
    const gA = ctx.createRadialGradient(px(90), py(sApu), 0, px(90), py(sApu), W * 0.075);
    gA.addColorStop(0, 'rgba(28,32,38,.95)');
    gA.addColorStop(0.62, 'rgba(46,52,60,.85)');
    gA.addColorStop(1, 'rgba(150,158,170,0)');
    ctx.fillStyle = gA;
    ctx.beginPath();
    ctx.ellipse(px(90), py(sApu), W * 0.075, (1.5 / AC.L) * H, 0, 0, TAU);
    ctx.fill();
  }

  // ── 机身侧面的小字（涂装细节，远看只是一条灰线） ──
  ctx.fillStyle = 'rgba(60,74,96,.55)';
  ctx.font = `600 ${Math.round(H * 0.006)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  for (const mirror of [0, 1]) {
    const a = mirror ? 360 - 90 : 90;
    ctx.save();
    ctx.translate(px(a), py(19.4));
    if (mirror) ctx.rotate(Math.PI);
    ctx.fillText('STARLIGHT', 0, 0);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 尾翼标志：一只简化的“星鸟”，白天是白+金，夜里会亮
function paintFinFlag(ctx, W, H, night) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W * 0.5, H * 0.52);
  const s = Math.min(W, H);
  // 尾翼本身的蓝色底（与网格颜色一致，这里只画标志）
  ctx.globalAlpha = 1;
  // 一个向上飞翔的三角翼形
  const grad = ctx.createLinearGradient(-s * 0.4, -s * 0.4, s * 0.4, s * 0.4);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, night ? '#ffe6a8' : '#e7edf7');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-s * 0.30, s * 0.22);
  ctx.quadraticCurveTo(-s * 0.05, -s * 0.30, s * 0.34, -s * 0.26);
  ctx.quadraticCurveTo(s * 0.06, s * 0.02, s * 0.16, s * 0.30);
  ctx.quadraticCurveTo(-s * 0.02, s * 0.16, -s * 0.30, s * 0.22);
  ctx.closePath();
  ctx.fill();
  // 一颗小星
  ctx.fillStyle = night ? '#ffd27a' : '#ffcf5c';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? s * 0.055 : s * 0.13;
    const x = -s * 0.22 + Math.cos(a) * r;
    const y = -s * 0.24 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 跑道号码贴花：在跑道的近端与远端各铺一块薄平面
function paintRunwayNumber(ctx, W, H, text, flip) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  if (flip) ctx.rotate(Math.PI);
  ctx.fillStyle = 'rgba(240,242,240,0.95)';
  ctx.font = `900 ${Math.round(H * 0.78)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, H * 0.02);
  ctx.restore();
}

// 跑道入口灯条 / 接地带：用几何体做，不用贴图
// 这里只补一张“警告线 / 各类标牌”的贴图给滑行道口
function paintSign(ctx, W, H, label, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = Math.max(2, W * 0.02);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
  ctx.fillStyle = '#f2f5f8';
  ctx.font = `700 ${Math.round(H * 0.56)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, H / 2 + H * 0.02);
}

// 跑道号：两张展开图（近端 18 / 远端 36），贴在两块水平的薄平面上。
// 数字的朝向按“从进近方向看过去是正的”来画。
function paintRwyNumberTex(ctx, W, H, text) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(236,238,236,0.97)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 数字在真机上约 18 m 高、9 m 宽；这里按贴图高度铺满
  ctx.font = `900 ${Math.round(H * 0.94)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(0.66, 1.0);
  ctx.fillText(text, 0, H * 0.01);
  ctx.restore();
}

// 滑行道口的黄色引导牌（黑底黄字）
function paintTaxiSignTex(ctx, W, H, label) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#e8c14a';
  ctx.lineWidth = Math.max(3, H * 0.06);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, W - ctx.lineWidth * 2, H - ctx.lineWidth * 2);
  ctx.fillStyle = '#f3cf5e';
  ctx.font = `700 ${Math.round(H * 0.50)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, H * 0.54);
}
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
// ═══════════════════════════════════════════════════════════════════════════
//  80 · 渲染器
//  一遍阴影（2048² 深度）+ 一遍主场景（HDR 离屏）→ 亮部提取 → 两次模糊
//  → 合成。场景里所有东西（飞机、地面、灯、烟）都在这里按时间求值。
// ═══════════════════════════════════════════════════════════════════════════

const TOD = {
  day: {
    label: '白天',
    sunDir: [-0.38, 0.72, -0.58],
    sunCol: [2.35, 2.28, 2.12],
    zenith: [0.085, 0.300, 0.760],
    horizon: [0.620, 0.790, 0.930],
    ground: [0.26, 0.30, 0.26],
    fog: [0.620, 0.790, 0.930],
    fogDensity: 0.000072,
    ambSky: [0.26, 0.33, 0.46],
    ambGnd: [0.20, 0.19, 0.16],
    night: 0.0,
    bloom: 0.30,
    exposure: 0.60,
    cloudCover: 0.62,
    mountainFade: 1.0,
    starAmt: 0,
  },
  dusk: {
    label: '黄昏',
    sunDir: [-0.82, 0.105, -0.56],
    sunCol: [3.50, 1.55, 0.62],
    zenith: [0.030, 0.055, 0.165],
    horizon: [0.900, 0.430, 0.240],
    zenithDusk: 0,
    ground: [0.20, 0.155, 0.145],
    fog: [0.360, 0.265, 0.300],
    fogDensity: 0.000090,
    ambSky: [0.30, 0.27, 0.39],
    ambGnd: [0.26, 0.165, 0.115],
    night: 0.34,
    bloom: 0.85,
    exposure: 1.26,
    cloudCover: 0.62,
    mountainFade: 0.95,
    starAmt: 0.15,
  },
  night: {
    label: '夜晚',
    sunDir: [-0.30, 0.46, -0.83],
    sunCol: [0.16, 0.20, 0.32],
    zenith: [0.006, 0.011, 0.032],
    horizon: [0.030, 0.045, 0.085],
    ground: [0.014, 0.017, 0.022],
    fog: [0.040, 0.052, 0.085],
    fogDensity: 0.000080,
    ambSky: [0.10, 0.13, 0.21],
    ambGnd: [0.13, 0.11, 0.085],
    night: 1.0,
    bloom: 1.45,
    exposure: 2.30,
    cloudCover: 0.55,
    mountainFade: 0.55,
    starAmt: 1,
  },
};

const DBG = {
  skipGround: false, skipInst: false, skipPlane: false, skipLights: false, skipParticles: false,
};
const R = {
  gl: null,
  canvas: null,
  W: 1, H: 1,
  dpr: 1,
  quality: 1,
  prog: {},
  bufs: {},
  fbo: {},
  shadow: { size: 2048, fbo: null, tex: null },
  env: TOD.dusk,
  ui: {
    cam: 'auto',
    tod: 'dusk',
    speed: 1,
    paused: false,
    orbitYaw: 0,
    orbitPitch: 0,
  },
  T: null,
  time: 0,
  lastNow: 0,
  frames: 0,
  fpsAcc: 0,
  plane: null,
  ground: null,
  statics: null,
  paint: null,
  finDecal: null,
  lights: null,
  nLights: 0,
  particles: null,
};

// ─── 初始化 ───
function initRenderer(canvas) {
  const gl = glc.init(canvas);
  if (!gl) return false;
  R.gl = gl;
  R.canvas = canvas;

  // 程序
  R.prog.sky = getProgram('sky', VS_FULL, FS_SKY, ['uInvViewProj', 'uCamPos', 'uSunDir', 'uSunCol', 'uSkyZenith', 'uSkyHorizon', 'uGroundCol', 'uFogCol', 'uFogDensity', 'uTime', 'uNight', 'uAmbSky', 'uAmbGnd', 'uCloudCover', 'uMountainFade']);
  R.prog.ground = getProgram('ground', VS_GROUND, FS_GROUND, ['uViewProj', 'uModel', 'uCamPos', 'uSunDir', 'uSunCol', 'uSkyZenith', 'uSkyHorizon', 'uGroundCol', 'uFogCol', 'uFogDensity', 'uTime', 'uNight', 'uAmbSky', 'uAmbGnd', 'uTerrainDetail', 'uNumNear', 'uNumFar']);
  R.prog.inst = getProgram('inst', VS_INST, FS_INST, ['uViewProj', 'uCamPos', 'uSunDir', 'uSunCol', 'uSkyZenith', 'uSkyHorizon', 'uGroundCol', 'uFogCol', 'uFogDensity', 'uTime', 'uNight', 'uAmbSky', 'uAmbGnd']);
  R.prog.light = getProgram('light', VS_LIGHT, FS_LIGHT, ['uViewProj', 'uCamPos', 'uTime', 'uViewportH', 'uNight', 'uExposure', 'uSunDir', 'uSunCol', 'uSkyZenith', 'uSkyHorizon', 'uGroundCol', 'uFogCol', 'uFogDensity', 'uAmbSky', 'uAmbGnd']);
  R.prog.plane = getProgram('plane', VS_PLANE, FS_PLANE, ['uModel', 'uViewProj', 'uLightVP', 'uNormalMat', 'uCamPos', 'uPaint', 'uShadowMap', 'uUsePaint', 'uTint', 'uRough', 'uMetal', 'uShadowTexel', 'uSunDir', 'uSunCol', 'uSkyZenith', 'uSkyHorizon', 'uGroundCol', 'uFogCol', 'uFogDensity', 'uTime', 'uNight', 'uAmbSky', 'uAmbGnd']);
  R.prog.depth = getProgram('depth', VS_DEPTH, FS_DEPTH, ['uModel', 'uLightVP']);
  R.prog.part = getProgram('part', VS_PART, FS_PART, ['uViewProj', 'uCamPos', 'uViewportH']);
  R.prog.bright = getProgram('bright', VS_FULL, FS_BRIGHT, ['uTex', 'uTexel', 'uThreshold']);
  R.prog.blur = getProgram('blur', VS_FULL, FS_BLUR, ['uTex', 'uDir']);
  R.prog.final = getProgram('final', VS_FULL, FS_FINAL, ['uScene', 'uBloom1', 'uBloom2', 'uBloom', 'uExposure', 'uTime', 'uRes', 'uFade']);

  // 几何：机身单独一份（贴涂装），其余部件合并（顶点色 + 光照烘焙）
  const planeGeo = buildPlane();
  const split = splitFuselage(planeGeo);
  R.plane = {
    fuselage: uploadRaw(gl, bakeVertexLight(split.fuselage)),
    solidMesh: uploadRaw(gl, bakeVertexLight(split.rest)),
    parts: planeGeo.parts.map((p) => ({ ...p, mesh: uploadRaw(gl, bakeVertexLight(p.raw)) })),
  };
  R.ground = uploadRaw(gl, buildGround());

  // 实例化道具
  {
    const boxGeo = unitBox();
    R.houses = makeInstanced(gl, boxGeo, buildPropHouses());
    const tr = buildTrees();
    R.treesA = makeInstanced(gl, treeConeGeo(), tr.conifer);
    R.treesB = makeInstanced(gl, treeBlobGeo(), tr.round);
  }
  R.lightsData = buildLights();
  R.nLights = R.lightsData.length / 5;
  R.lightVAO = makeLightsVAO(gl, R.lightsData);

  // 贴图
  R.paint = canvasTexture(gl, 2048, 1024, (c, w, h) => paintFuselage(c, w, h), { flipY: false, aniso: 8 });
  R.finDecal = canvasTexture(gl, 256, 512, (c, w, h) => paintFinFlag(c, w, h, 0), { flipY: false });
  R.numNear = canvasTexture(gl, 256, 512, (c, w, h) => paintRwyNumberTex(c, w, h, '18'), { flipY: false, aniso: 8 });
  R.numFar = canvasTexture(gl, 256, 512, (c, w, h) => paintRwyNumberTex(c, w, h, '36'), { flipY: false, aniso: 8 });

  // 粒子缓冲（每帧上传，最多 512 个）
  R.partCap = 512;
  R.partData = new Float32Array(R.partCap * 8);
  {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, R.partData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    R.partBuf = b;
    R.partVAO = vao;
  }

  setupFBOs();
  R.shadowVP = m4();
  R.DBG = DBG;
  R.ready = true;
  return true;
}

// 实例化的单位盒：y ∈ [0,1]，带一个 aTop 标记（顶面/侧面在着色器里分别处理）
function unitBox() {
  const pos = [], nrm = [], top = [], idx = [];
  const face = (n, quad, isTop) => {
    const base = pos.length / 3;
    for (const p of quad) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); top.push(isTop); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const P = (x, y, z) => [x, y, z];
  face([1, 0, 0], [P(1, 0, 1), P(1, 0, -1), P(1, 1, -1), P(1, 1, 1)], 0);
  face([-1, 0, 0], [P(-1, 0, -1), P(-1, 0, 1), P(-1, 1, 1), P(-1, 1, -1)], 0);
  face([0, 0, 1], [P(-1, 0, 1), P(1, 0, 1), P(1, 1, 1), P(-1, 1, 1)], 0);
  face([0, 0, -1], [P(1, 0, -1), P(-1, 0, -1), P(-1, 1, -1), P(1, 1, -1)], 0);
  face([0, 1, 0], [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], 1);
  face([0, -1, 0], [P(-1, 0, -1), P(1, 0, -1), P(1, 0, 1), P(-1, 0, 1)], 0);
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), top: new Float32Array(top), idx: new Uint16Array(idx) };
}

// 树的几何：针叶树是三段锥体，阔叶树是一个矮胖的多面体球
function treeConeGeo() {
  const pos = [], nrm = [], top = [], idx = [];
  const addRing = (y, r, seg, upward) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const n = vnorm([Math.cos(a) * 0.55, upward, Math.sin(a) * 0.55]);
      nrm.push(n[0], n[1], n[2]);
      top.push(0);
    }
  };
  // 三段锥：每段一个圆台
  const seg = 9;
  const tiers = [[0.0, 0.50, 0.55], [0.26, 0.40, 0.80], [0.54, 0.28, 1.0]];
  let base = 0;
  for (const [y0, r0, y1] of tiers) {
    const r1 = r0 * 0.18;
    addRing(y0, r0, seg, 0.4);
    addRing(y1, r1, seg, 0.8);
    for (let i = 0; i < seg; i++) {
      const a = base + i;
      const b = base + ((i + 1) % seg);
      idx.push(a, b, b + seg, a, b + seg, a + seg);
    }
    base += seg * 2;
  }
  // 树干
  addRing(0.0, 0.07, 5, 0.1);
  addRing(0.30, 0.055, 5, 0.1);
  for (let i = 0; i < 5; i++) {
    const a = base + i, b = base + ((i + 1) % 5);
    idx.push(a, b, b + 5, a, b + 5, a + 5);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), top: new Float32Array(top), idx: new Uint16Array(idx) };
}

function treeBlobGeo() {
  const pos = [], nrm = [], top = [], idx = [];
  const rings = 7, seg = 9;
  const pts = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const y = 0.16 + v * 0.84;
    const r = Math.sin(Math.PI * (0.12 + v * 0.88)) * 0.52 * (1 - 0.25 * v);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const jitter = 0.86 + 0.28 * hash2(i * 7 + j * 31, j * 13);
      const p = [Math.cos(a) * r * jitter, y, Math.sin(a) * r * jitter];
      pts.push(p);
      const n = vnorm([p[0], (y - 0.55) * 0.7, p[2]]);
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      top.push(0);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i, b = j * seg + ((i + 1) % seg);
      const c = a + seg, d = b + seg;
      idx.push(a, b, d, a, d, c);
    }
  }
  // 树冠底部封口 + 树干
  const trunkBase = pos.length / 3;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    pos.push(Math.cos(a) * 0.06, 0.0, Math.sin(a) * 0.06);
    nrm.push(Math.cos(a), 0.05, Math.sin(a)); top.push(0);
  }
  for (let i = 0; i < 5; i++) {
    const a = trunkBase + i, b = trunkBase + ((i + 1) % 5);
    idx.push(a, b, b + 0, a, b, a);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), top: new Float32Array(top), idx: new Uint16Array(idx) };
}

function makeInstanced(gl, geo, instData) {
  const n = instData.length / 9;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const add = (arr, size, loc, stride, offset, divisor) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    if (divisor) gl.vertexAttribDivisor(loc, divisor);
  };
  add(geo.pos, 3, 0, 12, 0, 0);
  add(geo.nrm, 3, 1, 12, 0, 0);
  add(geo.top, 1, 2, 4, 0, 0);
  add(instData, 4, 3, 36, 0, 1);
  add(instData, 4, 4, 36, 16, 1);
  add(instData, 1, 5, 36, 32, 1);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  return { vao, count: geo.idx.length, type: gl.UNSIGNED_SHORT, n };
}

function makeInstanced(gl, geo, instData) {
  const n = instData.length / 9;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const add = (arr, size, loc, stride, offset, divisor) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    if (divisor) gl.vertexAttribDivisor(loc, divisor);
  };
  add(geo.pos, 3, 0, 12, 0, 0);
  add(geo.nrm, 3, 1, 12, 0, 0);
  add(geo.top, 1, 2, 4, 0, 0);
  add(instData, 4, 3, 36, 0, 1);
  add(instData, 4, 4, 36, 16, 1);
  add(instData, 1, 5, 36, 32, 1);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  return { vao, count: geo.idx.length, type: gl.UNSIGNED_SHORT, n };
}

function makeLightsVAO(gl, data) {
  const n = data.length / 5;
  const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = data[i * 5]; a[i * 4 + 1] = data[i * 5 + 1]; a[i * 4 + 2] = data[i * 5 + 2]; a[i * 4 + 3] = data[i * 5 + 3];
    b[i * 4] = data[i * 5 + 4]; b[i * 4 + 1] = i; b[i * 4 + 2] = 0; b[i * 4 + 3] = 0;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const b1 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b1);
  gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  const b2 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b2);
  gl.bufferData(gl.ARRAY_BUFFER, b, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
  gl.bindVertexArray(null);
  return { vao, n };
}

function setupFBOs() {
  const gl = R.gl;
  // 阴影贴图
  const st = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, st);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, R.shadow.size, R.shadow.size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  // 深度纹理只能用 NEAREST 采样（WebGL2 不允许对 DEPTH_COMPONENT 做线性过滤，
  // 否则采样结果未定义，整个机体都会变成“永远在阴影里”）。柔边的效果靠 3×3 采样。
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const sf = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, sf);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, st, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  R.shadow = { size: R.shadow.size, fbo: sf, tex: st };
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  R.fbo = {
    scene: null, sceneTex: null, depth: null,
    bright: null, brightTex: null,
    blurA: null, blurATex: null, blurB: null, blurBTex: null,
    w: 0, h: 0,
  };
  R.hdr = !!gl.getExtension('EXT_color_buffer_float');
}

function resize() {
  const gl = R.gl;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * R.quality;
  const w = Math.max(2, Math.round(R.canvas.clientWidth * dpr));
  const h = Math.max(2, Math.round(R.canvas.clientHeight * dpr));
  if (w === R.W && h === R.H) return;
  R.W = w; R.H = h; R.dpr = dpr;
  R.canvas.width = w;
  R.canvas.height = h;

  const f = R.fbo;
  for (const k of ['scene', 'depth', 'bright', 'blurA', 'blurB']) if (f[k]) gl.deleteFramebuffer(f[k]);
  for (const k of ['sceneTex', 'brightTex', 'blurATex', 'blurBTex']) if (f[k]) gl.deleteTexture(f[k]);
  if (f.depth) gl.deleteRenderbuffer(f.depth);

  const mk = (w2, h2, fmt) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w2, h2, 0, gl.RGBA, R.hdr && fmt === gl.RGBA16F ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const fmt = R.hdr ? gl.RGBA16F : gl.RGBA8;
  f.w = w; f.h = h;
  f.sceneTex = mk(w, h, fmt);
  f.scene = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.scene);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.sceneTex, 0);
  f.depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, f.depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, f.depth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
  const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
  f.brightTex = mk(bw, bh, fmt);
  f.bright = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.bright);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.brightTex, 0);
  f.blurATex = mk(bw, bh, fmt);
  f.blurA = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.blurA);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.blurATex, 0);
  f.blurBTex = mk(qw, qh, fmt);
  f.blurB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.blurB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.blurBTex, 0);
  f.bw = bw; f.bh = bh; f.qw = qw; f.qh = qh;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 环境 ───
// 颜色在 TOD 表里按 sRGB 手调，送进着色器前统一转成线性（0-1 之间的幂函数）
const srgbToLin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const LIN = new WeakMap();
function linOf(E) {
  let v = LIN.get(E);
  if (!v) {
    v = {
      zenith: srgbToLin(E.zenith),
      horizon: srgbToLin(E.horizon),
      ground: srgbToLin(E.ground),
      fog: srgbToLin(E.fog),
      ambSky: srgbToLin(E.ambSky),
      ambGnd: srgbToLin(E.ambGnd),
    };
    LIN.set(E, v);
  }
  return v;
}

function envUniforms(prog, E, camPos) {
  const gl = R.gl;
  const L = linOf(E);
  gl.uniform3fv(prog.u.uSunDir, vnorm(E.sunDir));
  gl.uniform3fv(prog.u.uSunCol, E.sunCol);
  // 天顶 / 地平线是“调色板”颜色，按 sRGB 直接传给着色器（在那边混合后再转线性）；
  // 雾、地面、环境光是光照量，必须是线性值。
  gl.uniform3fv(prog.u.uSkyZenith, E.zenith);
  gl.uniform3fv(prog.u.uSkyHorizon, E.horizon);
  gl.uniform3fv(prog.u.uGroundCol, E.ground);
  gl.uniform3fv(prog.u.uFogCol, E.fog);
  if (prog.u.uFogDensity) gl.uniform1f(prog.u.uFogDensity, E.fogDensity);
  if (prog.u.uTime) gl.uniform1f(prog.u.uTime, R.time);
  if (prog.u.uNight) gl.uniform1f(prog.u.uNight, E.night);
  if (prog.u.uAmbSky) gl.uniform3fv(prog.u.uAmbSky, L.ambSky);
  if (prog.u.uAmbGnd) gl.uniform3fv(prog.u.uAmbGnd, L.ambGnd);
  if (prog.u.uCamPos && camPos) gl.uniform3fv(prog.u.uCamPos, camPos);
}

// ─── 飞机的动态变换 ───
// 每个可动部件都以“自己的铰链点”为原点建立局部坐标，所以这里的旋转矩阵
// 只需要绕原点转，不必再求一次 T(p)·R·T(−p)。
function partTransforms(S, t) {
  const out = {};
  const flap = (S.flap || 0) * D2R;
  const spoiler = (S.spoiler || 0) * 54 * D2R;
  const aileron = (S.aileron || 0) * D2R;
  const elev = (S.elev || 0) * D2R;
  const rud = (S.rudder || 0) * D2R;
  const spin = S.wheelSpin || 0;

  out.flapIn = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], flap * 0.62);
  out.flapOut = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], flap * 0.78);
  out.aileron = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], aileron);
  out.elev = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], elev);
  out.rudder = m4axisAngle(m4(), [0, 0, 0], [0, 1, 0], rud);
  out.spoiler1 = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], -spoiler);
  out.spoiler2 = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], -spoiler * 0.96);
  out.spoiler3 = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], -spoiler * 1.04);
  // 前缘缝翼：顺着襟翼下滑一点（平移写在矩阵里）
  const sl = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], flap * 0.1);
  sl[12] = 0; sl[13] = -0.10 * (S.flap || 0) / 30; sl[14] = -0.30 * (S.flap || 0) / 30;
  out.slat = sl;
  // 风扇：绕 Z 轴；地面滑跑时轮子：绕 X 轴
  out.fan = m4axisAngle(m4(), [0, 0, 0], [0, 0, 1], S.fanSpin || 0);
  out.wheelNose = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], -spin);
  out.wheelMain = m4axisAngle(m4(), [0, 0, 0], [1, 0, 0], -spin);
  return out;
}

// ─── 主循环的一帧 ───
function renderFrame(t) {
  const gl = R.gl;
  const T = R.T;
  const E = R.env;
  const S = T.sample(t);
  const dur = T.duration;
  R.time = t;

  R.ui.orbitYaw = R.ui.orbitYaw || 0;
  const aspect = R.W / Math.max(R.H, 1);
  R.ui.aspect = aspect;
  const cam = cameraAt(T, t, R.ui);
  R.cam = cam;          // 调试/测试用：当前帧的相机
  const near = 0.6, far = 26000;
  const proj = cam.ortho
    ? m4ortho(m4(), -cam.ortho * aspect, cam.ortho * aspect, -cam.ortho, cam.ortho, -400, 400)
    : m4perspect(m4(), cam.fov * D2R, aspect, near, far);
  const view = m4lookAt(m4(), cam.pos, cam.target, [0, 1, 0]);
  // 相机侧滚（机头视角用）
  if (cam.roll) {
    const r = m4();
    const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
    r[0] = c; r[4] = -s; r[1] = s; r[5] = c;
    m4mul(view, r, view);
  }
  const viewProj = m4mul(m4(), proj, view);
  const invVP = m4invert(m4(), viewProj);

  // 飞机世界矩阵
  const P = planeWorld(S);
  const model = m4compose(m4(), P, [S.pitch, S.yaw, S.roll], [1, 1, 1]);
  const normalMat = new Float32Array([model[0], model[1], model[2], model[4], model[5], model[6], model[8], model[9], model[10]]);

  // ── 太阳阴影用的正交投影：把飞机的包围盒包住 ──
  {
    const sunDir = vnorm(E.sunDir);
    const eye = vadd(P, vmul(sunDir, 120));
    const center = vadd(P, [0, 0, 0]);
    const lv = m4lookAt(m4(), eye, center, [0, 1, 0]);
    const ext = 40;
    const lp = m4ortho(m4(), -ext, ext, -ext, ext, 1, 260);
    m4mul(R.shadowVP, lp, lv);
  }

  // ══ 1. 阴影贴图 ══
  gl.bindFramebuffer(gl.FRAMEBUFFER, R.shadow.fbo);
  gl.viewport(0, 0, R.shadow.size, R.shadow.size);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1.6, 3.0);
  gl.disable(gl.BLEND);
  {
    const pr = R.prog.depth;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.uLightVP, false, R.shadowVP);
    gl.uniformMatrix4fv(pr.u.uModel, false, model);
    drawMesh(R.plane.solidMesh);
    const tr = partTransforms(S, t);
    for (const part of R.plane.parts) {
      const m = tr[part.name];
      if (!m) continue;
      for (const mm of partMatrices(model, part, m)) {
        gl.uniformMatrix4fv(pr.u.uModel, false, mm);
        drawMesh(part.mesh);
      }
    }
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);

  // ══ 2. 主场景 ══
  gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo.scene);
  gl.viewport(0, 0, R.W, R.H);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const fade = fadeAmount(t, dur);

  // ── 天空 ──
  {
    const pr = R.prog.sky;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(pr.p);
    envUniforms(pr, E, cam.pos);
    gl.uniformMatrix4fv(pr.u.uInvViewProj, false, invVP);
    gl.uniform1f(pr.u.uCloudCover, E.cloudCover);
    gl.uniform1f(pr.u.uMountainFade, E.mountainFade);
    gl.bindVertexArray(R.emptyVAO || (R.emptyVAO = gl.createVertexArray()));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // ── 地面 ──
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  if (!DBG.skipGround) {
    const pr = R.prog.ground;
    gl.useProgram(pr.p);
    envUniforms(pr, E, cam.pos);
    gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(pr.u.uModel, false, m4id(m4()));
    gl.uniform1f(pr.u.uTerrainDetail, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, R.numNear);
    gl.uniform1i(pr.u.uNumNear, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, R.numFar);
    gl.uniform1i(pr.u.uNumFar, 1);
    drawMesh(R.ground);
  }

  // ── 建筑与树 ──
  if (!DBG.skipInst) {
    const pr = R.prog.inst;
    gl.useProgram(pr.p);
    envUniforms(pr, E, cam.pos);
    gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
    for (const inst of [R.houses, R.treesA, R.treesB]) {
      if (!inst || !inst.n) continue;
      gl.bindVertexArray(inst.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, inst.count, inst.type, 0, inst.n);
    }
    gl.bindVertexArray(null);
  }

  // ── 飞机 ──
  if (!DBG.skipPlane) {
    const pr = R.prog.plane;
    gl.useProgram(pr.p);
    envUniforms(pr, E, cam.pos);
    gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(pr.u.uLightVP, false, R.shadowVP);
    gl.uniform1f(pr.u.uShadowTexel, 1 / R.shadow.size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, R.paint);
    gl.uniform1i(pr.u.uPaint, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, R.shadow.tex);
    gl.uniform1i(pr.u.uShadowMap, 1);
    gl.uniform1f(pr.u.uRough, 0.32);
    gl.uniform1f(pr.u.uMetal, 0.05);
    drawPlane(pr, model, normalMat, S, t);
  }

  // ── 灯（加色混合的点精灵） ──
  if (!DBG.skipLights) {
    const pr = R.prog.light;
    gl.useProgram(pr.p);
    envUniforms(pr, E, cam.pos);
    gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
    gl.uniform1f(pr.u.uViewportH, R.H);
    gl.uniform1f(pr.u.uExposure, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    // 灯光本身不受阴影
    drawLights(pr, model, S, E, cam, viewProj, t);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // ── 烟与尘 ──
  if (!DBG.skipParticles) drawParticles(viewProj, cam, S, t);

  // ══ 3. 泛光 ══
  const f = R.fbo;
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);

  gl.bindFramebuffer(gl.FRAMEBUFFER, f.bright);
  gl.viewport(0, 0, f.bw, f.bh);
  {
    const pr = R.prog.bright;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.sceneTex);
    gl.uniform1i(pr.u.uTex, 0);
    gl.uniform2f(pr.u.uTexel, 1 / R.W, 1 / R.H);
    gl.uniform1f(pr.u.uThreshold, 1.30);
    gl.bindVertexArray(R.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // 横 / 竖两次 blur，再降一半到 1/4 分辨率做更宽的辉光
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.blurA);
  gl.viewport(0, 0, f.bw, f.bh);
  {
    const pr = R.prog.blur;
    gl.useProgram(pr.p);
    gl.bindTexture(gl.TEXTURE_2D, f.brightTex);
    gl.uniform1i(pr.u.uTex, 0);
    gl.uniform2f(pr.u.uDir, 1.4 / f.bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, f.bright);
    gl.bindTexture(gl.TEXTURE_2D, f.blurATex);
    gl.uniform2f(pr.u.uDir, 0, 1.4 / f.bh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 第二次：更宽的模糊到 1/4 分辨率
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.blurB);
    gl.viewport(0, 0, f.qw, f.qh);
    gl.bindTexture(gl.TEXTURE_2D, f.blurATex);
    gl.uniform2f(pr.u.uDir, 2.6 / f.bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, f.blurA);
    gl.viewport(0, 0, f.bw, f.bh);
    gl.bindTexture(gl.TEXTURE_2D, f.blurBTex);
    gl.uniform2f(pr.u.uDir, 0, 2.6 / f.qh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ══ 4. 合成到屏幕 ══
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, R.W, R.H);
  {
    const pr = R.prog.final;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.sceneTex);
    gl.uniform1i(pr.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, f.brightTex);
    gl.uniform1i(pr.u.uBloom1, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, f.blurATex);
    gl.uniform1i(pr.u.uBloom2, 2);
    gl.uniform1f(pr.u.uBloom, E.bloom);
    gl.uniform1f(pr.u.uExposure, E.exposure);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform2f(pr.u.uRes, R.W, R.H);
    gl.uniform1f(pr.u.uFade, fade);
    gl.bindVertexArray(R.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  gl.activeTexture(gl.TEXTURE0);
  R.frames++;
}

function fadeAmount(t, dur) {
  // 开头 0.8 s 从黑场淡入；结尾 1.2 s 淡出（首尾成环，方便循环播放）
  const a = smoothstep(0, 0.9, t);
  const b = 1 - smoothstep(dur - 1.4, dur - 0.15, t);
  return Math.min(a, b);
}

const mirrorMatrix = () => {
  const m = m4id(m4());
  m[0] = -1;
  return m;
};

function drawPlane(pr, model, normalMat, S, t) {
  const gl = R.gl;
  const tr = partTransforms(S, t);
  const mir = mirrorMatrix();

  // 机身：用涂装贴图
  gl.uniform1f(pr.u.uUsePaint, 1);
  gl.uniform3fv(pr.u.uTint, [1, 1, 1]);
  gl.uniformMatrix4fv(pr.u.uModel, false, model);
  gl.uniformMatrix3fv(pr.u.uNormalMat, false, normalMat);
  drawMesh(R.plane.fuselage);
  // 其余固定部件（机翼、尾翼、短舱……）用顶点色
  gl.uniform1f(pr.u.uUsePaint, 0);
  gl.uniform3fv(pr.u.uTint, [1, 1, 1]);
  drawMesh(R.plane.solidMesh);
  // 尾翼标志（两侧各一片，半透明叠加）
  gl.uniform1f(pr.u.uUsePaint, 0);
  gl.uniform1f(pr.u.uMetal, 0.25);
  gl.uniform1f(pr.u.uRough, 0.35);

  // 可动部件（右侧）+ 镜像（左侧）
  for (const part of R.plane.parts) {
    const m = tr[part.name];
    if (!m) continue;
    for (const mm of partMatrices(model, part, m)) {
      gl.uniformMatrix4fv(pr.u.uModel, false, mm);
      gl.uniformMatrix3fv(pr.u.uNormalMat, false, upper3(mm));
      drawMesh(part.mesh);
    }
  }
  gl.uniform1f(pr.u.uMetal, 0.12);
  gl.uniform1f(pr.u.uRough, 0.32);
}

// 一个部件的世界矩阵列表：右侧一份，左侧（镜像）再一份。
// 部件网格以铰链点为原点，所以世界矩阵 = 机身矩阵 · 平移(铰链) · 旋转 · 平移(-铰链)
// ——其中后两项由 partTransforms 给出，这里只负责补上铰链平移。
function partMatrices(model, part, rot) {
  const out = [];
  const piv = part.pivot || [0, 0, 0];
  const base = m4();
  m4compose(base, piv, [0, 0, 0], [1, 1, 1]);
  const inv = m4();
  m4compose(inv, [-piv[0], -piv[1], -piv[2]], [0, 0, 0], [1, 1, 1]);
  const local = m4mul(m4(), m4mul(m4(), base, rot), inv);
  out.push(m4mul(m4(), model, local));
  if (!part.mirrorOnly) {
    const mir = mirrorMatrix();
    out.push(m4mul(m4(), m4mul(m4(), model, local), mir));
  }
  return out;
}

function upper3(m) {
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}

// ─── 灯 ───
function drawLights(pr, model, S, E, cam, viewProj, t) {
  const gl = R.gl;
  // 飞机上的灯（每帧算位置）：航行灯、频闪、着陆灯
  const P = model;
  const pts = [];
  const add = (p, col, size, glow) => pts.push({ p, col, size, glow });

  const wingtipL = [-17.2, 0.35, -5.2];
  const wingtipR = [17.2, 0.35, -5.2];
  const tail = [0, 1.1, 21.4];
  const wp = (v) => m4point(P, v);

  const strobeOn = (t) => {
    const ph = (t * 1.15) % 1;
    return ph < 0.045 || (ph > 0.09 && ph < 0.135) ? 1 : 0;
  };
  const nv = sat(E.night * 1.6 + 0.15);
  add(wp(wingtipL), [1.0, 0.12, 0.10], 0.55, 1.6 * nv);
  add(wp(wingtipR), [0.15, 1.0, 0.35], 0.55, 1.6 * nv);
  add(wp(tail), [1, 0.95, 0.9], 0.45, 1.2 * nv);
  if (strobeOn(t) && S.gear > 0.9) {
    add(wp([-17.3, 0.4, -5.1]), [1, 1, 1], 1.1, 9.0);
    add(wp([17.3, 0.4, -5.1]), [1, 1, 1], 1.1, 9.0);
    add(wp([0, 1.6, 21.5]), [1, 1, 1], 0.9, 7.0);
  }
  // 着陆灯：起飞/进近/着陆时开
  if (S.landingLights > 0.02) {
    for (const x of [-8.2, 8.2]) {
      add(wp([x, -2.6, -3.8]), [1.0, 0.97, 0.88], 0.9, 5.0 * S.landingLights);
    }
    add(wp([0, -2.9, -13.6]), [1.0, 0.97, 0.9], 0.7, 3.2 * S.landingLights);
  }

  // 机场灯：直接用静态缓冲
  gl.bindVertexArray(R.lightVAO.vao);
  gl.useProgram(pr.p);
  envUniforms(pr, E, cam.pos);
  gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
  gl.uniform1f(pr.u.uViewportH, R.H);
  gl.uniform1f(pr.u.uNight, Math.max(E.night, 0.25));
  gl.drawArrays(gl.POINTS, 0, R.lightVAO.n);

  // 飞机上的灯：临时拼一个缓冲（数量很少，直接 drawArrays 不行，得传数据）
  // 用一个小的动态缓冲
  if (!R.planeLightBuf) {
    R.planeLightBuf = gl.createBuffer();
    R.planeLightVAO = gl.createVertexArray();
    gl.bindVertexArray(R.planeLightVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.planeLightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 64 * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
  }
  const arr = new Float32Array(pts.length * 8);
  pts.forEach((o, i) => {
    arr[i * 8] = o.p[0]; arr[i * 8 + 1] = o.p[1]; arr[i * 8 + 2] = o.p[2]; arr[i * 8 + 3] = o.size;
    arr[i * 8 + 4] = o.col[0]; arr[i * 8 + 5] = o.col[1]; arr[i * 8 + 6] = o.col[2]; arr[i * 8 + 7] = o.glow;
  });
  gl.bindVertexArray(R.planeLightVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, R.planeLightBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
  gl.drawArrays(gl.POINTS, 0, pts.length);
  gl.bindVertexArray(null);
}

// ─── 轮胎烟 ───
function drawParticles(viewProj, cam, S, t) {
  const gl = R.gl;
  const T = R.T;
  const td = T.tdTime;
  const data = R.partData;
  let n = 0;
  const push = (p, size, alpha, col) => {
    if (n >= R.partCap) return;
    const i = n * 8;
    data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2]; data[i + 3] = size;
    data[i + 4] = alpha; data[i + 5] = col[0]; data[i + 6] = col[1]; data[i + 7] = col[2];
    n++;
  };

  if (td >= 0 && t > td - 0.15) {
    const E = R.env;
    // 接地瞬间主轮冒烟：沿滑跑方向每隔一段“留”一团
    // 主轮接地那一下先来一团大的（真实世界里这一瞬间的白烟最明显），
    // 之后再沿滑跑方向一路留下稀薄的胎烟。
    for (let i = 0; i < 22; i++) {
      const age = t - td;
      if (age < 0 || age > 4.2) continue;
      const life = age / 4.2;
      const side = i % 2 === 0 ? -1 : 1;
      const a = 0.55 * (1 - life) * (1 - life) * smoothstep(0, 0.06, age);
      const p = [
        side * 3.6 + (hash1(i * 5.7) - 0.5) * (1.4 + age * 3.4),
        0.30 + age * (0.7 + hash1(i * 3.1) * 0.5),
        T.tdZ + (hash1(i * 11.3) - 0.5) * (2.5 + age * 7.0),
      ];
      const tone = 0.86 + hash1(i * 9.1) * 0.12;
      push(p, 2.6 + age * 5.6, a, [tone, tone * 0.99, tone * 0.98]);
    }
    const nP = 64;
    for (let i = 0; i < nP; i++) {
      const birth = td + (i / nP) * 1.35;
      const age = t - birth;
      if (age < 0 || age > 5.5) continue;
      const z = T.tdZ + (i / nP) * 1.35 * S.vz * 0.6;
      const side = i % 2 === 0 ? -1 : 1;
      const jitter = hash1(i * 91 + 3) - 0.5;
      const spread = age * (1.4 + hash1(i * 17) * 3.2);
      const life = age / 5.5;
      const alpha = 0.42 * (1 - life) * (1 - life) * smoothstep(0, 0.10, age);
      const size = 1.5 + age * 3.4;
      const p = [
        side * 3.6 + jitter * spread + age * 0.6,
        0.25 + age * 0.55,
        z + (side * 0.4) + (hash1(i * 41) - 0.5) * spread,
      ];
      const tone = 0.72 + hash1(i * 7) * 0.16;
      const col = [tone * (0.85 + E.ambSky[0] * 0.5), tone * (0.86 + E.ambSky[1] * 0.4), tone * 0.90];
      push(p, size, alpha, col);
    }
    // 轮胎擦地的火花（非常短）
    for (let i = 0; i < 26; i++) {
      const birth = td + hash1(i * 13 + 1) * 0.42;
      const age = t - birth;
      if (age < 0 || age > 0.5) continue;
      const a = (1 - age / 0.5) * 0.5;
      const side = i % 2 === 0 ? -1 : 1;
      const p = [side * 3.6 + (hash1(i * 29) - 0.5) * 0.6, 0.14, T.tdZ + age * S.vz * 0.9 + (hash1(i * 37) - 0.5) * 2];
      push(p, 0.35, a, [1.0, 0.72, 0.35]);
    }
    // 反推吹起的尘土
    for (let i = 0; i < 40; i++) {
      const birth = td + 1.1 + hash1(i * 71) * 3.4;
      const age = t - birth;
      if (age < 0 || age > 2.6) continue;
      const life = age / 2.6;
      const z = T.tdZ + (birth - td) * S.vz * 0.55 + 6;
      const side = i % 2 === 0 ? -1 : 1;
      const p = [
        side * (9 + age * 7 + hash1(i * 11) * 6),
        0.3 + age * 1.1,
        z + (hash1(i * 23) - 0.5) * 10 - age * 3,
      ];
      push(p, 2.2 + age * 3.0, 0.10 * (1 - life) ** 2, [0.55, 0.50, 0.44]);
    }
  }

  if (!n) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, R.partBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 8));
  const pr = R.prog.part;
  gl.useProgram(pr.p);
  gl.uniformMatrix4fv(pr.u.uViewProj, false, viewProj);
  gl.uniform3fv(pr.u.uCamPos, cam.pos);
  gl.uniform1f(pr.u.uViewportH, R.H);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.enable(gl.DEPTH_TEST);
  gl.bindVertexArray(R.partVAO);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.bindVertexArray(null);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}
// ═══════════════════════════════════════════════════════════════════════════
//  85 · 界面与主循环
//  控制条：播放 / 从头 / 时间轴（带阶段刻度）/ 机位 / 天色 / 速度 / 全屏。
//  键盘：空格播放暂停，←→ 前后 2 秒，1–7 切机位，T 换天色，H 隐藏界面，
//        F 全屏，R 从头播放。
// ═══════════════════════════════════════════════════════════════════════════

const UI = {
  els: {},
  hidden: false,
  hintTimer: 0,
  dragging: false,
  lastPointer: null,
  autoHideTimer: 0,
};

const PHASE_LABEL = {
  approach: '进近 · 沿 3° 下滑道',
  flare: '拉平 · 收油门',
  touchdown: '主轮接地',
  rollout: '减速滑跑 · 反推',
  exit: '脱离跑道',
};

function initUI() {
  const $ = (id) => document.getElementById(id);
  UI.els = {
    canvas: $('view'),
    phase: $('phase'),
    alt: $('tAlt'), spd: $('tSpd'), vs: $('tVs'),
    chips: { gear: $('cGear'), flap: $('cFlap'), spl: $('cSpl'), rev: $('cRev'), brk: $('cBrk') },
    play: $('play'), restart: $('restart'), seek: $('seek'), clock: $('clock'), marks: $('marks'),
    bar: document.querySelector('.bar'),
    hideui: $('hideui'), showui: $('showui'), fs: $('fs'),
    hint: $('hint'),
    start: $('start'), startBtn: $('startBtn'),
    nogl: $('nogl'),
  };

  // 机位按钮
  for (const b of document.querySelectorAll('[data-cam]')) {
    b.addEventListener('click', () => setCam(b.dataset.cam));
  }
  for (const b of document.querySelectorAll('[data-tod]')) {
    b.addEventListener('click', () => setTod(b.dataset.tod));
  }
  for (const b of document.querySelectorAll('[data-speed]')) {
    b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed)));
  }

  UI.els.play.addEventListener('click', togglePlay);
  UI.els.restart.addEventListener('click', () => seekTo(0, true));
  UI.els.seek.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) / 1000;
    seekTo(v * R.T.duration, false);
  });
  UI.els.hideui.addEventListener('click', () => setHidden(true));
  UI.els.showui.addEventListener('click', () => setHidden(false));
  UI.els.fs.addEventListener('click', toggleFullscreen);
  UI.els.startBtn.addEventListener('click', () => {
    UI.els.start.hidden = true;
    R.ui.paused = false;
    updatePlayBtn();
  });

  // 键盘
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'arrowright') { e.preventDefault(); seekTo(Math.min(R.time + 2, R.T.duration), false); }
    else if (k === 'arrowleft') { e.preventDefault(); seekTo(Math.max(R.time - 2, 0), false); }
    else if (k === 'r') seekTo(0, true);
    else if (k === 'h') setHidden(!UI.hidden);
    else if (k === 'f') toggleFullscreen();
    else if (k === 't') cycleTod();
    else if (k >= '1' && k <= '7') {
      const c = CAMS[parseInt(k, 10) - 1];
      if (c) setCam(c.key);
    } else if (k === 'c') cycleCam();
    else if (k === '?') showHint('空格 播放/暂停 · ←→ 快退快进 · 1–7 机位 · T 天色 · H 隐藏界面 · F 全屏', 5200);
  });

  // 环绕视角的拖动
  const cv = UI.els.canvas;
  cv.addEventListener('pointerdown', (e) => {
    UI.dragging = true;
    UI.lastPointer = [e.clientX, e.clientY];
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!UI.dragging) return;
    const dx = e.clientX - UI.lastPointer[0];
    const dy = e.clientY - UI.lastPointer[1];
    UI.lastPointer = [e.clientX, e.clientY];
    if (R.ui.cam !== 'orbit') setCam('orbit');
    R.ui.orbitYaw = (R.ui.orbitYaw || 0) - dx * 0.006;
    R.ui.orbitPitch = clamp((R.ui.orbitPitch || 0) + dy * 0.16, -8, 60);
  });
  const endDrag = () => { UI.dragging = false; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    if (R.ui.cam !== 'orbit') return;
    e.preventDefault();
    R.ui.orbitPitch = clamp((R.ui.orbitPitch || 0) - e.deltaY * 0.04, -8, 60);
  }, { passive: false });

  // 鼠标移动时显示界面（但用 ?ui=0 强制隐藏时不受影响：截图与嵌入场景需要）
  window.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && UI.lockHidden) return;
    if (UI.hidden) setHidden(false);
    clearTimeout(UI.autoHideTimer);
  });

  // 时间轴上的阶段刻度
  UI.els.marks.innerHTML = '';
  for (const s of R.T.phaseSpans) {
    if (s.t0 <= 0.01) continue;
    const d = document.createElement('span');
    d.style.left = `${(s.t0 / R.T.duration) * 100}%`;
    d.textContent = PHASE_LABEL[s.key].split(' · ')[0];
    UI.els.marks.appendChild(d);
  }
  updatePlayBtn();
}

function setCam(cam) {
  R.ui.cam = cam;
  R.ui.orbitYaw = 0;
  R.ui.orbitPitch = 0;
  for (const b of document.querySelectorAll('[data-cam]')) {
    b.setAttribute('aria-pressed', String(b.dataset.cam === cam));
  }
  if (cam === 'front') R.ui.cam = 'orbit';
  const meta = CAMS.find((c) => c.key === cam);
  showHint(`镜头：${meta ? meta.label : cam}`, 1400);
}

function cycleCam() {
  const i = CAMS.findIndex((c) => c.key === R.ui.cam);
  setCam(CAMS[(i + 1) % CAMS.length].key);
}

function setTod(tod) {
  if (!TOD[tod]) return;
  R.ui.tod = tod;
  R.env = TOD[tod];
  for (const b of document.querySelectorAll('[data-tod]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tod === tod));
  }
  // 尾翼标志在夜里会亮
  const gl = R.gl;
  R.finDecal && gl.deleteTexture(R.finDecal);
  R.finDecal = canvasTexture(gl, 256, 512, (c, w, h) => paintFinFlag(c, w, h, tod === 'night' ? 1 : 0), { flipY: false });
  showHint(`天色：${TOD[tod].label}`, 1400);
}

function cycleTod() {
  const keys = Object.keys(TOD);
  setTod(keys[(keys.indexOf(R.ui.tod) + 1) % keys.length]);
}

function setSpeed(s) {
  R.ui.speed = s;
  for (const b of document.querySelectorAll('[data-speed]')) {
    b.setAttribute('aria-pressed', String(parseFloat(b.dataset.speed) === s));
  }
  showHint(`播放速度 ${s}×`, 1200);
}

function togglePlay() {
  R.ui.paused = !R.ui.paused;
  updatePlayBtn();
}

function updatePlayBtn() {
  const p = R.ui.paused;
  UI.els.play.classList.toggle('paused', p);
  UI.els.play.setAttribute('aria-label', p ? '播放' : '暂停');
}

function seekTo(t, restart) {
  R.time = clamp(t, 0, R.T.duration);
  if (restart) {
    R.ui.paused = false;
    updatePlayBtn();
  }
  syncUI(R.time);
}

function setHidden(h, lock) {
  if (lock) UI.lockHidden = h;
  UI.hidden = h;
  document.body.classList.toggle('ui-hidden', h);
  UI.els.showui.hidden = !h;
  if (h) showHint('按 H 或移动鼠标可重新显示界面', 2600);
}

function showHint(text, ms) {
  const el = UI.els.hint || document.getElementById('hint');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(UI.hintTimer);
  UI.hintTimer = setTimeout(() => el.classList.remove('show'), ms || 1800);
}

function toggleFullscreen() {
  const d = document;
  if (!d.fullscreenElement) {
    const el = d.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  } else {
    (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
  }
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function syncUI(t) {
  const S = R.T.sample(t);
  UI.els.phase.textContent = `${PHASE_LABEL[S.phase] || ''}`;
  UI.els.alt.textContent = Math.max(0, Math.round(S.altFt));
  UI.els.spd.textContent = Math.round(S.kts);
  UI.els.vs.textContent = Math.round(S.fpm / 10) * 10;
  const on = (el, v, warn) => {
    el.classList.toggle('on', !!v);
    el.classList.toggle('warn', !!warn && !!v);
  };
  on(UI.els.chips.gear, S.gear > 0.9);
  on(UI.els.chips.flap, S.flap > 1);
  on(UI.els.chips.spl, S.spoiler > 0.05);
  on(UI.els.chips.rev, S.rev > 0.05);
  on(UI.els.chips.brk, S.brake > 0.05);
  UI.els.seek.value = String(Math.round((t / R.T.duration) * 1000));
  UI.els.clock.textContent = `${fmtTime(t)} / ${fmtTime(R.T.duration)}`;
}

// ─── 主循环 ───
function startLoop() {
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (!R.T) return;
    const dt = R.lastNow ? Math.min((now - R.lastNow) / 1000, 0.1) : 0;
    R.lastNow = now;

    if (!R.ui.paused) {
      R.time += dt * R.ui.speed;
      if (R.time > R.T.duration) {
        R.time = 0;   // 循环播放（首尾都有淡入淡出）
      }
    }
    renderFrame(R.time);
    syncUI(R.time);
  };
  requestAnimationFrame(loop);
}

// ─── 启动 ───
function boot() {
  const canvas = document.getElementById('view');
  let ok = false;
  try {
    ok = initRenderer(canvas);
  } catch (err) {
    console.error((err && err.stack) || err);
    ok = false;
  }
  if (!ok) {
    document.getElementById('nogl').hidden = false;
    document.getElementById('fade').style.display = 'none';
    return;
  }

  // 轨迹 + 时间轴
  const traj = buildTrajectory();
  R.T = makeTimeline(traj);

  // 地址参数
  const q = new URLSearchParams(location.search);
  initUI();
  const tod = q.get('tod');
  if (tod && TOD[tod]) setTod(tod);
  const c = q.get('cam');
  if (c && CAMS.some((x) => x.key === c)) setCam(c);
  const sp = parseFloat(q.get('speed'));
  if (sp && [0.5, 1, 2].includes(sp)) setSpeed(sp);
  const qq = parseFloat(q.get('q'));
  if (qq > 0.3 && qq <= 2) R.quality = qq;
  if (q.get('ui') === '0') setHidden(true, true);
  if (q.get('paused') === '1') { R.ui.paused = true; updatePlayBtn(); }

  resize();
  window.addEventListener('resize', resize);

  // 开头 0.9 s 是黑场淡入（为了首尾成环），直接播放会先黑一下；
  // 没有显式指定 ?t= 时从淡入结束处开始，观感更干净。
  const t0 = parseFloat(q.get('t'));
  R.time = Number.isFinite(t0) ? clamp(t0, 0, R.T.duration) : Math.min(0.9, R.T.duration);

  // 首帧先渲染一次，避免出现空白的闪
  renderFrame(R.time);
  syncUI(R.time);
  // 淡入
  const f = document.getElementById('fade');
  f.style.transition = 'opacity 1.1s ease';
  requestAnimationFrame(() => { f.style.opacity = '0'; });

  // 系统设置了“减少动态效果”时先停住，等用户点播放
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && q.get('paused') !== '1') {
    R.ui.paused = true;
    document.getElementById('start').hidden = false;
    updatePlayBtn();
  }

  startLoop();

  // 供无头测试读：把几帧渲染的结果暴露出来
  window.__plane = {
    R,
    TOD,
    setTod,
    setCam,
    renderAt(t) {
      R.ui.paused = true;
      R.time = clamp(t, 0, R.T.duration);
      renderFrame(R.time);
      syncUI(R.time);
    },
    // 调试用：正交三视图（侧、前、顶），专门看模型比例
    ortho(axis, degree) {
      const R2 = R;
      R2.ui.paused = true;
      const S = R2.T.sample(0.2);
      R2.time = 0.2;
      const d = {
        side: [[-70, 1.5, 0], [0, 0, 0]],
        front: [[0, 2, -70], [0, 0, 0]],
        top: [[0, 70, 0.01], [0, 0, 0]],
        q3: [[-46, 16, -40], [0, 0, 0]],
      }[axis];
      const eye = [S.x + d[0][0], S.h - 3.86 + d[0][1], S.z + d[0][2]];
      const tgt = [S.x + d[1][0], S.h - 3.86 + d[1][1], S.z + d[1][2]];
      const P = window.__plane;
      P.__override = { eye, tgt, ortho: 13 * (degree || 1) };
      P.renderAt(0.2);
    },
    // 调试用：把机身涂装渲染成一张 PNG，方便直接看圆柱展开图
    paintPNG(w = 1024, h = 512) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      paintFuselage(c.getContext('2d'), w, h);
      return c.toDataURL('image/png');
    },
    get info() {
      return {
        duration: R.T.duration,
        tdTime: R.T.tdTime,
        tdZ: R.T.tdZ,
        frames: R.frames,
        gl: R.gl.getParameter(R.gl.VERSION),
        hdr: R.hdr,
      };
    },
  };
  document.documentElement.setAttribute('data-ready', '1');
  window.__ready = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
})();
