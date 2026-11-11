/**
 * 正文字号缩放：Markdown 正文里的正文字号统一乘以 CSS 变量 --prose-font-scale
 * （定义与说明见 src/styles/index.css 的 :root；当前 0.95，即原字号的 95%）。
 * 这里负责正文根字号和折叠框两档字号，表格 / 展示框的固定字号在 index.css 里按同样写法相乘。
 */
const proseScaled = (size) => `calc(${size} * var(--prose-font-scale))`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // 允许任意整数透明度修饰符，例如 bg-white/12、border-white/65
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, String(i / 100)])),
      // 字体栈由 FontProvider 写入 CSS 变量，管理员可在站内设置中即时切换。
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      /**
       * 折叠框的两档字号；表单控件（ui-choose / ui-select / ui-if / ui-write）直接复用，
       * 因此两者的字号永远一致，并随正文一起缩放：
       *   text-callout        内容：14.5px（行高另由 leading-relaxed 给出）
       *   text-callout-label  标题 / 标签：0.875rem，行高 1.25rem（原 text-sm）
       */
      fontSize: {
        callout: proseScaled('14.5px'),
        'callout-label': [proseScaled('0.875rem'), proseScaled('1.25rem')],
      },
      colors: {
        /**
         * 品牌色阶改为引用 CSS 变量（`R G B` 三元组），
         * 这样切换配色主题时全站所有 `bg-brand-500` 之类的类名自动跟随，
         * 无需在每个组件里写主题分支。变量定义见 src/styles/index.css。
         */
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b0b8c9',
          400: '#8591ab',
          500: '#667391',
          600: '#525c78',
          700: '#434b62',
          800: '#3a4053',
          900: '#191d2b',
          950: '#0d1017',
        },
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .5s cubic-bezier(.22,1,.36,1) both',
        'fade-in': 'fade-in .4s ease both',
        'scale-in': 'scale-in .25s cubic-bezier(.22,1,.36,1) both',
        float: 'float 9s ease-in-out infinite',
      },
      typography: () => ({
        DEFAULT: {
          css: {
            // 正文根字号：标题、列表、引用、行内代码、公式与段间距都按 em 跟随它。
            fontSize: proseScaled('1rem'),
            '--tw-prose-body': '#434b62',
            '--tw-prose-headings': '#191d2b',
            '--tw-prose-links': 'rgb(var(--brand-600))',
            '--tw-prose-quotes': '#525c78',
            maxWidth: 'none',
            a: {
              textDecoration: 'none',
              borderBottom: '1px solid rgb(var(--brand-300))',
              fontWeight: '500',
              transition: 'all .15s ease',
              '&:hover': { borderBottomColor: 'rgb(var(--brand-500))', color: 'rgb(var(--brand-700))' },
            },
            code: {
              fontWeight: '500',
              background: '#eceef2',
              padding: '.15em .4em',
              borderRadius: '.35rem',
              fontSize: '.875em',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            'pre code': { background: 'transparent', padding: '0' },
          },
        },
        // .prose-base / .prose-sm 会再声明一次根字号，同样要乘以缩放系数。
        base: { css: { fontSize: proseScaled('1rem') } },
        sm: { css: { fontSize: proseScaled('0.875rem') } },
        invert: {
          css: {
            '--tw-prose-body': '#b0b8c9',
            '--tw-prose-headings': '#f6f7f9',
            '--tw-prose-links': 'rgb(var(--brand-300))',
            code: { background: 'rgba(255,255,255,.08)' },
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
