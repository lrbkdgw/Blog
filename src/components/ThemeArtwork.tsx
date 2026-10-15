import { useId } from 'react'
import type { PaletteId } from '../lib/appearance'

/** Original vector artwork; no remote images, fonts, or animation-library dependency. */
export function ThemeArtwork({ palette, miniature = false }: { palette: PaletteId; miniature?: boolean }) {
  const id = useId().replace(/:/g, '')
  const fill = `url(#${id}-wash)`
  const glow = `url(#${id}-glow)`
  const line = 'var(--art-primary, rgb(var(--brand-500)))'
  const secondary = 'var(--art-secondary, rgb(var(--theme-secondary)))'
  return (
    <svg viewBox="0 0 400 300" fill="none" aria-hidden="true" className={`theme-artwork ${miniature ? 'is-miniature' : ''}`}>
      <defs>
        <linearGradient id={`${id}-wash`} x1="90" y1="40" x2="300" y2="260" gradientUnits="userSpaceOnUse">
          <stop stopColor={secondary} /><stop offset="1" stopColor={line} />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop stopColor={secondary} stopOpacity=".6" /><stop offset="1" stopColor={secondary} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="210" cy="145" r="150" fill={glow} opacity=".6" />
      {palette === 'classic' && (
        <>
          <g stroke={line} strokeWidth=".8">
            <circle cx="200" cy="150" r="113" strokeDasharray="2 8" opacity=".3" />
            <ellipse cx="200" cy="150" rx="156" ry="65" transform="rotate(-28 200 150)" opacity=".4" />
            <ellipse cx="200" cy="150" rx="142" ry="63" transform="rotate(38 200 150)" opacity=".25" />
            <path d="M30 150H370M200 15V285" opacity=".1" />
          </g>
          <g className="art-float">
            <circle cx="200" cy="150" r="62" fill={fill} opacity=".9" />
            <ellipse cx="200" cy="150" rx="25" ry="62" stroke="white" strokeOpacity=".35" />
            <ellipse cx="200" cy="150" rx="62" ry="22" stroke="white" strokeOpacity=".4" transform="rotate(-18 200 150)" />
            <path d="M144 124Q198 168 255 130M149 187Q210 148 255 174" stroke="white" strokeOpacity=".2" />
          </g>
          <g className="art-orbit" style={{ transformOrigin: '200px 150px' }}>
            <circle cx="200" cy="37" r="5" fill={line} /><circle cx="200" cy="37" r="10" stroke={line} strokeOpacity=".18" />
            <circle cx="113" cy="222" r="3" fill={secondary} />
          </g>
          <path d="M314 82v14m-7-7h14M75 207v10m-5-5h10" stroke={line} strokeWidth="1.2" opacity=".6" />
        </>
      )}
      {(palette === 'aurora' || palette === 'neon') && (
        <>
          {palette === 'neon' && <g stroke={line} strokeOpacity=".2" strokeWidth=".7">{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M200 130L${-120 + i * 80} 300M45 ${175 + i * 17}H355`} />)}</g>}
          <g className="art-float">
            {[0, 1, 2, 3].map((i) => <path key={i} d={`M15 ${170 + i * 16}C100 ${10 + i * 20} 165 ${290 - i * 25} 255 ${95 + i * 20}S350 ${90 + i * 18} 390 55`} stroke={fill} strokeWidth={28 - i * 4} strokeOpacity={0.22 + i * 0.08} />)}
          </g>
          <circle cx="280" cy="65" r="26" stroke={line} strokeOpacity=".4" />
          <circle cx="280" cy="65" r="18" fill={fill} opacity=".8" />
          {[[70, 60], [150, 100], [325, 205], [95, 250]].map(([x, y]) => <path key={x} d={`M${x} ${y - 4}v8m-4-4h8`} stroke={line} opacity=".55" />)}
        </>
      )}
      {palette === 'sakura' && (
        <>
          <circle cx="230" cy="125" r="88" stroke={line} strokeOpacity=".18" />
          <path d="M90 270Q180 185 240 55M145 205Q105 150 100 120M190 150Q260 180 304 155M210 113Q178 78 160 60" stroke={line} strokeWidth="2" strokeOpacity=".4" />
          <g className="art-float">
            {[[240, 60], [215, 110], [160, 65], [105, 123], [290, 155], [160, 185]].map(([x, y], j) => <g key={j} transform={`translate(${x} ${y})`}>{[0, 72, 144, 216, 288].map((r) => <ellipse key={r} cy="-12" rx="9" ry="14" transform={`rotate(${r})`} fill={j % 2 ? secondary : fill} opacity=".8" />)}<circle r="3" fill={line} /></g>)}
          </g>
          <ellipse cx="295" cy="223" rx="5" ry="11" fill={fill} transform="rotate(32 295 223)" opacity=".7" />
          <ellipse cx="110" cy="70" rx="4" ry="9" fill={fill} transform="rotate(-25 110 70)" opacity=".5" />
        </>
      )}
      {palette === 'forest' && (
        <>
          <circle cx="210" cy="130" r="89" stroke={line} strokeOpacity=".2" strokeDasharray="2 5" />
          <path d="M50 275Q120 200 200 225T370 200V300H50Z" fill={fill} opacity=".13" />
          {[0, 1, 2].map((branch) => <g key={branch} transform={`translate(${95 + branch * 90} ${250 - branch * 15}) rotate(${branch * 12 - 15})`} stroke={line}>
            <path d="M0 25Q20-70 5-130" strokeOpacity=".55" />
            {[0, 1, 2, 3].map((i) => <g key={i}><path d={`M${9 + i} ${-i * 27}q-38-8-38-35q32 3 38 35`} fill={fill} fillOpacity=".4" strokeOpacity=".2" /><path d={`M${11 + i} ${-i * 27 - 12}q35-12 36-36q-32 6-36 36`} fill={fill} fillOpacity=".25" strokeOpacity=".2" /></g>)}
          </g>)}
          <g className="art-float" fill={secondary}>{[[175, 85], [290, 115], [95, 155]].map(([x, y]) => <g key={x}><circle cx={x} cy={y} r="16" fill={glow} /><circle cx={x} cy={y} r="3" /></g>)}</g>
        </>
      )}
      {(palette === 'ocean' || palette === 'sunset') && (
        <>
          <circle cx="240" cy="114" r={palette === 'sunset' ? 67 : 43} fill={fill} opacity=".7" className="art-float" />
          <circle cx="240" cy="114" r="90" stroke={line} strokeOpacity=".15" />
          {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M20 ${161 + i * 13}Q100 ${121 + i * 14} 200 ${168 + i * 12}T390 ${165 + i * 13}`} stroke={i % 3 ? line : secondary} strokeOpacity={0.2 + i * 0.03} strokeWidth={i % 3 ? 1 : 2} />)}
          <path d="M76 79l13-7 12 7m-11 16 8-5 8 5" stroke={line} strokeOpacity=".5" strokeLinecap="round" />
        </>
      )}
      {palette === 'paper' && (
        <>
          <rect x="100" y="45" width="176" height="215" rx="5" transform="rotate(-9 100 45)" fill={fill} opacity=".12" />
          <g className="art-float">
            <rect x="125" y="35" width="176" height="215" rx="5" fill="var(--art-bg, rgb(var(--surface)))" stroke={line} strokeOpacity=".35" />
            <path d="M148 80H277M148 94H250M148 189H277M148 203H277M148 217H228" stroke={line} strokeOpacity=".28" />
            <circle cx="210" cy="141" r="28" stroke={line} strokeOpacity=".5" />
            <path d="M168 169L210 107 252 169ZM210 107V169" stroke={line} strokeOpacity=".45" />
          </g>
          <path d="M295 217l40-115 8 3-40 115-10 8z" fill={fill} opacity=".7" />
        </>
      )}
      {!miniature && <g fill={line} opacity=".5" fontFamily="ui-monospace, monospace" fontSize="8" letterSpacing="2"><text x="24" y="28">A SPACE FOR IDEAS</text><text x="290" y="285">EST. IN WORDS</text></g>}
    </svg>
  )
}
