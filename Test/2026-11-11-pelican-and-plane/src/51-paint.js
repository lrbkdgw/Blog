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
