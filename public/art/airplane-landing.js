/* 飞机降落 · 3D 动画（three.js，无构建步骤）
 *
 * 场景：黄昏机场，一架客机沿五边进近航线降落到跑道上。
 * 过程：远处高空 → 压坡度转弯对正跑道 → 下降、放起落架与襟翼 → 拉平接地（冒轮胎烟）
 *      → 减速、开反推 → 转入滑行道停稳。
 * 相机：开场为身侧/后上方跟拍，接地瞬间切到跑道旁的机位，落地后缓慢环绕。
 *
 * 交互：拖拽旋转视角，滚轮缩放，点按钮或按空格暂停/继续，R 键重播。
 * 用法：<script src="three.min.js"></script><script src="airplane-landing.js"></script>
 */
(function () {
  'use strict';

  const mount = document.getElementById('airplane-landing');
  if (!mount) return;
  if (!window.THREE) {
    mount.innerHTML = '<p style="padding:2rem;color:#94a3b8;font-family:sans-serif">three.js 未加载：请把 three.min.js 与 airplane-landing.js 放在同一目录。</p>';
    return;
  }
  const THREE = window.THREE;

  /* ───────────────────────── 小工具 ───────────────────────── */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /** 关键帧插值：keys = [{t, v:[...]}, ...]（t 递增，首尾自动钳制） */
  function track(keys, t) {
    if (t <= keys[0].t) return keys[0].v.slice();
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        const k = (t - a.t) / (b.t - a.t || 1);
        return a.v.map((va, j) => lerp(va, b.v[j], k));
      }
    }
    return keys[keys.length - 1].v.slice();
  }

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────────────────────── 渲染器 ───────────────────────── */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none';
  mount.appendChild(canvas);

  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0xd8b08a);
  scene.fog = new THREE.Fog(FOG, 260, 1900);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.6, 6000);

  /* ───────────────────────── 天空 ───────────────────────── */
  const skyGeo = new THREE.SphereGeometry(3200, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1b2350) },
      mid: { value: new THREE.Color(0x7c4a72) },
      hor: { value: new THREE.Color(0xf3a068) },
      sun: { value: new THREE.Color(0xffd9a0) },
      sunDir: { value: new THREE.Vector3(-0.42, 0.13, 0.90).normalize() }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.34, h));
        col = mix(col, top, smoothstep(0.28, 0.85, h));
        float sd = max(dot(normalize(vDir), sunDir), 0.0);
        col += sun * pow(sd, 90.0) * 0.9;            // 太阳
        col += sun * pow(sd, 8.0) * 0.22;            // 霞光
        col = mix(vec3(0.36, 0.26, 0.32), col, smoothstep(-0.16, 0.02, h)); // 地平线雾
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  /* 云：一堆压扁的球，缓慢漂移 */
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf6dcc4, roughness: 1, metalness: 0, transparent: true, opacity: 0.82 });
  const cloudGeo = new THREE.SphereGeometry(1, 12, 8);
  const cloudSeed = [];
  for (let i = 0; i < 20; i++) {
    const g = new THREE.Group();
    const puffs = 4 + (i % 4);
    for (let p = 0; p < puffs; p++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      const s = 52 + ((p * 17) % 46);
      m.scale.set(s * 1.9, s * 0.42, s * 1.1);
      m.position.set((p - puffs / 2) * s * 1.15, ((p * 7) % 12) - 6, ((p * 11) % 18) - 9);
      g.add(m);
    }
    const ang = (i / 20) * TAU + 0.4;
    const rad = 1500 + ((i * 137) % 800);
    g.position.set(Math.cos(ang) * rad, 420 + ((i * 53) % 320), Math.sin(ang) * rad - 500);
    g.rotation.y = -ang;
    clouds.add(g);
    cloudSeed.push({ g: g, speed: 0.6 + (i % 5) * 0.22, rad: rad, ang: ang });
  }
  scene.add(clouds);

  /* ───────────────────────── 灯光 ───────────────────────── */
  scene.add(new THREE.HemisphereLight(0xd6e0ff, 0x8a6248, 1.15));
  const sun = new THREE.DirectionalLight(0xffc891, 2.4);
  sun.position.set(-420, 190, 660);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 2400;
  const S = 380;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.9;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(0x86b7ff, 0.55);
  rim.position.set(520, 170, -420);
  scene.add(rim);

  /* ───────────────────────── 材质 ───────────────────────── */
  const std = (color, opts) => new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.72, metalness: 0.12 }, opts || {}));
  const M = {
    asphalt: std(0x474d58, { roughness: 1, metalness: 0 }),
    asphaltEdge: std(0x4a4f59, { roughness: 1, metalness: 0 }),
    line: std(0xf2f2ea, { roughness: 0.9, metalness: 0 }),
    grass: std(0x7d9660, { roughness: 1, metalness: 0 }),
    grassDark: std(0x6c8752, { roughness: 1, metalness: 0 }),
    belly: std(0xf1f3f6, { roughness: 0.55, metalness: 0.18 }),
    fuselage: std(0xffffff, { roughness: 0.42, metalness: 0.22 }),
    stripe: std(0x1f7fbf, { roughness: 0.45, metalness: 0.25 }),
    accent: std(0xf2a13a, { roughness: 0.5, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x16243a, roughness: 0.15, metalness: 0.85, emissive: 0x0a1524, emissiveIntensity: 0.6 }),
    engine: std(0x59616e, { roughness: 0.4, metalness: 0.8 }),
    tyre: std(0x1a1c20, { roughness: 0.95, metalness: 0 }),
    strut: std(0xb9c0c9, { roughness: 0.35, metalness: 0.85 }),
    light: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 }),
    red: new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2b1f, emissiveIntensity: 1.8 }),
    tower: std(0xdfe3e8, { roughness: 0.7, metalness: 0.1 }),
    towerGlass: new THREE.MeshStandardMaterial({ color: 0x2a4a63, roughness: 0.2, metalness: 0.7, emissive: 0x1b3348, emissiveIntensity: 0.5 }),
    tree: std(0x3d5c36, { roughness: 1, metalness: 0 }),
    trunk: std(0x40301f, { roughness: 1, metalness: 0 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffe0a0, emissiveIntensity: 1.6 })
  };

  /* ───────────────────────── 地面 / 跑道 ───────────────────────── */
  // 跑道沿 -Z 方向延伸；飞机从 -Z 远处进近，向 +Z 方向降落滑跑。
  const RUNWAY_LEN = 1200;
  const RUNWAY_W = 46;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1), M.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 远处农田/草地色块：只铺在跑道两侧，避免与主地面共面导致 z-fighting
  for (let i = 0; i < 18; i++) {
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(160 + (i * 53) % 220, 130 + (i * 31) % 200), i % 3 ? M.grassDark : M.grass);
    patch.rotation.x = -Math.PI / 2;
    const side = i % 2 ? 1 : -1;
    patch.position.set(side * (120 + (i * 97) % 700), 0.06, -600 + (i * 211) % 1400);
    patch.receiveShadow = true;
    scene.add(patch);
  }

  const runway = new THREE.Mesh(new THREE.BoxGeometry(RUNWAY_W, 0.6, RUNWAY_LEN), M.asphalt);
  runway.position.set(0, 0.3, RUNWAY_LEN / 2 - 300);
  runway.receiveShadow = true;
  scene.add(runway);

  // 两侧道肩
  [-1, 1].forEach((sx) => {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, RUNWAY_LEN), M.asphaltEdge);
    shoulder.position.set(sx * (RUNWAY_W / 2 + 2.4), 0.25, runway.position.z);
    shoulder.receiveShadow = true;
    scene.add(shoulder);
  });

  // 中心虚线
  const dashGeo = new THREE.BoxGeometry(1.1, 0.08, 22);
  for (let z = -280; z < RUNWAY_LEN - 320; z += 46) {
    const dash = new THREE.Mesh(dashGeo, M.line);
    dash.position.set(0, 0.62, z);
    scene.add(dash);
  }
  // 边线
  [-1, 1].forEach((sx) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, RUNWAY_LEN), M.line);
    edge.position.set(sx * (RUNWAY_W / 2 - 2), 0.62, runway.position.z);
    scene.add(edge);
  });
  // 入口斑马线（接地带）
  const barGeo = new THREE.BoxGeometry(2.4, 0.08, 26);
  for (let i = -8; i <= 8; i++) {
    if (Math.abs(i) < 1) continue;
    const bar = new THREE.Mesh(barGeo, M.line);
    bar.position.set(i * 2.6, 0.62, -120);
    scene.add(bar);
  }
  // 接地带标志（两两一组）
  for (let k = 0; k < 3; k++) {
    [-1, 1].forEach((sx) => {
      for (let j = 0; j < 2; j++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 12), M.line);
        b.position.set(sx * (9 + j * 3.4), 0.62, 20 + k * 60);
        scene.add(b);
      }
    });
  }

  /* 跑道灯 + 进近灯 */
  const lampGeo = new THREE.SphereGeometry(0.5, 8, 6);
  for (let z = -280; z < RUNWAY_LEN - 320; z += 60) {
    [-1, 1].forEach((sx) => {
      const l = new THREE.Mesh(lampGeo, M.lamp);
      l.position.set(sx * (RUNWAY_W / 2 + 0.6), 0.9, z);
      scene.add(l);
    });
  }
  // 进近灯排（跑道入口外侧）
  for (let i = 0; i < 12; i++) {
    const zz = -300 - i * 26;
    [-1, 1, -2.4, 2.4].forEach((sx) => {
      const l = new THREE.Mesh(lampGeo, M.lamp);
      l.position.set(sx * 3.4, 0.9, zz);
      scene.add(l);
    });
  }

  /* ───────────────────────── 塔台 / 机库 / 树 ───────────────────────── */
  function buildTower(x, z) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 46, 16), M.tower);
    base.position.y = 23;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(11, 9.5, 9, 16), M.towerGlass);
    cab.position.y = 50;
    cab.castShadow = true;
    g.add(cab);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 1.6, 16), M.tower);
    roof.position.y = 55;
    g.add(roof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 6), M.strut);
    mast.position.y = 63;
    g.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), M.red);
    beacon.position.y = 70;
    beacon.name = 'beacon';
    g.add(beacon);
    g.position.set(x, 0, z);
    return g;
  }
  scene.add(buildTower(230, 250));

  function buildHangar(x, z, w, rot) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 16, w * 0.7), M.tower);
    box.position.y = 8;
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.38, w * 0.38, w * 0.7, 18, 1, false, 0, Math.PI), M.asphaltEdge);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 16;
    roof.castShadow = true;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, 12), M.glass);
    door.position.set(0, 6, w * 0.351);
    g.add(door);
    g.position.set(x, 0, z);
    g.rotation.y = rot || 0;
    return g;
  }
  scene.add(buildHangar(-260, 180, 74));
  scene.add(buildHangar(-330, 60, 56));

  const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 7, 6);
  const leafGeo = new THREE.ConeGeometry(4.2, 12, 7);
  for (let i = 0; i < 90; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (90 + ((i * 53) % 520));
    const z = -700 + ((i * 137) % 1500);
    const g = new THREE.Group();
    const tr = new THREE.Mesh(trunkGeo, M.trunk);
    tr.position.y = 3.5;
    g.add(tr);
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.Mesh(leafGeo, M.tree);
      leaf.position.y = 8 + k * 4.4;
      leaf.scale.setScalar(1 - k * 0.22);
      leaf.castShadow = true;
      g.add(leaf);
    }
    const s = 0.8 + ((i * 29) % 70) / 100;
    g.scale.setScalar(s);
    g.position.set(x, 0, z);
    scene.add(g);
  }

  /* ───────────────────────── 飞机 ───────────────────────── */
  // 机身：把一段车削轮廓沿 Z 轴放平（机头朝 -Z，与进近方向一致）
  function fuselageLathe() {
    const pts = [];
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = -22 + t * 44;                 // -22 机头 … +22 机尾
      let r;
      if (t < 0.16) {
        r = 2.55 * Math.sqrt(Math.max(0, 1 - Math.pow((0.16 - t) / 0.16, 2)));       // 圆润机头
        r = Math.max(r, 0.35 * (1 - Math.pow((0.16 - t) / 0.16, 1.4)));
      } else if (t < 0.62) {
        r = 2.55;
      } else {
        const k = (t - 0.62) / 0.38;
        r = 2.55 * Math.pow(Math.cos(k * Math.PI / 2), 0.75) * 0.62 + 0.28 * (1 - k);  // 收细的尾锥+垂尾根部
      }
      pts.push(new THREE.Vector2(Math.max(r, 0.12), z));
    }
    const geo = new THREE.LatheGeometry(pts, 26);
    // 车削轴 Y → Z；取 +90° 而不是 -90°，这样轮廓里的 -22（机头）真正落在世界 -Z 上
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  function buildAirplane() {
    const plane = new THREE.Group();

    const body = new THREE.Mesh(fuselageLathe(), M.fuselage);
    body.castShadow = true;
    body.receiveShadow = true;
    plane.add(body);

    // 机腹浅灰
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 20, 1, true, Math.PI * 1.15, Math.PI * 0.7), M.belly);
    belly.rotation.x = -Math.PI / 2;
    belly.position.z = 1.5;
    plane.add(belly);

    // 侧窗带 + 舷窗
    [-1, 1].forEach((sx) => {
      const winBand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 26), M.glass);
      winBand.position.set(sx * 2.44, 0.72, 1.6);
      plane.add(winBand);
      const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 8, 6), M.glass, 26);
      const mtx = new THREE.Matrix4();
      for (let i = 0; i < 20; i++) {
        mtx.makeTranslation(sx * 2.5, 0.72, -10 + i * 1.02);
        dots.setMatrixAt(i, mtx);
      }
      plane.add(dots);
    });

    // 蓝色腰线
    [-1, 1].forEach((sx) => {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 30), M.stripe);
      line.position.set(sx * 2.5, 0.06, 1.2);
      plane.add(line);
    });

    // 驾驶舱风挡
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(2.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.glass);
    cockpit.scale.set(1, 0.74, 1.5);
    cockpit.position.set(0, 1.3, -14.4);
    plane.add(cockpit);
    // 风挡分框
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.7), M.belly);
    pillar.position.set(0, 1.2, -15.6);
    plane.add(pillar);
    const radome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 10), M.belly);
    radome.scale.set(1, 0.8, 1.1);
    radome.position.set(0, -0.3, -21.2);
    plane.add(radome);

    // 垂尾
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(6.4, 0);
    finShape.lineTo(4.2, 7.4);
    finShape.lineTo(1.2, 7.4);
    finShape.quadraticCurveTo(0.2, 4.4, 0, 0);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.42, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 2 });
    const fin = new THREE.Mesh(finGeo, M.fuselage);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(-0.21, 2.1, 14.6);
    fin.castShadow = true;
    plane.add(fin);
    // 垂尾上的航司色块
    const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 3.4), M.stripe);
    finStripe.position.set(0, 3.4, 18.4);
    finStripe.rotation.z = 0;
    plane.add(finStripe);

    // 平尾
    [-1, 1].forEach((sx) => {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.22, 2.6), M.fuselage);
      tail.position.set(sx * 3.9, 0.5, 19.4);
      tail.rotation.z = sx * 0.06;
      tail.rotation.y = sx * 0.14;
      tail.castShadow = true;
      plane.add(tail);
    });

    // 主翼（带上反角与后掠）
    const wingShape = new THREE.Shape();
    // 本地 +Z 为机身后方（机头朝 -Z），所以后缘用正 Z
    wingShape.moveTo(0, -3.2);          // 翼根前缘
    wingShape.lineTo(15.5, 3.6);        // 翼尖前缘（后掠）
    wingShape.lineTo(15.5, 6.1);        // 翼尖后缘
    wingShape.lineTo(0, 2.4);           // 翼根后缘
    wingShape.lineTo(0, -3.2);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.34, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    wingGeo.rotateY(Math.PI / 2);       // 让翼展沿 X 方向
    wingGeo.translate(0, 0, 0);

    const wings = new THREE.Group();
    [-1, 1].forEach((sx) => {
      const w = new THREE.Mesh(wingGeo, M.fuselage);
      w.position.set(sx * 2.2, -0.4, 2.2);
      w.scale.x = sx;
      w.rotation.z = sx * 0.055;       // 上反角
      w.castShadow = true;
      w.receiveShadow = true;
      wings.add(w);
      // 翼尖小翼
      const shark = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.9, 1.5), M.stripe);
      shark.position.set(sx * 17.6, 0.6, 6.0);
      shark.rotation.z = sx * -0.16;
      wings.add(shark);
    });
    plane.add(wings);

    // 发动机吊舱
    const engines = [];
    [-1, 1].forEach((sx) => {
      const nac = new THREE.Group();
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.12, 5.4, 18), M.engine);
      pod.rotation.x = Math.PI / 2;
      pod.castShadow = true;
      nac.add(pod);
      const cowl = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.16, 8, 20), M.stripe);
      cowl.position.z = -2.6;
      nac.add(cowl);
      const fan = new THREE.Mesh(new THREE.CircleGeometry(1.12, 20), M.glass);
      fan.position.z = -2.66;
      fan.rotation.y = Math.PI;
      nac.add(fan);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 2.4), M.fuselage);
      pylon.position.set(sx * -0.2, 1.1, 0.4);
      nac.add(pylon);
      nac.position.set(sx * 7.6, -1.42, -1.4);
      plane.add(nac);
      engines.push(nac);
    });

    // 翼梢闪烁灯
    const navL = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), M.red);
    navL.position.set(-17.4, 0.65, 6.4);
    plane.add(navL);
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), M.light);
    navR.position.set(17.4, 0.65, 6.4);
    plane.add(navR);
    const strobe = new THREE.PointLight(0xffffff, 0, 60, 2);
    strobe.position.set(0, -1.2, 8);
    plane.add(strobe);

    /* 起落架：前起落架 + 两组主起落架 */
    // 模型原点在机腹附近；放下起落架后轮胎最低点正好落在 y = -2.2（= 机身相对地面的高度）
    const R_TYRE = 0.62;
    const GEAR_TOP = -1.05;   // 起落架挂点（机身局部坐标）
    function gearLeg(x, z, len) {
      const g = new THREE.Group();
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, len, 8), M.strut);
      strut.position.y = -len / 2;
      strut.castShadow = true;
      g.add(strut);
      const wheels = x === 0 ? 1 : 2;
      const wheelY = -len - R_TYRE;
      for (let w = 0; w < wheels; w++) {
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R_TYRE, R_TYRE, 0.46, 16), M.tyre);
        tyre.rotation.z = Math.PI / 2;
        tyre.position.set(wheels === 1 ? 0 : (w ? 0.34 : -0.34), wheelY, wheels === 1 ? 0 : (w ? 0.85 : -0.85));
        tyre.castShadow = true;
        tyre.userData.isWheel = true;
        g.add(tyre);
      }
      if (wheels === 2) {
        const axle = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 1.9), M.strut);
        axle.position.y = wheelY;
        g.add(axle);
      }
      g.position.set(x, GEAR_TOP, z);
      return g;
    }
    // 轮胎最低点落在模型局部 y = -GROUND_Y 处，落地时正好贴住跑道
    const noseGear = gearLeg(0, -14.4, 0.42);
    const mainLeft = gearLeg(-2.55, 1.8, 0.42);
    const mainRight = gearLeg(2.55, 1.8, 0.42);
    const gear = [noseGear, mainLeft, mainRight];
    gear.forEach((g) => plane.add(g));

    // 襟翼：挂在主翼后缘的窄条，沿本地 X 轴下偏
    const flaps = [];
    [-1, 1].forEach((sx) => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 9.6, 0.24, 8.1);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.16, 2.3), M.belly);
      flap.position.z = 1.2;
      flap.castShadow = true;
      pivot.add(flap);
      wings.add(pivot);
      flaps.push(pivot);
    });

    const wheels = [];
    gear.forEach((g) => g.traverse((o) => { if (o.userData && o.userData.isWheel) wheels.push(o); }));
    plane.userData = { wheels: wheels, flaps: flaps, engines: engines, strobe: strobe, gear: gear };

    plane.scale.setScalar(1.0);
    return plane;
  }

  const plane = buildAirplane();
  scene.add(plane);

  /* 轮胎烟 / 接地尘土 */
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);
  const puffs = [];
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 1, transparent: true, opacity: 0 }));
    m.visible = false;
    scene.add(m);
    puffs.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, scale: 1 });
  }
  function burstPuffs(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const p = puffs.find((q) => q.life <= 0);
      if (!p) return;
      p.life = 1;
      p.mesh.visible = true;
      p.mesh.position.set(x + (Math.random() - 0.5) * 2.4, y, z + (Math.random() - 0.5) * 2.4);
      p.vx = (Math.random() - 0.5) * 5;
      p.vy = 1.5 + Math.random() * 2.6;
      p.vz = (Math.random() - 0.5) * 5;
      p.scale = 0.7 + Math.random() * 0.9;
    }
  }

  /* ───────────────────────── 飞行时间线（秒） ───────────────────────── */
  const TOTAL = 26;
  const TOUCHDOWN = 16.9;      // 主轮接地
  const GROUND_Y = 2.71;      // 机身原点离地高度（轮胎最低点 = 0）

  // 位置：x, 离地高度, z。飞机沿 +Z 方向进近，最后沿跑道停稳。
  const POS = [
    { t: 0, v: [-420, 236, -1250] },
    { t: 4, v: [-320, 182, -1020] },
    { t: 8, v: [-190, 122, -760] },
    { t: 11, v: [-92, 70, -520] },
    { t: 13.4, v: [-26, 31, -300] },
    { t: 15.3, v: [-4, 9.5, -142] },
    { t: 16.5, v: [0, 1.6, -86] },
    { t: TOUCHDOWN, v: [0, 0, -62] },
    { t: 20, v: [0, 0, 150] },
    { t: 23.5, v: [0, 0, 302] },
    { t: 26, v: [0, 0, 382] }
  ];
  // 航向修正：进近时略微右偏，接地前对正跑道（0 = 正对跑道）
  const YAW = [
    { t: 0, v: [0.30] }, { t: 8, v: [0.26] }, { t: 12, v: [0.10] },
    { t: 14, v: [0.02] }, { t: 26, v: [0.0] }
  ];
  // 俯仰：巡航 → 下滑 → 拉平 → 滑跑
  const PITCH = [
    { t: 0, v: [0.045] }, { t: 6, v: [0.02] }, { t: 12.5, v: [-0.075] },
    { t: 14.6, v: [-0.10] }, { t: 16.2, v: [0.055] }, { t: TOUCHDOWN, v: [0.012] },
    { t: 18.4, v: [-0.012] }, { t: 21, v: [0.012] }, { t: 26, v: [0.0] }
  ];
  // 横滚：五边转弯时压坡度
  const ROLL = [
    { t: 0, v: [-0.26] }, { t: 5, v: [-0.20] }, { t: 10, v: [-0.10] },
    { t: 13, v: [0.0] }, { t: 26, v: [0.0] }
  ];
  // 起落架展开 0→1
  const GEAR = [
    { t: 0, v: [0] }, { t: 8.5, v: [0] }, { t: 11.2, v: [1] }, { t: 26, v: [1] }
  ];
  // 襟翼 0→1
  const FLAPS = [
    { t: 0, v: [0] }, { t: 5.5, v: [0] }, { t: 8.5, v: [0.55] }, { t: 12, v: [1] }, { t: 26, v: [1] }
  ];
  // 指示空速（km/h）
  const SPEED = [
    { t: 0, v: [268] }, { t: 14, v: [246] }, { t: TOUCHDOWN, v: [248] }, { t: 21, v: [88] }, { t: 26, v: [10] }
  ];

  /* 相机：相对飞机的位置偏移 + 注视点偏移，保证飞机始终在画面里 */
  const CAM_OFF = [
    { t: 0, v: [-150, 76, 152, 0, 1.6, 0] },
    { t: 4, v: [-126, 62, 124, 0, 1.4, 0] },
    { t: 8, v: [-100, 50, 98, 0, 1.4, 0] },
    { t: 11, v: [-78, 38, 76, 0, 1.4, 0] },
    { t: 13.4, v: [-74, 32, 66, 0, 1.5, 0] },
    { t: 15.3, v: [-48, 17, 34, 0, 1.2, 0] },
    { t: TOUCHDOWN, v: [-64, 12, -16, 0, 0.6, 6] },
    { t: 20, v: [-70, 16, -4, 0, 0.6, 8] },
    { t: 23.5, v: [-60, 19, 28, 0, 0.8, 10] },
    { t: 26, v: [-42, 22, 66, 0, 1.0, 12] }
  ];

  /* ───────────────────────── 交互 ───────────────────────── */
  let t = reduced ? TOUCHDOWN + 0.2 : 0;
  let playing = !reduced;
  let camBlend = 0;      // 用户拖动后叠加的相机偏移
  let yawOff = 0, pitchOff = 0, distOff = 0;
  let dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yawOff += (e.clientX - lastX) * 0.005;
    pitchOff = clamp(pitchOff + (e.clientY - lastY) * 0.003, -0.5, 0.7);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    distOff = clamp(distOff + e.deltaY * 0.22, -90, 420);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); playing = !playing; syncUI(); }
    if (e.key === 'r' || e.key === 'R') { t = 0; playing = true; syncUI(); }
  });

  /* 进度条与状态标签（可选，存在才更新） */
  const bar = mount.querySelector('[data-air-progress]');
  const label = mount.querySelector('[data-air-status]');
  const btn = mount.querySelector('[data-air-toggle]');
  const phaseEl = mount.querySelector('[data-air-phase]');
  function phaseName(tt) {
    if (tt < 5) return '巡航 · 进近移交';
    if (tt < 8.5) return '下降 · 五边转弯';
    if (tt < 12) return '放起落架 · 襟翼 15°';
    if (tt < 14.8) return '最后进近 · 襟翼 30°';
    if (tt < TOUCHDOWN) return '拉平 Flare';
    if (tt < 19.5) return '接地 · 反推减速';
    if (tt < 23) return '脱离跑道';
    return '停稳 · 关车';
  }
  function syncUI() {
    if (btn) btn.textContent = playing ? '暂停' : '继续';
  }
  if (btn) btn.addEventListener('click', () => { playing = !playing; syncUI(); });
  const replay = mount.querySelector('[data-air-replay]');
  if (replay) replay.addEventListener('click', () => { t = 0; playing = true; syncUI(); });
  syncUI();

  /* ───────────────────────── 自适应尺寸 ───────────────────────── */
  function resize() {
    const w = mount.clientWidth || 960;
    const h = mount.clientHeight || 540;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(mount);
  else window.addEventListener('resize', resize);

  /* 可见性：离开视口时暂停渲染 */
  let visible = true;
  if (window.IntersectionObserver) {
    new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }, { threshold: 0.01 }).observe(mount);
  }

  /* ───────────────────────── 主循环 ───────────────────────── */
  const tmpA = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();
  let last = performance.now();
  let puffClock = 0;

  function update(dt) {
    if (playing) {
      t += dt;
      if (t > TOTAL + 3) { t = 0; }
    }
    const tt = Math.min(t, TOTAL);

    /* 飞机姿态与位置 */
    const pos = track(POS, tt);
    const yaw = track(YAW, tt)[0];
    const pitch = track(PITCH, tt)[0];
    const roll = track(ROLL, tt)[0];
    plane.position.set(pos[0], GROUND_Y + pos[1], pos[2]);
    plane.rotation.set(pitch, Math.PI + yaw, roll, 'YXZ');   // 模型机头朝 -Z，故加 π

    /* 起落架收放 */
    const gearK = track(GEAR, tt)[0];
    plane.userData.gear.forEach((g, i) => {
      const tilt = (1 - gearK) * Math.PI * 0.5;
      g.rotation.x = tilt * (i === 0 ? 1 : -1);
      g.visible = gearK > 0.02;
    });

    /* 襟翼 */
    const flapK = track(FLAPS, tt)[0];
    plane.userData.flaps.forEach((f) => { f.rotation.x = flapK * 0.5; });

    /* 轮胎滚动 */
    const speed = track(SPEED, tt)[0];
    const spin = (speed / 3.6) * dt / 0.62;
    plane.userData.wheels.forEach((w) => { w.rotation.x += spin; });
    plane.userData.engines.forEach((e) => { e.children[2].rotation.z += dt * (2 + speed * 0.05); });

    /* 接地扬尘 */
    if (tt > TOUCHDOWN - 0.05 && tt < TOUCHDOWN + 1.4) {
      puffClock -= dt;
      if (puffClock <= 0) {
        puffClock = 0.05;
        burstPuffs(0, 0.5, pos[2] - 1.2, 1);
        burstPuffs(-2.9, 0.5, pos[2] + 1.6, 1);
        burstPuffs(2.9, 0.5, pos[2] + 1.6, 1);
      }
    }

    /* 尾部水汽/尾迹：高速时淡淡的拖尾 */
    cloudSeed.forEach((c, i) => {
      c.g.position.x += c.speed * dt * 1.2;
      if (c.g.position.x > 1500) c.g.position.x = -1500;
    });

    /* 塔台信标闪烁 + 机翼频闪灯 */
    const phase = (performance.now() / 1000) % 1.6;
    scene.traverse((o) => {
      if (o.name === 'beacon') o.material.emissiveIntensity = phase < 0.12 ? 4 : 0.4;
    });
    plane.userData.strobe.intensity = phase < 0.06 ? 26 : 0;

    /* 相机：以飞机为原点的偏移机位，叠加拖拽（环绕）与滚轮（推拉） */
    const co = track(CAM_OFF, tt);
    const look = tmpLook.set(plane.position.x + co[3] * 0, plane.position.y + co[4], plane.position.z + co[5]);
    const camYaw = yawOff + (reduced ? 0 : Math.sin(tt * 0.05) * 0.035);
    const distBoost = 1 + distOff * 0.0022;
    tmpA.set(co[0], co[1] + pitchOff * 60, co[2]).multiplyScalar(distBoost);
    const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
    const rx = tmpA.x * cs - tmpA.z * sn;
    const rz = tmpA.x * sn + tmpA.z * cs;
    camera.position.set(look.x + rx, Math.max(1.6, look.y + tmpA.y), look.z + rz);
    camera.lookAt(look);

    /* 阴影相机跟随飞机，保证机身与跑道都有清晰阴影 */
    sun.target.position.set(plane.position.x, 0, plane.position.z);
    sun.position.set(plane.position.x - 420, 200, plane.position.z + 660);

    /* 烟 */
    puffs.forEach((p) => {
      if (p.life <= 0) return;
      p.life -= dt * 0.55;
      if (p.life <= 0) { p.mesh.visible = false; return; }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= dt * 1.2;
      const s = p.scale * (1.4 - p.life) * 2.2;
      p.mesh.scale.setScalar(Math.max(0.01, s));
      p.mesh.material.opacity = p.life * 0.42;
    });

    /* UI */
    if (bar) bar.style.width = (clamp(tt / TOTAL, 0, 1) * 100).toFixed(2) + '%';
    if (label) {
      const el = Math.round(pos[1]);
      label.textContent = '高度 ' + el.toString().padStart(3, '0') + ' m · ' + Math.round(speed) + ' km/h';
    }
    if (phaseEl) phaseEl.textContent = phaseName(tt);
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (visible) {
      update(dt);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 暴露少量内部状态，方便调试/截图
  window.__airplaneLanding = {
    setTime: function (v) { t = v; },
    pause: function () { playing = false; syncUI(); },
    play: function () { playing = true; syncUI(); },
    total: TOTAL,
    scene: scene,
    camera: camera,
    renderer: renderer
  };
})();
