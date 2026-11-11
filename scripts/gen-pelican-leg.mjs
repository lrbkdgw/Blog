/**
 * 「鹈鹕骑车」SVG 的腿部关键帧生成器：`node scripts/gen-pelican-leg.mjs`
 *
 * 纯 CSS 没法做反向运动学，所以这里离线把「脚踩在转动的脚踏上」解算成
 * 大腿 / 小腿 / 脚掌三段的旋转角，按曲柄一圈等分采样成 @keyframes，
 * 再写回 src/assets/pelican-bicycle.svg 里 `IK:BEGIN` 与 `IK:END` 两行标记之间。
 * 改了髋部位置、腿长、曲柄长度或中轴坐标后重新跑一遍即可，SVG 其余部分手写维护。
 *
 * 坐标系与 SVG 一致：x 向右、y 向下，正角度为顺时针；曲柄角 0° 指向正前方（3 点钟）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'src/assets/pelican-bicycle.svg')

/** 与 SVG 中的几何保持一致（改这里的同时要改 SVG 里对应的 translate） */
export const RIG = {
  hip: [356, 226], // 髋关节（藏在腹部羽毛下）
  bottomBracket: [378, 350], // 中轴
  crank: 22, // 曲柄长度
  ankleOffset: [-3, -8], // 踝关节相对脚踏中心的偏移
  thigh: 72,
  shin: 72,
  steps: 24,
}

const deg = (rad) => (rad * 180) / Math.PI
const rad = (d) => (d * Math.PI) / 180

export function solveLeg(crankDeg, rig = RIG) {
  const a = rad(crankDeg)
  const fx = rig.bottomBracket[0] + rig.crank * Math.cos(a) + rig.ankleOffset[0]
  const fy = rig.bottomBracket[1] + rig.crank * Math.sin(a) + rig.ankleOffset[1]
  const dx = fx - rig.hip[0]
  const dy = fy - rig.hip[1]
  const reach = rig.thigh + rig.shin
  const d = Math.min(Math.hypot(dx, dy), reach - 0.01)
  const base = Math.atan2(dy, dx)
  const alpha = Math.acos((rig.thigh ** 2 + d ** 2 - rig.shin ** 2) / (2 * rig.thigh * d))
  const thigh = base - alpha // 膝盖朝前（-x→+x 方向弯）
  const kx = rig.hip[0] + rig.thigh * Math.cos(thigh)
  const ky = rig.hip[1] + rig.thigh * Math.sin(thigh)
  const shinAbs = Math.atan2(fy - ky, fx - kx)
  // 脚掌：下踩时脚尖略向下、提拉时略上翘
  const footAbs = rad(5 + 10 * Math.sin(a))
  return {
    thigh: deg(thigh),
    shin: deg(shinAbs - thigh),
    foot: deg(footAbs - shinAbs),
    knee: [kx, ky],
    ankle: [fx, fy],
  }
}

export function buildKeyframes(rig = RIG) {
  const frames = []
  for (let i = 0; i <= rig.steps; i++) frames.push(solveLeg((360 * i) / rig.steps, rig))
  const block = (name, key) =>
    `    @keyframes ${name} {\n` +
    frames
      .map((f, i) => {
        const pct = ((100 * i) / rig.steps).toFixed(4).replace(/\.?0+$/, '')
        return `      ${pct}% { transform: rotate(${f[key].toFixed(2)}deg) }`
      })
      .join('\n') +
    '\n    }'
  return [block('pb-thigh', 'thigh'), block('pb-shin', 'shin'), block('pb-foot', 'foot')].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const svg = readFileSync(svgPath, 'utf8')
  const re = /(\/\* IK:BEGIN[^\n]*\*\/\n)[\s\S]*?([ \t]*\/\* IK:END \*\/)/
  if (!re.test(svg)) {
    console.error('找不到 IK:BEGIN / IK:END 标记，未写入。')
    process.exit(1)
  }
  writeFileSync(svgPath, svg.replace(re, (_, head, tail) => `${head}${buildKeyframes()}\n${tail}`))
  const f0 = solveLeg(0)
  console.log(`已写回 ${svgPath}`)
  console.log(`曲柄 0° 时：膝 (${f0.knee.map((v) => v.toFixed(1))})，踝 (${f0.ankle.map((v) => v.toFixed(1))})`)
}
