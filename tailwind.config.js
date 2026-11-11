/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // 允许任意整数透明度修饰符，例如 bg-white/12、border-white/65
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, String(i / 100)])),
      // 字体栈由 FontProvider 写入 CSS 变量，管理员可在站内设置中即时切换。
      // display 用于标题：默认跟随正文字体（--font-display 在 index.css 里指向 --font-sans），
      // 于是用户自定义的正文字体会同时作用于标题，而被 `::set-font` 指定的文章字体也能一并跟随。
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        serif: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
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
        /**
         * 中性色阶：偏冷的灰，承载全部界面文字、描边与底色。
         * 重设计后整体更收敛——浅色端更接近纸白，深色端更接近墨黑，
         * 灰阶之间的明度步长更均匀，小字号文本仍保持可读对比度。
         */
        ink: {
          50: '#f7f8fa',
          100: '#f1f3f6',
          200: '#e4e7ec',
          300: '#cfd4dc',
          400: '#98a0ae',
          500: '#6b7280',
          600: '#565d69',
          700: '#414753',
          800: '#2a2f38',
          900: '#16191f',
          950: '#0b0d11',
        },
      },
      borderRadius: {
        '4xl': '1.75rem',
      },
      boxShadow: {
        /** 卡片默认只有一层几乎看不见的接触阴影，悬浮时再用 .card-lift 抬起来 */
        '2xs': '0 1px 2px 0 rgb(16 24 40 / 0.05)',
        card: '0 1px 2px rgb(16 24 40 / 0.04)',
        lift: '0 1px 2px rgb(16 24 40 / 0.05), 0 20px 40px -28px rgb(16 24 40 / 0.35)',
        pop: '0 24px 64px -28px rgb(16 24 40 / 0.32), 0 2px 6px rgb(16 24 40 / 0.06)',
      },
      transitionTimingFunction: {
        /** 页面上所有位移 / 淡入都走同一条缓动，观感统一 */
        smooth: 'cubic-bezier(.22,1,.36,1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(.97) translateY(-2px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .55s cubic-bezier(.22,1,.36,1) both',
        'fade-in': 'fade-in .4s ease both',
        'scale-in': 'scale-in .2s cubic-bezier(.22,1,.36,1) both',
        float: 'float 9s ease-in-out infinite',
      },
      typography: () => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': '#414753',
            '--tw-prose-headings': '#16191f',
            '--tw-prose-lead': '#565d69',
            '--tw-prose-links': 'rgb(var(--brand-600))',
            '--tw-prose-bold': '#16191f',
            '--tw-prose-counters': '#6b7280',
            '--tw-prose-bullets': '#cfd4dc',
            '--tw-prose-hr': '#e4e7ec',
            '--tw-prose-quotes': '#414753',
            '--tw-prose-quote-borders': 'rgb(var(--brand-300))',
            '--tw-prose-captions': '#6b7280',
            '--tw-prose-code': '#16191f',
            '--tw-prose-th-borders': '#e4e7ec',
            '--tw-prose-td-borders': '#e4e7ec',
            maxWidth: 'none',
            fontSize: '1.0625rem',
            lineHeight: '1.8',
            a: {
              textDecoration: 'none',
              borderBottom: '1px solid rgb(var(--brand-400) / 0.45)',
              fontWeight: '500',
              transition: 'border-color .15s ease, color .15s ease',
              '&:hover': { borderBottomColor: 'rgb(var(--brand-600))', color: 'rgb(var(--brand-700))' },
            },
            code: {
              fontWeight: '500',
              background: '#f1f3f6',
              padding: '.15em .4em',
              borderRadius: '.35rem',
              fontSize: '.875em',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            'pre code': { background: 'transparent', padding: '0' },
            blockquote: { fontStyle: 'normal', fontWeight: '400' },
          },
        },
        invert: {
          css: {
            '--tw-prose-body': '#a8b0bd',
            '--tw-prose-headings': '#f4f6f9',
            '--tw-prose-lead': '#98a0ae',
            '--tw-prose-links': 'rgb(var(--brand-300))',
            '--tw-prose-bold': '#f4f6f9',
            '--tw-prose-bullets': '#414753',
            '--tw-prose-hr': 'rgba(255,255,255,.1)',
            '--tw-prose-quotes': '#cfd4dc',
            '--tw-prose-code': '#f4f6f9',
            '--tw-prose-th-borders': 'rgba(255,255,255,.12)',
            '--tw-prose-td-borders': 'rgba(255,255,255,.1)',
            a: {
              borderBottomColor: 'rgb(var(--brand-400) / 0.4)',
              '&:hover': { borderBottomColor: 'rgb(var(--brand-300))', color: 'rgb(var(--brand-200))' },
            },
            code: { background: 'rgba(255,255,255,.08)' },
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
