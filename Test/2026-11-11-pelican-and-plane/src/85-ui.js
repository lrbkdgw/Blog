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