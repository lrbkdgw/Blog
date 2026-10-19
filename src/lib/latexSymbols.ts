/**
 * LaTeX 符号目录（issue #60）：站内编辑器 / 评论框的符号选择框与
 * VS Code 插件「插入 LaTeX 符号」命令共用同一份数据。
 *
 * 每个符号都登记了多类别名（中文叫法 + 英文关键词），选择框里既可以搜
 * 命令（`pm`、`\pm`）也可以搜别名（「正负」「加减」→ `\pm`，「异或」→ `\oplus`）。
 * `preview` 是给 KaTeX 渲染的示例源码，`insert` 是实际写入光标处的文本，
 * `cursor` 是插入后光标（选区）相对 insert 起点的偏移——如 `\frac{}{}`
 * 插入后光标落在第一个花括号里，可以直接打分子。
 *
 * 本模块是纯数据 + 纯函数（零运行时依赖），浏览器与 Node 都可直接用。
 * 新增符号时注意：`preview` 必须能被 KaTeX（strict 关闭、throwOnError 开启）
 * 正常渲染，仓库验证会逐个检查。
 */

export type LatexCategoryId =
  | 'structures'
  | 'greek'
  | 'operators'
  | 'relations'
  | 'sets-logic'
  | 'arrows'
  | 'big-operators'
  | 'functions'
  | 'misc'

export const LATEX_CATEGORIES: readonly { id: LatexCategoryId; name: string }[] = [
  { id: 'structures', name: '结构' },
  { id: 'greek', name: '希腊字母' },
  { id: 'operators', name: '运算' },
  { id: 'relations', name: '关系' },
  { id: 'sets-logic', name: '集合与逻辑' },
  { id: 'arrows', name: '箭头' },
  { id: 'big-operators', name: '大型运算符' },
  { id: 'functions', name: '函数' },
  { id: 'misc', name: '其他' },
]

export function latexCategoryName(id: LatexCategoryId): string {
  return LATEX_CATEGORIES.find((category) => category.id === id)?.name ?? id
}

export interface LatexSymbol {
  /** 符号的标志性写法（展示与搜索用），如 '\\pm'、'\\frac{}{}'。 */
  command: string
  /** 实际插入的文本。 */
  insert: string
  /** KaTeX 预览源码。 */
  preview: string
  /** 插入后选区相对 insert 起点的偏移 [start, end]。 */
  cursor: [number, number]
  category: LatexCategoryId
  /** 别名（中文叫法、英文关键词等），搜索时逐一匹配。 */
  aliases: string[]
  /** 对应的 Unicode 字符（若有），供无法渲染 KaTeX 的宿主（如 VS Code QuickPick）展示。 */
  glyph?: string
}

interface LatexSymbolInput {
  command: string
  aliases: string[]
  glyph?: string
  insert?: string
  preview?: string
  /** 光标落在此子串之后（优先于自动规则），如 '\\sqrt[' 表示落在方括号里。 */
  cursorAfter?: string
  cursor?: [number, number]
}

/** 自动预览：把 insert 里的空参数依次填上 a、b、c，空方括号填 n。 */
function autoPreview(insert: string): string {
  const fillers = ['a', 'b', 'c']
  let used = 0
  return insert
    .replace(/\[\]/g, '[n]')
    .replace(/\{\}/g, () => `{${fillers[Math.min(used++, fillers.length - 1)]}}`)
}

function resolveSymbol(category: LatexCategoryId, input: LatexSymbolInput): LatexSymbol {
  const insert = input.insert ?? input.command
  let cursor: [number, number]
  if (input.cursor) {
    cursor = input.cursor
  } else if (input.cursorAfter) {
    const at = insert.indexOf(input.cursorAfter)
    const pos = at === -1 ? insert.length : at + input.cursorAfter.length
    cursor = [pos, pos]
  } else {
    // 默认落在第一个空花括号 {} 里面；没有空参数时落在末尾。
    const braces = insert.indexOf('{}')
    cursor = braces === -1 ? [insert.length, insert.length] : [braces + 1, braces + 1]
  }
  return {
    command: input.command,
    insert,
    preview: input.preview ?? autoPreview(insert),
    cursor,
    category,
    aliases: input.aliases,
    glyph: input.glyph,
  }
}

function category(id: LatexCategoryId, inputs: LatexSymbolInput[]): LatexSymbol[] {
  return inputs.map((input) => resolveSymbol(id, input))
}

const structures = category('structures', [
  { command: '\\frac{}{}', insert: '\\frac{}{}', preview: '\\frac{a}{b}', aliases: ['分数', '分式', '除', '分数线', 'fraction'] },
  { command: '\\dfrac{}{}', insert: '\\dfrac{}{}', preview: '\\dfrac{a}{b}', aliases: ['分数', '大分数', '显示分数', '分式'] },
  { command: '\\tfrac{}{}', insert: '\\tfrac{}{}', preview: '\\tfrac{a}{b}', aliases: ['分数', '小分数', '分式'] },
  { command: '\\cfrac{}{}', insert: '\\cfrac{}{}', preview: '\\cfrac{a}{b}', aliases: ['连分数', '分数', '分式'] },
  { command: '\\sqrt{}', insert: '\\sqrt{}', preview: '\\sqrt{x}', aliases: ['根号', '平方根', '开方', '根式', 'sqrt', 'root'] },
  { command: '\\sqrt[n]{}', insert: '\\sqrt[]{}', cursorAfter: '\\sqrt[', preview: '\\sqrt[3]{x}', aliases: ['n次根', '立方根', '根号', '开方', '根式'] },
  { command: '^{}', insert: '^{}', preview: 'x^{2}', aliases: ['上标', '次方', '幂', '指数', '平方', 'superscript', 'power'] },
  { command: '_{}', insert: '_{}', preview: 'a_{n}', aliases: ['下标', '角标', '序号', 'subscript'] },
  { command: '\\binom{}{}', insert: '\\binom{}{}', preview: '\\binom{n}{k}', aliases: ['组合数', '二项式系数', '组合', 'binomial', 'choose'] },
  { command: '\\overline{}', insert: '\\overline{}', preview: '\\overline{AB}', aliases: ['上划线', '线段', '共轭', '平均值'] },
  { command: '\\underline{}', insert: '\\underline{}', preview: '\\underline{x}', aliases: ['下划线'] },
  { command: '\\hat{}', insert: '\\hat{}', preview: '\\hat{x}', aliases: ['帽', '估计值', '单位向量'] },
  { command: '\\widehat{}', insert: '\\widehat{}', preview: '\\widehat{ABC}', aliases: ['宽帽', '角', '弧'] },
  { command: '\\bar{}', insert: '\\bar{}', preview: '\\bar{x}', aliases: ['平均值', '均值', '共轭', '短横线'] },
  { command: '\\vec{}', insert: '\\vec{}', preview: '\\vec{a}', aliases: ['向量', '箭头', 'vector'] },
  { command: '\\overrightarrow{}', insert: '\\overrightarrow{}', preview: '\\overrightarrow{AB}', aliases: ['向量', '长箭头'] },
  { command: '\\dot{}', insert: '\\dot{}', preview: '\\dot{x}', aliases: ['一阶导数', '上点', '求导'] },
  { command: '\\ddot{}', insert: '\\ddot{}', preview: '\\ddot{x}', aliases: ['二阶导数', '两点'] },
  { command: '\\tilde{}', insert: '\\tilde{}', preview: '\\tilde{x}', aliases: ['波浪号', '颚化符'] },
  { command: '\\widetilde{}', insert: '\\widetilde{}', preview: '\\widetilde{AB}', aliases: ['宽波浪'] },
  { command: '\\overbrace{}', insert: '\\overbrace{}', preview: '\\overbrace{a+b+c}', aliases: ['上大括号', '上括号', 'brace'] },
  { command: '\\underbrace{}', insert: '\\underbrace{}', preview: '\\underbrace{a+b+c}', aliases: ['下大括号', '下括号', 'brace'] },
  { command: '\\overset{}{}', insert: '\\overset{}{}', preview: '\\overset{*}{=}', aliases: ['上方标注', '上标符号'] },
  { command: '\\underset{}{}', insert: '\\underset{}{}', preview: '\\underset{n}{\\sum}', aliases: ['下方标注', '下标符号'] },
  { command: '\\boxed{}', insert: '\\boxed{}', preview: '\\boxed{x=1}', aliases: ['方框', '框选', '答案框'] },
  { command: '\\cancel{}', insert: '\\cancel{}', preview: '\\cancel{x}', aliases: ['约去', '划掉', '斜线删除'] },
  { command: '\\left(\\right)', insert: '\\left(\\right)', cursorAfter: '\\left(', preview: '\\left(\\dfrac{a}{b}\\right)', aliases: ['自适应括号', '大圆括号', '圆括号', '括号'] },
  { command: '\\left[\\right]', insert: '\\left[\\right]', cursorAfter: '\\left[', preview: '\\left[\\dfrac{a}{b}\\right]', aliases: ['自适应方括号', '大方括号', '方括号', '中括号'] },
  { command: '\\left\\{\\right\\}', insert: '\\left\\{\\right\\}', cursorAfter: '\\left\\{', preview: '\\left\\{\\dfrac{a}{b}\\right\\}', aliases: ['自适应花括号', '大大括号', '花括号', '集合括号'] },
  { command: '\\left|\\right|', insert: '\\left|\\right|', cursorAfter: '\\left|', preview: '\\left|x\\right|', aliases: ['绝对值', '模', '自适应竖线', 'absolute'] },
  { command: '\\langle\\rangle', insert: '\\langle\\rangle', cursorAfter: '\\langle', preview: '\\langle u, v\\rangle', aliases: ['内积', '尖括号', '角括号', 'inner product'] },
  { command: '\\lfloor\\rfloor', insert: '\\lfloor\\rfloor', cursorAfter: '\\lfloor', preview: '\\lfloor x\\rfloor', aliases: ['向下取整', '地板', '高斯取整', 'floor'] },
  { command: '\\lceil\\rceil', insert: '\\lceil\\rceil', cursorAfter: '\\lceil', preview: '\\lceil x\\rceil', aliases: ['向上取整', '天花板', 'ceil'] },
  { command: '\\|\\|', insert: '\\|\\|', cursorAfter: '\\|', preview: '\\|x\\|', aliases: ['范数', '模长', '双竖线', 'norm'] },
  { command: '\\begin{matrix}…\\end{matrix}', insert: '\\begin{matrix}\n\n\\end{matrix}', cursorAfter: '\\begin{matrix}\n', preview: '\\begin{matrix}a&b\\\\c&d\\end{matrix}', aliases: ['矩阵', '无括号矩阵', 'matrix'] },
  { command: '\\begin{pmatrix}…\\end{pmatrix}', insert: '\\begin{pmatrix}\n\n\\end{pmatrix}', cursorAfter: '\\begin{pmatrix}\n', preview: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', aliases: ['圆括号矩阵', '矩阵', 'matrix'] },
  { command: '\\begin{bmatrix}…\\end{bmatrix}', insert: '\\begin{bmatrix}\n\n\\end{bmatrix}', cursorAfter: '\\begin{bmatrix}\n', preview: '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}', aliases: ['方括号矩阵', '矩阵', 'matrix'] },
  { command: '\\begin{vmatrix}…\\end{vmatrix}', insert: '\\begin{vmatrix}\n\n\\end{vmatrix}', cursorAfter: '\\begin{vmatrix}\n', preview: '\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}', aliases: ['行列式', '竖线矩阵', 'determinant'] },
  { command: '\\begin{cases}…\\end{cases}', insert: '\\begin{cases}\n\n\\end{cases}', cursorAfter: '\\begin{cases}\n', preview: '\\begin{cases}x,&x>0\\\\0,&x=0\\end{cases}', aliases: ['分段函数', '方程组', '大括号分段', 'cases'] },
  { command: '\\begin{aligned}…\\end{aligned}', insert: '\\begin{aligned}\n\n\\end{aligned}', cursorAfter: '\\begin{aligned}\n', preview: '\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}', aliases: ['对齐', '多行公式', '等式链', 'aligned'] },
  { command: '\\text{}', insert: '\\text{}', preview: 'x\\text{ 千米}', aliases: ['文本', '文字', '中文', 'text'] },
  { command: '\\mathrm{}', insert: '\\mathrm{}', preview: '\\mathrm{d}x', aliases: ['正体', '直立体', '罗马体', '单位'] },
  { command: '\\mathbf{}', insert: '\\mathbf{}', preview: '\\mathbf{v}', aliases: ['粗体', '黑体', '向量粗体', 'bold'] },
  { command: '\\boldsymbol{}', insert: '\\boldsymbol{}', preview: '\\boldsymbol{\\alpha}', aliases: ['粗斜体', '加粗符号'] },
  { command: '\\mathbb{}', insert: '\\mathbb{}', preview: '\\mathbb{R}', aliases: ['黑板粗体', '数集字母', '空心字母', 'blackboard'] },
  { command: '\\mathcal{}', insert: '\\mathcal{}', preview: '\\mathcal{F}', aliases: ['花体', '书法体', 'calligraphic'] },
  { command: '\\mathfrak{}', insert: '\\mathfrak{}', preview: '\\mathfrak{g}', aliases: ['哥特体', '德文尖角体', 'fraktur', '李代数'] },
  { command: '\\operatorname{}', insert: '\\operatorname{}', preview: '\\operatorname{rank}A', aliases: ['算子名', '函数名', '正体名称'] },
  { command: '\\\\', insert: '\\\\', preview: 'a\\\\b', aliases: ['换行', '新行', '分行'] },
  { command: '\\,', insert: '\\,', preview: 'a\\,b', aliases: ['小空格', '窄空格', '间距'] },
  { command: '\\quad', insert: '\\quad', preview: 'a\\quad b', aliases: ['空格', '大间距', 'quad'] },
  { command: '\\qquad', insert: '\\qquad', preview: 'a\\qquad b', aliases: ['大空格', '双倍间距'] },
])

const greek = category('greek', [
  { command: '\\alpha', glyph: 'α', aliases: ['阿尔法', 'alpha'] },
  { command: '\\beta', glyph: 'β', aliases: ['贝塔', 'beta'] },
  { command: '\\gamma', glyph: 'γ', aliases: ['伽马', 'gamma'] },
  { command: '\\Gamma', glyph: 'Γ', aliases: ['伽马大写', '伽马函数', 'Gamma'] },
  { command: '\\delta', glyph: 'δ', aliases: ['德尔塔', '小增量', 'delta'] },
  { command: '\\Delta', glyph: 'Δ', aliases: ['德尔塔大写', '增量', '判别式', '差', 'Delta'] },
  { command: '\\epsilon', glyph: 'ϵ', aliases: ['艾普西龙', '小量', 'epsilon'] },
  { command: '\\varepsilon', glyph: 'ε', aliases: ['艾普西龙', '任意小', '正数', 'varepsilon'] },
  { command: '\\zeta', glyph: 'ζ', aliases: ['泽塔', 'zeta', '黎曼泽塔'] },
  { command: '\\eta', glyph: 'η', aliases: ['伊塔', 'eta', '效率'] },
  { command: '\\theta', glyph: 'θ', aliases: ['西塔', '角度', 'theta'] },
  { command: '\\Theta', glyph: 'Θ', aliases: ['西塔大写', 'Theta'] },
  { command: '\\vartheta', glyph: 'ϑ', aliases: ['西塔异体', 'vartheta'] },
  { command: '\\iota', glyph: 'ι', aliases: ['约塔', 'iota'] },
  { command: '\\kappa', glyph: 'κ', aliases: ['卡帕', 'kappa', '曲率'] },
  { command: '\\lambda', glyph: 'λ', aliases: ['拉姆达', 'lambda', '波长', '特征值', '参数'] },
  { command: '\\Lambda', glyph: 'Λ', aliases: ['拉姆达大写', 'Lambda'] },
  { command: '\\mu', glyph: 'μ', aliases: ['缪', 'mu', '微', '期望', '系数'] },
  { command: '\\nu', glyph: 'ν', aliases: ['纽', 'nu', '频率'] },
  { command: '\\xi', glyph: 'ξ', aliases: ['克西', 'xi', '介值点'] },
  { command: '\\Xi', glyph: 'Ξ', aliases: ['克西大写', 'Xi'] },
  { command: '\\pi', glyph: 'π', aliases: ['派', '圆周率', 'pi'] },
  { command: '\\Pi', glyph: 'Π', aliases: ['派大写', 'Pi'] },
  { command: '\\varpi', glyph: 'ϖ', aliases: ['派异体', 'varpi'] },
  { command: '\\rho', glyph: 'ρ', aliases: ['柔', 'rho', '密度'] },
  { command: '\\sigma', glyph: 'σ', aliases: ['西格玛', 'sigma', '标准差'] },
  { command: '\\Sigma', glyph: 'Σ', aliases: ['西格玛大写', 'Sigma'] },
  { command: '\\varsigma', glyph: 'ς', aliases: ['西格玛词尾', 'varsigma'] },
  { command: '\\tau', glyph: 'τ', aliases: ['陶', 'tau'] },
  { command: '\\upsilon', glyph: 'υ', aliases: ['宇普西龙', 'upsilon'] },
  { command: '\\phi', glyph: 'ϕ', aliases: ['斐', 'phi', '角度', '欧拉函数', '黄金比'] },
  { command: '\\Phi', glyph: 'Φ', aliases: ['斐大写', 'Phi', '磁通量'] },
  { command: '\\varphi', glyph: 'φ', aliases: ['斐异体', 'varphi', '角度', '欧拉函数'] },
  { command: '\\chi', glyph: 'χ', aliases: ['卡', 'chi', '卡方'] },
  { command: '\\psi', glyph: 'ψ', aliases: ['普赛', 'psi', '波函数'] },
  { command: '\\Psi', glyph: 'Ψ', aliases: ['普赛大写', 'Psi'] },
  { command: '\\omega', glyph: 'ω', aliases: ['欧米伽', 'omega', '角速度', '角频率'] },
  { command: '\\Omega', glyph: 'Ω', aliases: ['欧米伽大写', 'Omega', '欧姆', '全集', '样本空间'] },
])

const operators = category('operators', [
  { command: '\\pm', glyph: '±', aliases: ['正负', '加减', '正负号', 'plus minus'] },
  { command: '\\mp', glyph: '∓', aliases: ['负正', '减加', 'minus plus'] },
  { command: '\\times', glyph: '×', aliases: ['乘号', '乘', '叉乘', '交叉', 'times'] },
  { command: '\\div', glyph: '÷', aliases: ['除号', '除以', '除'] },
  { command: '\\cdot', glyph: '⋅', aliases: ['点乘', '内积', '乘点', '点'] },
  { command: '\\cdots', glyph: '⋯', aliases: ['省略号', '中间省略', '等'] },
  { command: '\\ldots', glyph: '…', aliases: ['省略号', '低省略', '等'] },
  { command: '\\dots', glyph: '…', aliases: ['省略号', '等', 'dots'] },
  { command: '\\vdots', glyph: '⋮', aliases: ['竖省略号'] },
  { command: '\\ddots', glyph: '⋱', aliases: ['斜省略号'] },
  { command: '\\ast', glyph: '∗', aliases: ['星号', '星运算', 'asterisk'] },
  { command: '\\star', glyph: '⋆', aliases: ['星', '五角星', 'star'] },
  { command: '\\circ', glyph: '∘', aliases: ['复合', '圆圈', '函数复合', 'composition'] },
  { command: '\\bullet', glyph: '•', aliases: ['实心圆点', '项目点'] },
  { command: '\\oplus', glyph: '⊕', aliases: ['异或', '直和', '圆加', 'xor', 'direct sum'] },
  { command: '\\ominus', glyph: '⊖', aliases: ['圆减'] },
  { command: '\\otimes', glyph: '⊗', aliases: ['张量积', '直积', '圆乘', '克罗内克积', 'tensor'] },
  { command: '\\odot', glyph: '⊙', aliases: ['圆点', '点积'] },
  { command: '\\oslash', glyph: '⊘', aliases: ['圆斜线'] },
  { command: '\\wedge', glyph: '∧', aliases: ['合取', '逻辑与', '与', '楔积', '外积', 'and'] },
  { command: '\\vee', glyph: '∨', aliases: ['析取', '逻辑或', '或', 'or'] },
  { command: '\\diamond', glyph: '⋄', aliases: ['菱形', '小方块'] },
  { command: '\\dagger', glyph: '†', aliases: ['剑', '匕首', '共轭转置', 'dagger'] },
  { command: '\\uplus', glyph: '⊎', aliases: ['多重集并'] },
  { command: '\\sqcap', glyph: '⊓', aliases: ['方交'] },
  { command: '\\sqcup', glyph: '⊔', aliases: ['方并', '不交并'] },
])

const relations = category('relations', [
  { command: '\\leq', glyph: '≤', aliases: ['小于等于', '小于或等于', '不大于', 'le', 'less equal'] },
  { command: '\\geq', glyph: '≥', aliases: ['大于等于', '大于或等于', '不小于', 'ge', 'greater equal'] },
  { command: '\\leqslant', glyph: '⩽', aliases: ['小于等于', '斜线小于等于', '不大于'] },
  { command: '\\geqslant', glyph: '⩾', aliases: ['大于等于', '斜线大于等于', '不小于'] },
  { command: '\\neq', glyph: '≠', aliases: ['不等于', '不等', 'ne', 'neq', 'not equal'] },
  { command: '\\approx', glyph: '≈', aliases: ['约等于', '近似', '大约', 'approx'] },
  { command: '\\sim', glyph: '∼', aliases: ['相似', '等价', '服从分布', '同阶', '波浪等'] },
  { command: '\\simeq', glyph: '≃', aliases: ['渐近等', '近似等'] },
  { command: '\\cong', glyph: '≅', aliases: ['全等', '同构', 'congruent'] },
  { command: '\\equiv', glyph: '≡', aliases: ['恒等', '同余', '恒等于', '定义等', 'equiv'] },
  { command: '\\propto', glyph: '∝', aliases: ['正比', '成正比', 'proportional'] },
  { command: '\\ll', glyph: '≪', aliases: ['远小于', '大大小于'] },
  { command: '\\gg', glyph: '≫', aliases: ['远大于', '大大小于'] },
  { command: '\\prec', glyph: '≺', aliases: ['先于', 'prec'] },
  { command: '\\succ', glyph: '≻', aliases: ['后于', 'succ'] },
  { command: '\\preceq', glyph: '⪯', aliases: ['先于等于', 'preceq'] },
  { command: '\\succeq', glyph: '⪰', aliases: ['后于等于', 'succeq'] },
  { command: '\\lesssim', glyph: '≲', aliases: ['小于约', '至多量级'] },
  { command: '\\gtrsim', glyph: '≳', aliases: ['大于约', '至少量级'] },
  { command: '\\asymp', glyph: '≍', aliases: ['渐近于', 'asymp'] },
  { command: '\\doteq', glyph: '≐', aliases: ['点等于'] },
  { command: '\\triangleq', glyph: '≜', aliases: ['定义', '记为', '定义等'] },
  { command: '\\coloneqq', glyph: '≔', aliases: ['定义为', '定义', '赋值'] },
  { command: '\\mid', glyph: '∣', aliases: ['整除', '竖线', '条件', '除数', 'divides'] },
  { command: '\\nmid', glyph: '∤', aliases: ['不整除'] },
  { command: '\\parallel', glyph: '∥', aliases: ['平行', 'parallel'] },
  { command: '\\nparallel', glyph: '∦', aliases: ['不平行'] },
  { command: '\\perp', glyph: '⊥', aliases: ['垂直', '正交', '垂直于', 'perpendicular'] },
])

const setsLogic = category('sets-logic', [
  { command: '\\in', glyph: '∈', aliases: ['属于', '包含于元素', 'in', 'member'] },
  { command: '\\notin', glyph: '∉', aliases: ['不属于', 'notin'] },
  { command: '\\ni', glyph: '∋', aliases: ['包含元素', '含有', 'ni'] },
  { command: '\\subset', glyph: '⊂', aliases: ['真子集', '子集', '包含于', 'subset'] },
  { command: '\\subseteq', glyph: '⊆', aliases: ['子集', '包含于', '子集或等', 'subseteq'] },
  { command: '\\supset', glyph: '⊃', aliases: ['真超集', '包含', '超集', 'supset'] },
  { command: '\\supseteq', glyph: '⊇', aliases: ['超集', '包含', 'supseteq'] },
  { command: '\\cap', glyph: '∩', aliases: ['交集', '交', 'intersection', 'cap'] },
  { command: '\\cup', glyph: '∪', aliases: ['并集', '并', 'union', 'cup'] },
  { command: '\\setminus', glyph: '∖', aliases: ['差集', '除去', 'setminus', 'minus'] },
  { command: '\\complement', glyph: '∁', aliases: ['补集', '余集', 'complement'] },
  { command: '\\emptyset', glyph: '∅', aliases: ['空集', 'empty set'] },
  { command: '\\varnothing', glyph: '∅', aliases: ['空集', '空集异体'] },
  { command: '\\forall', glyph: '∀', aliases: ['任意', '所有', '任一', '全称量词', 'forall', 'for all'] },
  { command: '\\exists', glyph: '∃', aliases: ['存在', '存在量词', 'exists'] },
  { command: '\\nexists', glyph: '∄', aliases: ['不存在'] },
  { command: '\\neg', glyph: '¬', aliases: ['非', '否定', '逻辑非', 'not'] },
  { command: '\\land', glyph: '∧', aliases: ['逻辑与', '合取', '与', 'and'] },
  { command: '\\lor', glyph: '∨', aliases: ['逻辑或', '析取', '或', 'or'] },
  { command: '\\veebar', glyph: '⊻', aliases: ['异或', '逻辑异或', 'xor'] },
  { command: '\\Rightarrow', glyph: '⇒', aliases: ['推出', '蕴含', '推得', 'implies'] },
  { command: '\\implies', glyph: '⟹', aliases: ['推出', '蕴含', '长蕴含'] },
  { command: '\\Leftrightarrow', glyph: '⇔', aliases: ['等价', '当且仅当', '充要条件', 'iff'] },
  { command: '\\iff', glyph: '⟺', aliases: ['当且仅当', '等价', '充要'] },
  { command: '\\vdash', glyph: '⊢', aliases: ['可推出', '证明', 'vdash'] },
  { command: '\\dashv', glyph: '⊣', aliases: ['反可推出'] },
  { command: '\\models', glyph: '⊨', aliases: ['满足', '模型', 'models'] },
  { command: '\\therefore', glyph: '∴', aliases: ['所以', '因此', 'therefore'] },
  { command: '\\because', glyph: '∵', aliases: ['因为', 'because'] },
  { command: '\\mathbb{R}', glyph: 'ℝ', aliases: ['实数', '实数集', 'real'] },
  { command: '\\mathbb{Z}', glyph: 'ℤ', aliases: ['整数', '整数集', 'integer'] },
  { command: '\\mathbb{N}', glyph: 'ℕ', aliases: ['自然数', '自然数集', 'natural'] },
  { command: '\\mathbb{Q}', glyph: 'ℚ', aliases: ['有理数', '有理数集', 'rational'] },
  { command: '\\mathbb{C}', glyph: 'ℂ', aliases: ['复数', '复数集', 'complex'] },
  { command: '\\mathbb{P}', glyph: 'ℙ', aliases: ['概率', '素数集'] },
  { command: '\\mathbb{E}', glyph: '𝔼', aliases: ['期望', '数学期望', 'expectation'] },
  { command: '\\aleph', glyph: 'ℵ', aliases: ['阿列夫', '基数', 'aleph'] },
])

const arrows = category('arrows', [
  { command: '\\rightarrow', glyph: '→', aliases: ['右箭头', '到', '趋于', 'right arrow', 'to'] },
  { command: '\\to', glyph: '→', aliases: ['趋于', '走向', '到', 'to'] },
  { command: '\\leftarrow', glyph: '←', aliases: ['左箭头', 'left arrow'] },
  { command: '\\leftrightarrow', glyph: '↔', aliases: ['双向箭头', '左右箭头'] },
  { command: '\\Rightarrow', glyph: '⇒', aliases: ['双线右', '推出', '蕴含', 'implies'] },
  { command: '\\Leftarrow', glyph: '⇐', aliases: ['双线左', '被推出'] },
  { command: '\\Leftrightarrow', glyph: '⇔', aliases: ['双线双向', '等价', '充要'] },
  { command: '\\mapsto', glyph: '↦', aliases: ['映射到', '映到', 'mapsto'] },
  { command: '\\longrightarrow', glyph: '⟶', aliases: ['长右箭头', '长箭头'] },
  { command: '\\Longrightarrow', glyph: '⟹', aliases: ['长推出', '长蕴含', '双线长箭头'] },
  { command: '\\longleftarrow', glyph: '⟵', aliases: ['长左箭头'] },
  { command: '\\longleftrightarrow', glyph: '⟷', aliases: ['长双向箭头'] },
  { command: '\\Longleftrightarrow', glyph: '⟺', aliases: ['长等价', '双线长双向'] },
  { command: '\\uparrow', glyph: '↑', aliases: ['上箭头', '向上', 'up'] },
  { command: '\\downarrow', glyph: '↓', aliases: ['下箭头', '向下', 'down'] },
  { command: '\\updownarrow', glyph: '↕', aliases: ['上下箭头'] },
  { command: '\\Uparrow', glyph: '⇑', aliases: ['双线上箭头'] },
  { command: '\\Downarrow', glyph: '⇓', aliases: ['双线下箭头'] },
  { command: '\\nearrow', glyph: '↗', aliases: ['右上箭头', '东北', '上升'] },
  { command: '\\searrow', glyph: '↘', aliases: ['右下箭头', '东南', '下降'] },
  { command: '\\swarrow', glyph: '↙', aliases: ['左下箭头', '西南'] },
  { command: '\\nwarrow', glyph: '↖', aliases: ['左上箭头', '西北'] },
  { command: '\\hookrightarrow', glyph: '↪', aliases: ['嵌入', '钩箭头', '单射', 'hook'] },
  { command: '\\rightleftharpoons', glyph: '⇌', aliases: ['可逆反应', '平衡', '鱼叉', 'equilibrium'] },
  { command: '\\xrightarrow{}', insert: '\\xrightarrow{}', preview: '\\xrightarrow{f}', aliases: ['带标注箭头', '上标箭头', '可伸长箭头'] },
  { command: '\\rightsquigarrow', glyph: '⇝', aliases: ['波浪箭头'] },
  { command: '\\twoheadrightarrow', glyph: '↠', aliases: ['满射', '双头箭头', 'surjection'] },
  { command: '\\rightarrowtail', glyph: '↣', aliases: ['单射', '尾箭头', 'injection'] },
])

const bigOperators = category('big-operators', [
  { command: '\\sum_{}^{}', insert: '\\sum_{}^{}', preview: '\\sum_{i=1}^{n}a_i', glyph: '∑', aliases: ['求和', '连加', 'sum', 'summation'] },
  { command: '\\prod_{}^{}', insert: '\\prod_{}^{}', preview: '\\prod_{i=1}^{n}a_i', glyph: '∏', aliases: ['求积', '连乘', 'product'] },
  { command: '\\coprod', glyph: '∐', aliases: ['上积', '余积', 'coproduct'] },
  { command: '\\int_{}^{}', insert: '\\int_{}^{}', preview: '\\int_{a}^{b}f(x)\\,\\mathrm{d}x', glyph: '∫', aliases: ['积分', '定积分', 'integral'] },
  { command: '\\int', glyph: '∫', aliases: ['积分', '不定积分', 'integral'] },
  { command: '\\iint', glyph: '∬', aliases: ['二重积分'] },
  { command: '\\iiint', glyph: '∭', aliases: ['三重积分'] },
  { command: '\\oint', glyph: '∮', aliases: ['环路积分', '曲线积分', '围道积分'] },
  { command: '\\bigcup_{}^{}', insert: '\\bigcup_{}^{}', preview: '\\bigcup_{i=1}^{n}A_i', glyph: '⋃', aliases: ['大并集', '总并'] },
  { command: '\\bigcap_{}^{}', insert: '\\bigcap_{}^{}', preview: '\\bigcap_{i=1}^{n}A_i', glyph: '⋂', aliases: ['大交集', '总交'] },
  { command: '\\bigoplus', glyph: '⨁', aliases: ['大直和', '直和总和'] },
  { command: '\\bigotimes', glyph: '⨂', aliases: ['大张量积'] },
  { command: '\\bigodot', glyph: '⨀', aliases: ['大圆点'] },
  { command: '\\bigvee', glyph: '⋁', aliases: ['大析取', '大或'] },
  { command: '\\bigwedge', glyph: '⋀', aliases: ['大合取', '大与'] },
  { command: '\\lim_{}', insert: '\\lim_{}', preview: '\\lim_{x\\to\\infty}', aliases: ['极限', 'limit'] },
  { command: '\\limsup', aliases: ['上极限', 'limit superior'] },
  { command: '\\liminf', aliases: ['下极限', 'limit inferior'] },
])

const functions = category('functions', [
  { command: '\\sin', aliases: ['正弦', 'sin', 'sine'] },
  { command: '\\cos', aliases: ['余弦', 'cos', 'cosine'] },
  { command: '\\tan', aliases: ['正切', 'tan', 'tangent'] },
  { command: '\\cot', aliases: ['余切', 'cot'] },
  { command: '\\sec', aliases: ['正割', 'sec'] },
  { command: '\\csc', aliases: ['余割', 'csc'] },
  { command: '\\arcsin', aliases: ['反正弦', 'arcsin'] },
  { command: '\\arccos', aliases: ['反余弦', 'arccos'] },
  { command: '\\arctan', aliases: ['反正切', 'arctan'] },
  { command: '\\sinh', aliases: ['双曲正弦', 'sinh'] },
  { command: '\\cosh', aliases: ['双曲余弦', 'cosh'] },
  { command: '\\tanh', aliases: ['双曲正切', 'tanh'] },
  { command: '\\log', aliases: ['对数', 'log', 'logarithm'] },
  { command: '\\ln', aliases: ['自然对数', 'ln'] },
  { command: '\\lg', aliases: ['常用对数', '以十为底对数', 'lg'] },
  { command: '\\exp', aliases: ['指数函数', '自然指数', 'exp'] },
  { command: '\\max', aliases: ['最大值', '最大', 'max', 'maximum'] },
  { command: '\\min', aliases: ['最小值', '最小', 'min', 'minimum'] },
  { command: '\\sup', aliases: ['上确界', 'sup', 'supremum'] },
  { command: '\\inf', aliases: ['下确界', 'inf', 'infimum'] },
  { command: '\\arg', aliases: ['辐角', 'arg', '自变量'] },
  { command: '\\det', aliases: ['行列式值', 'det', 'determinant'] },
  { command: '\\dim', aliases: ['维数', '维度', 'dim'] },
  { command: '\\ker', aliases: ['核', '零空间', 'ker', 'kernel'] },
  { command: '\\gcd', aliases: ['最大公约数', 'gcd'] },
  { command: '\\deg', aliases: ['次数', '度', 'deg'] },
  { command: '\\hom', aliases: ['同态', 'hom'] },
  { command: '\\Pr', aliases: ['概率', 'Probability'] },
  { command: '\\bmod', aliases: ['取模', '取余', '求余', 'mod'] },
  { command: '\\pmod{}', insert: '\\pmod{}', preview: 'a\\equiv b\\pmod{m}', aliases: ['同余模', '模', 'modulo'] },
])

const misc = category('misc', [
  { command: '\\infty', glyph: '∞', aliases: ['无穷', '无限', 'infinity'] },
  { command: '\\partial', glyph: '∂', aliases: ['偏导数', '偏微分', '偏导', 'partial'] },
  { command: '\\nabla', glyph: '∇', aliases: ['梯度', '纳布拉', '倒三角', '散度', '旋度', 'nabla', 'gradient'] },
  { command: "'", insert: "'", preview: "f'(x)", aliases: ['导数', '撇', '一阶导', 'prime'] },
  { command: '^\\circ', insert: '^\\circ', preview: '90^\\circ', glyph: '°', aliases: ['度', '角度单位', '度数', 'degree'] },
  { command: '^\\top', insert: '^\\top', preview: 'A^\\top', aliases: ['转置', '矩阵转置', 'transpose'] },
  { command: '\\angle', glyph: '∠', aliases: ['角', '角度符号', 'angle'] },
  { command: '\\measuredangle', glyph: '∡', aliases: ['量角'] },
  { command: '\\triangle', glyph: '△', aliases: ['三角形', 'triangle'] },
  { command: '\\square', glyph: '□', aliases: ['正方形', '方框', '证毕', 'square'] },
  { command: '\\blacksquare', glyph: '■', aliases: ['实心方', '证毕', 'qed'] },
  { command: '\\checkmark', glyph: '✓', aliases: ['对勾', '勾选', '正确', 'check'] },
  { command: '\\hbar', glyph: 'ℏ', aliases: ['约化普朗克', 'hbar'] },
  { command: '\\ell', glyph: 'ℓ', aliases: ['手写l', '小椭'] },
  { command: '\\Re', glyph: 'ℜ', aliases: ['实部', 'real part'] },
  { command: '\\Im', glyph: 'ℑ', aliases: ['虚部', 'imaginary part'] },
  { command: '\\%', glyph: '%', aliases: ['百分号', '百分比', 'percent'] },
  { command: '\\$', glyph: '$', aliases: ['美元', '钱', 'dollar'] },
  { command: '\\&', glyph: '&', aliases: ['和', 'ampersand'] },
  { command: '\\#', glyph: '#', aliases: ['井号', '编号'] },
  { command: '\\_', glyph: '_', aliases: ['下划线符号', 'underscore'] },
  { command: '\\{', glyph: '{', aliases: ['左花括号', '开大括号'] },
  { command: '\\}', glyph: '}', aliases: ['右花括号', '闭大括号'] },
])

/** 全部符号，顺序即选择框「全部」分类下的浏览顺序：常用结构在前。 */
export const LATEX_SYMBOLS: readonly LatexSymbol[] = [
  ...structures,
  ...greek,
  ...operators,
  ...relations,
  ...setsLogic,
  ...arrows,
  ...bigOperators,
  ...functions,
  ...misc,
]

/** 插入时需要的全部信息：文本 + 插入点相对位置（偏移基于 insert 本身）。 */
export function latexSymbolInsert(symbol: LatexSymbol): {
  text: string
  selectionStart: number
  selectionEnd: number
} {
  return { text: symbol.insert, selectionStart: symbol.cursor[0], selectionEnd: symbol.cursor[1] }
}

/**
 * 按命令或别名搜索符号（选择框搜索框用）。
 * 匹配顺序：命令完全一致 > 命令前缀 > 别名/字形完全一致 > 别名前缀 >
 * 命令包含 > 别名包含；同档内保持目录原顺序。命令匹配时忽略前导反斜杠，
 * 因此搜 `pm`、`\pm`、「正负」「加减」都能找到 `\pm`。
 */
export function searchLatexSymbols(
  query: string,
  symbols: readonly LatexSymbol[] = LATEX_SYMBOLS,
): LatexSymbol[] {
  const q = query.trim().toLowerCase().replace(/^\\+/, '')
  if (!q) return [...symbols]

  const scored: { symbol: LatexSymbol; score: number; index: number }[] = []
  symbols.forEach((symbol, index) => {
    const command = symbol.command.toLowerCase()
    const bare = command.replace(/^\\+/, '')
    const aliases = symbol.aliases.map((alias) => alias.toLowerCase())
    let score = Number.POSITIVE_INFINITY
    if (bare === q || command === q || command === `\\${q}`) score = 0
    else if (bare.startsWith(q)) score = 1
    else if (symbol.glyph === q || aliases.some((alias) => alias === q)) score = 2
    else if (aliases.some((alias) => alias.startsWith(q))) score = 3
    else if (bare.includes(q)) score = 4
    else if (aliases.some((alias) => alias.includes(q))) score = 5
    if (Number.isFinite(score)) scored.push({ symbol, score, index })
  })

  scored.sort((a, b) => a.score - b.score || a.index - b.index)
  return scored.map((item) => item.symbol)
}
