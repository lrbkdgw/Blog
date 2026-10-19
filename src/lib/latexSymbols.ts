/**
 * LaTeX 符号目录（issue #60）。
 *
 * 编辑器里按 <kbd>Shift</kbd> + <kbd>↑</kbd> 打开符号选择框，可以按命令、中文别名或
 * 英文名称搜索。每个符号都带多个别名，例如 `\pm` 支持「正负 / 加减 / ± / plus-minus」，
 * `\oplus` 支持「异或 / 直和 / xor」。
 *
 * 说明：
 * - `latex` 是插入正文的源码（默认不包 `$`，由用户在公式里使用）；
 * - `preview` 只在选择框里用于展示，缺省等于 `latex`；
 * - `cursor` 是插入后光标相对起点的偏移，用于 `\frac{}{}` 这类需要继续输入的结构；
 * - `aliases` 至少包含中文名与英文名，方便不同习惯的搜索。
 */

export type LatexCategoryId = 'greek' | 'relation' | 'operator' | 'logic' | 'arrow' | 'misc'

export interface LatexCategory {
  id: LatexCategoryId
  name: string
}

export const LATEX_CATEGORIES: LatexCategory[] = [
  { id: 'greek', name: '希腊字母' },
  { id: 'relation', name: '关系与比较' },
  { id: 'operator', name: '运算与大型运算符' },
  { id: 'logic', name: '逻辑与集合' },
  { id: 'arrow', name: '箭头' },
  { id: 'misc', name: '括号、省略号与结构' },
]

export interface LatexSymbol {
  /** 插入正文的 LaTeX 源码 */
  latex: string
  /** 选择框中的预览公式，缺省用 latex 本身 */
  preview?: string
  /** 搜索与展示用的别名（中文、英文、读法、Unicode 字符等） */
  aliases: string[]
  category: LatexCategoryId
  /** 插入后光标相对起点的偏移（模板类命令用） */
  cursor?: number
}

function symbols(category: LatexCategoryId, entries: [latex: string, aliases: string[], extra?: Partial<LatexSymbol>][]): LatexSymbol[] {
  return entries.map(([latex, aliases, extra]) => ({ latex, aliases, category, ...extra }))
}

const GREEK = symbols('greek', [
  ['\\alpha', ['阿尔法', 'alpha', 'α']],
  ['\\beta', ['贝塔', 'beta', 'β']],
  ['\\gamma', ['伽马', 'gamma', 'γ']],
  ['\\delta', ['德尔塔', 'delta', 'δ']],
  ['\\epsilon', ['艾普西龙', 'epsilon', 'ε']],
  ['\\varepsilon', ['艾普西龙变体', 'epsilon variant', 'varepsilon', 'ϵ']],
  ['\\zeta', ['泽塔', 'zeta', 'ζ']],
  ['\\eta', ['伊塔', 'eta', 'η']],
  ['\\theta', ['西塔', 'theta', 'θ']],
  ['\\vartheta', ['西塔变体', 'theta variant', 'vartheta', 'ϑ']],
  ['\\iota', ['约塔', 'iota', 'ι']],
  ['\\kappa', ['卡帕', 'kappa', 'κ']],
  ['\\lambda', ['兰布达', 'lambda', 'λ']],
  ['\\mu', ['缪', 'mu', 'μ']],
  ['\\nu', ['纽', 'nu', 'ν']],
  ['\\xi', ['克西', 'xi', 'ξ']],
  ['\\pi', ['派', '圆周率', 'pi', 'π']],
  ['\\varpi', ['派变体', 'pi variant', 'varpi', 'ϖ']],
  ['\\rho', ['柔', 'rho', 'ρ']],
  ['\\varrho', ['柔变体', 'rho variant', 'varrho', 'ϱ']],
  ['\\sigma', ['西格玛', 'sigma', 'σ']],
  ['\\varsigma', ['西格玛变体', 'sigma variant', 'varsigma', 'ς']],
  ['\\tau', ['陶', 'tau', 'τ']],
  ['\\upsilon', ['宇普西龙', 'upsilon', 'υ']],
  ['\\phi', ['斐', 'phi', 'φ']],
  ['\\varphi', ['斐变体', 'phi variant', 'varphi', 'ϕ']],
  ['\\chi', ['卡伊', 'chi', 'χ']],
  ['\\psi', ['普西', 'psi', 'ψ']],
  ['\\omega', ['欧米伽', 'omega', 'ω']],
  ['\\Gamma', ['伽马大写', 'Gamma', 'Γ']],
  ['\\Delta', ['德尔塔大写', 'Delta', 'Δ']],
  ['\\Theta', ['西塔大写', 'Theta', 'Θ']],
  ['\\Lambda', ['兰布达大写', 'Lambda', 'Λ']],
  ['\\Xi', ['克西大写', 'Xi', 'Ξ']],
  ['\\Pi', ['派大写', 'Pi', 'Π']],
  ['\\Sigma', ['西格玛大写', 'Sigma', 'Σ']],
  ['\\Upsilon', ['宇普西龙大写', 'Upsilon', 'Υ']],
  ['\\Phi', ['斐大写', 'Phi', 'Φ']],
  ['\\Psi', ['普西大写', 'Psi', 'Ψ']],
  ['\\Omega', ['欧米伽大写', 'Omega', 'Ω']],
])

const RELATION = symbols('relation', [
  ['\\pm', ['正负', '加减', '正负号', 'plus-minus', '±']],
  ['\\mp', ['负正', '减加', 'minus-plus', '∓']],
  ['\\times', ['乘', '乘以', '叉乘', 'times', 'cross', '×']],
  ['\\div', ['除', '除以', 'divide', '÷']],
  ['\\cdot', ['点乘', '乘', '点', 'dot', 'cdot', '·']],
  ['\\ast', ['星号', '卷积', 'ast', 'asterisk', '∗']],
  ['\\star', ['星', '星形', 'star', '⋆']],
  ['\\circ', ['圈', '复合', '度', 'circ', 'degree', '∘']],
  ['\\bullet', ['实心点', 'bullet', '•']],
  ['\\le', ['小于等于', '不大于', 'leq', '<=', '≤']],
  ['\\leq', ['小于等于', '不大于', 'le', '<=', '≤']],
  ['\\ge', ['大于等于', '不小于', 'geq', '>=', '≥']],
  ['\\geq', ['大于等于', '不小于', 'ge', '>=', '≥']],
  ['\\ne', ['不等于', 'neq', '!=', '≠']],
  ['\\neq', ['不等于', 'ne', '!=', '≠']],
  ['\\approx', ['约等于', '近似', 'approx', '≈']],
  ['\\equiv', ['恒等于', '同余', '等价于', 'equiv', '≡']],
  ['\\sim', ['相似', '等价', '波浪号', 'sim', '∼']],
  ['\\simeq', ['渐近等于', 'simeq', '≃']],
  ['\\cong', ['全等', '同构', 'cong', '≅']],
  ['\\propto', ['正比', '正比于', 'propto', '∝']],
  ['\\ll', ['远小于', 'll', '≪']],
  ['\\gg', ['远大于', 'gg', '≫']],
  ['\\prec', ['先于', 'prec', '≺']],
  ['\\succ', ['后于', 'succ', '≻']],
  ['\\preceq', ['先于等于', 'preceq', '⪯']],
  ['\\succeq', ['后于等于', 'succeq', '⪰']],
  ['\\perp', ['垂直', '正交', 'perp', '⊥']],
  ['\\parallel', ['平行', 'parallel', '∥']],
  ['\\mid', ['整除', '竖线', 'mid', '|']],
  ['\\nmid', ['不整除', 'nmid', '∤']],
  ['\\infty', ['无穷', '无穷大', 'infinity', '∞']],
  ['\\partial', ['偏导', '偏微分', 'partial', '∂']],
  ['\\nabla', ['梯度', '算子', 'nabla', '∇']],
  ['\\prime', ['导数', '撇号', 'prime', '′']],
  ['\\angle', ['角', 'angle', '∠']],
  ['\\triangle', ['三角形', 'triangle', '△']],
  ['\\square', ['正方形', 'square', '□']],
])

const OPERATOR = symbols('operator', [
  ['\\oplus', ['异或', '直和', '圈加', 'xor', 'oplus', '⊕']],
  ['\\ominus', ['圈减', 'ominus', '⊖']],
  ['\\otimes', ['张量积', '圈乘', '克罗内克积', 'tensor', 'otimes', '⊗']],
  ['\\oslash', ['圈斜线', 'oslash', '⊘']],
  ['\\odot', ['圈点', 'odot', '⊙']],
  ['\\dagger', ['匕首', '共轭转置', 'dagger', '†']],
  ['\\ddagger', ['双匕首', 'ddagger', '‡']],
  ['\\sum', ['求和', '连加', 'sum', '∑']],
  ['\\prod', ['连乘', '求积', 'product', 'prod', '∏']],
  ['\\coprod', ['余积', 'coprod', '∐']],
  ['\\int', ['积分', 'int', 'integral', '∫']],
  ['\\iint', ['二重积分', '双重积分', 'iint', '∬']],
  ['\\iiint', ['三重积分', 'iiint', '∭']],
  ['\\oint', ['环路积分', '闭合积分', 'contour integral', 'oint', '∮']],
  ['\\bigcup', ['大并集', 'bigcup', '⋃']],
  ['\\bigcap', ['大交集', 'bigcap', '⋂']],
  ['\\bigvee', ['大或', 'bigvee', '⋁']],
  ['\\bigwedge', ['大与', 'bigwedge', '⋀']],
  ['\\lim', ['极限', 'lim', 'limit']],
  ['\\limsup', ['上极限', 'limsup']],
  ['\\liminf', ['下极限', 'liminf']],
  ['\\sup', ['上确界', 'supremum', 'sup']],
  ['\\inf', ['下确界', 'infimum', 'inf']],
  ['\\max', ['最大值', 'max', 'maximum']],
  ['\\min', ['最小值', 'min', 'minimum']],
  ['\\gcd', ['最大公约数', 'gcd']],
  ['\\log', ['对数', 'log', '对数函数']],
  ['\\ln', ['自然对数', 'ln']],
  ['\\exp', ['指数函数', 'exp']],
  ['\\sin', ['正弦', 'sin']],
  ['\\cos', ['余弦', 'cos']],
  ['\\tan', ['正切', 'tan']],
  ['\\cot', ['余切', 'cot']],
  ['\\sec', ['正割', 'sec']],
  ['\\csc', ['余割', 'csc']],
  ['\\arcsin', ['反正弦', 'arcsin']],
  ['\\arccos', ['反余弦', 'arccos']],
  ['\\arctan', ['反正切', 'arctan']],
  ['\\sinh', ['双曲正弦', 'sinh']],
  ['\\cosh', ['双曲余弦', 'cosh']],
  ['\\tanh', ['双曲正切', 'tanh']],
])

const LOGIC = symbols('logic', [
  ['\\forall', ['任意', '全称量词', 'for all', 'forall', '∀']],
  ['\\exists', ['存在', '存在量词', 'exists', '∃']],
  ['\\nexists', ['不存在', 'nexists', '∄']],
  ['\\neg', ['非', '否定', 'neg', 'not', '¬']],
  ['\\lnot', ['非', '否定', 'lnot', 'not', '¬']],
  ['\\land', ['且', '与', '逻辑与', '合取', 'wedge', 'land', '∧']],
  ['\\wedge', ['且', '与', '逻辑与', '合取', 'land', 'wedge', '∧']],
  ['\\lor', ['或', '逻辑或', '析取', 'vee', 'lor', '∨']],
  ['\\vee', ['或', '逻辑或', '析取', 'lor', 'vee', '∨']],
  ['\\top', ['真', '顶', 'top', '⊤']],
  ['\\bot', ['假', '底', 'bottom', 'bot', '⊥']],
  ['\\vdash', ['推出', '可证', 'vdash', '⊢']],
  ['\\vDash', ['满足', '蕴含', 'vDash', '⊨']],
  ['\\models', ['满足', 'models', '⊨']],
  ['\\therefore', ['所以', '因此', 'therefore', '∴']],
  ['\\because', ['因为', 'because', '∵']],
  ['\\cup', ['并集', '并', 'union', 'cup', '∪']],
  ['\\cap', ['交集', '交', 'intersection', 'cap', '∩']],
  ['\\setminus', ['差集', '集合差', 'setminus', '∖']],
  ['\\subset', ['真子集', '包含于', 'subset', '⊂']],
  ['\\subseteq', ['子集', '包含于等于', 'subseteq', '⊆']],
  ['\\subsetneq', ['真子集', 'subsetneq', '⊊']],
  ['\\supset', ['真超集', '包含', 'supset', '⊃']],
  ['\\supseteq', ['超集', '包含等于', 'supseteq', '⊇']],
  ['\\supsetneq', ['真超集', 'supsetneq', '⊋']],
  ['\\in', ['属于', 'in', '∈']],
  ['\\notin', ['不属于', 'notin', '∉']],
  ['\\ni', ['包含元素', 'contains', 'ni', '∋']],
  ['\\emptyset', ['空集', 'emptyset', '∅']],
  ['\\varnothing', ['空集', 'varnothing', '∅']],
  ['\\aleph', ['阿列夫', 'aleph', 'ℵ']],
  ['\\hbar', ['约化普朗克常数', 'hbar', 'ℏ']],
  ['\\ell', ['手写体 l', 'ell', 'ℓ']],
  ['\\Re', ['实部', 'Re', 'ℜ']],
  ['\\Im', ['虚部', 'Im', 'ℑ']],
  ['\\wp', ['魏尔斯特拉斯 p', 'weierstrass', 'wp', '℘']],
  ['\\mho', ['姆欧', '电导', 'mho', '℧']],
])

const ARROW = symbols('arrow', [
  ['\\to', ['箭头', '右箭头', '趋于', 'to', 'rightarrow', '→']],
  ['\\rightarrow', ['右箭头', '趋于', 'to', 'rightarrow', '→']],
  ['\\leftarrow', ['左箭头', 'gets', 'leftarrow', '←']],
  ['\\gets', ['左箭头', '赋值', 'gets', 'leftarrow', '←']],
  ['\\leftrightarrow', ['双向箭头', '等价', 'leftrightarrow', '↔']],
  ['\\Rightarrow', ['推出', '蕴含', '双线右箭头', 'implies', 'Rightarrow', '⇒']],
  ['\\Leftarrow', ['反推', '双线左箭头', 'Leftarrow', '⇐']],
  ['\\Leftrightarrow', ['等价', '当且仅当', '双线双向箭头', 'iff', 'Leftrightarrow', '⇔']],
  ['\\iff', ['当且仅当', '等价', 'iff', '⇔']],
  ['\\implies', ['推出', '蕴含', 'implies', '⇒']],
  ['\\mapsto', ['映射', '映射到', 'mapsto', '↦']],
  ['\\uparrow', ['上箭头', 'uparrow', '↑']],
  ['\\downarrow', ['下箭头', 'downarrow', '↓']],
  ['\\updownarrow', ['上下箭头', 'updownarrow', '↕']],
  ['\\Uparrow', ['上双线箭头', 'Uparrow', '⇑']],
  ['\\Downarrow', ['下双线箭头', 'Downarrow', '⇓']],
  ['\\nearrow', ['右上箭头', 'nearrow', '↗']],
  ['\\searrow', ['右下箭头', 'searrow', '↘']],
  ['\\swarrow', ['左下箭头', 'swarrow', '↙']],
  ['\\nwarrow', ['左上箭头', 'nwarrow', '↖']],
  ['\\longrightarrow', ['长右箭头', 'longrightarrow', '⟶']],
  ['\\longleftarrow', ['长左箭头', 'longleftarrow', '⟵']],
  ['\\longleftrightarrow', ['长双向箭头', 'longleftrightarrow', '⟷']],
  ['\\Longrightarrow', ['长推出', '长双线右箭头', 'Longrightarrow', '⟹']],
  ['\\Longleftarrow', ['长反推', '长双线左箭头', 'Longleftarrow', '⟸']],
  ['\\rightleftharpoons', ['可逆反应', '平衡箭头', 'rightleftharpoons', '⇌']],
  ['\\hookrightarrow', ['嵌入映射', 'hookrightarrow', '↪']],
  ['\\hookleftarrow', ['hookleftarrow', '↩']],
  ['\\rightharpoonup', ['右半箭头', 'rightharpoonup', '⇀']],
])

const MISC = symbols('misc', [
  ['\\ldots', ['省略号', '点省略号', 'ldots', 'ellipsis', '…']],
  ['\\dots', ['省略号', 'dots', 'ellipsis', '…']],
  ['\\cdots', ['居中省略号', 'cdots', '⋯']],
  ['\\vdots', ['竖直省略号', 'vdots', '⋮']],
  ['\\ddots', ['对角省略号', 'ddots', '⋱']],
  ['\\langle', ['左尖括号', 'langle', '⟨']],
  ['\\rangle', ['右尖括号', 'rangle', '⟩']],
  ['\\lceil', ['上取整左括号', 'lceil', '⌈']],
  ['\\rceil', ['上取整右括号', 'rceil', '⌉']],
  ['\\lfloor', ['下取整左括号', 'lfloor', '⌊']],
  ['\\rfloor', ['下取整右括号', 'rfloor', '⌋']],
  ['\\lvert', ['左竖线', 'lvert', '|']],
  ['\\rvert', ['右竖线', 'rvert', '|']],
  ['\\lVert', ['左双竖线', 'lVert', '‖']],
  ['\\rVert', ['右双竖线', 'rVert', '‖']],
  ['\\{', ['左花括号', 'brace', 'left brace', '\\{', '{']],
  ['\\}', ['右花括号', 'brace', 'right brace', '\\}', '}']],
  ['\\|', ['双竖线', '范数', 'double vertical bar', '‖']],
  ['\\%', ['百分号', 'percent', '%']],
  ['\\&', ['与号', '和号', 'ampersand', '&']],
  ['\\#', ['井号', 'hash', 'sharp', '#']],
  ['\\_', ['下划线', 'underscore', '_']],
  ['\\$', ['美元符号', 'dollar', '$']],
  ['\\surd', ['根号', 'surd', 'square root', '√']],
  ['\\flat', ['降号', 'flat', '♭']],
  ['\\natural', ['还原号', 'natural', '♮']],
  ['\\sharp', ['升号', 'sharp', '♯']],
  ['\\clubsuit', ['梅花', 'clubsuit', '♣']],
  ['\\diamondsuit', ['方块', 'diamondsuit', '♦']],
  ['\\heartsuit', ['红桃', 'heartsuit', '♥']],
  ['\\spadesuit', ['黑桃', 'spadesuit', '♠']],
  ['\\frac{}{}', ['分数', '分式', 'fraction', 'frac'], { preview: '\\frac{a}{b}', cursor: 6 }],
  ['\\sqrt{}', ['根号', '平方根', 'sqrt', 'square root'], { preview: '\\sqrt{x}', cursor: 6 }],
  ['\\binom{}{}', ['组合数', '二项式系数', 'binom', 'binomial'], { preview: '\\binom{n}{k}', cursor: 7 }],
  ['\\overline{}', ['上划线', 'overline'], { preview: '\\overline{AB}', cursor: 10 }],
  ['\\underline{}', ['下划线', 'underline'], { preview: '\\underline{AB}', cursor: 11 }],
  ['\\hat{}', ['帽子', '估计量', 'hat'], { preview: '\\hat{x}', cursor: 5 }],
  ['\\vec{}', ['向量', 'vec', 'vector'], { preview: '\\vec{v}', cursor: 5 }],
  ['\\tilde{}', ['波浪号', 'tilde'], { preview: '\\tilde{x}', cursor: 7 }],
  ['\\bar{}', ['上横线', 'bar'], { preview: '\\bar{x}', cursor: 5 }],
])

export const LATEX_SYMBOLS: LatexSymbol[] = [...GREEK, ...RELATION, ...OPERATOR, ...LOGIC, ...ARROW, ...MISC]

function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/\\/g, '').replace(/\s+/g, ' ').trim()
}

function haystack(symbol: LatexSymbol): string {
  return normalizeSearch([symbol.latex, ...symbol.aliases].join(' '))
}

/**
 * 按关键词筛选符号。空格分隔的多个关键词需要全部命中；
 * 搜索时忽略大小写与反斜杠，所以输入 `pm`、`\pm`、`正负` 都能找到 `\pm`。
 */
export function searchLatexSymbols(query: string, category?: LatexCategoryId | 'all'): LatexSymbol[] {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean)
  return LATEX_SYMBOLS.filter((symbol) => {
    if (category && category !== 'all' && symbol.category !== category) return false
    if (tokens.length === 0) return true
    const text = haystack(symbol)
    return tokens.every((token) => text.includes(token))
  })
}

/** 符号在列表里展示的别名（最多展示前三个，避免撑破卡片）。 */
export function displayAliases(symbol: LatexSymbol, limit = 3): string[] {
  return symbol.aliases.slice(0, limit)
}
