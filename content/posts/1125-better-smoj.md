---
title: "Better SMOJ"
date: "2026-11-25"
updated: "2026-11-25"
summary: "SMOJ 优化插件。"
---

[Previous ver.](https://lscminxi.github.io/2026/11/25/smoj/)

由 GPT 大人修改，花费 2.9 cny。~~GPT 的审美还是一如既往地烂~~。

有 Bug 或建议可以在评论区反馈，可能 100 万年后会修。

:::info[ChangeLog]{open}

1. 提交记录列表：修复内外两层容器重复套用卡片样式的问题。横向滚动交给外层记录容器，窄屏可以在卡片内滑动查看右侧列，避免内容被裁掉或把整页撑宽。评测耗时、内存、代码长度等字段和数据未改动。
2. 在线编程入口（smoj1）：补齐进入和退出按钮的圆角、上下间隔和两侧留白；即使卡片内距设为 0，入口仍保留最小留白。将原来的贴边深红底改为随主题变化的强调色背景，保留原有快捷键。
3. 侧栏菜单：统一菜单项常态、悬浮和选中时的圆角；去掉悬浮时左侧的蓝条（smoj2）。长文字可以换行，键盘聚焦时保留可见轮廓。
4. 卡片动效：移除卡片悬浮上浮和整张卡片变亮，同时移除对应设置项。恢复 Hydro 原有的入场淡入和位移动画。
5. 不透明度：将“全局透明度”和各板块的“透明度”改为“不透明度”，范围统一为 20%–100%；旧配置或导入配置低于 20% 时自动上调。“边框透明度”也改名为“边框不透明度”，仍可设为 0%。
6. 卡片内距：修复紧凑模式把内距固定为 8px 的问题；标题栏、正文、菜单、表格外层和没有标准正文容器的卡片都能应用内距。相邻标题和正文之间避免重复叠加留白。
7. 边框与阴影：关闭边框后，边框宽度也归零；关闭阴影后，共用样式的卡片、媒体外框和浮动按钮不再保留独立阴影。
8. 全局背景：关闭背景层时恢复站点原有背景，不再继续把页面容器强制设为透明。清除背景图片时，图片和输入框里的 URL 一起清空；切换主题时会取消尚未完成的旧图片检查。
9. 深浅色对比度：站点主题和脚本卡片主题不一致时，调整卡片标题、表单标签和普通菜单链接的文字颜色。强调色按钮会根据背景明暗选用深色或白色文字。
10. 浮动按钮：设置按钮改为圆形，跟随全局不透明度、强调色、模糊、边框和阴影。站点搜索按钮也统一为圆形，保留 Ctrl+K；私信页未额外移动按钮。
11. 设置面板：标签页可自动换行，特别矮的窗口会收紧标题、标签栏和底栏。面板避开屏幕边缘和系统安全区；输入框、下拉选项、提示文字、状态框和预设按钮适配深浅色，长预设名称可换行。
12. 设置面板键盘操作：打开后聚焦当前标签；在面板内按 Esc 可关闭并将焦点还给设置按钮。辅助读屏可识别面板展开状态、当前标签和滑块数值及单位。
13. 题库搜索（smoj4）：搜索框、题目计数、排序和提交按钮合为一条圆角搜索栏。控件按布局顺序排列，不再盖住输入文字；搜索栏宽度不足时，题目计数单独换行。
14. 题库表格：搜索、列表和上下分页统一到一层卡片，移除表格周围的重复边框和阴影。减弱条纹和分隔线，统一表头、行距及悬浮底色；长题名可换行，状态、难度和统计列保持整列易读。窄屏从表格内部横向滚动，保留编辑模式、评测状态色和原有表头行为。
15. 题库小控件：统一题目标签、分类标签、显示／隐藏标签入口、分页、进出编辑模式及“试试手气”的配色和交互状态；分页当前页使用强调色，标签和按钮文字过长时可换行。
16. 题目详情：题型、时限、内存、难度等信息改为圆角标签，宽度不足时自动换行。题面里的长代码和样例在代码块内横向滚动，避免撑宽正文。
17. 比赛与题单题号（smoj5）：取消题号的绝对定位，让它与题目标题并排或换行；窄屏下仍显示，且按钮尺寸更大。当前题用强调色，已通过、未通过和评测中用不同颜色和圆点区分，题号始终显示。读屏也能读出题号和状态。
18. 学术导航：顶部“学术”和分类菜单标明当前位置；窄屏的分类按钮补齐可读名称和抽屉关联。保留原有入口、分类跳转与搜索行为。
19. 学术页样式：学术卡片、侧栏、标题、分类按钮和写文章入口统一配色。搜索、分类和公告弹窗跟随学术板块圆角与模糊设置，并限制在视口内；窄屏工具栏可换行，链接及控件有可见的键盘焦点。
20. 私信会话：会话外框跟随全局不透明度、圆角、模糊、边框和阴影；联系人行改为带留白的圆角样式，区分悬浮和选中状态。收发气泡使用不同底色，链接和消息内代码块也跟随主题。
21. 私信控件：适配联系人搜索、消息搜索弹窗、通知菜单、会话工具按钮、回到最新消息、输入区、预览和发送按钮。输入区域聚焦时用强调色提示，窄屏工具栏可换行，保留原有列表与会话切换。
22. 页面布局：仅对识别到的主内容与侧栏应用自定义单双栏。宽屏调整侧栏比例时同步调整主栏宽度；窄屏减小页面留白。进入在线编程时让出原生布局，退出后恢复自定义设置。
23. 媒体外框与识别：不再给编辑器、可编辑区域或菜单按钮里的媒体套外框。卡片或表格结构变化后清除过期样式，避免动态更新后留下错误外框。
24. 配置兼容与保存：保留原有设置和自定义方案；读取旧配置、导入文件或套用自定义方案时校验数值和颜色，无效值回退到默认值。拖动滑块即时预览，操作结束时保存并记录撤销历史；相同配置不重复写入。导出的 JSON 文件名包含当前版本号。
25. 页面更新效率：同一帧内的多次页面变化合并扫描，忽略设置面板、提示和媒体外框自身引发的变化。调整滑块时复用已识别的卡片，不再反复扫描整页。

:::

:::success[Code]
```
// ==UserScript==
// @name         Hydro UI Beautifier
// @namespace    https://zsoj.gbfish.cn/
// @version      1.7.7
// @description  Hydro 全站美化
// @author       lrbkdgw
// @match        https://zsoj.gbfish.cn/*
// @match        http://10.3.44.224/*
// @match        https://10.3.44.224/*
// @match        https://hydro.ac/*
// @match        https://oier.group/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';
    // 沿用 v1.7 的保护标记、存储键，保留现有配置和自定义方案。
    if (window.__HYDRO_BEAUTIFIER_V170__) return;
    window.__HYDRO_BEAUTIFIER_V170__ = true;

    const VERSION = '1.7.7';
    const KEY = 'hydro_beautifier_v170';
    const OLD_KEYS = ['hydro_beautifier_v160', 'hydro_beautifier_v150', 'hydro_beautifier_v141', 'hydro_beautifier_v14', 'hydro_beautifier_v13', 'hydro_beautifier_v12', 'hydro_beautifier_v11'];
    const PRESET_KEY = KEY + '_presets';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const clone = x => JSON.parse(JSON.stringify(x));
    const GROUPS = ['native', 'table', 'side', 'academic'];
    const MIN_CARD_OPACITY = 20;
    const DEFAULTS = {
        enabled: true, image: '', background: '#171923', backgroundMode: 'image',
        gradientA: '#202b48', gradientB: '#11131e', gradientAngle: 135,
        opacity: 100, bgBlur: 0, overlay: 18, overlayColor: '#000000',
        bgPosition: 'center', bgSize: 'cover', saturation: 100, brightness: 100, contrast: 100, noise: false,
        dark: true, accent: '#7186f5', transparent: true, border: true, borderOpacity: 12, borderWidth: 1,
        shadow: true, shadowStrength: 28,
        radius: 16, cardOpacity: 86, blur: 12, cardPadding: 16, mediaFrames: true, mediaFramePadding: 5,
        nativeFollowGlobal: true, nativeOpacity: 86, nativeBlur: 12, nativeRadius: 16,
        tableFollowGlobal: true, tableOpacity: 86, tableBlur: 12, tableRadius: 16,
        sideFollowGlobal: true, sideOpacity: 86, sideBlur: 12, sideRadius: 16,
        academicFollowGlobal: true, academicOpacity: 86, academicBlur: 12, academicRadius: 16,
        layoutEnabled: true, width: 1440, gap: 18, sideWidth: 27, layoutMode: 'auto', compact: false,
        striped: true, fontScale: 100, preset: 'midnight'
    };
    const THEMES = {
        midnight: { accent: '#7186f5', background: '#171923', dark: true, cardOpacity: 86, blur: 12, overlay: 18 },
        oled: { accent: '#a78bfa', background: '#050505', dark: true, cardOpacity: 94, blur: 8, overlay: 5 },
        forest: { accent: '#55aa85', background: '#182c29', dark: true, cardOpacity: 86, blur: 16, overlay: 20 },
        ocean: { accent: '#45a9dc', background: '#102332', dark: true, cardOpacity: 82, blur: 16, overlay: 20 },
        light: { accent: '#4778d5', background: '#e9edf5', dark: false, cardOpacity: 90, blur: 12, overlay: 0 }
    };

    function mergedSettings(src) {
        const s = { ...DEFAULTS };
        for (const [key, fallback] of Object.entries(DEFAULTS)) {
            if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
            const value = src[key];
            if (typeof fallback === 'number') {
                if (value !== '' && (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value))) s[key] = Number(value);
            } else if (typeof value === typeof fallback) s[key] = value;
        }
        for (const key of ['cardOpacity', ...GROUPS.map(g => g + 'Opacity')]) s[key] = Math.min(100, Math.max(MIN_CARD_OPACITY, s[key]));
        s.cardPadding = Math.min(36, Math.max(0, s.cardPadding));
        for (const key of ['accent', 'background', 'gradientA', 'gradientB', 'overlayColor']) {
            if (!/^#[\da-f]{6}$/i.test(s[key])) s[key] = DEFAULTS[key];
        }
        return s;
    }
    function loadSettings() {
        for (const k of [KEY, ...OLD_KEYS]) {
            try {
                const raw = localStorage.getItem(k);
                if (!raw) continue;
                const obj = JSON.parse(raw);
                const src = obj?.settings && typeof obj.settings === 'object' ? obj.settings : obj;
                if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
                const s = mergedSettings(src);
                if (k !== KEY) {
                    const legacy = { native: [86,12,14], table: [82,10,14], side: [82,12,14], academic: [86,12,14] };
                    for (const [g, values] of Object.entries(legacy)) {
                        if (['Opacity','Blur','Radius'].every((p, i) => Number(s[g+p]) === values[i])) s[g+'FollowGlobal'] = true;
                    }
                }
                return s;
            } catch (e) { console.warn('[HB] 配置读取失败：', k, e); }
        }
        return clone(DEFAULTS);
    }
    let settings = loadSettings();
    let customPresets = {};
    try {
        const x = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
        if (x && typeof x === 'object' && !Array.isArray(x)) customPresets = x;
    } catch (e) { console.warn('[HB] 方案读取失败', e); }
    function save() {
        try {
            const next = JSON.stringify(settings);
            if (localStorage.getItem(KEY) !== next) localStorage.setItem(KEY, next);
        }
        catch (e) { console.warn('[HB] 保存失败', e); toast('保存失败：浏览器存储空间可能不足'); }
    }
    function savePresets() {
        try { localStorage.setItem(PRESET_KEY, JSON.stringify(customPresets)); }
        catch (e) { console.warn('[HB] 方案保存失败', e); toast('方案保存失败'); }
    }
    function rgba(hex, alpha) {
        let h = String(hex || '#000000').replace('#', '');
        if (h.length === 3) h = h.split('').map(x => x + x).join('');
        const n = parseInt(h, 16);
        return Number.isFinite(n) ? `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})` : `rgba(0,0,0,${alpha})`;
    }
    function accentInk(hex, alpha = 1) {
        const n = parseInt(hex.slice(1), 16), base = settings.dark ? [29,32,45] : [250,251,255];
        const luma = [16,8,0].reduce((sum, shift, i) => {
            const c = ((n >> shift & 255) * alpha + base[i] * (1 - alpha)) / 255;
            return sum + [0.2126,0.7152,0.0722][i] * (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        }, 0);
        return luma > .179 ? '#13151d' : '#fff';
    }
    function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    const bg = document.createElement('div');
    bg.id = 'hb170-background';
    bg.innerHTML = '<div class="hb170-bg-image"></div><div class="hb170-bg-noise"></div><div class="hb170-bg-overlay"></div>';
    const bgImage = $('.hb170-bg-image', bg), bgOverlay = $('.hb170-bg-overlay', bg), bgNoise = $('.hb170-bg-noise', bg);
    const style = document.createElement('style');
    style.id = 'hb170-style';
    style.textContent = `
:root{--hb-accent:#7186f5;--hb-global-bg:rgba(29,32,45,.86);--hb-global-blur:12px;--hb-global-radius:16px;--hb-global-border:rgba(255,255,255,.12);--hb-global-shadow:0 8px 28px rgba(0,0,0,.28);--hb-global-padding:16px;--hb-page-width:1440px;--hb-layout-gap:18px}
#hb170-background{position:fixed!important;inset:0!important;z-index:-1!important;pointer-events:none!important;overflow:hidden!important;background:#171923}
#hb170-background .hb170-bg-image{position:absolute;inset:-2%;background-position:center;background-size:cover;background-repeat:no-repeat;will-change:filter;transform:translateZ(0)}
#hb170-background .hb170-bg-overlay{position:absolute;inset:0}
#hb170-background .hb170-bg-noise{position:absolute;inset:0;opacity:.055;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E")}
html.hb170-bg-active{min-height:100%;background:transparent!important}
body.hb170-bg-active{min-height:100vh;min-height:100dvh;background:transparent!important;isolation:isolate}
/* 吸底使用实际共同父容器（Hydro 通常是 #panel），不是强制 body。 */
.hb170-sticky-shell{display:flex!important;flex-direction:column!important;box-sizing:border-box!important;min-height:calc(100vh - var(--hb-shell-offset,0px))!important;min-height:calc(100dvh - var(--hb-shell-offset,0px))!important}
.hb170-sticky-shell>.hb170-sticky-main{flex:1 0 auto!important;min-height:0}
.hb170-sticky-shell>.hb170-sticky-footer{margin-top:auto!important;flex-shrink:0!important;width:100%}
body.hb170-transparent .main,body.hb170-transparent #panel,body.hb170-transparent .slideout-panel{background:transparent!important}
body.hb170-layout:not(.mode--scratchpad) .main{max-width:var(--hb-page-width)!important;width:calc(100% - 32px)!important;margin-inline:auto!important}
/* Hydro 使用浮动栅格，column-gap 对 float 不生效。以半栏距作为每列的左右内边距。 */
body.hb170-layout:not(.mode--scratchpad) .main .row:not(.collapse)>:is(.column,.columns){padding-inline:calc(var(--hb-layout-gap) / 2)!important;box-sizing:border-box!important}
body.hb170-layout.hb170-compact:not(.mode--scratchpad) .main .row{row-gap:8px}
body.hb170-compact:not(.mode--scratchpad) .main .section.hb170-card{margin-bottom:10px!important}
body.hb170-layout:not(.mode--scratchpad) .hb170-layout-single>.hb170-layout-main,body.hb170-layout:not(.mode--scratchpad) .hb170-layout-single>.hb170-layout-side{width:100%!important;max-width:100%!important;float:none!important}
@media(min-width:900px){
  body.hb170-layout:not(.mode--scratchpad) .hb170-layout-wide>.hb170-layout-main{width:calc(100% - var(--hb-side-width,27%))!important;max-width:none!important}
  body.hb170-layout:not(.mode--scratchpad) .hb170-layout-wide>.hb170-layout-side{width:var(--hb-side-width,27%)!important;max-width:none!important}
}
@media(max-width:600px){
  body.hb170-layout:not(.mode--scratchpad) .main{width:calc(100% - 16px)!important}
  body.hb170-layout:not(.mode--scratchpad) .main .row>.columns>.section.hb170-card{margin-inline:0!important}
}
/* Leave transform, opacity and transition to Hydro's original section reveal. */
.hb170-card{box-sizing:border-box!important;border-radius:var(--hb170-radius,var(--hb-global-radius))!important;background:var(--hb170-bg,var(--hb-global-bg))!important;border:var(--hb170-border-width,1px) solid var(--hb-global-border)!important;backdrop-filter:blur(var(--hb170-blur,var(--hb-global-blur)))!important;-webkit-backdrop-filter:blur(var(--hb170-blur,var(--hb-global-blur)))!important;box-shadow:var(--hb-global-shadow)!important;background-clip:padding-box!important}
.hb170-media-frame{display:inline-block!important;max-width:100%!important;box-sizing:border-box!important;padding:var(--hb-media-frame-padding,5px)!important;margin:.35em .2em!important;vertical-align:middle!important;line-height:0!important;border-radius:var(--hb-global-radius)!important;background:var(--hb-global-bg)!important;border:var(--hb170-border-width,1px) solid var(--hb-global-border)!important;backdrop-filter:blur(var(--hb-global-blur))!important;-webkit-backdrop-filter:blur(var(--hb-global-blur))!important;box-shadow:var(--hb-global-shadow)!important;overflow:hidden!important}
.hb170-media-frame>img,.hb170-media-frame>picture,.hb170-media-frame>video,.hb170-media-frame>iframe,.hb170-media-frame>object,.hb170-media-frame>embed{display:block!important;max-width:100%!important;border:0!important;border-radius:max(0px,calc(var(--hb-global-radius) - var(--hb-media-frame-padding,5px)))!important}
.hb170-media-frame>picture>img{display:block!important;max-width:100%!important;height:auto!important;border-radius:inherit!important}
.hb170-media-surface{border-radius:inherit!important;overflow:hidden!important;background-clip:padding-box!important}
.hb170-card>.contest-sidebar__bg{display:block;border-radius:inherit!important;overflow:hidden!important}
body:not(.hb170-media-frames) .hb170-media-frame{padding:0!important;background:transparent!important;border-color:transparent!important;box-shadow:none!important;backdrop-filter:none!important}
body:not(.hb170-media-frames) .hb170-media-frame>img,body:not(.hb170-media-frames) .hb170-media-frame>picture,body:not(.hb170-media-frames) .hb170-media-frame>video,body:not(.hb170-media-frames) .hb170-media-frame>iframe{border-radius:var(--hb-global-radius)!important}
.hb170-card.hb170-no-border{border-color:transparent!important}
/* 浅色适配：比赛横幅的标题、信息和参加状态采用灰色；保留深色状态徽章、黄色按钮和图标的原配色。 */
:is(html.theme--light body,body.hb170-light) .main .section--contest .media__body .section__body>h1,
:is(html.theme--light body,body.hb170-light) .main .section--contest .info,
:is(html.theme--light body,body.hb170-light) .main .section--contest .info li,
:is(html.theme--light body,body.hb170-light) .main .section--contest .media__right .typo,
:is(html.theme--light body,body.hb170-light) .main .section--contest .media__right .typo p,
:is(html.theme--light body,body.hb170-light) .main .section--contest .media__right .typo .icon{color:#6b7280!important;text-shadow:none!important}
/* Inset the menu as a whole; the persistent programming link and hover share the same corners. */
.main .hb170-card>.menu,.main .hb170-card>.section__body.no-padding:has(>.menu){padding:var(--hb-global-padding)!important}
.main .hb170-card :is(.menu__link,.messagepad__list-item){border-radius:clamp(0px,calc(var(--hb170-radius,var(--hb-global-radius)) - var(--hb-global-padding) / 2),12px)!important;background-clip:padding-box!important}
.main .hb170-card :is(a,button).menu__link{border-inline-start:0!important;overflow-wrap:anywhere}
.main .hb170-card :is(.menu__link,.messagepad__list-item):focus-visible{outline:2px solid var(--hb-accent)!important;outline-offset:-2px!important}
.main .section.side.section--problem-sidebar.hb170-card{--hb-problem-menu-inset:clamp(6px,var(--hb-global-padding),16px)}
.main .section.side.section--problem-sidebar.hb170-card>ol.menu{box-sizing:border-box;width:auto!important;margin:0!important;padding:var(--hb-problem-menu-inset)!important}
.main .section.side.section--problem-sidebar.hb170-card>ol.menu>.menu__item>.menu__link{box-sizing:border-box;max-width:100%;padding:.6rem .7rem!important;line-height:1.35;border-inline-start:0!important;border-radius:clamp(0px,calc(var(--hb170-radius,var(--hb-global-radius)) - var(--hb-problem-menu-inset) / 2),12px)!important}
.main .section.side.section--problem-sidebar.hb170-card>ol.menu>.menu__item>.menu__link:is([name="problem-sidebar__open-scratchpad"],[name="problem-sidebar__close-scratchpad"],[data-global-hotkey="alt+q" i]){margin-block:.15rem;background:color-mix(in srgb,var(--hb-accent) 16%,transparent)!important;color:var(--hb-text,#f0f0f5)!important}
.main .section.side.section--problem-sidebar.hb170-card>ol.menu>.menu__item>.menu__link:is([name="problem-sidebar__open-scratchpad"],[name="problem-sidebar__close-scratchpad"],[data-global-hotkey="alt+q" i]):is(:hover,:focus-visible){background:color-mix(in srgb,var(--hb-accent) 26%,transparent)!important}
.page--problem_detail body:not(.mode--scratchpad) .main .hb170-card ul.problem__tags{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .45rem;padding-inline-start:0;list-style:none}
.page--problem_detail body:not(.mode--scratchpad) .main .hb170-card ul.problem__tags>.problem__tag-item{margin:0!important;max-width:100%;border-radius:999px!important;line-height:1.4;overflow-wrap:anywhere}
.page--problem_detail body:not(.mode--scratchpad) .main .hb170-card ul.problem__tags>.problem__tag-item:not(.icon:empty){padding:.2rem .5rem!important;background-color:var(--hb-panel-fill,#ffffff12)}
.page--problem_detail body:not(.mode--scratchpad) .main .hb170-card .typo pre:not(:where(.monaco-editor *,.cm-editor *)){max-width:100%;overflow-x:auto;border-radius:clamp(0px,var(--hb170-radius,var(--hb-global-radius)),12px)!important}
.hb170-card>:is(.section__header,.section__body){background:transparent!important;border-radius:inherit}
/* Keep native labels readable when the site's theme and the script's card theme differ. */
html:is(.theme--dark,:not(.theme--light)[data-mantine-color-scheme="dark"]) body.hb170-light{--hb-card-foreground:#303444;--hb-card-link:#284b8d}
html:is(.theme--light,:not(.theme--dark)[data-mantine-color-scheme="light"]) body:not(.hb170-light){--hb-card-foreground:#f0f0f5;--hb-card-link:#b4c7ff}
:is(html:is(.theme--dark,:not(.theme--light)[data-mantine-color-scheme="dark"]) body.hb170-light,html:is(.theme--light,:not(.theme--dark)[data-mantine-color-scheme="light"]) body:not(.hb170-light)){
  & .hb170-card:not(.section--contest),
  & .hb170-card:not(.section--contest)>:is(.section__header,.section__body),
  & .hb170-card:not(.section--contest) :is(h1,h2,h3,h4,legend,label):not(:where(.monaco-editor *,.cm-editor *)){color:var(--hb-card-foreground)}
  & .hb170-card .menu__link:not(:is(.active,.selected,.disabled,[aria-current])){color:var(--hb-card-link)!important}
  & .hb170-card .menu__link:not(:is(.active,.selected,.disabled,[aria-current])):is(.highlight,:hover){background:color-mix(in srgb,var(--hb-card-link) 12%,transparent)!important}
}
body:not(.mode--scratchpad) :is(.main,#academic-root,.academic-root) .hb170-card>.section__header,
body:not(.mode--scratchpad) :is(.main,#academic-root,.academic-root) .hb170-card>.section__body:not(.no-padding),
body:not(.mode--scratchpad) :is(.main,#academic-root,.academic-root) .hb170-card.hb170-table>.section__body,
body:not(.mode--scratchpad) :is(.main,#academic-root,.academic-root) .hb170-card:is(.ac-card,.card,.ui.segment,.panel):not(:has(>:is(.section__header,.section__body,.menu))),
body:not(.mode--scratchpad) .main .hb170-card.hb170-table:not(.section){padding:var(--hb-global-padding)!important}
body:not(.mode--scratchpad) :is(.main,#academic-root,.academic-root) .hb170-card>.section__header:has(+.section__body:not(.no-padding)){padding-block-end:0!important}
/* Keep the problem count and sort in normal flow so they never cover typed text. */
.main .hb170-card>.section__body.no-padding:has(>#searchForm>.search){padding:var(--hb-global-padding)!important}
.main #searchForm{container-type:inline-size}
.main #searchForm>.search{display:grid!important;grid-template-columns:minmax(0,1fr) auto minmax(0,8rem) 2.75rem;align-items:stretch;box-sizing:border-box;min-width:0;padding:0!important;margin:0!important;border:1px solid var(--hb-panel-line,#ffffff24);border-radius:clamp(0px,var(--hb170-radius,var(--hb-global-radius)),16px)!important;background:var(--hb-panel-fill,#ffffff12)!important;color:var(--hb-text,#f0f0f5);overflow:hidden;color-scheme:dark}
body.hb170-light .main #searchForm>.search{color-scheme:light}
.main #searchForm>.search:focus-within{border-color:var(--hb-accent)}
.main #searchForm>.search>:is(input[name=q],.search-sort,button[type=submit],[data-fragment-id=problem_stat]),.main #searchForm>.search>[data-fragment-id=problem_stat]>p{position:static!important;inset:auto!important;transform:none!important;margin:0!important;min-width:0;box-sizing:border-box}
.main #searchForm>.search>:is(input[name=q],.search-sort,button[type=submit]){width:100%!important;min-height:2.5rem;height:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;line-height:normal}
.main #searchForm>.search>input[name=q]{padding:.5rem .75rem!important;background:transparent!important;color:inherit!important}
.main #searchForm>.search>input[name=q]::placeholder{color:var(--hb-panel-muted,#9ba1b3);opacity:1}
.main #searchForm>.search>[data-fragment-id=problem_stat]{display:flex;align-items:center;min-width:0;padding:.375rem .65rem;color:var(--hb-panel-muted,#9ba1b3);font-size:.85em;overflow-wrap:anywhere}
.main #searchForm>.search>[data-fragment-id=problem_stat]>p{width:auto!important;color:inherit;line-height:1.35;text-align:start}
.main #searchForm>.search>.search-sort{appearance:auto;padding:.375rem .4rem!important;border-inline-start:1px solid var(--hb-panel-line,#ffffff24)!important;background:transparent!important;color:inherit!important;font-size:.875em}
.main #searchForm>.search>.search-sort option{background:var(--hb-panel-bg,#252938);color:var(--hb-text,#f0f0f5)}
.main #searchForm>.search>button[type=submit]{display:grid;place-items:center;padding:0!important;background:var(--hb-accent)!important;color:var(--hb-panel-control-text,#fff)!important}
.main #searchForm>.search>:is(input,select,button):focus-visible{outline:2px solid var(--hb-accent)!important;outline-offset:-2px!important}
.main #searchForm>.search>button[type=submit]:focus-visible{outline-color:currentColor!important}
@container (max-width:420px){
  .main #searchForm>.search{grid-template-columns:minmax(0,1fr) minmax(0,min(32%,8rem)) 2.75rem}
  .main #searchForm>.search>[data-fragment-id=problem_stat]{grid-row:2;grid-column:1/-1;border-block-start:1px solid var(--hb-panel-line,#ffffff24)}
}
.hb170-table-wrap{max-width:100%;overflow-x:auto!important;overscroll-behavior-inline:contain}
.hb170-table-wrap table{border-collapse:separate!important;border-spacing:0!important;background:transparent!important;border-radius:inherit!important}
.hb170-table-wrap th,.hb170-table-wrap td{background:transparent!important;border-color:var(--hb-global-border)!important}
body.hb170-striped .hb170-table-wrap tbody tr:nth-child(odd){background:rgba(255,255,255,.035)!important}
body.hb170-striped .hb170-table-wrap tbody tr:nth-child(even){background:rgba(0,0,0,.10)!important}
/* The problem bank keeps filters, results and pagination on one surface. */
html[data-page="problem_main"] .main{
  --hb-bank-surface:color-mix(in srgb,var(--hb-text) 6%,transparent);
  --hb-bank-stripe:color-mix(in srgb,var(--hb-text) 2.5%,transparent);
  --hb-bank-rule:color-mix(in srgb,var(--hb-text) 13%,transparent);
  --hb-bank-link:color-mix(in srgb,var(--hb-accent) 55%,var(--hb-text));
}
html[data-page="problem_main"] .main .hb170-card{
  --hb-bank-radius:clamp(0px,calc(var(--hb170-radius,var(--hb-global-radius)) * .6),9px);
  & :is(.problem__tag-link,.widget--category-filter__tag,:is(.pagination,.pager) a[href],.pager [aria-current="page"],.pager .pager__item--current){border:1px solid var(--hb-bank-rule)!important;border-radius:var(--hb-bank-radius)!important;background:var(--hb-bank-surface)!important;color:var(--hb-bank-link)!important;text-decoration:none!important}
  & :is(.problem__tag-link,.widget--category-filter__tag){padding:.15em .5em!important;line-height:1.35;white-space:normal;overflow-wrap:anywhere;box-decoration-break:clone}
  & :is(.problem__tag-link,.widget--category-filter__tag,:is(.pagination,.pager) a[href],[name=enter-edit-mode],[name=leave-edit-mode]):is(:hover,:focus-visible){border-color:var(--hb-accent)!important;background:color-mix(in srgb,var(--hb-accent) 15%,transparent)!important;color:var(--hb-text)!important}
  & :is(.problem__tag-link,.widget--category-filter__tag,:is(.pagination,.pager) a[href],.toggle-tag,a.button[href="/problem/random"]):focus-visible{outline:2px solid var(--hb-accent)!important;outline-offset:1px}
  & :is(.widget--category-filter__tag,.pagination a,.pager a):is(.active,.selected,.current,[aria-current="page"],[aria-pressed="true"]),
  & .pagination :is(.current,.active,.selected)>a,
  & .pager :is([aria-current="page"],.pager__item--current){border-color:var(--hb-accent)!important;background:var(--hb-accent)!important;color:var(--hb-panel-control-text,#fff)!important}
  & a.button[href="/problem/random"]{box-sizing:border-box;max-width:100%;min-height:2.5rem;margin:0!important;padding:.55rem .75rem!important;border:1px solid var(--hb-bank-rule)!important;border-radius:var(--hb-bank-radius)!important;background:var(--hb-bank-surface)!important;color:var(--hb-text)!important;white-space:normal;overflow-wrap:anywhere}
  & a.button[href="/problem/random"]:is(:hover,:focus-visible){border-color:var(--hb-accent)!important;background:color-mix(in srgb,var(--hb-accent) 15%,transparent)!important}
}
html[data-page="problem_main"] .main .section.hb170-table:has(>.section__body>#searchForm){
  min-width:0;
  &>.section__body:has(>#searchForm){padding-block-end:0!important}
  &>.section__body:has(.hb170-table-wrap){min-width:0}
  & .hb170-table-wrap{border:0!important;box-shadow:none!important;background:transparent!important;scrollbar-color:var(--hb-bank-rule) transparent}
  & .hb170-table-wrap>.section__table{margin:0!important}
  & .hb170-table-wrap table{width:100%;margin:0!important}
  & .hb170-table-wrap table>thead>tr>th{background:var(--hb-panel-bg)!important;color:var(--hb-text)!important;border-block-end:1px solid var(--hb-bank-rule)!important}
  & .hb170-table-wrap :is(th,td){padding-block:.45rem!important;border-color:var(--hb-bank-rule)!important}
  & .hb170-table-wrap :is(.col--name,.col--name>a){white-space:normal!important;overflow-wrap:anywhere}
  & .hb170-table-wrap :is(.col--status,.col--ac-tried,.col--difficulty,.col--pid){white-space:nowrap}
  & .hb170-table-wrap .col--name>a:not(.problem__tag-link){color:var(--hb-bank-link)}
  & .hb170-table-wrap .col--name .toggle-tag{color:var(--hb-bank-link)!important}
  & .hb170-table-wrap tbody tr{background:transparent!important}
  body.hb170-striped & .hb170-table-wrap tbody tr:nth-child(even){background:var(--hb-bank-stripe)!important}
  & .hb170-table-wrap tbody tr:hover,
  body.hb170-striped & .hb170-table-wrap tbody tr:nth-child(even):hover{background:var(--hb-bank-surface)!important}
  & .pager{max-width:100%;margin-block:.35rem!important}
  & :is(ul,ol).pagination{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;margin:.45rem 0!important}
  & :is(ul,ol).pagination>li{float:none!important;margin:0!important}
  & :is(.pagination,.pager) :is(a[href],[aria-current="page"],.pager__item--current){min-height:1.8rem;padding:.25rem .55rem!important;line-height:1.3}
  & .pager :is(a[href],[aria-current="page"],.pager__item--current){margin-block:.12rem}
}
@media(max-width:700px){
  html[data-page="problem_main"] .main .section.hb170-table:has(>.section__body>#searchForm) .hb170-table-wrap table{min-width:34rem}
}
.hb170-card.hb170-side{--hb170-bg:var(--hb-side-bg);--hb170-blur:var(--hb-side-blur);--hb170-radius:var(--hb-side-radius)}
.hb170-card.hb170-native{--hb170-bg:var(--hb-native-bg);--hb170-blur:var(--hb-native-blur);--hb170-radius:var(--hb-native-radius)}
.hb170-card.hb170-table{--hb170-bg:var(--hb-table-bg);--hb170-blur:var(--hb-table-blur);--hb170-radius:var(--hb-table-radius)}
.hb170-card.hb170-academic{--hb170-bg:var(--hb-academic-bg);--hb170-blur:var(--hb-academic-blur);--hb170-radius:var(--hb-academic-radius)}
.hb170-card.hb170-side.hb170-follow,.hb170-card.hb170-native.hb170-follow,.hb170-card.hb170-table.hb170-follow,.hb170-card.hb170-academic.hb170-follow{--hb170-bg:var(--hb-global-bg);--hb170-blur:var(--hb-global-blur);--hb170-radius:var(--hb-global-radius)}
/* The academic add-on uses its own palette, including for search and category controls. */
#academic-root.academic,
body:has(#academic-root.academic) :is(dialog#ac-search,dialog#ac-side-drawer,dialog#ac-notice-dialog){
  --paper:var(--hb-panel-bg);--ink:var(--hb-text);--secondary:var(--hb-panel-muted);--muted:var(--hb-panel-muted);
  --line:var(--hb-panel-line);--wash:var(--hb-panel-fill);--accent:var(--hb-accent);
  --hb-ac-link:color-mix(in srgb,var(--hb-accent) 45%,var(--hb-text));
  --selected:color-mix(in srgb,var(--hb-accent) 17%,transparent);--nav-selected:var(--selected);
  --nav-selected-icon:var(--hb-ac-link);--nav-icon:var(--secondary);--card-pid:var(--secondary);
  --card-title-hover:var(--hb-ac-link);--card-date:var(--secondary);--subtle-line:var(--line);--notice-line:var(--line);
  color:var(--ink);color-scheme:var(--hb-ac-scheme,dark)
}
body.hb170-light{--hb-ac-scheme:light}
#academic-root :is(.ac-main,.ac-side,.ac-side-slot,.ac-mast,.ac-main-title,.ac-actions,.ac-entry){min-width:0}
#academic-root .hb170-academic :is(h1,h2,h3){color:var(--ink);overflow-wrap:anywhere}
#academic-root .ac-mast{flex-wrap:wrap;column-gap:.75rem;row-gap:.5rem}
#academic-root .ac-actions{display:flex;flex-wrap:wrap;gap:.4rem}
#academic-root :is(.ac-btn,.ac-drawer-trigger,.ac-board-link,#ac-search input){
  border-radius:clamp(0px,var(--hb-academic-radius),12px)
}
#academic-root .ac-primary{color:var(--hb-panel-control-text)!important;background:var(--hb-accent)!important}
body:has(#academic-root.academic) .nav__item[aria-current="page"][href="/academic"],
body:has(#academic-root.academic) .nav__item[aria-current="location"][href="/academic"]{box-shadow:inset 0 -2px var(--hb-accent)}
:is(#academic-root,#ac-side-drawer) .ac-board-link[aria-current="page"]{
  background:var(--nav-selected)!important;color:var(--ink)!important;font-weight:650
}
:is(#academic-root,#ac-search,#ac-side-drawer,#ac-notice-dialog)
  :is(a,button,input,textarea,select):focus-visible{outline:2px solid var(--hb-accent);outline-offset:2px}
body:has(#academic-root.academic) :is(dialog#ac-search,dialog#ac-side-drawer,dialog#ac-notice-dialog){
  box-sizing:border-box;max-inline-size:calc(100vw - 1rem);max-block-size:calc(100dvh - 1rem);
  border:var(--hb170-border-width,1px) solid var(--hb-global-border)!important;
  border-radius:var(--hb-academic-radius)!important;background:var(--paper)!important;color:var(--ink)!important;
  box-shadow:var(--hb-global-shadow)!important;backdrop-filter:blur(var(--hb-academic-blur));
  -webkit-backdrop-filter:blur(var(--hb-academic-blur));overscroll-behavior:contain
}
@media(max-width:760px){
  #academic-root .ac-list-layout{grid-template-columns:minmax(0,1fr)}
  #academic-root .ac-main-title{flex-basis:100%}
  #academic-root .ac-drawer-trigger{min-block-size:2.25rem}
}
body.hb170-shadow .hb170-card{box-shadow:var(--hb-global-shadow)!important}
body:not(.hb170-shadow) .hb170-card{box-shadow:none!important}
body.hb170-border-off .hb170-card{border-color:transparent!important}
/* Hydro 的大量字号使用 rem，仅修改 body 无法影响这些元素。以原有根字号为基准缩放。 */
html.hb170-font-scale{font-size:calc(var(--hb-base-font-size,13px) * var(--hb-font-scale,1))!important}
.main .section__table-container.hb170-card table{margin:0!important}
#hb170-trigger,#hb170-panel{--hb-edge:20px;--hb-edge-right:max(var(--hb-edge),env(safe-area-inset-right,0px));--hb-edge-bottom:max(var(--hb-edge),env(safe-area-inset-bottom,0px));--hb-trigger-size:48px;position:fixed!important;right:var(--hb-edge-right)!important;box-sizing:border-box}
#hb170-trigger{bottom:var(--hb-edge-bottom)!important;z-index:2147483000!important;display:grid;place-items:center;width:var(--hb-trigger-size);height:var(--hb-trigger-size);min-width:0;padding:0!important;border:var(--hb170-border-width,1px) solid var(--hb-global-border)!important;border-radius:50%!important;background:var(--hb-trigger-bg,var(--hb-global-bg))!important;background-clip:padding-box!important;color:var(--hb-trigger-ink,var(--hb-text,#f0f0f5))!important;font:22px/1 system-ui,sans-serif;cursor:pointer;box-shadow:var(--hb-global-shadow)!important;backdrop-filter:blur(var(--hb-global-blur));-webkit-backdrop-filter:blur(var(--hb-global-blur));touch-action:manipulation}
body button.omnibar-toggle[data-global-hotkey="ctrl+k:click"]{box-sizing:border-box;width:48px!important;height:48px!important;min-width:0;padding:0!important;border:var(--hb170-border-width,1px) solid var(--hb-global-border)!important;border-radius:50%!important;background:var(--hb-trigger-bg,var(--hb-global-bg))!important;background-clip:padding-box!important;color:var(--hb-trigger-ink,var(--hb-text,#f0f0f5))!important;box-shadow:var(--hb-global-shadow)!important;backdrop-filter:blur(var(--hb-global-blur));-webkit-backdrop-filter:blur(var(--hb-global-blur));touch-action:manipulation}
body button.omnibar-toggle[data-global-hotkey="ctrl+k:click"]:focus-visible{outline:2px solid var(--hb-accent)!important;outline-offset:2px!important}
#hb170-trigger:focus-visible,#hb170-panel :is(button,input,select,textarea):focus-visible{outline:2px solid var(--hb-accent)!important;outline-offset:2px!important}
#hb170-panel{--hb-panel-bottom:calc(var(--hb-edge-bottom) + var(--hb-trigger-size) + 12px);bottom:var(--hb-panel-bottom)!important;z-index:2147483001!important;width:min(440px,calc(100vw - var(--hb-edge-right) - max(var(--hb-edge),env(safe-area-inset-left,0px))));max-height:min(86vh,calc(100vh - var(--hb-panel-bottom) - 12px));max-height:min(86dvh,calc(100dvh - var(--hb-panel-bottom) - max(12px,env(safe-area-inset-top,0px))));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--hb-panel-line,#ffffff24);border-radius:20px!important;background:var(--hb-panel-bg,#1e2130f7)!important;color:var(--hb-text,#f0f0f5)!important;box-shadow:0 18px 60px #0008;backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);font:13px/1.45 system-ui,sans-serif}
#hb170-panel[hidden]{display:none!important}#hb170-panel *{box-sizing:border-box}
#hb170-head{padding:16px 18px 12px;border-bottom:1px solid var(--hb-panel-line,#ffffff24)}#hb170-head strong{font-size:18px}#hb170-head small{display:block;color:var(--hb-panel-muted,#9ba1b3);margin-top:3px}
#hb170-tabs{display:flex;flex-wrap:wrap;gap:5px;padding:10px 12px;flex-shrink:0}#hb170-tabs button{white-space:nowrap;border:0;border-radius:9px!important;padding:8px 11px;background:var(--hb-panel-fill,#ffffff12);color:inherit;cursor:pointer}#hb170-tabs button.active{background:var(--hb-accent);color:var(--hb-panel-control-text,#fff)}
#hb170-content{padding:0 17px 18px;overflow:auto;min-height:0;flex:1}#hb170-content [data-page][hidden]{display:none!important}#hb170-content h3{font-size:13px;margin:17px 0 10px;padding-bottom:8px;border-bottom:1px solid #ffffff20}#hb170-content .item{margin:12px 0}#hb170-content .label{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:650}
#hb170-content input[type=range]{width:100%;accent-color:var(--hb-accent)}#hb170-content input[type=color]{width:44px;height:30px;border:0;background:transparent}#hb170-content input[type=text],#hb170-content input[type=number],#hb170-content select,#hb170-content textarea{width:100%;padding:9px;border:1px solid var(--hb-panel-line,#ffffff24);border-radius:8px!important;background:var(--hb-panel-fill,#ffffff12);color:inherit}#hb170-content select option{background:var(--hb-panel-bg,#252938);color:var(--hb-text,#f0f0f5)}#hb170-content input[type=checkbox]{accent-color:var(--hb-accent)}#hb170-content .check{display:flex;align-items:center;gap:8px;margin:9px 0;cursor:pointer}#hb170-content .hint{font-size:11px;color:var(--hb-panel-muted,#9ba1b3);line-height:1.55;margin-top:5px}#hb170-content .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#hb170-content button.action{width:100%;padding:10px;border:0;border-radius:9px!important;background:var(--hb-accent);color:var(--hb-panel-control-text,#fff);font-weight:700;cursor:pointer}#hb170-content button.secondary{background:var(--hb-panel-fill,#ffffff18);color:inherit}#hb170-content button:disabled,#hb170-content input:disabled{opacity:.42;cursor:not-allowed}#hb170-content .preset{padding:11px;border:1px solid var(--hb-panel-line,#ffffff24);border-radius:10px!important;background:var(--hb-panel-fill,#ffffff12);color:inherit;text-align:left;cursor:pointer;overflow-wrap:anywhere}#hb170-content .preset.active{border-color:var(--hb-accent);box-shadow:inset 0 0 0 1px var(--hb-accent)}#hb170-content .status{padding:9px;border-radius:8px;background:var(--hb-panel-fill,#ffffff12);font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}
#hb170-foot{padding:10px 16px;border-top:1px solid var(--hb-panel-line,#ffffff24);display:flex;flex-shrink:0;gap:8px;justify-content:space-between;align-items:center}#hb170-foot button{border:0;border-radius:8px!important;padding:8px 14px;background:var(--hb-accent);color:var(--hb-panel-control-text,#fff);cursor:pointer}
#hb170-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:10px;background:#202536;color:#fff;box-shadow:0 6px 24px #0006;font:13px system-ui;opacity:0;pointer-events:none;transition:opacity .2s}#hb170-toast.show{opacity:1}
.main .hb170-card>.section__header:has(>.contest-problems){display:flex!important;align-items:flex-start;flex-wrap:wrap;gap:.5rem .85rem}
.main .hb170-card>.section__header:has(>.contest-problems)>.section__title{flex:1 1 15rem;min-width:0;overflow-wrap:anywhere}
.main .hb170-card>.section__header>.contest-problems{position:static!important;display:flex!important;flex-wrap:wrap;gap:.35rem;width:max-content!important;max-width:min(100%,19rem);padding:0!important;--hb-problem-pass:#79dfa2;--hb-problem-fail:#ff9f9f;--hb-problem-pending:#90d9f1}
body.hb170-light .main .hb170-card>.section__header>.contest-problems{--hb-problem-pass:#076c3f;--hb-problem-fail:#9e293b;--hb-problem-pending:#125979}
.main .hb170-card .contest-problems>a[href]{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;position:relative;isolation:isolate;width:auto;min-width:2rem;height:2rem;padding:0 .38rem;text-decoration:none!important;font-weight:650;line-height:1;border:1px solid var(--hb-panel-line);border-radius:clamp(0px,calc(var(--hb170-radius,var(--hb-global-radius)) * .6),11px)!important;background:var(--hb-panel-fill);color:var(--hb-text)}
.main .hb170-card .contest-problems>a[href]:is(:hover,:focus-visible){border-color:var(--hb-accent);background:color-mix(in srgb,var(--hb-accent) 18%,transparent)}
.main .hb170-card .contest-problems>a[href]:is(.active,[aria-current="page"]){background:var(--hb-accent);border-color:var(--hb-accent);color:var(--hb-panel-control-text,#fff)}
.main .hb170-card .contest-problems>a[href]:focus-visible{outline:2px solid var(--hb-accent)!important;outline-offset:2px}
.main .hb170-card .contest-problems>a[href]::after{content:none}
.main .hb170-card .contest-problems>a[href].pass{--hb-problem-status:var(--hb-problem-pass)}
.main .hb170-card .contest-problems>a[href].fail{--hb-problem-status:var(--hb-problem-fail)}
.main .hb170-card .contest-problems>a[href].pending{--hb-problem-status:var(--hb-problem-pending)}
.main .hb170-card .contest-problems>a[href]:is(.pass,.fail,.pending):not(.active){color:var(--hb-problem-status);border-color:color-mix(in srgb,var(--hb-problem-status) 48%,transparent)}
.main .hb170-card .contest-problems>a[href]:is(.pass,.fail,.pending)::before{content:"";position:absolute;inset:auto .12rem .12rem auto;width:.3rem;height:.3rem;border:0;border-radius:50%;background:var(--hb-problem-status);opacity:1}
.main .hb170-card .contest-problems>a[href]>.id{display:inline!important}
.main .hb170-card .contest-problems>a[href]:has(>.id)>.icon{display:none!important}
@media(max-width:600px){.main .hb170-card>.section__header>.contest-problems{width:100%!important;max-width:100%}.main .hb170-card .contest-problems>a[href]{min-width:2.25rem;height:2.25rem}}
.hb170-inspector-highlight{outline:3px solid #ffca58!important;outline-offset:2px!important}
/* 私信由站点独立渲染；复用它的颜色变量，保留联系人与会话的原生布局。 */
html[data-page="home_messages_final"] :is(.mf-page,.mf-dialog){
  --mf-paper:var(--hb-panel-bg);--mf-left:var(--hb-panel-fill);--mf-ink:var(--hb-text);--mf-muted:var(--hb-panel-muted);
  --mf-line:var(--hb-panel-line);--mf-border:var(--hb-panel-line);--mf-peer:color-mix(in srgb,var(--hb-text) 8%,transparent);
  --mf-self:color-mix(in srgb,var(--hb-accent) 22%,transparent);--mf-selected:color-mix(in srgb,var(--hb-accent) 24%,transparent);
  --mf-mark:var(--hb-accent);--mf-code:var(--hb-panel-fill);--mf-link:color-mix(in srgb,var(--hb-accent) 44%,var(--hb-text));
  --mf-gutter:clamp(10px,var(--hb-global-padding),28px);--hb-mf-control-radius:clamp(0px,var(--hb-global-radius),10px);
  color-scheme:dark;
}
html[data-page="home_messages_final"] body.hb170-light :is(.mf-page,.mf-dialog){color-scheme:light}
html[data-page="home_messages_final"] .mf-workspace{border:var(--hb170-border-width) solid var(--hb-global-border)!important;border-radius:var(--hb-global-radius)!important;background:var(--hb-global-bg)!important;box-shadow:var(--hb-global-shadow)!important;backdrop-filter:blur(var(--hb-global-blur));color:var(--mf-ink)}
html[data-page="home_messages_final"] .mf-workspace .mf-search input,html[data-page="home_messages_final"] .mf-dialog input{border-radius:var(--hb-mf-control-radius)!important;background:var(--hb-panel-fill)!important}
html[data-page="home_messages_final"] .mf-workspace .mf-contact{box-sizing:border-box;width:calc(100% - 12px);margin:3px 6px;padding-inline:clamp(10px,var(--hb-global-padding),18px);border:1px solid transparent;border-radius:var(--hb-mf-control-radius)}
html[data-page="home_messages_final"] .mf-workspace .mf-contact[aria-current="true"]{border-color:color-mix(in srgb,var(--hb-accent) 48%,transparent);background:var(--mf-selected)}
html[data-page="home_messages_final"] .mf-workspace .mf-contact:hover:not([aria-current="true"]){background:var(--mf-peer)}
html[data-page="home_messages_final"] .mf-workspace :is(.mf-icon,.mf-tools button,.mf-latest,.mf-notification-menu),html[data-page="home_messages_final"] .mf-dialog{border-radius:var(--hb-mf-control-radius)!important}
html[data-page="home_messages_final"] .mf-workspace :is(button,a,input):focus-visible,html[data-page="home_messages_final"] .mf-dialog :is(button,input):focus-visible{outline-color:var(--hb-accent)}
html[data-page="home_messages_final"] .mf-bubble{border-radius:clamp(0px,var(--hb-global-radius),14px);border-color:var(--mf-line)}
html[data-page="home_messages_final"] .mf-bubble pre,html[data-page="home_messages_final"] .mf-preview pre{border-radius:var(--hb-mf-control-radius);max-inline-size:100%}
html[data-page="home_messages_final"] .mf-composer{min-width:0;background:var(--hb-panel-fill);padding-inline:var(--mf-gutter)}
html[data-page="home_messages_final"] .mf-composer:focus-within{box-shadow:inset 0 2px 0 color-mix(in srgb,var(--hb-accent) 45%,transparent)}
html[data-page="home_messages_final"] .mf-workspace .mf-send{border-radius:var(--hb-mf-control-radius);border-color:var(--mf-line)}
html[data-page="home_messages_final"] .mf-workspace .mf-send:not(:disabled){background:var(--hb-accent);color:var(--hb-panel-control-text);border-color:var(--hb-accent)}
html[data-page="home_messages_final"] .mf-workspace .mf-send:hover:not(:disabled){filter:brightness(1.09);background:var(--hb-accent);border-color:var(--hb-accent)}
html[data-page="home_messages_final"] .mf-dialog{box-shadow:var(--hb-global-shadow)!important}
@media(max-width:760px){html[data-page="home_messages_final"] .mf-workspace .mf-contact{min-width:0}html[data-page="home_messages_final"] .mf-composer .mf-tools{height:auto;min-height:28px;flex-wrap:wrap;gap:2px 8px}}
@media(max-width:520px){#hb170-panel,#hb170-trigger{--hb-edge:12px;--hb-trigger-size:44px}}
@media(max-height:420px){#hb170-head{padding:10px 14px 6px}#hb170-head small{display:none}#hb170-tabs{padding-block:5px}#hb170-tabs button{padding:5px 8px}#hb170-foot{padding:5px 12px}}
`;
    document.head.appendChild(style);
    function toast(message) {
        let el = $('#hb170-toast');
        if (!el) { el = document.createElement('div'); el.id = 'hb170-toast'; document.body.append(el); }
        el.textContent = message; el.classList.add('show');
        clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    const trigger = document.createElement('button');
    trigger.id = 'hb170-trigger'; trigger.type = 'button'; trigger.textContent = '⚙'; trigger.title = 'Hydro 美化设置';
    trigger.setAttribute('aria-label', trigger.title);
    trigger.setAttribute('aria-controls', 'hb170-panel');
    trigger.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('section');
    panel.id = 'hb170-panel'; panel.hidden = true;
    panel.setAttribute('aria-label', 'Hydro 美化设置');
    const range = (key, label, min, max, step = 1) => `<div class="item"><div class="label"><label for="hb-range-${key}">${label}</label><b id="v-${key}" aria-hidden="true"></b></div><input id="hb-range-${key}" data-range="${key}" type="range" min="${min}" max="${max}" step="${step}"></div>`;
    const check = (key, label) => `<label class="check"><input data-check="${key}" type="checkbox">${label}</label>`;
    const color = (key, label) => `<div class="item"><div class="label">${label}</div><input data-color="${key}" type="color"></div>`;
    panel.innerHTML = `
<header id="hb170-head"><strong>Hydro UI Beautifier</strong><small>v${VERSION} · Glass Design System</small></header>
<nav id="hb170-tabs"><button class="active" data-tab="global">全局</button><button data-tab="cards">卡片</button><button data-tab="layout">布局</button><button data-tab="background">背景</button><button data-tab="themes">主题</button><button data-tab="tools">诊断/配置</button></nav>
<main id="hb170-content">
<section data-page="global"><h3>全局卡片样式</h3>
${range('cardOpacity','全局不透明度',MIN_CARD_OPACITY,100)}${range('blur','全局毛玻璃',0,30)}${range('radius','全局圆角',0,32)}${range('cardPadding','卡片内部间距',0,36)}
${check('dark','深色卡片')}${check('transparent','页面背景透明化')}<h3>边框与阴影</h3>
${check('border','显示卡片边框')}${range('borderOpacity','边框不透明度',0,50)}${range('borderWidth','边框宽度',0,3,.5)}${check('shadow','卡片阴影')}${range('shadowStrength','阴影强度',0,60)}</section>
<section data-page="cards" hidden><h3>板块继承关系</h3><p class="hint">默认所有板块继承全局设置。关闭某个板块的跟随开关后，才启用该板块的独立参数。</p><h3>图片与嵌入内容</h3>${check('mediaFrames','为正文图片、贴图和嵌入内容添加圆角外框')}${range('mediaFramePadding','媒体外框内边距',0,16)}<p class="hint">自动排除导航 Logo、头像和图标；带背景图的作业/比赛侧栏封面也会裁切到卡片圆角内。</p>
${['native:普通卡片','table:题目表格','side:右侧栏','academic:学术板块'].map(x => { const [g,label] = x.split(':'); return `<h3>${label}</h3>${check(g+'FollowGlobal','跟随全局卡片设置')}${range(g+'Opacity','不透明度',MIN_CARD_OPACITY,100)}${range(g+'Blur','毛玻璃',0,30)}${range(g+'Radius','圆角',0,32)}`; }).join('')}
<div class="grid"><button class="action secondary" id="hb-follow-all">全部跟随全局</button><button class="action secondary" id="hb-reset-groups">重置独立参数</button></div></section>
<section data-page="layout" hidden><h3>页面布局</h3>${check('layoutEnabled','启用布局控制')}${range('width','内容最大宽度',900,2200,20)}${range('gap','栏间距',0,48)}${range('sideWidth','侧栏宽度比例',15,45)}<div class="item"><div class="label">布局模式</div><select data-select="layoutMode"><option value="auto">自动（保持 Hydro 原布局）</option><option value="wide">宽屏双栏</option><option value="single">单栏</option></select></div>${check('compact','紧凑模式')}<div class="hint">栏间距作用于 Hydro 的标准列布局；宽屏双栏和单栏只对检测到的主内容布局容器生效。</div><h3>字体</h3>${range('fontScale','全局字号比例',85,115)}<div class="hint">缩放以 rem 和继承字号为主；网页中固定像素字号或编辑器字号可能不受影响。</div></section>
<section data-page="background" hidden><h3>背景模式</h3><div class="item"><select data-select="backgroundMode"><option value="image">图片/纯色</option><option value="gradient">渐变</option></select></div><div class="item"><label class="label">图片 URL</label><input id="hb-image-url" type="text" placeholder="https://..."></div><div class="grid"><button class="action" id="hb-image-apply">应用图片</button><button class="action secondary" id="hb-image-clear">清除图片</button></div><div class="status" id="hb-image-status">背景尚未加载</div>
${color('background','纯色背景')}${color('gradientA','渐变颜色 A')}${color('gradientB','渐变颜色 B')}${range('gradientAngle','渐变角度',0,360)}<h3>背景效果</h3>${range('opacity','图片透明度',0,100)}${range('bgBlur','背景模糊',0,20)}${range('overlay','遮罩强度',0,90)}${color('overlayColor','遮罩颜色')}${range('saturation','饱和度',0,200)}${range('brightness','亮度',20,180)}${range('contrast','对比度',20,180)}${check('noise','细微噪点纹理')}${check('enabled','启用背景层')}<div class="item"><div class="label">背景尺寸</div><select data-select="bgSize"><option>cover</option><option>contain</option><option>100% 100%</option></select></div><div class="item"><div class="label">背景位置</div><select data-select="bgPosition"><option>center</option><option>top</option><option>bottom</option><option>left</option><option>right</option></select></div></section>
<section data-page="themes" hidden><h3>内置主题</h3><div class="grid">${Object.keys(THEMES).map(k => `<button class="preset" data-theme="${k}">${k.toUpperCase()}</button>`).join('')}</div><h3>自定义主题</h3><div class="item"><input id="hb-preset-name" type="text" placeholder="方案名称"></div><div class="grid"><button class="action" id="hb-preset-save">保存当前方案</button><button class="action secondary" id="hb-preset-delete">删除选中方案</button></div><div id="hb-custom-presets"></div>${color('accent','强调色')}<div class="hint">主题切换不会覆盖背景图片 URL 和独立板块参数。</div></section>
<section data-page="tools" hidden><h3>页面诊断</h3><div class="grid"><button class="action" id="hb-scan">重新扫描卡片</button><button class="action secondary" id="hb-highlight">高亮识别结果</button></div><div class="status" id="hb-diagnostics">等待扫描</div><h3>配置管理</h3><div class="grid"><button class="action" id="hb-export">导出 JSON</button><button class="action secondary" id="hb-import">导入 JSON</button></div><input id="hb-file" type="file" accept=".json,application/json" hidden><div class="grid" style="margin-top:8px"><button class="action secondary" id="hb-copy">复制配置</button><button class="action secondary" id="hb-reset">恢复默认</button></div><h3>撤销/重做</h3><div class="grid"><button class="action secondary" id="hb-undo">撤销</button><button class="action secondary" id="hb-redo">重做</button></div><p class="hint">配置只保存在当前站点浏览器本地，不会修改 Hydro 服务端数据。</p></section>
</main><footer id="hb170-foot"><span style="font-size:11px;opacity:.65">更改自动保存</span><button id="hb-close">完成</button></footer>`;

    const history = [clone(settings)];
    let historyIndex = 0;
    function recordHistory() {
        if (JSON.stringify(history[historyIndex]) === JSON.stringify(settings)) return;
        history.splice(historyIndex + 1); history.push(clone(settings));
        if (history.length > 40) history.shift();
        historyIndex = history.length - 1;
    }
    function restoreHistory(i) {
        if (i < 0 || i >= history.length) return;
        historyIndex = i; imageToken++; settings = clone(history[i]); syncUI(); applyAll();
    }
    function groupValues(g) {
        const f = settings[g+'FollowGlobal'];
        return { opacity: f ? settings.cardOpacity : settings[g+'Opacity'], blur: f ? settings.blur : settings[g+'Blur'], radius: f ? settings.radius : settings[g+'Radius'] };
    }
    const CARD_SELECTORS = {
        academic: '#academic-root .ac-card,.academic-root .ac-card',
        table: '.main :is(table.data-table,table.section__table,.section__table-container table)',
        native: '.main :is(.section,.card,.ui.segment,.panel)'
    };
    const recognized = new Map();
    const tableScrolls = new Set();
    const counts = {academic:0,table:0,side:0,native:0};
    const EXCLUDED_SURFACE = '#hb170-panel,.scratchpad-container,.monaco-editor,.CodeMirror,.cm-editor,[contenteditable="true"]';
    function setCardStyle(el, group) {
        for (const g of GROUPS) el.classList.toggle('hb170-'+g, g === group);
        el.classList.add('hb170-card');
        el.classList.toggle('hb170-follow', !!settings[group+'FollowGlobal']);
        el.classList.toggle('hb170-no-border', !settings.border);
    }
    function tableParts(table) {
        const section = table.closest('.section');
        let scroll = table.closest('.record-scroll');
        if (!scroll) {
            for (let p = table.parentElement; p && p !== section && !p.matches('.main'); p = p.parentElement) {
                if (p.matches('.section__table-container,.section__table')) scroll = p;
            }
        }
        if (!scroll && table.parentElement?.matches('.section__body')) scroll = table.parentElement;
        if (!scroll) return null;
        const body = scroll.closest('.section__body');
        const isTableContent = el => el === scroll || el.matches('.section__table-container,.section__table,table.data-table,.pagination');
        const plainBody = body?.parentElement === section && [...body.children].every(isTableContent);
        const problemBank = section?.matches('html[data-page="problem_main"] .main .section:has(>.section__body>#searchForm)') && body?.parentElement === section;
        const plainSection = section && (problemBank || [...section.children].every(el => isTableContent(el) || el.matches('.section__header,.section__footer') || (plainBody && el === body)));
        return { scroll, card: plainSection ? section : scroll.matches('.section__body') ? null : scroll };
    }
    function markAcademicNavigation() {
        if (!$('#academic-root.academic')) return;
        const page = location.pathname.replace(/\/$/,'');
        for (const link of $$('.nav__item[href="/academic"]')) {
            const current = page === '/academic' ? 'page' : 'location';
            if (link.getAttribute('aria-current') !== current) link.setAttribute('aria-current', current);
        }
        for (const link of $$('#academic-root .ac-board-nav .ac-board-link[href],#ac-side-drawer .ac-board-nav .ac-board-link[href]')) {
            if (link.pathname.replace(/\/$/,'') === page && link.getAttribute('aria-current') !== 'page') {
                link.setAttribute('aria-current','page');
            }
        }
        const drawer = $('#ac-side-drawer');
        if (drawer) for (const trigger of $$('#academic-root .ac-drawer-trigger')) {
            if (!trigger.hasAttribute('aria-controls')) trigger.setAttribute('aria-controls',drawer.id);
            if (!trigger.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-haspopup','dialog');
            if (!trigger.textContent.trim() && !trigger.getAttribute('aria-label')) trigger.setAttribute('aria-label','学术分类');
        }
    }
    function scanCards() {
        Object.keys(counts).forEach(k => counts[k] = 0);
        const next = new Map(), nextScrolls = new Set();
        for (const el of $$(CARD_SELECTORS.academic)) if (!el.closest(EXCLUDED_SURFACE)) next.set(el,'academic');
        for (const table of $$(CARD_SELECTORS.table)) {
            if (table.closest(EXCLUDED_SURFACE)) continue;
            const parts = tableParts(table);
            if (!parts) continue;
            nextScrolls.add(parts.scroll);
            if (parts.card && !next.has(parts.card)) next.set(parts.card,'table');
        }
        for (const el of $$(CARD_SELECTORS.native)) {
            if (el.closest(EXCLUDED_SURFACE) || next.has(el)) continue;
            next.set(el,el.closest('.section.side,aside,.column--sidebar,.columns.medium-3') ? 'side' : 'native');
        }
        for (const el of tableScrolls) if (!nextScrolls.has(el)) el.classList.remove('hb170-table-wrap');
        tableScrolls.clear();
        for (const el of nextScrolls) { el.classList.add('hb170-table-wrap'); tableScrolls.add(el); }
        for (const el of recognized.keys()) if (!next.has(el)) el.classList.remove('hb170-card','hb170-follow','hb170-no-border',...GROUPS.map(g=>'hb170-'+g));
        recognized.clear();
        for (const [el,g] of next) { setCardStyle(el,g); recognized.set(el,g); counts[g]++; }
        markAcademicNavigation();
        for (const link of $$('.main .hb170-card .contest-problems>a[href]')) {
            const id = $(':scope > .id',link)?.textContent.trim();
            if (!id) continue;
            const status = [['pass','已通过'],['fail','未通过'],['pending','评测中']].find(([state])=>link.classList.contains(state));
            link.setAttribute('aria-label', status ? `题目 ${id}，${status[1]}` : `题目 ${id}`);
            if (link.classList.contains('active')) link.setAttribute('aria-current','page');
            else link.removeAttribute('aria-current');
        }
        const diag = $('#hb-diagnostics', panel);
        if (diag) diag.textContent = `扫描完成：${new Date().toLocaleTimeString()}\n普通卡片：${counts.native}\n题目表格：${counts.table}\n右侧栏：${counts.side}\n学术卡片：${counts.academic}\n总计：${Object.values(counts).reduce((a,b)=>a+b,0)}\n\n提示：若某个区域没有被识别，请展开该区域并重新扫描；也可提供该元素的 HTML class 以便增加适配规则。`;
        return { ...counts };
    }
    function scanMediaFrames() {
        if (!settings.mediaFrames) return;
        const region = ':is(.main .typo,.main .section__body,#academic-root .typo,.main .problem-content,.main .content)';
        for (const media of $$(region + ' :is(img,video,iframe,object,embed)')) {
            if (media.closest(EXCLUDED_SURFACE + ',.hb170-media-frame,nav,.nav,.header--mobile,.avatar,.user-avatar,.user__avatar,.problem__avatar,.icon,.menu__link,button')) continue;
            if (media.matches('[class*="avatar"],[class*="logo"],[class*="icon"]')) continue;
            const target = media.tagName === 'IMG' && media.parentElement?.tagName === 'PICTURE' ? media.parentElement : media;
            if (!target.parentNode) continue;
            const frame = document.createElement('span'); frame.className = 'hb170-media-frame'; frame.dataset.hbMediaFrame = '1';
            target.parentNode.insertBefore(frame, target); frame.appendChild(target);
        }
        $$('.contest-sidebar__bg').forEach(el => el.classList.add('hb170-media-surface'));
    }
    function highlightCards() {
        const els = [...recognized.keys()]; els.forEach(el => el.classList.add('hb170-inspector-highlight'));
        setTimeout(() => els.forEach(el => el.classList.remove('hb170-inspector-highlight')), 1800);
        toast(`已高亮 ${els.length} 个识别到的卡片`);
    }
    function applyBackground() {
        bg.style.display = settings.enabled ? 'block' : 'none';
        bg.style.background = settings.backgroundMode === 'gradient' ? `linear-gradient(${settings.gradientAngle}deg,${settings.gradientA},${settings.gradientB})` : settings.background;
        bgImage.style.backgroundImage = settings.image ? `url("${String(settings.image).replace(/["\\]/g, '\\$&')}")` : 'none';
        bgImage.style.backgroundPosition = settings.bgPosition; bgImage.style.backgroundSize = settings.bgSize;
        bgImage.style.opacity = settings.opacity / 100;
        bgImage.style.filter = `blur(${settings.bgBlur}px) saturate(${settings.saturation}%) brightness(${settings.brightness}%) contrast(${settings.contrast}%)`;
        bgImage.style.display = settings.backgroundMode === 'gradient' ? 'none' : 'block';
        bgOverlay.style.background = rgba(settings.overlayColor, settings.overlay / 100);
        bgNoise.style.display = settings.noise ? 'block' : 'none';
    }
    let activeLayout = null;
    function applyLayoutMode() {
        const mode = settings.layoutMode;
        let next = null;
        if (settings.layoutEnabled && mode !== 'auto' && !document.body.classList.contains('mode--scratchpad')) {
            for (const row of $$('.main .row')) {
                if (row.closest('.section,.scratchpad-container')) continue;
                const columns = [...row.children].filter(el=>el.matches('.column,.columns,aside'));
                if (columns.length !== 2) continue;
                const sides = columns.filter(el=>el.matches('aside,.column--sidebar') || el.querySelector('.section.side') || (el.matches('.medium-3,.large-3') && columns.some(x=>x.matches('.medium-9,.large-9'))));
                if (sides.length !== 1) continue;
                const side = sides[0], main = columns.find(el=>el!==side);
                next = {row,main,side,mode}; break;
            }
        }
        if (activeLayout && (!next || activeLayout.row !== next.row || activeLayout.main !== next.main || activeLayout.side !== next.side || activeLayout.mode !== mode)) {
            const {row,main,side,mode:previous} = activeLayout;
            row.classList.remove('hb170-layout-columns','hb170-layout-'+previous);
            row.style.removeProperty('--hb-side-width');
            main.classList.remove('hb170-layout-main'); side.classList.remove('hb170-layout-side');
            activeLayout = null;
        }
        if (!next) return;
        const {row,main,side} = next;
        row.style.setProperty('--hb-side-width',settings.sideWidth+'%');
        row.classList.add('hb170-layout-columns','hb170-layout-'+mode);
        main.classList.add('hb170-layout-main'); side.classList.add('hb170-layout-side');
        activeLayout = next;
    }
    function applyAll(rescan = true, persist = true) {
        const root = document.documentElement, body = document.body, darkRGB = settings.dark ? '29,32,45' : '255,255,255';
        const vars = {
            '--hb-accent':settings.accent, '--hb-global-bg':`rgba(${darkRGB},${settings.cardOpacity/100})`, '--hb-global-blur':settings.blur+'px', '--hb-global-radius':settings.radius+'px',
            '--hb-global-border':settings.border ? rgba(settings.dark?'#ffffff':'#465069',settings.borderOpacity/100) : 'transparent',
            '--hb170-border-width':(settings.border ? settings.borderWidth : 0)+'px',
            '--hb-global-shadow':settings.shadow ? `0 8px 28px rgba(0,0,0,${settings.shadowStrength/100})` : 'none',
            '--hb-global-padding':settings.cardPadding+'px', '--hb-media-frame-padding':settings.mediaFramePadding+'px', '--hb-page-width':settings.width+'px', '--hb-layout-gap':settings.gap+'px',
            '--hb-panel-bg':settings.dark?'rgba(30,33,46,.97)':'rgba(250,251,255,.97)', '--hb-text':settings.dark?'#f0f0f5':'#303444',
            '--hb-panel-muted':settings.dark?'#b5bacb':'#595f6e', '--hb-panel-line':settings.dark?'#ffffff2b':'#29354f33',
            '--hb-panel-fill':settings.dark?'#ffffff12':'#29354f0d', '--hb-panel-control-text':accentInk(settings.accent),
            '--hb-trigger-bg':rgba(settings.accent,settings.cardOpacity/100), '--hb-trigger-ink':accentInk(settings.accent,settings.cardOpacity/100),
            '--hb-font-scale':settings.fontScale/100
        };
        for (const g of GROUPS) { const v = groupValues(g); vars[`--hb-${g}-bg`] = `rgba(${darkRGB},${v.opacity/100})`; vars[`--hb-${g}-blur`] = v.blur+'px'; vars[`--hb-${g}-radius`] = v.radius+'px'; }
        Object.entries(vars).forEach(([k,v]) => root.style.setProperty(k,v));
        root.classList.toggle('hb170-bg-active', settings.enabled && settings.transparent);
        for (const [cls,val] of Object.entries({'bg-active':settings.enabled && settings.transparent,'transparent':settings.enabled && settings.transparent,'layout':settings.layoutEnabled,'compact':settings.compact,'striped':settings.striped,'shadow':settings.shadow,'border-off':!settings.border,'media-frames':settings.mediaFrames,'light':!settings.dark})) body.classList.toggle('hb170-'+cls,!!val);
        root.classList.toggle('hb170-font-scale', Number(settings.fontScale)!==100);
        applyBackground();
        // 更新跟随状态，不必每次滑动都重新搜索 DOM。
        if (rescan) scanCards(); else for (const [el,g] of recognized) if (el.isConnected) setCardStyle(el,g);
        if (rescan && settings.mediaFrames) scanMediaFrames();
        applyLayoutMode(); if (persist) save();
    }
    const units = {cardOpacity:'%',blur:'px',radius:'px',cardPadding:'px',borderOpacity:'%',borderWidth:'px',shadowStrength:'%',width:'px',gap:'px',sideWidth:'%',fontScale:'%',opacity:'%',bgBlur:'px',overlay:'%',saturation:'%',brightness:'%',contrast:'%',gradientAngle:'°',mediaFramePadding:'px'};
    function updateLabels() {
        for (const input of $$('[data-range]', panel)) {
            const k = input.dataset.range, label = settings[k]+(units[k] || (k.endsWith('Opacity') ? '%' : 'px'));
            $('#v-'+k,panel).textContent = label; input.setAttribute('aria-valuetext', label);
        }
    }
    function updateGroupInputs() { for (const g of GROUPS) for (const p of ['Opacity','Blur','Radius']) { const el = $(`[data-range="${g+p}"]`,panel); if (el) el.disabled = !!settings[g+'FollowGlobal']; } }
    function updatePresetButtons() { $$('[data-theme]',panel).forEach(el => el.classList.toggle('active',el.dataset.theme===settings.preset)); }
    function renderCustomPresets() {
        const box = $('#hb-custom-presets',panel);
        box.innerHTML = Object.keys(customPresets).length ? Object.keys(customPresets).map(name => `<div class="item grid"><button class="preset" data-custom-load="${escapeHTML(name)}">${escapeHTML(name)}</button><button class="action secondary" data-custom-delete="${escapeHTML(name)}">删除</button></div>`).join('') : '<p class="hint">暂无自定义方案</p>';
        $$('[data-custom-load]',box).forEach(b => b.addEventListener('click', () => { imageToken++; settings = mergedSettings({...settings,...customPresets[b.dataset.customLoad],preset:'custom'}); syncUI(); changed(); toast('已加载方案：'+b.dataset.customLoad); }));
        $$('[data-custom-delete]',box).forEach(b => b.addEventListener('click', () => { delete customPresets[b.dataset.customDelete]; savePresets(); renderCustomPresets(); }));
    }
    function syncUI() {
        $$('[data-range]',panel).forEach(el => el.value = settings[el.dataset.range]);
        $$('[data-check]',panel).forEach(el => el.checked = !!settings[el.dataset.check]);
        $$('[data-color]',panel).forEach(el => el.value = settings[el.dataset.color]);
        $$('[data-select]',panel).forEach(el => el.value = settings[el.dataset.select]);
        $('#hb-image-url',panel).value = settings.image || '';
        updateLabels(); updatePresetButtons(); updateGroupInputs(); renderCustomPresets();
    }
    function changed() { updateLabels(); updateGroupInputs(); applyAll(); recordHistory(); }
    panel.addEventListener('input', e => {
        const el = e.target;
        if (el.matches('[data-range]')) { settings[el.dataset.range] = Number(el.value); updateLabels(); applyAll(false, false); }
        else if (el.matches('[data-check]')) { settings[el.dataset.check] = el.checked; updateGroupInputs(); applyAll(false, false); if (el.dataset.check==='mediaFrames') scanMediaFrames(); }
        else if (el.matches('[data-color]')) { settings[el.dataset.color] = el.value; settings.preset = 'custom'; applyAll(false, false); updatePresetButtons(); }
    });
    panel.addEventListener('change', e => {
        const el = e.target;
        if (el.matches('[data-select]')) { settings[el.dataset.select] = el.value; applyAll(false, false); }
        if (el.matches('[data-range],[data-check],[data-color],[data-select]')) { save(); recordHistory(); }
    });
    const tabButtons = $$('[data-tab]', panel);
    tabButtons.forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
        btn.addEventListener('click', () => {
            tabButtons.forEach(x => { x.classList.toggle('active',x===btn); x.setAttribute('aria-pressed',String(x===btn)); });
            $$('[data-page]',panel).forEach(x => x.hidden = x.dataset.page!==btn.dataset.tab);
        });
    });
    $('#hb-follow-all',panel).addEventListener('click', () => { GROUPS.forEach(g => settings[g+'FollowGlobal']=true); syncUI(); changed(); toast('所有板块已改为跟随全局'); });
    $('#hb-reset-groups',panel).addEventListener('click', () => { GROUPS.forEach(g => {settings[g+'Opacity']=settings.cardOpacity;settings[g+'Blur']=settings.blur;settings[g+'Radius']=settings.radius;}); syncUI(); changed(); toast('独立参数已重置为当前全局值'); });
    let imageToken = 0;
    function applyImage(url) {
        const status = $('#hb-image-status',panel), token = ++imageToken, value = String(url||'').trim();
        if (!value) { settings.image=''; $('#hb-image-url',panel).value=''; applyAll(false); recordHistory(); status.textContent='已清除背景图片'; return; }
        let parsed;
        try { parsed = new URL(value,location.href); } catch { status.textContent='URL 格式不正确'; return; }
        if (!['http:','https:'].includes(parsed.protocol)) { status.textContent='仅支持 HTTP/HTTPS 图片'; return; }
        status.textContent='正在检查图片...'; const img = new Image();
        img.onload = () => { if (token!==imageToken) return; settings.image=parsed.href; settings.backgroundMode='image'; syncUI(); applyAll(); recordHistory(); status.textContent=`加载成功：${img.naturalWidth} × ${img.naturalHeight}`; toast('背景图片已应用'); };
        img.onerror = () => { if (token===imageToken) status.textContent='图片加载失败，原背景保持不变'; }; img.src=parsed.href;
    }
    $('#hb-image-apply',panel).addEventListener('click', () => applyImage($('#hb-image-url',panel).value));
    $('#hb-image-clear',panel).addEventListener('click', () => { applyImage(''); $('#hb-image-url',panel).value=''; });
    $$('[data-theme]',panel).forEach(btn => btn.addEventListener('click', () => { const name=btn.dataset.theme; if (!THEMES[name]) return; imageToken++; Object.assign(settings,THEMES[name],{preset:name}); syncUI(); changed(); toast('已切换主题：'+name); }));
    $('#hb-preset-save',panel).addEventListener('click', () => { const name=$('#hb-preset-name',panel).value.trim(); if (!name) return toast('请先输入方案名称'); Object.defineProperty(customPresets,name,{value:clone(settings),writable:true,enumerable:true,configurable:true}); savePresets(); renderCustomPresets(); toast('方案已保存'); });
    $('#hb-preset-delete',panel).addEventListener('click', () => { const name=$('#hb-preset-name',panel).value.trim(); if (!name || !Object.prototype.hasOwnProperty.call(customPresets,name)) return toast('请输入已存在的方案名称'); delete customPresets[name]; savePresets(); renderCustomPresets(); toast('方案已删除'); });
    function downloadJSON(filename,data) { const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1200); }
    $('#hb-export',panel).addEventListener('click', () => { downloadJSON(`hydro-ui-beautifier-v${VERSION}-config.json`,{app:'Hydro UI Beautifier',version:VERSION,exportedAt:new Date().toISOString(),settings,customPresets}); toast('配置已导出'); });
    const file=$('#hb-file',panel);
    $('#hb-import',panel).addEventListener('click',()=>file.click());
    file.addEventListener('change',async()=>{
        const f=file.files?.[0]; if(!f)return;
        try { const data=JSON.parse(await f.text()); const src=data?.settings ?? data; if(!src||typeof src!=='object'||Array.isArray(src)) throw new Error('配置结构无效'); imageToken++; settings=mergedSettings(src); if(data.customPresets && typeof data.customPresets==='object' && !Array.isArray(data.customPresets)){customPresets=data.customPresets;savePresets();} syncUI();applyAll();recordHistory();toast('配置导入成功'); }
        catch(e){toast('导入失败：'+e.message);} file.value='';
    });
    $('#hb-copy',panel).addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify({settings,customPresets},null,2));toast('配置已复制');}catch{toast('复制失败，请使用导出 JSON');}});
    $('#hb-reset',panel).addEventListener('click',()=>{if(!confirm('确定恢复全部默认设置？背景图片和自定义方案也会清空。'))return;settings=clone(DEFAULTS);customPresets={};savePresets();imageToken++;syncUI();applyAll();recordHistory();toast('已恢复默认设置');});
    $('#hb-undo',panel).addEventListener('click',()=>restoreHistory(historyIndex-1));
    $('#hb-redo',panel).addEventListener('click',()=>restoreHistory(historyIndex+1));
    $('#hb-scan',panel).addEventListener('click',()=>{scanCards();if(settings.mediaFrames)scanMediaFrames();toast('页面卡片扫描完成');});
    $('#hb-highlight',panel).addEventListener('click',highlightCards);
    function setPanelOpen(open) {
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        if (open) { scanCards(); $('.active[data-tab]',panel)?.focus({preventScroll:true}); }
        else if (panel.contains(document.activeElement) || document.activeElement === document.body) trigger.focus({preventScroll:true});
    }
    trigger.addEventListener('click',()=>setPanelOpen(panel.hidden));
    $('#hb-close',panel).addEventListener('click',()=>setPanelOpen(false));
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && !panel.hidden && (panel.contains(e.target) || e.target===trigger)){e.preventDefault();setPanelOpen(false);}});

    // 修复吸底：查找 main 和页脚的共同父容器，然后在这个容器内布局。
    function applyStickyFooter() {
        const body=document.body; if(!body)return;
        const mainEl=$('#panel .main')||$('.main')||$('#main');
        const candidates=$$('#panel .footer,#panel footer,.footer,#footer,.page-footer,.footer-container').filter(el=>!el.closest('#hb170-panel'));
        const footerEl=candidates.find(el=>/Powered by Hydro|Worker|Language/i.test(el.textContent||''))||candidates[0];
        let shell=mainEl?.parentElement || null;
        while(shell && footerEl && !shell.contains(footerEl)) shell=shell.parentElement;
        const directChild=el=>{let n=el;while(n && n.parentElement!==shell)n=n.parentElement;return n;};
        let mainItem=null,footerItem=null;
        if(shell && shell!==document.documentElement && mainEl && footerEl){mainItem=directChild(mainEl);footerItem=directChild(footerEl);}
        if(!mainItem||!footerItem||mainItem===footerItem){shell=null;mainItem=null;footerItem=null;}
        $$('.hb170-sticky-shell').forEach(el=>{if(el!==shell){el.classList.remove('hb170-sticky-shell');el.style.removeProperty('--hb-shell-offset');}});
        $$('.hb170-sticky-main').forEach(el=>{if(el!==mainItem)el.classList.remove('hb170-sticky-main');});
        $$('.hb170-sticky-footer').forEach(el=>{if(el!==footerItem)el.classList.remove('hb170-sticky-footer');});
        if(!shell)return;
        const offset=shell===body?0:Math.max(0,shell.getBoundingClientRect().top+window.scrollY);
        shell.style.setProperty('--hb-shell-offset',`${offset}px`);
        shell.classList.add('hb170-sticky-shell');mainItem.classList.add('hb170-sticky-main');footerItem.classList.add('hb170-sticky-footer');
    }
    function mount() {
        if(!document.body)return;
        if(bg.parentNode!==document.body)document.body.prepend(bg);
        if(trigger.parentNode!==document.body)document.body.append(trigger);
        if(panel.parentNode!==document.body)document.body.append(panel);
    }
    // 获取 Hydro 当前响应式根字号（不把之前的缩放再计入基准）。
    function refreshBaseFontSize() {
        const root = document.documentElement;
        const scaled = root.classList.contains('hb170-font-scale');
        if (scaled) root.classList.remove('hb170-font-scale');
        const size = parseFloat(getComputedStyle(root).fontSize);
        if (scaled) root.classList.add('hb170-font-scale');
        if (Number.isFinite(size) && size > 0) root.style.setProperty('--hb-base-font-size', size + 'px');
    }
    mount(); applyStickyFooter(); syncUI(); refreshBaseFontSize(); applyAll();
    window.addEventListener('resize',()=>{refreshBaseFontSize();applyStickyFooter();});
    // 每帧合并站点更新，忽略设置面板和媒体包装自身产生的变动。
    const ownUI = '#hb170-panel,#hb170-trigger,#hb170-background,#hb170-toast,.hb170-media-frame';
    const isOwn = node => node.nodeType === 1 && node.matches(ownUI);
    let queuedScan = 0;
    const observer=new MutationObserver(records=>{
        if (queuedScan || !records.some(r=>{
            if (r.target.closest?.(ownUI)) return false;
            const added = [...r.addedNodes], removed = [...r.removedNodes];
            if (added.length && added.every(isOwn)) return false;
            return [...added,...removed].some(n=>n.nodeType===1 && !isOwn(n));
        })) return;
        queuedScan=requestAnimationFrame(()=>{queuedScan=0;mount();scanCards();scanMediaFrames();applyLayoutMode();applyStickyFooter();});
    });
    observer.observe(document.body,{childList:true,subtree:true});
    let inScratchpad = document.body.classList.contains('mode--scratchpad');
    new MutationObserver(()=>{
        const next = document.body.classList.contains('mode--scratchpad');
        if (next !== inScratchpad) { inScratchpad = next; applyLayoutMode(); }
    }).observe(document.body,{attributes:true,attributeFilter:['class']});
    console.info(`[Hydro UI Beautifier] v${VERSION} loaded`);
})();


```

:::

