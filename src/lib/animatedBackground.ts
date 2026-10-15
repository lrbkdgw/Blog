import { useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import {
  findScene, getSceneValues, defaultSceneValues, normalizeSceneValues, normalizeAnimatedBackground,
  type AnimatedBackgroundPreference, type SceneId, type ActiveSceneId,
} from './scenes'
export * from './scenes'

const STORAGE_NAME = 'animatedBackground'

export function readAnimatedBackground(): AnimatedBackgroundPreference {
  return normalizeAnimatedBackground(readPersonalSetting(STORAGE_NAME))
}

// An in-memory fallback keeps controls usable when storage is unavailable. This
// preference is deliberately never enqueued for GitHub account synchronization.
let volatilePreference: AnimatedBackgroundPreference | null = null
function current() { return volatilePreference ?? readAnimatedBackground() }
function write(next: AnimatedBackgroundPreference) {
  try {
    volatilePreference = null
    writePersonalSetting(STORAGE_NAME, next)
  } catch {
    volatilePreference = next
    window.dispatchEvent(new Event('starlog:storage-unavailable'))
    window.dispatchEvent(new CustomEvent('starlog:settings-changed', { detail: { name: STORAGE_NAME } }))
  }
}

export function setAnimatedScene(scene: SceneId) {
  write(normalizeAnimatedBackground({ ...current(), scene }))
}
export function setSceneValue(scene: ActiveSceneId, key: string, value: number) {
  const spec = findScene(scene)
  if (!spec) return
  const pref = current()
  write({ ...pref, values: { ...pref.values, [scene]: normalizeSceneValues(spec, { ...getSceneValues(pref, scene), [key]: value }) } })
}
export function resetSceneValues(scene: ActiveSceneId) {
  const spec = findScene(scene)
  if (!spec) return
  const pref = current()
  write({ ...pref, values: { ...pref.values, [scene]: defaultSceneValues(spec) } })
}
export function resetAnimatedBackground() { write(normalizeAnimatedBackground(null)) }

export function useAnimatedBackground(): AnimatedBackgroundPreference {
  const [pref, setPref] = useState(current)
  useEffect(() => {
    const sync = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name
      if (name && name !== STORAGE_NAME) return
      if (event instanceof StorageEvent) volatilePreference = null
      setPref(current())
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return pref
}
