'use strict'

class TimeoutError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TimeoutError'
  }
}

class AbortError extends Error {
  constructor (message = 'Aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

function sleep (ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort () {
      clearTimeout(timer)
      reject(new AbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Wait for `event` on `emitter`, optionally filtered, with a hard timeout.
 * Always removes its listener, including on the timeout and abort paths —
 * the leak that makes long-lived bots gradually fall over.
 */
function waitForEvent (emitter, event, { timeoutMs, filter, signal } = {}) {
  return new Promise((resolve, reject) => {
    let timer = null

    const cleanup = () => {
      emitter.removeListener(event, onEvent)
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    function onEvent (...args) {
      if (filter && !filter(...args)) return
      cleanup()
      resolve(args)
    }

    function onAbort () {
      cleanup()
      reject(new AbortError())
    }

    if (signal?.aborted) return reject(new AbortError())

    emitter.on(event, onEvent)
    signal?.addEventListener('abort', onAbort, { once: true })

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        cleanup()
        reject(new TimeoutError(`Timed out after ${timeoutMs}ms waiting for "${event}"`))
      }, timeoutMs)
    }
  })
}

module.exports = { sleep, waitForEvent, TimeoutError, AbortError }
