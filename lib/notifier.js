'use strict'

const { Client, GatewayIntentBits, ActivityType, Events } = require('discord.js')

// A Discord notifier that can never take the bot down with it.
//
// The kit bot's job is delivering kits; Discord is a nice-to-have side channel.
// Every path here swallows its own errors and logs, and messages sent before
// the client is ready are buffered rather than dropped on the floor.
class Notifier {
  #client = null
  #channel = null
  #queue = []
  #ready = false
  #closed = false

  constructor ({ token, channelId, logger, maxQueue = 100 }) {
    this.token = token
    this.channelId = channelId
    this.log = logger
    this.maxQueue = maxQueue
    this.enabled = Boolean(token && channelId)
  }

  async start () {
    if (!this.enabled) {
      this.log.info('Discord not configured; notifications disabled')
      return
    }

    // Notifications are one-way, so we need no privileged intents at all.
    // The original bot requested GuildMembers and message content style
    // intents it never used, which forces needless portal configuration.
    this.#client = new Client({ intents: [GatewayIntentBits.Guilds] })

    this.#client.once(Events.ClientReady, async (client) => {
      this.log.info(`Discord connected as ${client.user.tag}`)
      try {
        client.user.setActivity('handing out kits', { type: ActivityType.Playing })
      } catch (err) {
        this.log.warn('Could not set Discord activity:', err.message)
      }
      try {
        const channel = await client.channels.fetch(this.channelId)
        if (!channel?.isTextBased()) {
          this.log.error(`Discord channel ${this.channelId} is not a text channel; notifications disabled`)
          this.enabled = false
          return
        }
        this.#channel = channel
        this.#ready = true
        await this.#drain()
      } catch (err) {
        this.log.error(`Could not resolve Discord channel ${this.channelId}: ${err.message}`)
        this.enabled = false
      }
    })

    this.#client.on(Events.Error, (err) => this.log.error('Discord client error:', err.message))

    try {
      await this.#client.login(this.token)
    } catch (err) {
      this.log.error(`Discord login failed (${err.message}); continuing without notifications`)
      this.enabled = false
      this.#client = null
    }
  }

  async #drain () {
    const pending = this.#queue.splice(0, this.#queue.length)
    for (const text of pending) await this.#deliver(text)
  }

  async #deliver (text) {
    try {
      await this.#channel.send(text)
    } catch (err) {
      this.log.warn(`Discord send failed: ${err.message}`)
    }
  }

  // Fire-and-forget by design: callers should never await Discord on the
  // delivery hot path.
  send (text) {
    if (!this.enabled || this.#closed) return
    if (!this.#ready) {
      if (this.#queue.length >= this.maxQueue) this.#queue.shift()
      this.#queue.push(text)
      return
    }
    this.#deliver(text)
  }

  async stop () {
    this.#closed = true
    if (!this.#client) return
    try {
      await this.#client.destroy()
    } catch (err) {
      this.log.warn(`Discord shutdown: ${err.message}`)
    }
    this.#client = null
    this.#ready = false
  }
}

module.exports = { Notifier }
