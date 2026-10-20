/**
 * 离线单文件版的全局构建标记。
 *
 * - 线上站点（`npm run build`）：vite.config.ts 把 `__STARLOG_OFFLINE__` 定义为 `false`
 * - 离线单文件（`npm run build:offline`）：vite.offline.config.ts 定义为 `true`
 *
 * 读取时一律通过 `typeof` 守卫（见 src/lib/runtime.ts），这样在未注入该定义的
 * 打包环境（如 VS Code 扩展用 esbuild 直接打包 src/lib 的部分模块）里也只是
 * 得到 `false`，不会抛 ReferenceError。
 */
declare const __STARLOG_OFFLINE__: boolean
