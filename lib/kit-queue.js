'use strict'

/**
 * Serialises kit deliveries.
 *
 * The bot has exactly one body, so it can only ever serve one player at a
 * time. The original implementation stored the requester in a single mutable
 * variable, which meant a second `!kit` during a delivery silently redirected
 * the in-flight one: the first player got nothing and never found out why.
 *
 * Delivery itself is injected, so this class stays synchronous, deterministic
 * and testable without a Minecraft server.
 */
class KitQueue {
  #pending = []
  #cooldowns = new Map()
  #running = false
  #current = null

  constructor ({ deliver, logger, cooldownMs = 0, maxLength = 20, now = Date.now }) {
    this.deliver = deliver
    this.log = logger
    this.cooldownMs = cooldownMs
    this.maxLength = maxLength
    this.now = now
  }

  get length () {
    return this.#pending.length
  }

  get current () {
    return this.#current
  }

  cooldownRemaining (username) {
    const until = this.#cooldowns.get(username.toLowerCase())
    if (until === undefined) return 0
    return Math.max(0, until - this.now())
  }

  /**
   * @returns {{ accepted: boolean, reason?: string, position?: number }}
   */
  request (username) {
    const key = username.toLowerCase()

    if (this.#current === username || this.#pending.includes(username)) {
      return { accepted: false, reason: 'already-queued' }
    }

    const remaining = this.cooldownRemaining(username)
    if (remaining > 0) {
      return { accepted: false, reason: 'cooldown', retryInMs: remaining }
    }

    if (this.#pending.length >= this.maxLength) {
      return { accepted: false, reason: 'queue-full' }
    }

    this.#pending.push(username)
    this.#cooldowns.set(key, this.now() + this.cooldownMs)
    const position = this.#pending.length + (this.#current ? 1 : 0)

    this.#pump()
    return { accepted: true, position }
  }

  /** Drop a queued request, e.g. because the player logged off. */
  cancel (username) {
    const idx = this.#pending.indexOf(username)
    if (idx === -1) return false
    this.#pending.splice(idx, 1)
    return true
  }

  clear () {
    const dropped = this.#pending.splice(0, this.#pending.length)
    return dropped
  }

  async #pump () {
    if (this.#running) return
    this.#running = true
    try {
      while (this.#pending.length > 0) {
        const username = this.#pending.shift()
        this.#current = username
        try {
          await this.deliver(username)
        } catch (err) {
          // One failed delivery must never wedge the queue.
          this.log.warn(`Delivery to ${username} failed: ${err.message}`)
          // A failed delivery shouldn't burn the player's cooldown.
          this.#cooldowns.delete(username.toLowerCase())
        } finally {
          this.#current = null
        }
      }
    } finally {
      this.#running = false
    }
  }

  /** Resolves once the queue has fully drained. Test helper. */
  async idle () {
    while (this.#running || this.#pending.length > 0) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

module.exports = { KitQueue }
