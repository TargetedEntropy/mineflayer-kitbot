'use strict'

const path = require('path')

const { loadConfig } = require('./lib/config')
const { createLogger } = require('./lib/logger')
const { Notifier } = require('./lib/notifier')
const { Supervisor } = require('./lib/kitbot')
const { State } = require('./lib/state')

async function main () {
  const bootLog = createLogger({ level: 'info' })

  let config
  try {
    config = loadConfig({ warn: (msg) => bootLog.warn(msg) })
  } catch (err) {
    if (err.name === 'ConfigError') {
      bootLog.error(err.message)
      process.exitCode = 1
      return
    }
    throw err
  }

  const log = createLogger({ level: config.logLevel })
  const notifier = new Notifier({
    token: config.discord.token,
    channelId: config.discord.channelId,
    logger: log
  })

  // Discord is best-effort and must not gate the bot coming online.
  await notifier.start()

  // Runtime state (currently just the home set via the `sethome` whisper)
  // lives beside config.json and takes precedence over it.
  const state = new State({ file: path.join(__dirname, 'kitbot-state.json'), logger: log })
  state.load()

  const savedHome = state.get('kitHome')
  if (savedHome) {
    if (config.kit.home) {
      log.info(`Using home saved via sethome (x=${savedHome.x} z=${savedHome.z}), overriding config.json`)
    } else {
      log.info(`Using home saved via sethome: x=${savedHome.x} z=${savedHome.z}`)
    }
    config.kit.home = savedHome
  }

  const supervisor = new Supervisor({ config, notifier, logger: log, state })
  supervisor.start()

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info(`Received ${signal}, shutting down`)
    await supervisor.stop()
    // Give Discord's socket a moment to close cleanly.
    setTimeout(() => process.exit(0), 500).unref()
  }

  process.on('SIGINT', () => { shutdown('SIGINT') })
  process.on('SIGTERM', () => { shutdown('SIGTERM') })

  process.on('unhandledRejection', (err) => {
    log.error('Unhandled rejection:', err?.stack ?? err)
  })
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during startup:', err)
    process.exit(1)
  })
}

module.exports = { main }
