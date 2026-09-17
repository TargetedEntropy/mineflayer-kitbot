'use strict'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

function ts () {
  return new Date().toISOString()
}

// Minimal leveled logger. Deliberately dependency-free: the bot is meant to be
// dropped on a box and run with `node index.js`, not wired into a log pipeline.
function createLogger (opts = {}) {
  const threshold = LEVELS[opts.level] ?? LEVELS.info
  const sink = opts.sink ?? console

  function emit (level, stream, args) {
    if (LEVELS[level] < threshold) return
    stream(`${ts()} ${level.toUpperCase().padEnd(5)}`, ...args)
  }

  return {
    level: opts.level ?? 'info',
    debug: (...a) => emit('debug', sink.log.bind(sink), a),
    info: (...a) => emit('info', sink.log.bind(sink), a),
    warn: (...a) => emit('warn', sink.warn.bind(sink), a),
    error: (...a) => emit('error', sink.error.bind(sink), a)
  }
}

module.exports = { createLogger, LEVELS }
