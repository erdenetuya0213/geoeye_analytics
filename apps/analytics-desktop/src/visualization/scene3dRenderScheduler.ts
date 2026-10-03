// Adapted from teamastrogeo/drillhole-planner (main @ 3a712c1).
// The timer fallback matters in desktop shells where an occluded WebGL view may
// not receive requestAnimationFrame callbacks until the next user gesture.

export const SCENE_RENDER_FALLBACK_MS = 250

type FrameRequest = (callback: FrameRequestCallback) => number
type FrameCancel = (id: number) => void
type TimerRequest = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
type TimerCancel = (id: ReturnType<typeof setTimeout>) => void

interface RenderSchedulerOptions {
  cancelFrame?: FrameCancel
  clearTimer?: TimerCancel
  fallbackDelayMs?: number
  requestFrame?: FrameRequest
  setTimer?: TimerRequest
}

export interface SceneRenderScheduler {
  dispose: () => void
  flush: () => void
  isPending: () => boolean
  request: () => void
}

export function createSceneRenderScheduler(
  render: () => void,
  {
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (id) => globalThis.clearTimeout(id),
    fallbackDelayMs = SCENE_RENDER_FALLBACK_MS,
  }: RenderSchedulerOptions = {},
): SceneRenderScheduler {
  let frameId: number | null = null
  let timerId: ReturnType<typeof setTimeout> | null = null
  let token = 0
  let disposed = false

  const cancelPending = () => {
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
    if (timerId !== null) {
      clearTimer(timerId)
      timerId = null
    }
    token += 1
  }

  const renderNow = () => {
    cancelPending()
    render()
  }

  return {
    request() {
      if (disposed || frameId !== null || timerId !== null) return
      const requestToken = ++token
      const deliver = () => {
        if (disposed || requestToken !== token) return
        renderNow()
      }
      frameId = requestFrame(deliver)
      timerId = setTimer(deliver, fallbackDelayMs)
    },
    flush() {
      if (!disposed) renderNow()
    },
    isPending() {
      return frameId !== null || timerId !== null
    },
    dispose() {
      cancelPending()
      disposed = true
    },
  }
}
