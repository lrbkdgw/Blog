import catalogData from '../data/genshin/catalog.json'
import manifestData from '../data/genshin/manifest.json'

export type GenshinKind = 'characters' | 'weapons'
export type DataValue = string | number | boolean | null | DataValue[] | { [key: string]: DataValue }
export type DataObject = { [key: string]: DataValue }
export interface CatalogEntry {
  id: string
  kind: GenshinKind
  name: string
  enName: string
  element?: string
  weaponType: string
  rarity: number
  icon: string | null
  available: boolean
  special: boolean
  gender?: string | null
}
export const catalog = catalogData as CatalogEntry[]
export const genshinManifest = manifestData
export const elements: Record<string, string> = { Anemo: '风', Geo: '岩', Electro: '雷', Dendro: '草', Hydro: '水', Pyro: '火', Cryo: '冰', Unknown: '特殊' }
export const weaponTypes: Record<string, string> = { WEAPON_SWORD_ONE_HAND: '单手剑', WEAPON_CLAYMORE: '双手剑', WEAPON_POLE: '长柄武器', WEAPON_CATALYST: '法器', WEAPON_BOW: '弓', WEAPON_CROSSBOW: '弩' }
export const labels: Record<string, string> = {
  info: '角色资料', icons: '图标资源', ascension: '养成材料', costumes: '角色装扮', envisagedEcho: '绘想游迹', skills: '战斗天赋', passives: '固有天赋', constellations: '命之座', hyperlinks: '关联资料', stories: '角色故事', quotes: '语音文本', energy: '元素产球', attacks: '攻击数据', endure: '抗打断数据',
  name: '名称', description: '说明', rarity: '品质', qualityType: '品质', weapon: '武器类型', weaponType: '武器类型', birthday: '生日（日/月）', element: '元素', title: '称号', constellation: '命之座', affiliation: '所属', cv: '配音', attributes: '等级属性',
  level: '等级', ascensionStats: '满级属性', hp: '生命值', atk: '攻击力', def: '防御力', 'CRIT DMG%': '暴击伤害（%）', 'CRIT Rate%': '暴击率（%）', 'CRIT RATE%': '暴击率（%）', 'ATK%': '攻击力（%）', 'HP%': '生命值（%）', 'DEF%': '防御力（%）', EM: '元素精通', ER: '元素充能效率',
  normalattack: '普通攻击', elementalskill: '元素战技', elementalburst: '元素爆发', leveling: '天赋升级材料', multipliers: '技能倍率（天赋等级）', params: '原始参数', p1: '固有天赋一', p2: '固有天赋二', p3: '固有天赋三', p4: '固有天赋四',
  const1: '命座一', const2: '命座二', const3: '命座三', const4: '命座四', const5: '命座五', const6: '命座六',
  passive: '武器特效', refinements: '精炼等级', stats: '等级属性', weaponDesc: '武器描述', weaponIcon: '武器图标',
  count: '数量', icon: '图标', forward: '正面头像', coop_img: '联机图片', sideIcon: '侧面头像', gachaImg: '立绘', quality: '品质', itemId: '物品 ID', isDefault: '默认装扮', isDefaultUnlock: '默认解锁', id: 'ID',
  exp: '经验材料', speciality: '地区特产', elemental: '元素突破材料', worldmonster: '普通敌人材料', elitemonster: '首领材料', '202': '摩拉',
  storyTitle: '故事标题', storyText: '故事正文', quoteTitle: '语音标题', quoteText: '语音正文', unlockConds: '解锁条件', type: '类型', value: '值', source: '来源', particles: '微粒数量', chance: '概率', cd: '冷却',
  icd_source: '附着分组', icd_rule: '附着规则', gauge: '元素量', poise: '削韧', attackType: '攻击类型', strikeType: '打击类型', damageParam: '伤害参数', EN: '英语', CHS: '汉语', JP: '日语', KR: '韩语',
}
export function label(key: string): string { return labels[key] ?? weaponTypes[key] ?? elements[key] ?? key }
export function cleanGameText(text: string): string {
  return text.replace(/\\+n/g, '\n').replace(/<\/?color(?:=[^>]*)?>/gi, '').replace(/<\/?(?:b|i)>/gi, '').replace(/\{NON_BREAK_SPACE\}/g, '')
}
export function entryName(entry: CatalogEntry): string {
  return entry.gender ? entry.name + ' · ' + entry.gender + '（' + label(entry.element ?? '') + '）' : entry.name
}
async function decodeSnapshot(encoded: string): Promise<Record<string, DataObject>> {
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as Record<string, DataObject>
}
const detailCache: Partial<Record<GenshinKind, Record<string, DataObject>>> = {}
const pending: Partial<Record<GenshinKind, Promise<Record<string, DataObject>>>> = {}
export async function loadGenshinDetail(kind: GenshinKind, id: string): Promise<DataObject | undefined> {
  if (!detailCache[kind]) {
    pending[kind] ??= (kind === 'characters'
      ? import('../data/genshin/characters.gz.base64?raw')
      : import('../data/genshin/weapons.gz.base64?raw'))
      .then(module => decodeSnapshot(module.default))
      .then(data => { detailCache[kind] = data; return data })
      .catch(error => { delete pending[kind]; throw error })
    await pending[kind]
  }
  return detailCache[kind]?.[id]
}
const imageCache: Record<string, string> = {}
let portraitsPromise: Promise<void> | undefined
let skillsPromise: Promise<void> | undefined
export async function loadGenshinImages(skills = false): Promise<void> {
  portraitsPromise ??= import('../data/genshin/portraits.json?raw').then(module => { Object.assign(imageCache, JSON.parse(module.default)) })
    .catch(error => { portraitsPromise = undefined; throw error })
  await portraitsPromise
  if (skills) {
    skillsPromise ??= import('../data/genshin/skill-icons.json?raw').then(module => { Object.assign(imageCache, JSON.parse(module.default)) })
      .catch(error => { skillsPromise = undefined; throw error })
    await skillsPromise
  }
}
export function genshinImage(key: string): string | undefined { return imageCache[key] }
