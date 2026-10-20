import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Download, FileJson, HardDrive, Image as ImageIcon, ListChecks, RefreshCw } from 'lucide-react'
import { OFFLINE } from '../lib/runtime'
import {
  countLocalContent,
  exportBundleFile,
  BUNDLE_FILE_SUFFIX,
} from '../lib/offlineBundle'
import { getAllPosts } from '../lib/posts'
import { formatDate } from '../lib/posts'
import { useToast } from './Toast'
import BundleImportDialog from './BundleImportDialog'

/**
 * 离线版的「带到线上站点」面板（管理页 → 带到线上）。
 *
 * 这里**没有任何网络调用**：离线文件不登录、不授权、不提交仓库。
 * 唯一的出口是导出一个文章包文件，由线上站点的「管理 → 导入离线文章包」写进
 * 该站点的本地文章列表，再走站点自己的待更新队列提交与部署。
 *
 * 之所以不做「一键直推」：那需要 GitHub 授权与 API 请求，属于在线功能；
 * 而 `file://` 的本机存储与站点来源彼此隔离，也无法替站点写好它的本地列表。
 * 一个可核对、可留存的文件才是诚实的接口。
 */

const STEPS = [
  `1. 在这里勾选文章，导出一个 .${BUNDLE_FILE_SUFFIX} 文件（含本机暂存的图片）`,
  '2. 在联网的浏览器里打开线上站点，进入「管理 → 导入离线文章包」，选择这个文件',
  '3. 内容写入站点的本地文章列表；在「待更新队列」里统一更新，Actions 部署后就出现在线上文章列表',
]

export default function OfflineExportPanel() {
  const toast = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  const [lastFile, setLastFile] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const onChanged = () => refresh()
    window.addEventListener('starlog:posts-changed', onChanged)
    window.addEventListener('starlog:queue-changed', onChanged)
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener('starlog:posts-changed', onChanged)
      window.removeEventListener('starlog:queue-changed', onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [refresh])

  // 只有本机写过的文章需要带走：内置文章本来就来自站点，回传只会被判定为「内容一致，跳过」
  const locals = useMemo(
    () =>
      getAllPosts()
        .filter((post) => post.source === 'local')
        .sort((a, b) => (b.updated ?? b.date).localeCompare(a.updated ?? a.date)),
    // tick 只用于「重新计算」按钮触发重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  )
  const stats = useMemo(() => countLocalContent(), [tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(
    () => (selected.length > 0 ? locals.filter((post) => selected.includes(post.slug)) : locals),
    [locals, selected],
  )

  const exportChosen = () => {
    if (chosen.length === 0) {
      toast('本机还没有写过的文章可导出：先写点东西，或在列表里勾选', 'warning')
      return
    }
    try {
      const result = exportBundleFile(chosen.map((post) => post.slug))
      setLastFile(`${result.file}（${(result.bytes / 1024).toFixed(0)} KB，${result.posts} 篇）`)
      toast(`已导出 ${result.posts} 篇文章的导入包：${result.file}`, 'success', {
        label: '使用说明在面板里',
        href: '/admin?tab=export',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold">
          <Archive size={17} />
          带到线上站点
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          {OFFLINE
            ? '这个文件不会联网：不能在这里登录 GitHub，也不能直接提交仓库。把文章导出成导入包，再在线上站点导入即可——站点会把它写进自己的本地文章列表。'
            : '这里是给离线版用的导入入口：把离线文件导出的文章包写进本站点的本地文章列表。'}
        </p>
        <ol className="mt-3 space-y-1 text-xs leading-relaxed text-ink-500">
          {STEPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <section className="card grid gap-3 p-5 sm:grid-cols-3">
        <Stat icon={<HardDrive size={15} />} label="本机文章" value={`${stats.posts} 篇`} />
        <Stat icon={<ListChecks size={15} />} label="本机草稿" value={`${stats.drafts} 篇`} />
        <Stat icon={<ImageIcon size={15} />} label="暂存图片" value={`${stats.images} 张`} />
        <p className="text-xs leading-relaxed text-ink-400 sm:col-span-3">
          这些内容存在浏览器本机（IndexedDB，降级时是 localStorage）。清除浏览器数据会一起删掉，
          想长期留存请在「设置 → 离线版」导出<b>离线档案</b>。
          <button type="button" onClick={refresh} className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300">
            <RefreshCw size={11} />
            重新计算
          </button>
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-3 dark:border-white/10">
          <h3 className="text-sm font-semibold">
            本机写的文章 <span className="text-ink-400">（已选 {selected.length || locals.length} / {locals.length}）</span>
          </h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setImportOpen(true)} className="btn-outline h-9">
              <FileJson size={15} />
              导入文章包
            </button>
            <button type="button" onClick={exportChosen} className="btn-primary flex h-9 items-center gap-1.5">
              <Download size={15} />
              导出{selected.length ? `选中的 ${selected.length} 篇` : '全部本机文章'}
            </button>
          </div>
        </div>

        {locals.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-ink-500">本机还没有写过的文章。</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              去「写新文章」写一篇，保存后会出现在这里；也可以点上面的「导入文章包」把另一台设备的内容拿过来。
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-200/60 dark:divide-white/10">
            {locals.map((post) => (
              <li key={post.slug} className="flex items-start gap-3 px-5 py-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(post.slug)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(post.slug)
                        ? current.filter((slug) => slug !== post.slug)
                        : [...current, post.slug],
                    )
                  }
                  aria-label={`选择 ${post.title}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {post.title || '（无标题）'}
                    {post.draft ? <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-300">草稿</span> : null}
                    {post.encryption ? <span className="ml-1.5 text-xs text-ink-400">加密（导出密文）</span> : null}
                  </p>
                  <p className="truncate text-xs text-ink-400">
                    /{post.slug} · {(post.content ?? '').length} 字 · 更新于{' '}
                    {formatDate((post.updated ?? post.date).slice(0, 10))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-ink-200/70 px-5 py-2.5 text-[11px] leading-relaxed text-ink-400 dark:border-white/10">
          不勾选任何条目时，「导出」会包含上面全部本机文章。加密文章导出的是密文信封，
          密码不会随文件离开本机——线上站点同样需要你输入密码才能阅读。
          {lastFile ? <span className="ml-2 text-emerald-600 dark:text-emerald-300">最近导出：{lastFile}</span> : null}
        </p>
      </section>

      <BundleImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} />
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-400">{icon}</span>
      <span className="text-xs text-ink-500">{label}</span>
      <span className="ml-auto text-sm font-semibold">{value}</span>
    </div>
  )
}
