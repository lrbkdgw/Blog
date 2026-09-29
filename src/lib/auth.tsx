import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AUTH_PASSWORD_SHA256, STORAGE_KEYS } from './config'
import { getToken, setToken, verifyToken } from './github'
import type { GhUser } from './github'

export type AuthMode = 'local' | 'github'

interface Session {
  mode: AuthMode
  at: number
  user?: GhUser
}

interface AuthCtx {
  session: Session | null
  isAuthed: boolean
  ghUser: GhUser | null
  /** 是否具备提交到 GitHub 的能力 */
  canPublish: boolean
  loginWithPassword: (password: string) => Promise<void>
  loginWithGithub: (token: string) => Promise<GhUser>
  connectGithub: (token: string) => Promise<GhUser>
  disconnectGithub: () => void
  logout: () => void
  loading: boolean
}

const Ctx = createContext<AuthCtx | null>(null)

async function sha256(text: string): Promise<string> {
  if (!crypto?.subtle) throw new Error('当前环境不支持 Web Crypto（请使用 HTTPS 或 localhost 访问）')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 7 天有效期 */
const MAX_AGE = 7 * 24 * 3600 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ghUser, setGhUser] = useState<GhUser | null>(null)
  const [loading, setLoading] = useState(true)

  // 恢复会话
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.session)
        const cached = localStorage.getItem(STORAGE_KEYS.ghUser)
        if (cached && alive) setGhUser(JSON.parse(cached))
        if (raw) {
          const s: Session = JSON.parse(raw)
          if (Date.now() - s.at < MAX_AGE) {
            if (alive) setSession(s)
          } else {
            localStorage.removeItem(STORAGE_KEYS.session)
          }
        }
        // 后台校验 token 是否仍然有效
        const token = getToken()
        if (token) {
          try {
            const user = await verifyToken(token)
            if (!alive) return
            setGhUser(user)
            localStorage.setItem(STORAGE_KEYS.ghUser, JSON.stringify(user))
          } catch {
            if (!alive) return
            setToken(null)
            setGhUser(null)
            localStorage.removeItem(STORAGE_KEYS.ghUser)
          }
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const persist = useCallback((s: Session | null) => {
    setSession(s)
    if (s) localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(s))
    else localStorage.removeItem(STORAGE_KEYS.session)
  }, [])

  const loginWithPassword = useCallback(
    async (password: string) => {
      const hash = await sha256(password)
      if (hash !== AUTH_PASSWORD_SHA256.toLowerCase()) throw new Error('密码不正确')
      persist({ mode: 'local', at: Date.now() })
    },
    [persist],
  )

  const connectGithub = useCallback(async (token: string) => {
    const user = await verifyToken(token.trim())
    setToken(token.trim())
    setGhUser(user)
    localStorage.setItem(STORAGE_KEYS.ghUser, JSON.stringify(user))
    return user
  }, [])

  const loginWithGithub = useCallback(
    async (token: string) => {
      const user = await connectGithub(token)
      persist({ mode: 'github', at: Date.now(), user })
      return user
    },
    [connectGithub, persist],
  )

  const disconnectGithub = useCallback(() => {
    setToken(null)
    setGhUser(null)
    localStorage.removeItem(STORAGE_KEYS.ghUser)
  }, [])

  const logout = useCallback(() => {
    persist(null)
    setToken(null)
    setGhUser(null)
    localStorage.removeItem(STORAGE_KEYS.ghUser)
  }, [persist])

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      isAuthed: !!session,
      ghUser,
      canPublish: !!ghUser && !!getToken(),
      loginWithPassword,
      loginWithGithub,
      connectGithub,
      disconnectGithub,
      logout,
      loading,
    }),
    [session, ghUser, loading, loginWithPassword, loginWithGithub, connectGithub, disconnectGithub, logout],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
