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
