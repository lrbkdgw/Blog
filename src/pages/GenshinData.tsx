import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Orbit, Search, Sparkles, Swords } from 'lucide-react'
import { catalog, cleanGameText, elements, entryName, genshinImage, genshinManifest, label, loadGenshinDetail, loadGenshinImages, weaponTypes } from '../lib/genshin'
import type { CatalogEntry, DataObject, GenshinKind } from '../lib/genshin'
import '../styles/genshin.css'

/* ------------------------------ 数据整理小工具 ------------------------------ */

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null
}

function asText(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  return ''
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return cleanGameText(value)
  return '—'
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

type TextTone = 'plain' | 'gold' | 'element' | 'highlight' | 'quote' | 'strong'
interface TextPart { text: string; tone: TextTone }

const GAME_TAG = /<color=([^>]+)>([\s\S]*?)<\/color>|<i>([\s\S]*?)<\/i>|<b>([\s\S]*?)<\/b>/gi

/** 把游戏文本里的着色 / 斜体 / 粗体标签转成可读的行内样式，保留换行。 */
function parseGameText(raw: string): TextPart[] {
  const source = raw.replace(/\\+n/g, '\n').replace(/\{NON_BREAK_SPACE\}/g, '')
  const parts: TextPart[] = []
  let cursor = 0
  for (const match of source.matchAll(GAME_TAG)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ text: source.slice(cursor, index), tone: 'plain' })
    if (match[1]) {
      const code = match[1].toLowerCase()
      const tone: TextTone = code.includes('99ffff') ? 'element' : code.includes('ffd780') ? 'gold' : 'highlight'
      parts.push({ text: stripTags(match[2]), tone })
    } else if (match[3] !== undefined) {
      parts.push({ text: stripTags(match[3]), tone: 'quote' })
    } else if (match[4] !== undefined) {
      parts.push({ text: stripTags(match[4]), tone: 'strong' })
    }
    cursor = index + match[0].length
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), tone: 'plain' })
  // 未成对 / 未知标签不让它们以原始字符串出现在页面上，普通片段也统一清一遍。
  const cleaned = parts.map(part => part.tone === 'plain' ? { ...part, text: stripTags(part.text) } : part)
  return cleaned.length ? cleaned : [{ text: stripTags(source), tone: 'plain' as TextTone }]
}

function GameText({ text, className = '' }: { text: string; className?: string }) {
  const parts = useMemo(() => parseGameText(text), [text])
  if (!text) return null
  return <div className={'gi-game-text ' + className}>{parts.map((part, index) => <span key={index} className={'gi-tone-' + part.tone}>{part.text}</span>)}</div>
}

function Stars({ rarity, large = false }: { rarity: number; large?: boolean }) {
  const count = Math.max(0, Math.min(5, rarity))
  return <span className={'gi-stars' + (large ? ' gi-stars-large' : '')} aria-label={count ? `${count} 星` : '特殊条目'}>
    {count ? '★'.repeat(count) : '特殊条目'}
  </span>
}

function ElementBadge({ element }: { element?: string }) {
  if (!element) return null
  const text = element === 'Unknown' ? '特殊条目' : label(element) + '元素'
  return <span className={'gi-badge gi-element-' + element}>{text}</span>
}

function EntryImage({ entry, large = false }: { entry: CatalogEntry; large?: boolean }) {
  const src = entry.icon ? genshinImage(entry.icon) : undefined
  return <div className={'gi-entry-image gi-rarity-' + entry.rarity + (large ? ' gi-entry-image-large' : '')}>
    {src ? <img src={src} alt="" width={large ? 160 : 96} height={large ? 160 : 96} loading={large ? 'eager' : 'lazy'} /> : <Sparkles size={large ? 48 : 26} aria-hidden="true" />}
  </div>
}

function SkillIcon({ icon }: { icon?: string }) {
  const src = icon ? genshinImage('skills/' + icon) : undefined
  return <span className="gi-skill-icon">
    {src ? <img src={src} alt="" width="56" height="56" loading="lazy" /> : <Sparkles size={24} aria-hidden="true" />}
  </span>
}

/* --------------------------------- 角色详情 --------------------------------- */

const COMBAT_KEYS = ['normalattack', 'elementalskill', 'elementalburst'] as const
const PASSIVE_KEYS = ['p1', 'p2', 'p3', 'p4'] as const
const CONSTELLATION_KEYS = ['const1', 'const2', 'const3', 'const4', 'const5', 'const6'] as const
type DetailTab = 'skills' | 'passives' | 'constellations'

interface MultiplierRow { key: string; values: unknown[] }

function multiplierRows(value: unknown): MultiplierRow[] {
  const record = asObject(value)
  if (!record) return []
  return Object.entries(record)
    .filter((row): row is [string, unknown[]] => Array.isArray(row[1]))
    .map(([key, values]) => ({ key, values }))
}

function valueAt(row: MultiplierRow, level: number): unknown {
  return row.values[level - 1] ?? row.values[row.values.length - 1] ?? null
}

function LevelPicker({ level, max, onChange }: { level: number; max: number; onChange: (level: number) => void }) {
  if (max <= 1) return null
  return <div className="gi-level-picker" role="group" aria-label="天赋等级">
    <span className="gi-level-label">天赋等级</span>
    <div className="gi-level-buttons">
      {Array.from({ length: max }, (_, index) => {
        const value = index + 1
        return <button key={value} type="button" aria-pressed={level === value} className={level === value ? 'is-active' : ''} onClick={() => onChange(value)}>{value}</button>
      })}
    </div>
  </div>
}

function MultiplierTable({ value, level }: { value: unknown; level: number }) {
  const rows = multiplierRows(value)
  if (!rows.length) return null
  const max = Math.max(1, ...rows.map(row => row.values.length))
  const active = Math.min(Math.max(1, level), max)
  return <div className="gi-multipliers">
    <div className="gi-multipliers-head"><h4>技能倍率</h4><span>Lv. {active}</span></div>
    <div className="gi-table-wrap gi-multiplier-wrap">
      <table className="gi-multiplier-table">
        <thead><tr><th scope="col">项目</th><th scope="col">Lv. {active}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{label(row.key)}</th><td>{formatValue(valueAt(row, active))}</td></tr>)}</tbody>
      </table>
    </div>
    <details className="gi-all-levels">
      <summary><ChevronDown size={14} aria-hidden="true" />查看全部等级</summary>
      <div className="gi-table-wrap">
        <table className="gi-table">
          <thead><tr><th scope="col">项目</th>{Array.from({ length: max }, (_, index) => <th scope="col" key={index}>Lv. {index + 1}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{label(row.key)}</th>{Array.from({ length: max }, (_, index) => <td key={index}>{formatValue(valueAt(row, index + 1))}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>
}

function SkillCard({ skillKey, value, level }: { skillKey: string; value: unknown; level: number }) {
  const record = asObject(value)
  if (!record) return null
  const name = asText(record.name) || label(skillKey)
  const icon = typeof record.icon === 'string' ? record.icon : undefined
  const description = asText(record.description)
  return <article className="gi-skill-card">
    <header className="gi-card-head">
      <SkillIcon icon={icon} />
      <div><p className="gi-card-kicker">{label(skillKey)}</p><h3>{name}</h3></div>
    </header>
    {description && <GameText text={description} />}
    <MultiplierTable value={record.multipliers} level={level} />
  </article>
}

function TalentCard({ index, value, kind }: { index: number; value: unknown; kind: 'passive' | 'constellation' }) {
  const record = asObject(value)
  if (!record) return null
  const name = asText(record.name)
  const description = asText(record.description)
  if (!name && !description) return null
  const icon = typeof record.icon === 'string' ? record.icon : undefined
  return <article className="gi-talent-card">
    <span className="gi-talent-index">{kind === 'passive' ? `0${index}` : `C${index}`}</span>
    <SkillIcon icon={icon} />
    <div className="gi-talent-copy"><h3>{name || (kind === 'passive' ? `固有天赋 ${index}` : `命之座 ${index}`)}</h3>{description && <GameText text={description} />}</div>
  </article>
}

function EmptySection({ children }: { children: ReactNode }) {
  return <div className="gi-empty gi-empty-small"><p>{children}</p></div>
}

function DetailHero({ entry, data, kind }: { entry: CatalogEntry; data?: DataObject; kind: GenshinKind }) {
  const info = asObject(data?.info)
  const description = kind === 'characters' ? asText(info?.description) : asText(data?.weaponDesc)
  const cv = asObject(info?.cv)
  const profile = kind === 'characters' ? [
    { label: '称号', value: asText(info?.title) },
    { label: '命之座', value: asText(info?.constellation) },
    { label: '所属', value: asText(info?.affiliation) },
    { label: '生日', value: asText(info?.birthday) },
    { label: '中文配音', value: asText(cv?.CHS) },
  ].filter(field => field.value) : []
  return <>
    <header className="gi-hero" data-element={kind === 'characters' ? entry.element ?? 'Unknown' : 'Weapon'}>
      <div className="gi-hero-art">
        <EntryImage entry={entry} large />
        <span className="gi-hero-rarity"><Stars rarity={entry.rarity} large /></span>
      </div>
      <div className="gi-hero-copy">
        <p className="gi-eyebrow">原神 · {genshinManifest.version} 正式服 · {kind === 'characters' ? '角色' : '武器'}图鉴</p>
        <h1>{entryName(entry)}</h1>
        <p className="gi-hero-en">{entry.enName || '本地资料'}</p>
        <Stars rarity={entry.rarity} large />
        {description && <GameText text={description} className="gi-hero-desc" />}
        <div className="gi-hero-badges">
          {kind === 'characters' && <ElementBadge element={entry.element} />}
          <span className="gi-badge">{label(entry.weaponType)}</span>
          <span className="gi-badge">{entry.rarity ? `${entry.rarity} 星${kind === 'characters' ? '角色' : '武器'}` : '特殊条目'}</span>
        </div>
      </div>
    </header>
    {profile.length > 0 && <section className="gi-profile" aria-label="角色档案">
      {profile.map(field => <div key={field.label} className="gi-profile-item"><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
    </section>}
  </>
}

function CharacterSections({ data }: { data: DataObject }) {
  const skills = asObject(data.skills) ?? {}
  const passives = asObject(data.passives) ?? {}
  const constellations = asObject(data.constellations) ?? {}
  const [tab, setTab] = useState<DetailTab>('skills')
  const [level, setLevel] = useState(10)
  const maxLevel = useMemo(() => {
    let max = 1
    for (const key of COMBAT_KEYS) {
      const record = asObject(skills[key])
      if (!record) continue
      for (const row of multiplierRows(record.multipliers)) max = Math.max(max, row.values.length)
    }
    return max
  }, [skills])
  useEffect(() => setLevel(current => Math.min(current, maxLevel)), [maxLevel])

  const combat = COMBAT_KEYS.filter(key => asObject(skills[key])).map(key => ({ key, value: skills[key] }))
  const passiveList = PASSIVE_KEYS.map((key, index) => ({ index: index + 1, value: passives[key] })).filter(item => asObject(item.value))
  const constellationList = CONSTELLATION_KEYS.map((key, index) => ({ index: index + 1, value: constellations[key] })).filter(item => asObject(item.value))
  const tabs: { id: DetailTab; label: string; count: number; icon: ReactNode }[] = [
    { id: 'skills', label: '战斗天赋', count: combat.length, icon: <Swords size={15} aria-hidden="true" /> },
    { id: 'passives', label: '固有天赋', count: passiveList.length, icon: <BookOpen size={15} aria-hidden="true" /> },
    { id: 'constellations', label: '命之座', count: constellationList.length, icon: <Orbit size={15} aria-hidden="true" /> },
  ]

  return <>
    <nav className="gi-tabs" aria-label="角色资料分区">
      {tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
        {item.icon}<span>{item.label}</span><small>{item.count}</small>
      </button>)}
    </nav>
    {tab === 'skills' && <section className="gi-section" aria-label="战斗天赋">
      <div className="gi-section-head">
        <div><h2>战斗天赋</h2><p>切换等级查看对应倍率；需要逐等级对照时展开「查看全部等级」。</p></div>
        <LevelPicker level={level} max={maxLevel} onChange={setLevel} />
      </div>
      {combat.length ? <div className="gi-skill-list">{combat.map(item => <SkillCard key={item.key} skillKey={item.key} value={item.value} level={level} />)}</div> : <EmptySection>这位角色没有可用的战斗天赋资料。</EmptySection>}
    </section>}
    {tab === 'passives' && <section className="gi-section" aria-label="固有天赋">
      <div className="gi-section-head"><div><h2>固有天赋</h2><p>角色自带的被动效果，按解锁顺序排列。</p></div></div>
      {passiveList.length ? <div className="gi-card-grid">{passiveList.map(item => <TalentCard key={item.index} index={item.index} value={item.value} kind="passive" />)}</div> : <EmptySection>这位角色没有可用的固有天赋资料。</EmptySection>}
    </section>}
    {tab === 'constellations' && <section className="gi-section" aria-label="命之座">
      <div className="gi-section-head"><div><h2>命之座</h2><p>命座效果按一至六座排列。</p></div></div>
      {constellationList.length ? <div className="gi-card-grid">{constellationList.map(item => <TalentCard key={item.index} index={item.index} value={item.value} kind="constellation" />)}</div> : <EmptySection>这位角色没有可用的命之座资料。</EmptySection>}
    </section>}
  </>
}

function WeaponSections({ data }: { data: DataObject }) {
  const description = asText(data.weaponDesc)
  const passive = asObject(data.passive)
  const refinements = asObject(passive?.refinements)
  const stats = asObject(data.stats)
  const levelKeys = stats ? Object.keys(stats).filter(key => /^\d+$/.test(key)).sort((a, b) => Number(b) - Number(a)) : []
  const topLevel = levelKeys[0]
  const topStats = topLevel ? asObject(stats?.[topLevel]) : null
  const statEntries = Object.entries(topStats ?? {}).map(([key, value]) => {
    const raw = formatValue(value)
    return { key, label: label(key), value: /%/.test(key) && !raw.includes('%') ? `${raw}%` : raw }
  })
  const refinementRows = ['1', '2', '3', '4', '5'].map(level => ({ level, record: asObject(refinements?.[level]) })).filter(item => item.record)
  return <>
    {description && <section className="gi-panel"><h2>武器故事</h2><GameText text={description} /></section>}
    {statEntries.length > 0 && <section className="gi-panel"><h2>{topLevel} 级属性</h2><dl className="gi-stat-grid">{statEntries.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section>}
    {passive && <section className="gi-panel"><h2>武器特效 · {asText(passive.name) || '—'}</h2>
      {refinementRows.length ? <div className="gi-table-wrap"><table className="gi-table"><thead><tr><th scope="col">精炼</th><th scope="col">效果</th></tr></thead><tbody>{refinementRows.map(row => <tr key={row.level}><th scope="row">Lv. {row.level}</th><td><GameText text={asText(row.record?.description)} /></td></tr>)}</tbody></table></div> : <p className="gi-empty gi-empty-small">这把武器没有额外特效。</p>}
    </section>}
  </>
}

function Footnote() {
  return <p className="gi-footnote">
    数据版本 {genshinManifest.version} · 简体中文 · 采集于 {genshinManifest.retrievedAt.slice(0, 10)} · 来源 api.lunaris.moe。
    页面只展示技能、天赋、星级等可观资料；游戏内容及图像版权归其权利人所有，本站为非官方资料整理。
  </p>
}

/* ----------------------------------- 页面 ----------------------------------- */

export default function GenshinData() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const kind: GenshinKind = params.kind === 'weapons' || (!params.kind && searchParams.get('kind') === 'weapons') ? 'weapons' : 'characters'
  const selected = params.id ? catalog.find(entry => entry.kind === params.kind && entry.id === params.id) : undefined
  const detailKind: GenshinKind = selected?.kind ?? kind
  const [data, setData] = useState<DataObject>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [, setImagesReady] = useState(0)
  const query = searchParams.get('q') ?? ''
  const element = searchParams.get('element') ?? ''
  const weapon = searchParams.get('weapon') ?? ''
  const rarity = searchParams.get('rarity') ?? ''
  const sort = searchParams.get('sort') ?? 'id'

  function update(values: Record<string, string>) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key)
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    let active = true
    loadGenshinImages().then(() => { if (active) setImagesReady(n => n + 1) }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setData(undefined)
    setError('')
    setLoading(!!selected?.available)
    if (selected?.available) {
      loadGenshinDetail(selected.kind, selected.id).then(result => {
        if (!active) return
        if (result) setData(result)
        else setError('未找到该条目的本地详情。')
        setLoading(false)
      }).catch(() => {
        if (!active) return
        setError('本地数据加载失败，请重新加载此页面。')
        setLoading(false)
      })
      loadGenshinImages(true).then(() => { if (active) setImagesReady(n => n + 1) }).catch(() => {})
    }
    return () => { active = false }
  }, [selected?.kind, selected?.id, selected?.available])

  useEffect(() => {
    const old = document.title
    document.title = (selected ? entryName(selected) : '原神图鉴') + ' · 百宝箱'
    return () => { document.title = old }
  }, [selected])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return catalog.filter(entry => entry.kind === kind && (!needle || [entryName(entry), entry.enName, entry.id].some(value => value.toLocaleLowerCase().includes(needle))) && (!element || entry.element === element) && (!weapon || entry.weaponType === weapon) && (!rarity || String(entry.rarity) === rarity))
      .sort((a, b) => sort === 'name' ? entryName(a).localeCompare(entryName(b), 'zh-CN') : sort === 'rarity' ? b.rarity - a.rarity || a.id.localeCompare(b.id) : a.id.localeCompare(b.id))
  }, [kind, query, element, weapon, rarity, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / 48))
  const requestedPage = Number(searchParams.get('page'))
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1))
  const visible = filtered.slice((page - 1) * 48, page * 48)
  const listQuery = new URLSearchParams(searchParams)
  listQuery.set('kind', kind)
  const detailQuery = listQuery.toString()

  if (params.id) return <div className="container-page gi-page pt-12" data-yield-list>
    <Link className="gi-back" to={'/toolbox/genshin?' + detailQuery}><ArrowLeft size={16} />返回{kind === 'characters' ? '角色' : '武器'}图鉴</Link>
    {!selected ? <div className="gi-empty"><h1>未找到该条目</h1><p>请从图鉴选择一个角色或武器。</p></div> : <div className="gi-detail" data-element={detailKind === 'characters' ? selected.element ?? 'Unknown' : 'Weapon'}>
      <DetailHero entry={selected} data={data} kind={detailKind} />
      {loading && <p role="status" className="gi-loading">正在读取技能与天赋资料…</p>}
      {error && <p role="alert" className="gi-error">{error}</p>}
      {!selected.available && <div className="gi-empty"><h2>源站未提供详情</h2><p>该条目在 {genshinManifest.version} 清单中存在，但详情缺失，已保留清单记录。</p></div>}
      {data && (detailKind === 'characters' ? <CharacterSections key={selected.id} data={data} /> : <WeaponSections key={selected.id} data={data} />)}
    </div>}
    <Footnote />
  </div>

  return <div className="container-page gi-page pt-12" data-yield-list>
    <Link to="/toolbox" className="gi-back"><ArrowLeft size={16} />百宝箱</Link>
    <header className="gi-header">
      <div><h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">原神图鉴</h1>
        <p className="mt-3 text-sm leading-7 text-ink-500 dark:text-ink-400">翻阅角色技能、天赋、命座与星级；武器只看描述、特效与满级属性。<br />收录至 {genshinManifest.version} 正式服，支持离线阅读。</p></div>
    </header>
    <nav className="gi-category" aria-label="数据类别">{(['characters', 'weapons'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} className={kind === value ? 'is-active' : ''} onClick={() => update({ kind: value, element: '', weapon: '', rarity: '' })}>{value === 'characters' ? '角色' : '武器'}<span>{catalog.filter(entry => entry.kind === value).length}</span></button>)}</nav>
    <div className="gi-filters">
      <label className="gi-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索角色或武器" value={query} onChange={event => update({ q: event.target.value })} placeholder="名称、英文名或 ID" type="search" /></label>
      {kind === 'characters' && <label><span className="sr-only">元素</span><select aria-label="元素" value={element} onChange={event => update({ element: event.target.value })}><option value="">全部元素</option>{Object.entries(elements).map(([value, name]) => <option key={value} value={value}>{name}{value === 'Unknown' ? '条目' : '元素'}</option>)}</select></label>}
      <label><span className="sr-only">武器类型</span><select aria-label="武器类型" value={weapon} onChange={event => update({ weapon: event.target.value })}><option value="">全部武器类型</option>{Object.entries(weaponTypes).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
      <label><span className="sr-only">星级</span><select aria-label="星级" value={rarity} onChange={event => update({ rarity: event.target.value })}><option value="">全部星级</option>{[5, 4, 3, 2, 1].map(value => <option value={value} key={value}>{value} 星</option>)}</select></label>
      <label><span className="sr-only">排序</span><select aria-label="排序" value={sort} onChange={event => update({ sort: event.target.value })}><option value="id">默认排序</option><option value="name">名称排序</option><option value="rarity">星级优先</option></select></label>
    </div>
    <p className="gi-result-count" role="status">找到 {filtered.length} 个{kind === 'characters' ? '角色条目' : '武器条目'}{filtered.length > 48 && '，第 ' + page + ' / ' + pages + ' 页'}</p>
    {error && <p role="alert" className="gi-error">{error}</p>}
    {visible.length ? <div className="gi-catalog" data-yield-list>{visible.map(entry => <Link key={entry.id} to={'/toolbox/genshin/' + entry.kind + '/' + entry.id + '?' + detailQuery} className="gi-entry">
      <EntryImage entry={entry} />
      <div className="gi-entry-copy"><h2>{entryName(entry)}</h2><p>{entry.element ? label(entry.element) + ' · ' : ''}{label(entry.weaponType)}</p><Stars rarity={entry.rarity} />{!entry.available && <small>详情暂缺</small>}</div>
    </Link>)}</div> : <div className="gi-empty"><h2>没有匹配的条目</h2><p>尝试其他名称，或清除筛选条件。</p><button type="button" className="btn-outline mt-4" onClick={() => update({ q: '', element: '', weapon: '', rarity: '' })}>清除筛选</button></div>}
    {pages > 1 && <nav className="gi-pagination" aria-label="图鉴分页"><button type="button" className="btn-outline" disabled={page === 1} onClick={() => { const next = new URLSearchParams(searchParams); next.set('page', String(page - 1)); setSearchParams(next) }}><ChevronLeft size={16} />上一页</button><span>{page} / {pages}</span><button type="button" className="btn-outline" disabled={page === pages} onClick={() => { const next = new URLSearchParams(searchParams); next.set('page', String(page + 1)); setSearchParams(next) }}>下一页<ChevronRight size={16} /></button></nav>}
    <Footnote />
  </div>
}
