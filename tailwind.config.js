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
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e5ff',
          200: '#bcd1ff',
          300: '#8eb3ff',
          400: '#5a8bff',
          500: '#3563f6',
          600: '#2044eb',
          700: '#1a34d8',
          800: '#1c2eae',
          900: '#1d2d89',
          950: '#151d53',
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
      typography: (theme) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.ink.700'),
            '--tw-prose-headings': theme('colors.ink.900'),
            '--tw-prose-links': theme('colors.brand.600'),
            '--tw-prose-quotes': theme('colors.ink.600'),
            maxWidth: 'none',
            a: {
              textDecoration: 'none',
              borderBottom: `1px solid ${theme('colors.brand.300')}`,
              fontWeight: '500',
              transition: 'all .15s ease',
              '&:hover': { borderBottomColor: theme('colors.brand.500'), color: theme('colors.brand.700') },
            },
            code: {
              fontWeight: '500',
              background: theme('colors.ink.100'),
              padding: '.15em .4em',
              borderRadius: '.35rem',
              fontSize: '.875em',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            'pre code': { background: 'transparent', padding: '0' },
          },
        },
        invert: {
          css: {
            '--tw-prose-body': theme('colors.ink.300'),
            '--tw-prose-headings': theme('colors.ink.50'),
            '--tw-prose-links': theme('colors.brand.300'),
            code: { background: 'rgba(255,255,255,.08)' },
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
