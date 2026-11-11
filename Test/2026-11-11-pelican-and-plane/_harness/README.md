# 验收脚本（无头 Chromium）

沙箱里没有中文字体，截图里的中文曾经是空白 —— 现在页面已经内嵌了子集字体
（`../src/05-fonts.css`，由 `@fontsource/noto-sans-sc` 的子集裁出来，约 150 KB）。
如果以后页面文案变了、新出现的汉字显示成方框，重新生成一次即可：

```bash
npm i @fontsource/noto-sans-sc      # 有中文字体子集可以用
# 用 fontTools 把页面里出现过的汉字裁成 woff2，再 base64 内联（见 src/05-fonts.css）
```

## 依赖

```bash
npm i @sparticuz/chromium puppeteer-core
```

（`node_modules/` 已被 .gitignore 排除，换机器要重装。）

## 脚本

| 脚本 | 用途 |
| --- | --- |
| `node grid.mjs out.png 3 440 250 "cam:tod:t;..."` | 把多组镜头拼成一张对照表，最常用 |
| `node mobile.mjs 390 844 out.png dusk 18 [cam]` | 指定视口尺寸截一张（检查竖屏布局，机位默认 auto） |
| `node live.mjs` | 不暂停地真实播放，看首帧淡入与自动播放 |
| `node params.mjs` | 逐个验证地址参数（t / cam / tod / speed / paused / ui / q） |
| `node sheet.mjs <html> <outDir> "cam:tod:t;..."` | 每张单独存文件 |
| `node ortho.mjs side,front,top` | 正交三视图，检查模型比例 |
| `node crop.mjs cam tod t x y w h out scale` | 放大画面局部看细节 |
| `node pix.mjs cam:tod:t '[[x,y,"名字"],...]'` | 采样指定像素的颜色 |
| `node svg.mjs 960 540 out.png 1.6` | 截鹈鹕 SVG（参数是停留秒数） |
| `node click.mjs` | 模拟点击机位/天色/拖动时间轴 |

跑之前需要：

```bash
export AWS_EXECUTION_ENV='AWS_Lambda_nodejs22.x'   # @sparticuz/chromium 解压时要
```

`FONTCONFIG_PATH` 各脚本里已写死为 `/tmp/fonts`，那个目录是空的也没关系
（页面自带字体）。
