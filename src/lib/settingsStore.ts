import { STORAGE_KEYS } from './config'

type PersonalSettings = Record<string, unknown>

function readAll(): PersonalSettings {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.personalSettings)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PersonalSettings : {}
  } catch {
    return {}
  }
}

/**
 * Personal preferences use the same storage model as comments: a browser-local
 * JSON store and a custom event so every open view can refresh immediately.
 * `legacyKey` keeps installations made before the consolidated store working.
 */
export function readPersonalSetting<T>(name: string, legacyKey?: string): T | null {
  const all = readAll()
  if (name in all) return all[name] as T
  if (!legacyKey || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(legacyKey)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

export function writePersonalSetting<T>(name: string, value: T) {
  if (typeof localStorage === 'undefined') return
  const all = readAll()
  all[name] = value
  localStorage.setItem(STORAGE_KEYS.personalSettings, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent('starlog:settings-changed', { detail: { name } }))
}
