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


