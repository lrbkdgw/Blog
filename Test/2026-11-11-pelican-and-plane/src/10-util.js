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
