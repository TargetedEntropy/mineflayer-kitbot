/* eslint-env mocha */
'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')
const { sleep, waitForEvent } = require('../lib/wait')

describe('waitForEvent', () => {
  it('resolves with the event arguments', async () => {
    const em = new EventEmitter()
    setImmediate(() => em.emit('hit', 'a', 'b'))
    assert.deepStrictEqual(await waitForEvent(em, 'hit'), ['a', 'b'])
  })

  it('ignores events that fail the filter', async () => {
    const em = new EventEmitter()
    setImmediate(() => { em.emit('hit', 'no'); em.emit('hit', 'yes') })
    const [value] = await waitForEvent(em, 'hit', { filter: (v) => v === 'yes' })
    assert.strictEqual(value, 'yes')
  })

  it('rejects with TimeoutError past the deadline', async () => {
    const em = new EventEmitter()
    await assert.rejects(
      () => waitForEvent(em, 'never', { timeoutMs: 10 }),
      (err) => err.name === 'TimeoutError'
    )
  })

  it('removes its listener on the success path', async () => {
    const em = new EventEmitter()
    setImmediate(() => em.emit('hit'))
    await waitForEvent(em, 'hit')
    assert.strictEqual(em.listenerCount('hit'), 0)
  })

  it('removes its listener on the timeout path', async () => {
    const em = new EventEmitter()
    await assert.rejects(() => waitForEvent(em, 'never', { timeoutMs: 5 }))
    assert.strictEqual(em.listenerCount('never'), 0)
  })

  it('removes its listener on the abort path', async () => {
    const em = new EventEmitter()
    const ac = new AbortController()
    const pending = waitForEvent(em, 'never', { signal: ac.signal })
    ac.abort()
    await assert.rejects(() => pending, (err) => err.name === 'AbortError')
    assert.strictEqual(em.listenerCount('never'), 0)
  })

  it('rejects immediately if the signal is already aborted', async () => {
    const em = new EventEmitter()
    await assert.rejects(
      () => waitForEvent(em, 'x', { signal: AbortSignal.abort() }),
      (err) => err.name === 'AbortError'
    )
  })

  it('does not leak listeners across many filtered misses', async () => {
    const em = new EventEmitter()
    for (let i = 0; i < 50; i++) {
      setImmediate(() => em.emit('tick', i))
      await waitForEvent(em, 'tick')
    }
    assert.strictEqual(em.listenerCount('tick'), 0)
  })
})

describe('sleep', () => {
  it('resolves after the delay', async () => {
    const start = Date.now()
    await sleep(15)
    assert.ok(Date.now() - start >= 10)
  })

  it('rejects when aborted mid-sleep', async () => {
    const ac = new AbortController()
    const pending = sleep(1000, ac.signal)
    setImmediate(() => ac.abort())
    await assert.rejects(() => pending, (err) => err.name === 'AbortError')
  })

  it('rejects immediately when already aborted', async () => {
    await assert.rejects(() => sleep(10, AbortSignal.abort()), (err) => err.name === 'AbortError')
  })
})
