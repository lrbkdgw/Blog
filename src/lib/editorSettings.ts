import { useCallback, useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

/** 个人偏好键：编辑器双栏视图是否自动同步滚动。 */
const SCROLL_SYNC_SETTING = 'editorScrollSync'

/** 默认开启：沿用双栏编辑器原有的自动同步行为。 */
export function readEditorScrollSync(): boolean {
  const value = readPersonalSetting<boolean>(SCROLL_SYNC_SETTING)
  return typeof value === 'boolean' ? value : true
}

export function writeEditorScrollSync(enabled: boolean) {
  writePersonalSetting(SCROLL_SYNC_SETTING, enabled)
}

/**
 * 编辑器滚动同步偏好。设置页与其他标签页修改后，
 * 正在使用的编辑器会通过 `starlog:settings-changed` / `storage` 事件即时更新。
 */
export function useEditorScrollSync(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(readEditorScrollSync)

  useEffect(() => {
    const sync = () => setEnabledState(readEditorScrollSync())
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    writeEditorScrollSync(next)
    setEnabledState(next)
  }, [])

  return [enabled, setEnabled]
}
