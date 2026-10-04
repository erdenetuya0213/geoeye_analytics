import { useRef, useState } from 'react'

/** Serializes explicit save/export actions and reports disk errors to the screen. */
export function useDurableAction() {
  const locked = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const perform = async (action: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setNotice('Saving to your workspace folder…')
    try { await action(); setNotice(null) }
    catch (error) { setNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}. Keep this window open and retry after checking the folder.`) }
    finally { locked.current = false }
  }
  return { notice, perform }
}
