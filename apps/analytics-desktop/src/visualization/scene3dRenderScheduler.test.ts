import { describe, expect, it, vi } from 'vitest'
import { createSceneRenderScheduler } from './scene3dRenderScheduler.js'

describe('3D demand render scheduler', () => {
  it('coalesces requests and cancels the fallback after an animation frame', () => {
    const frames = new Map<number, FrameRequestCallback>()
    const timers = new Map<number, () => void>()
    const render = vi.fn()
    let nextId = 0
    const scheduler = createSceneRenderScheduler(render, {
      requestFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id },
      cancelFrame: (id) => frames.delete(id),
      setTimer: (callback) => { const id = ++nextId; timers.set(id, callback); return id as unknown as ReturnType<typeof setTimeout> },
      clearTimer: (id) => timers.delete(id as unknown as number),
    })

    scheduler.request()
    scheduler.request()
    expect(frames.size).toBe(1)
    expect(timers.size).toBe(1)
    const frame = [...frames.values()][0]
    expect(frame).toBeDefined()
    frame?.(16)
    expect(render).toHaveBeenCalledTimes(1)
    expect(timers.size).toBe(0)
    expect(scheduler.isPending()).toBe(false)
  })

  it('renders through the timer fallback and supports a final synchronous flush', () => {
    const timers: Array<() => void> = []
    const render = vi.fn()
    const scheduler = createSceneRenderScheduler(render, {
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
      setTimer: (callback) => { timers.push(callback); return timers.length as unknown as ReturnType<typeof setTimeout> },
      clearTimer: vi.fn(),
    })

    scheduler.request()
    timers[0]?.()
    expect(render).toHaveBeenCalledTimes(1)
    scheduler.flush()
    expect(render).toHaveBeenCalledTimes(2)
    scheduler.dispose()
    scheduler.request()
    expect(render).toHaveBeenCalledTimes(2)
  })
})
