/**
 * 离线单文件版的存储层。
 *
 * 目标：让 `file://` 下打开的单个 HTML 也能可靠保存文章、图片与偏好设置。
 *
 * 层级（按可用性依次尝试）：
 *   1. IndexedDB —— 容量大（可存放 base64 图片），离线版首选；
 *   2. localStorage —— IndexedDB 不可用（部分浏览器在 `file://` 下禁用 IDB、无痕模式）时降级，
 *      容量约 5MB，并且明确告知用户容量限制；
 *   3. 两者都不可用 —— **不做静默的内存兜底**（内存态关页面即丢，属于静默数据丢失）：
 *      `status.error` 记录原因，`setItem` 直接抛错，界面显示阻断式错误页
 *      （src/components/StorageGuard.tsx）。
 *
 * 任何一层的写入失败都会：console.error + 触发 `starlog:storage-error` 事件
 * （界面据此弹错误 toast），并且关键操作（发布、导入档案）会 `await flushStorage()`
 * 让失败以异常形式冒到调用方的提示里，不会「假装保存成功」。
 *
 * 实现方式：离线版启动时（main.tsx 第一行 import）用一层镜像替换 `window.localStorage`，
 * 因此站内既有的 `localStorage.getItem/setItem` 代码（草稿、待更新队列、偏好设置、评论…）
 * 无需逐个改造即可享受 IndexedDB 容量与「先写内存 + 异步落盘」的语义。
 * 线上站点不安装这层镜像，行为与之前完全一致。
 */

import { OFFLINE } from './runtime'

const DB_NAME = 'starlog-offline'
const DB_STORE = 'kv'
/** 站内所有本地键都以 starlog: 开头（STORAGE_KEYS 与各 *_KEY） */
const KEY_PREFIX = 'starlog:'
/** 单键落盘的防抖窗口（毫秒）；flushStorage() 会立刻越过它 */
const WRITE_DEBOUNCE = 200

export type StorageBackend = 'indexeddb' | 'localstorage' | 'none'

export interface OfflineStorageStatus {
  backend: StorageBackend
  /** 是否已完成初始化（init 成功后为 true） */
  ready: boolean
  /** 存储错误说明；空字符串表示正常。非空时界面必须显示错误提示 */
  error: string
  /** 最近若干条存储问题（用于错误面板，最新的在前） */
  issues: string[]
  /** 是否有尚未落盘成功的改动 */
  dirty: boolean
  /** 已用字节（近似：所有键值长度之和） */
  bytes: number
}

export const storageStatus: OfflineStorageStatus = {
  backend: 'none',
  ready: false,
  error: '',
  issues: [],
  dirty: false,
  bytes: 0,
}

const STORAGE_ERROR_EVENT = 'starlog:storage-error'

const mirror = new Map<string, string>()
const pending = new Map<string, string | null>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let inflight = new Set<Promise<unknown>>()
/** 自上次 flush 以来出现过的落盘错误；flush 时作为异常抛出 */
let pendingFailures: string[] = []
/** 落盘失败过的键（镜像里有值但磁盘上没有）；只要非空，界面就必须继续显示「未确认写入」 */
const failedWrites = new Set<string>()

/**
 * dirty 只表示「有内容还没确认落盘」。
 * 千万别把它当成「出过任何警告」——例如 file:// 下 IndexedDB 被禁用、我们降级到 localStorage，
 * 那是一次正常的降级提示，此时写入其实已经同步落盘，如果 dirty 被点亮，
 * 用户每次打开离线文件都会看到一条吓人的「改动可能丢失」横幅。
 */
function syncDirty() {
  storageStatus.dirty = pending.size > 0 || timers.size > 0 || failedWrites.size > 0
}
let idb: IDBDatabase | null = null
/** 真实的 localStorage（安装镜像前拿到的引用，用于双写与首屏读取） */
let nativeStorage: Storage | null = null
let installed = false

function reportError(message: string, cause?: unknown, opts: { fatal?: boolean } = { fatal: true }) {
  if (opts.fatal) storageStatus.error = message
  storageStatus.issues = [message, ...storageStatus.issues].slice(0, 8)
  syncDirty()
  if (typeof console !== 'undefined') {
    if (cause) console.error(`[离线存储] ${message}`, cause)
    else console.error(`[离线存储] ${message}`)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { message } }))
  }
}

/** 订阅存储错误（界面用它弹 toast / 显示横幅） */
export function onStorageError(handler: (message: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail
    handler(detail?.message || storageStatus.error || '本地存储不可用')
  }
  window.addEventListener(STORAGE_ERROR_EVENT, listener)
  return () => window.removeEventListener(STORAGE_ERROR_EVENT, listener)
}

/** 存储不可用时直接抛错的统一出口 */
function storageUnavailableError(): Error {
  return new Error(
    storageStatus.error ||
      '本地存储不可用：IndexedDB 与 localStorage 都无法写入。为免丢失数据，已拒绝本次保存，请先解决存储问题。',
  )
}

function assertUsable() {
  if (storageStatus.backend === 'none' && storageStatus.ready) throw storageUnavailableError()
}

/* --------------------------------- IndexedDB -------------------------------- */

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = typeof indexedDB === 'undefined' ? null : indexedDB
    if (!factory) {
      reject(new Error('当前浏览器在本页禁用了 IndexedDB（file:// 或无痕模式常见）'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, 1)
    } catch (err) {
      reject(err instanceof Error ? err : new Error('IndexedDB 打开失败'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
    }
    // 用户在浏览器里拒绝过存储权限时，open 会直接 error；这里不静默吞掉
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打不开（站点数据被禁止）'))
    request.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞，请关闭同站旧标签页后重试'))
    request.onsuccess = () => resolve(request.result)
  })
}

function idbReadAll(db: IDBDatabase): Promise<Array<[IDBValidKey, unknown]>> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly')
      const store = tx.objectStore(DB_STORE)
      const out: Array<[IDBValidKey, unknown]> = []
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const result = cursor.result
        if (result) {
          out.push([result.key, result.value])
          result.continue()
        } else {
          resolve(out)
        }
      }
      cursor.onerror = () => reject(cursor.error ?? new Error('IndexedDB 读取失败'))
    } catch (err) {
      reject(err instanceof Error ? err : new Error('IndexedDB 读取失败'))
    }
  })
}

function idbWrite(key: string, value: string | null): Promise<unknown> {
  const db = idb
  if (!db) return Promise.resolve()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite')
      const store = tx.objectStore(DB_STORE)
      if (value === null) store.delete(key)
      else store.put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止（存储已满或被拒绝）'))
    } catch (err) {
      reject(err instanceof Error ? err : new Error('IndexedDB 写入失败'))
    }
  })
}

/* --------------------------------- 落盘调度 -------------------------------- */

function countBytes() {
  let total = 0
  for (const [key, value] of mirror) total += key.length + value.length
  storageStatus.bytes = total
  return total
}

function schedule(key: string) {
  if (storageStatus.backend !== 'indexeddb') return
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void persist(key)
    }, WRITE_DEBOUNCE),
  )
}

/** 把单个键真正写进当前后端；返回的 Promise 在落盘成功后才 resolve */
function durableWrite(key: string, value: string | null): Promise<unknown> {
  // localStorage 后端：镜像里的值要在这里确认写进真实 storage（首次写入已在 writeNative 做过，
  // 这里既覆盖「之前失败现在重试」的情况，也让 flush 的语义在两种后端下保持一致）
  if (storageStatus.backend !== 'indexeddb') {
    writeNative(key, value)
    return Promise.resolve()
  }
  return idbWrite(key, value)
}

function persist(key: string): Promise<void> {
  const value = pending.get(key)
  if (value === undefined) return Promise.resolve()
  pending.delete(key)
  const task = durableWrite(key, value)
    .then(() => {
      failedWrites.delete(key)
      syncDirty()
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : '本地存储写入失败'
      pendingFailures.push(message)
      failedWrites.add(key)
      reportError(
        `${storageStatus.backend === 'indexeddb' ? 'IndexedDB' : 'localStorage'} 写入失败（${message}）。` +
          '改动目前只在内存里，关闭页面前请在「设置 → 离线版」导出档案备份。',
        err,
      )
    })
  inflight.add(task)
  void task.finally(() => inflight.delete(task))
  return task
}

/**
 * 把在途写入立刻刷盘。
 * 关键操作（发布、导入、同步）后必须 await：若有落盘失败，这里抛出，
 * 调用方的 toast / 错误提示就能直接告诉用户「没保存成功」。
 */
export async function flushStorage(): Promise<void> {
  for (const key of [...timers.keys()]) {
    clearTimeout(timers.get(key))
    timers.delete(key)
    pending.set(key, mirror.get(key) ?? null)
  }
  const tasks = [...pending.keys()].map((key) => persist(key))
  await Promise.all([...tasks, ...inflight])
  const failures = pendingFailures
  pendingFailures = []
  syncDirty()
  if (failures.length > 0) {
    throw new Error(
      failures.length > 1 ? `本地存储未能写入（${failures.length} 项）：${failures[0]}` : `本地存储未能写入：${failures[0]}`,
    )
  }
  if (typeof navigator !== 'undefined' && 'storage' in navigator) {
    // 请求浏览器把这条来源的数据标记为持久化（失败不影响结果）
    try {
      await (navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } }).storage?.persist?.()
    } catch {
      /* 忽略：只是最佳努力 */
    }
  }
}

/** 存储是否健康；不健康时抛错，供「保存」之类的路径在成功提示前调用 */
export async function assertStorageHealthy(): Promise<void> {
  if (storageStatus.backend === 'none') throw storageUnavailableError()
  await flushStorage()
}

/* --------------------------------- 镜像安装 -------------------------------- */

function writeNative(key: string, value: string | null) {
  // IndexedDB 可用时，localStorage 是第二份冗余副本：它失败要说明，但不必否定主存储；
  // 只用 localStorage 时，它失败就是真失败，必须抛出（上层会给出「空间不足」提示）。
  try {
    if (!nativeStorage) throw new Error('localStorage 不可用（浏览器禁用或无痕模式）')
    if (value === null) nativeStorage.removeItem(key)
    else nativeStorage.setItem(key, value)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'localStorage 写入失败'
    if (storageStatus.backend === 'localstorage') {
      failedWrites.add(key)
      reportError(`localStorage 写入失败（${message}）。请清理离线文章库中的超大内容，或改用 IndexedDB 可用的浏览器。`, err)
      throw new DOMException(`本地存储空间不足或不可写：${message}`, 'QuotaExceededError')
    }
    reportError(`localStorage 冗余副本写入失败（${message}）；数据已写入 IndexedDB，但失去第二份备份。`, err, {
      fatal: false,
    })
  }
}

function makeShim(): Storage {
  const keysOf = () => [...mirror.keys()]
  return {
    get length() {
      return mirror.size
    },
    getItem: (key: string) => (mirror.has(key) ? (mirror.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      assertUsable()
      const text = String(value)
      mirror.set(key, text)
      pending.set(key, text)
      countBytes()
      writeNative(key, text)
      schedule(key)
      syncDirty()
    },
    removeItem: (key: string) => {
      assertUsable()
      mirror.delete(key)
      pending.set(key, null)
      countBytes()
      writeNative(key, null)
      schedule(key)
      syncDirty()
    },
    key: (index: number) => keysOf()[index] ?? null,
    clear: () => {
      assertUsable()
      for (const key of keysOf()) {
        mirror.delete(key)
        pending.set(key, null)
        writeNative(key, null)
        schedule(key)
      }
      countBytes()
    },
  } as unknown as Storage
}

/**
 * 安装存储镜像。必须在任何读取 localStorage 的业务模块求值之前调用
 * （main.tsx 第一行 import 即本模块，模块求值时同步完成安装）。
 */
export function installOfflineStorage(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  try {
    nativeStorage = window.localStorage
  } catch (err) {
    nativeStorage = null
    reportError('浏览器禁止访问 localStorage（无痕模式或站点数据被屏蔽）。', err, { fatal: false })
  }
  // 同步种子：让首屏脚本之后、init 完成之前的读取也能拿到已有数据
  if (nativeStorage) {
    try {
      for (let i = 0; i < nativeStorage.length; i += 1) {
        const key = nativeStorage.key(i)
        if (!key || !key.startsWith(KEY_PREFIX)) continue
        const value = nativeStorage.getItem(key)
        if (value !== null) mirror.set(key, value)
      }
    } catch (err) {
      reportError('读取 localStorage 失败，本机已有数据可能无法恢复。', err, { fatal: false })
    }
  }
  countBytes()
  try {
    Object.defineProperty(window, 'localStorage', {
      value: makeShim(),
      configurable: true,
      writable: true,
    })
  } catch (err) {
    // 极少数浏览器不允许覆盖 window.localStorage：继续用原生实现（仍是持久化的），但必须告警
    reportError('浏览器禁止接管 localStorage，离线文章库退化为原生 localStorage（约 5MB 上限）。', err, {
      fatal: false,
    })
  }
}

/**
 * 异步初始化：打开 IndexedDB 并把其中的数据覆盖进镜像（IndexedDB 的值优先）。
 * 必须在 React 渲染前 await 完成，保证之后所有同步读取都拿得到完整数据。
 */
export async function initOfflineStorage(): Promise<OfflineStorageStatus> {
  installOfflineStorage()
  let idbError = ''
  try {
    idb = await openDatabase()
    const records = await idbReadAll(idb)
    for (const [key, value] of records) {
      if (typeof key !== 'string' || typeof value !== 'string') continue
      mirror.set(key, value)
    }
    storageStatus.backend = 'indexeddb'
    storageStatus.error = ''
  } catch (err) {
    idbError = err instanceof Error ? err.message : 'IndexedDB 不可用'
    if (typeof console !== 'undefined') {
      console.warn(`[离线存储] IndexedDB 不可用（${idbError}），尝试使用 localStorage。`, err)
    }
  }

  if (storageStatus.backend !== 'indexeddb') {
    let writable = false
    try {
      if (nativeStorage) {
        nativeStorage.setItem(`${KEY_PREFIX}:probe`, '1')
        nativeStorage.removeItem(`${KEY_PREFIX}:probe`)
        writable = true
      }
    } catch {
      writable = false
    }
    if (writable) {
      storageStatus.backend = 'localstorage'
      storageStatus.error = ''
      reportError(
        `IndexedDB 不可用（${idbError}），已降级到 localStorage：容量约 5MB，图片请改用外链或较小的文件。`,
        undefined,
        { fatal: false },
      )
    } else {
      storageStatus.backend = 'none'
      reportError(
        `本地存储完全不可用：IndexedDB 失败（${idbError}），localStorage 也无法写入。` +
          '离线文章无法保存，已拒绝一切写入以免丢失数据。' +
          '解决办法：用 Chrome / Edge / Firefox 正常窗口直接双击打开本文件，' +
          '或在同目录执行 `npx serve .` 后用 http://localhost:3000 打开。',
      )
    }
  }

  storageStatus.ready = true
  countBytes()

  if (typeof window !== 'undefined') {
    const flush = () => void flushStorage().catch((err: unknown) => reportError(String(err instanceof Error ? err.message : err), err))
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }
  return storageStatus
}

/* ------------------------------ 档案导出 / 导入 ----------------------------- */

/** 导出全部站内本地数据（离线档案备份：文章、偏好、待同步图片等） */
export function exportLocalRecords(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of mirror) if (key.startsWith(KEY_PREFIX)) out[key] = value
  return out
}

/**
 * 导入离线档案（exportLocalRecords 的结果）。
 * `replace` 为 true 时先清空现有 starlog:* 键，使导入结果与备份完全一致。
 */
export async function importLocalRecords(
  records: Record<string, string>,
  replace = false,
): Promise<number> {
  assertUsable()
  const entries = Object.entries(records).filter(
    ([key, value]) => typeof key === 'string' && key.startsWith(KEY_PREFIX) && typeof value === 'string',
  )
  if (entries.length === 0) throw new Error('档案中没有可导入的 starlog:* 数据')
  if (replace) {
    for (const key of [...mirror.keys()]) {
      if (!key.startsWith(KEY_PREFIX)) continue
      mirror.delete(key)
      pending.set(key, null)
      writeNative(key, null)
      schedule(key)
    }
  }
  for (const [key, value] of entries) {
    mirror.set(key, value)
    pending.set(key, value)
    writeNative(key, value)
    schedule(key)
  }
  countBytes()
  await flushStorage()
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
  window.dispatchEvent(new CustomEvent('starlog:settings-changed'))
  window.dispatchEvent(new CustomEvent('starlog:queue-changed'))
  return entries.length
}

/* -------------------------- 模块求值阶段就接管存储 ------------------------- */
// 离线版必须在任何业务模块读取 localStorage 之前装好镜像（否则首屏会读到未接管的存储，
// 且之后写入的数据不再进入镜像），所以在模块求值阶段安装；
// initOfflineStorage() 只负责异步补齐 IndexedDB 里的既有数据。
if (OFFLINE) installOfflineStorage()

/** 当前使用的存储后端（设置页展示） */
export function describeBackend(): string {
  switch (storageStatus.backend) {
    case 'indexeddb':
      return 'IndexedDB（大容量，适合保存文章与图片）'
    case 'localstorage':
      return 'localStorage（约 5MB 上限，建议图片使用外链）'
    default:
      return '不可用'
  }
}
