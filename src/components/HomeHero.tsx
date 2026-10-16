import {
  ArrowDown,
  ArrowUpRight,
  Braces,
  Orbit,
  Palette,
  Sigma,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { siteConfig } from '../lib/config'
import { AppearancePicker } from './AppearancePicker'
import { AuroraText } from './magicui/aurora-text'
import { BorderBeam } from './magicui/border-beam'

export function HomeHero({
  postCount,
  tagCount,
}: {
  postCount: number
  tagCount: number
}) {
  return (
    <section
      className="container-page pt-6 sm:pt-10"
      aria-labelledby="hero-title"
    >
      <div className="home-hero relative isolate overflow-hidden rounded-[2rem] border border-brand-300/30 px-6 py-10 sm:px-12 sm:py-16 lg:px-14">
        <div className="hero-dot-pattern" aria-hidden="true" />
        <div className="hero-halo" aria-hidden="true" />
        <div className="relative z-10 grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div className="animate-fade-up">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-400/20 bg-brand-500/5 px-3 py-1.5 font-mono text-[10px] tracking-[.18em] text-brand-700 dark:text-brand-200">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> A SMALL
              CORNER OF THE INTERNET
            </span>
            <p className="mb-3 text-sm font-medium tracking-widest text-ink-500 dark:text-ink-300">
              {siteConfig.titleEn || siteConfig.title} ·{' '}
              {siteConfig.author.name}
            </p>
            <h1
              id="hero-title"
              className="font-serif text-4xl font-semibold leading-[1.3] tracking-tight text-ink-900 sm:text-5xl lg:text-[3.4rem] dark:text-white"
            >
              让思绪漫游，
              <br />
              <AuroraText>让灵感有迹可循。</AuroraText>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-ink-600 sm:text-base dark:text-ink-300">
              {siteConfig.description}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#posts"
                className="btn-primary shimmer-button !rounded-full !px-6 !py-3"
              >
                开始阅读 <ArrowDown size={15} />
              </a>
              <Link
                to="/archive"
                className="btn-outline !rounded-full !px-5 !py-3"
              >
                探索归档 <ArrowUpRight size={15} />
              </Link>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-ink-500 dark:text-ink-400">
              <span>
                <strong className="mr-1.5 font-mono font-medium text-ink-800 dark:text-ink-200">
                  {String(postCount).padStart(2, '0')}
                </strong>
                篇记录
              </span>
              <span className="h-3 w-px bg-ink-400/30" />
              <span>
                <strong className="mr-1.5 font-mono font-medium text-ink-800 dark:text-ink-200">
                  {String(tagCount).padStart(2, '0')}
                </strong>
                个标签
              </span>
              <span className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-brand-500" />{' '}
                保持好奇，持续记录
              </span>
            </div>
          </div>
          <div
            className="hero-observatory relative mx-auto hidden h-[320px] w-full max-w-[360px] items-center justify-center sm:flex"
            aria-hidden="true"
          >
            <div className="orbit-ring orbit-ring-outer" />
            <div className="orbit-ring orbit-ring-inner" />
            <div className="orbit-track">
              <span />
            </div>
            <div className="hero-planet">
              <Orbit size={64} strokeWidth={1} />
              <span className="mt-3 font-mono text-[10px] tracking-[.35em]">
                THINK · CREATE
              </span>
            </div>
            <div className="orbit-note absolute left-0 top-7 -rotate-6">
              <Sigma size={18} className="text-brand-500" />
              <span>数学里的浪漫</span>
              <span className="font-mono text-[10px] text-ink-400">
                f(x) = curiosity
              </span>
            </div>
            <div className="orbit-note absolute bottom-6 right-0 rotate-6">
              <Braces size={18} className="text-brand-500" />
              <span>代码里的宇宙</span>
              <span className="font-mono text-[10px] text-ink-400">
                while (curious) create()
              </span>
            </div>
            <span className="absolute right-8 top-10 text-brand-400">
              <Sparkles size={22} strokeWidth={1} />
            </span>
          </div>
        </div>
        <div className="relative z-10 mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-brand-400/15 pt-5">
          <span className="font-mono text-[10px] tracking-[.14em] text-ink-400">
            WORDS, IDEAS & LITTLE DISCOVERIES
          </span>
          <div className="flex items-center gap-3">
            <Link
              to="/settings"
              className="flex items-center gap-1.5 text-xs text-ink-500 transition hover:text-brand-600 dark:text-ink-400"
            >
              <Palette size={13} />
              换个心情
            </Link>
            <AppearancePicker compact />
          </div>
        </div>
        <BorderBeam />
      </div>
    </section>
  )
}
