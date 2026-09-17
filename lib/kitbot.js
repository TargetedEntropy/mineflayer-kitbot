'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

const { KitQueue } = require('./kit-queue')
const { normalizeUuid } = require('./config')
const { sleep, waitForEvent, AbortError } = require('./wait')

const RECONNECT_BASE_MS = 5_000
const RECONNECT_MAX_MS = 5 * 60_000
// Give the dropper a moment to push the shulker onto the bot after it steps on
// the plate. Without this the bot often /tpa's before it is actually holding a kit.
const PICKUP_SETTLE_MS = 1_500

/**
 * Owns a single Minecraft connection and everything bound to it.
 *
 * One KitBot instance == one mineflayer bot. When the connection dies the
 * instance is discarded whole and a fresh one is built, so no listener,
 * timer or half-finished delivery can survive into the next session. The
 * original code reassigned a captured `bot` variable and re-bound listeners
 * onto the old object, which leaked a listener set per reconnect and left
 * the outer reference pointing at a dead connection.
 */
class KitBot {
  #bot = null
  #queue = null
  #abort = new AbortController()
  #stopped = false

  constructor ({ config, notifier, logger, onEnd }) {
    this.config = config
    this.notifier = notifier
    this.log = logger
    this.onEnd = onEnd
    this.ownerUuids = new Set(config.owners)
  }

  get bot () {
    return this.#bot
  }

  get queue () {
    return this.#queue
  }

  start () {
    const { minecraft } = this.config
    this.log.info(`Connecting to ${minecraft.host}:${minecraft.port} as ${minecraft.username}`)

    const options = {
      host: minecraft.host,
      port: minecraft.port,
      username: minecraft.username,
      auth: minecraft.auth,
      // `version: false` lets mineflayer negotiate with the server instead of
      // guessing, which is what you want on a server you do not control.
      version: minecraft.version || false,
      // Surface auth problems instead of silently retrying forever.
      hideErrors: false,
      onMsaCode: (data) => {
        this.log.warn('=========================================================')
        this.log.warn(`Microsoft sign-in required: go to ${data.verification_uri}`)
        this.log.warn(`and enter code ${data.user_code}`)
        this.log.warn('=========================================================')
      }
    }
    if (minecraft.profilesFolder) options.profilesFolder = minecraft.profilesFolder

    this.#bot = mineflayer.createBot(options)
    this.#bind(this.#bot)
    return this
  }

  #bind (bot) {
    bot.loadPlugin(pathfinder)

    this.#queue = new KitQueue({
      deliver: (username) => this.#deliver(username),
      logger: this.log,
      cooldownMs: this.config.kit.cooldownMs
    })

    bot.once('spawn', () => {
      // Movements reads bot.registry itself now; the old `new Movements(bot, mcData)`
      // second argument was removed in mineflayer-pathfinder 2.4.x, and the
      // hardcoded require('minecraft-data')('1.12.2') ignored the real server version.
      bot.pathfinder.setMovements(new Movements(bot))
      this.log.info(`Spawned as ${bot.username} (${bot.registry?.version?.minecraftVersion ?? 'unknown version'})`)
      this.notifier.send(`✅ **${bot.username}** is online and taking kit requests.`)
    })

    // Plugin-provided methods such as addChatPattern only exist once mineflayer
    // has injected its internal plugins, so they cannot be called synchronously
    // after createBot().
    bot.once('inject_allowed', () => {
      // `chatAddPattern` is deprecated; `addChatPattern(..., { parse: true })`
      // emits `chat:<name>` with the regex capture groups.
      bot.addChatPattern('tpaccepted', /^Teleported to ([a-zA-Z0-9_]{3,16})!$/, { parse: true })
      bot.addChatPattern('tparequest', /^([a-zA-Z0-9_]{3,16}) wants to teleport to you\.$/, { parse: true })
    })

    bot.on('chat:tparequest', ([[username]]) => this.#onTpaRequest(username))
    bot.on('chat', (username, message) => this.#onChat(username, message))
    bot.on('whisper', (username, message) => this.#onWhisper(username, message))

    bot.on('death', () => this.log.info('Bot died (usually the /kill trip home)'))

    bot.on('playerLeft', (player) => {
      if (this.#queue?.cancel(player.username)) {
        this.log.info(`${player.username} left; dropped their queued kit request`)
      }
    })

    bot.on('kicked', (reason, loggedIn) => {
      this.log.warn(`Kicked (${loggedIn ? 'in-game' : 'during login'}): ${reason}`)
    })

    bot.on('error', (err) => {
      this.log.error(`Bot error: ${err.message}`)
    })

    // 'end' is the single reliable disconnect signal; 'error' and 'kicked' are
    // always followed by it. Reconnecting from all three, as the original did,
    // produced overlapping connections and login throttling.
    bot.once('end', (reason) => {
      if (this.#stopped) return
      this.log.warn(`Disconnected: ${reason}`)
      this.#teardown()
      this.notifier.send(`⚠️ **${this.config.minecraft.username}** disconnected (${reason}).`)
      this.onEnd?.(reason)
    })
  }

  #isOwner (username) {
    const player = this.#bot?.players?.[username]
    if (!player) return false
    // The server's own player list is the source of truth for UUIDs, so the
    // dead mojang-api / add-dashes-to-uuid round trip is unnecessary. The old
    // code also checked the *bot's* UUID rather than the sender's, so owner
    // commands never actually worked.
    return this.ownerUuids.has(normalizeUuid(player.uuid))
  }

  #onTpaRequest (username) {
    if (!this.#isOwner(username)) {
      this.log.debug(`Ignoring TP request from non-owner ${username}`)
      return
    }
    this.log.info(`Accepting TP request from owner ${username}`)
    this.notifier.send(`🔁 Accepting teleport request from **${username}**.`)
    this.#bot.whisper(username, 'Auto-accepting your teleport request.')
    this.#bot.chat(`/tpy ${username}`)
  }

  #onChat (username, message) {
    if (username === this.#bot.username) return
    if (message.trim().toLowerCase() !== this.config.kit.trigger.toLowerCase()) return

    const result = this.#queue.request(username)
    if (result.accepted) {
      this.log.info(`Queued kit for ${username} (position ${result.position})`)
      if (result.position > 1) {
        this.#bot.whisper(username, `You're #${result.position} in the kit queue, hang tight.`)
      }
      return
    }

    if (result.reason === 'cooldown') {
      const secs = Math.ceil(result.retryInMs / 1000)
      this.#bot.whisper(username, `You already got a kit recently. Try again in ${secs}s.`)
    } else if (result.reason === 'queue-full') {
      this.#bot.whisper(username, 'The kit queue is full right now, try again shortly.')
    }
    this.log.debug(`Rejected kit request from ${username}: ${result.reason}`)
  }

  #onWhisper (username, message) {
    this.log.info(`${username} whispers: ${message}`)
    if (!this.#isOwner(username)) return

    const command = message.trim().toLowerCase()
    if (command === 'kill' || command === 'stop') {
      this.#bot.whisper(username, 'Shutting down.')
      this.log.warn(`Shutdown requested by owner ${username}`)
      this.onEnd?.('owner-requested', { permanent: true })
      return
    }
    if (command === 'tpa') {
      this.#bot.chat(`/tpa ${username}`)
      return
    }
    if (command === 'queue') {
      const current = this.#queue.current
      this.#bot.whisper(username, `Serving: ${current ?? 'nobody'} | waiting: ${this.#queue.length}`)
    }
  }

  /** One full kit run. Throws to let the queue log and move on. */
  async #deliver (username) {
    const { kit } = this.config
    const bot = this.#bot
    const signal = this.#abort.signal

    if (!bot.players[username]) {
      throw new Error(`${username} is no longer online`)
    }

    this.log.info(`Fetching kit for ${username}`)

    // 1. Walk to the pressure plate in front of the dropper.
    await this.#withTimeout(
      bot.pathfinder.goto(new goals.GoalXZ(kit.pickup.x, kit.pickup.z)),
      kit.pickupTimeoutMs,
      'walking to the kit dropper'
    )

    // 2. Let the redstone actually hand over the kit.
    await sleep(PICKUP_SETTLE_MS, signal)

    // 3. Offer the teleport and wait for this specific player to accept.
    this.log.info(`Sending /tpa to ${username}`)
    bot.chat(`/tpa ${username}`)

    try {
      await waitForEvent(bot, 'chat:tpaccepted', {
        timeoutMs: kit.acceptTimeoutMs,
        signal,
        filter: ([[accepted]]) => accepted?.toLowerCase() === username.toLowerCase()
      })
    } catch (err) {
      if (err.name === 'TimeoutError') {
        bot.whisper(username, "You didn't accept the teleport in time; run the trigger again when you're ready.")
        this.notifier.send(`⏳ **${username}** did not accept the teleport in time.`)
      }
      throw err
    }

    this.log.info(`Delivered kit to ${username}`)
    this.notifier.send(`🎁 Gave a kit to **${username}**.`)

    // 4. Go home. /kill is the anarchy-server idiom for "respawn at my bed".
    await this.#goHome()
  }

  async #goHome () {
    const bot = this.#bot
    const { kit } = this.config

    bot.pathfinder.setGoal(null)
    bot.chat('/kill')
    this.log.debug('Sent /kill to return home')

    try {
      await waitForEvent(bot, 'spawn', { timeoutMs: kit.returnTimeoutMs, signal: this.#abort.signal })
    } catch (err) {
      if (err.name !== 'TimeoutError') throw err
      this.log.warn('No respawn seen after /kill; retrying once')
      bot.chat('/kill')
      return
    }

    if (!kit.home) return

    // Confirm we actually landed at the bed. The original compared a number
    // against a config string, so this check could never pass.
    const { x, z } = bot.entity.position
    const distance = Math.hypot(x - kit.home.x, z - kit.home.z)
    if (distance > 16) {
      this.log.warn(`Respawned ${distance.toFixed(1)} blocks from configured home; is kit.home correct?`)
    }
  }

  async #withTimeout (promise, timeoutMs, what) {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out ${what} after ${timeoutMs}ms`)), timeoutMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  #teardown () {
    this.#abort.abort()
    this.#queue?.clear()
    this.#bot?.removeAllListeners()
    if (this.#bot?.pathfinder) {
      try {
        this.#bot.pathfinder.setGoal(null)
      } catch { /* pathfinder may already be gone with the connection */ }
    }
  }

  stop (reason = 'shutdown') {
    if (this.#stopped) return
    this.#stopped = true
    this.#teardown()
    try {
      this.#bot?.quit(reason)
    } catch { /* already disconnected */ }
    this.#bot = null
  }
}

/**
 * Supervises KitBot instances: builds one, and when it ends builds a fresh one
 * after an exponentially backed-off delay.
 */
class Supervisor {
  #current = null
  #attempt = 0
  #timer = null
  #stopped = false

  constructor ({ config, notifier, logger }) {
    this.config = config
    this.notifier = notifier
    this.log = logger
  }

  /** The live KitBot, or null while disconnected/backing off. */
  get current () {
    return this.#current
  }

  /** The live mineflayer bot, or null while disconnected/backing off. */
  get bot () {
    return this.#current?.bot ?? null
  }

  start () {
    if (this.#stopped) return
    this.#current = new KitBot({
      config: this.config,
      notifier: this.notifier,
      logger: this.log,
      onEnd: (reason, opts) => this.#handleEnd(reason, opts)
    })
    this.#current.start()

    // A connection that stays up for a while is a healthy one; reset backoff.
    this.#current.bot.once('spawn', () => { this.#attempt = 0 })
  }

  #handleEnd (reason, { permanent = false } = {}) {
    this.#current?.stop(reason)
    this.#current = null

    if (permanent) {
      this.log.warn('Permanent shutdown requested; not reconnecting')
      this.stop()
      return
    }
    if (this.#stopped) return

    this.#attempt += 1
    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** (this.#attempt - 1), RECONNECT_MAX_MS)
    // Jitter keeps several bots from stampeding a server after a restart.
    const delay = Math.round(backoff * (0.75 + Math.random() * 0.5))
    this.log.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.#attempt})`)
    this.#timer = setTimeout(() => this.start(), delay)
    this.#timer.unref?.()
  }

  async stop () {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#current?.stop('shutdown')
    this.#current = null
    await this.notifier.stop()
  }
}

module.exports = { KitBot, Supervisor, AbortError }
