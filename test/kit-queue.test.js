/* eslint-env mocha */
'use strict'

const assert = require('assert')
const { KitQueue } = require('../lib/kit-queue')

const silent = { debug () {}, info () {}, warn () {}, error () {} }

function makeQueue (opts = {}) {
  const served = []
  const deliver = opts.deliver ?? (async (u) => { served.push(u) })
  const queue = new KitQueue({ deliver, logger: silent, cooldownMs: 0, ...opts })
  return { queue, served }
}

describe('KitQueue', () => {
  it('accepts a first request and reports position 1', () => {
    const { queue } = makeQueue()
    assert.deepStrictEqual(queue.request('Alice'), { accepted: true, position: 1 })
  })

  it('serves queued players in order', async () => {
    const order = []
    const q = new KitQueue({
      deliver: async (u) => { await new Promise((resolve) => setTimeout(resolve, 5)); order.push(u) },
      logger: silent,
      cooldownMs: 0
    })
    q.request('Alice')
    q.request('Bob')
    q.request('Carol')
    await q.idle()
    assert.deepStrictEqual(order, ['Alice', 'Bob', 'Carol'])
  })

  it('never runs two deliveries concurrently', async () => {
    let active = 0
    let maxActive = 0
    const q = new KitQueue({
      deliver: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
      },
      logger: silent,
      cooldownMs: 0
    })
    for (const name of ['A', 'B', 'C', 'D']) q.request(name)
    await q.idle()
    assert.strictEqual(maxActive, 1)
  })

  it('rejects a duplicate request from a queued player', () => {
    const { queue } = makeQueue()
    queue.request('Alice')
    assert.deepStrictEqual(queue.request('Alice'), { accepted: false, reason: 'already-queued' })
  })

  it('enforces a per-player cooldown after delivery', async () => {
    let now = 1000
    const { queue } = makeQueue({ cooldownMs: 60_000, now: () => now })
    assert.strictEqual(queue.request('Alice').accepted, true)
    await queue.idle()
    now += 1000
    const second = queue.request('Alice')
    assert.strictEqual(second.accepted, false)
    assert.strictEqual(second.reason, 'cooldown')
    assert.strictEqual(second.retryInMs, 59_000)
  })

  it('reports an in-flight requester as already-queued, not on cooldown', async () => {
    const queue = new KitQueue({
      deliver: () => new Promise(() => {}),
      logger: silent,
      cooldownMs: 60_000
    })
    queue.request('Alice')
    await new Promise((resolve) => setImmediate(resolve))
    assert.strictEqual(queue.current, 'Alice')
    assert.strictEqual(queue.request('Alice').reason, 'already-queued')
  })

  it('lets a player back in once the cooldown expires', async () => {
    let now = 1000
    const { queue } = makeQueue({ cooldownMs: 10_000, now: () => now })
    queue.request('Alice')
    await queue.idle()
    now += 10_001
    assert.strictEqual(queue.request('Alice').accepted, true)
  })

  it('treats usernames case-insensitively for cooldowns', async () => {
    const now = 0
    const { queue } = makeQueue({ cooldownMs: 60_000, now: () => now })
    queue.request('Alice')
    await queue.idle()
    assert.strictEqual(queue.request('alice').reason, 'cooldown')
  })

  it('rejects requests once the queue is full', () => {
    const { queue } = makeQueue({
      maxLength: 2,
      deliver: () => new Promise(() => {}) // never resolves; queue stays occupied
    })
    queue.request('A')
    queue.request('B')
    queue.request('C')
    assert.strictEqual(queue.request('D').reason, 'queue-full')
  })

  it('keeps serving after a delivery throws', async () => {
    const order = []
    const q = new KitQueue({
      deliver: async (u) => {
        if (u === 'Bob') throw new Error('tpa timed out')
        order.push(u)
      },
      logger: silent,
      cooldownMs: 0
    })
    q.request('Alice')
    q.request('Bob')
    q.request('Carol')
    await q.idle()
    assert.deepStrictEqual(order, ['Alice', 'Carol'])
  })

  it('does not burn a cooldown when delivery fails', async () => {
    const now = 0
    const q = new KitQueue({
      deliver: async () => { throw new Error('nope') },
      logger: silent,
      cooldownMs: 60_000,
      now: () => now
    })
    q.request('Alice')
    await q.idle()
    assert.strictEqual(q.cooldownRemaining('Alice'), 0)
    assert.strictEqual(q.request('Alice').accepted, true)
  })

  it('cancels a queued player who logs off', () => {
    const { queue } = makeQueue({ deliver: () => new Promise(() => {}) })
    queue.request('Alice')
    queue.request('Bob')
    assert.strictEqual(queue.cancel('Bob'), true)
    assert.strictEqual(queue.cancel('Nobody'), false)
    assert.strictEqual(queue.length, 0)
  })

  it('exposes who is currently being served', async () => {
    let release
    const q = new KitQueue({
      deliver: () => new Promise((resolve) => { release = resolve }),
      logger: silent,
      cooldownMs: 0
    })
    q.request('Alice')
    await new Promise((resolve) => setImmediate(resolve))
    assert.strictEqual(q.current, 'Alice')
    release()
    await q.idle()
    assert.strictEqual(q.current, null)
  })
})
