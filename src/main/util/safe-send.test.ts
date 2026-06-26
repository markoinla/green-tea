import { describe, it, expect, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { safeSend } from './safe-send'

function makeWindow(opts: {
  destroyed?: boolean
  webContentsDestroyed?: boolean
  send?: ReturnType<typeof vi.fn>
}): BrowserWindow {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      isDestroyed: () => opts.webContentsDestroyed ?? false,
      send: opts.send ?? vi.fn()
    }
  } as unknown as BrowserWindow
}

describe('safeSend', () => {
  it('no-ops when window is null', () => {
    expect(() => safeSend(null, 'channel')).not.toThrow()
  })

  it('no-ops when window is undefined', () => {
    expect(() => safeSend(undefined, 'channel')).not.toThrow()
  })

  it('no-ops when window.isDestroyed() is true', () => {
    const send = vi.fn()
    safeSend(makeWindow({ destroyed: true, send }), 'channel', 1)
    expect(send).not.toHaveBeenCalled()
  })

  it('no-ops when webContents.isDestroyed() is true', () => {
    const send = vi.fn()
    safeSend(makeWindow({ webContentsDestroyed: true, send }), 'channel', 1)
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards channel and args to webContents.send when alive', () => {
    const send = vi.fn()
    safeSend(makeWindow({ send }), 'channel', 1, 'two', { three: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('channel', 1, 'two', { three: true })
  })
})
