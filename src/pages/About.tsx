import aboutRaw from '/content/about.md?raw'
import { Github, Mail, Twitter } from 'lucide-react'
import { Markdown } from '../components/Markdown'
import { parseFrontmatter } from '../lib/frontmatter'
import { siteConfig } from '../lib/config'

export default function About() {
  const { content } = parseFrontmatter(aboutRaw)
  const { author, social } = siteConfig

  const links = [
    social.github && { href: social.github, icon: Github, label: 'GitHub' },
    social.twitter && { href: social.twitter, icon: Twitter, label: 'Twitter' },
    social.email && { href: `mailto:${social.email}`, icon: Mail, label: social.email },
  ].filter(Boolean) as { href: string; icon: typeof Github; label: string }[]

  return (
    <div className="container-page max-w-3xl pt-16">
      <header className="flex animate-fade-up flex-col items-start gap-5 sm:flex-row sm:items-center">
        {author.avatar ? (
          <img src={author.avatar} alt={author.name} className="h-20 w-20 rounded-2xl object-cover shadow-lg" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-indigo-700 text-3xl font-bold text-white shadow-xl shadow-brand-600/25">
            {author.name[0]?.toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">{author.name}</h1>
          <p className="mt-1.5 text-sm text-ink-500">{author.bio}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="chip">
                <l.icon size={12} />
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </header>

      <div className="mt-12 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <Markdown content={content} />
      </div>
    </div>
  )
}
