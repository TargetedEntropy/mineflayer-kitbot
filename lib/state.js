'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Small persisted key-value store for things the bot learns at runtime.
 *
 * Kept deliberately separate from config.json: that file is hand-written and
 * may carry comments, ordering and formatting the operator cares about, so the
 * bot has no business rewriting it. State written here overrides the matching
 * config value, and can always be cleared to fall back to the file.
 */
class State {
  #data = {}

  constructor ({ file, logger }) {
    this.file = file
    this.log = logger
  }

  /** Never throws: a missing or corrupt state file is not worth refusing to start over. */
  load () {
    try {
      this.#data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (typeof this.#data !== 'object' || this.#data === null || Array.isArray(this.#data)) {
        throw new Error('state file is not a JSON object')
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.log.warn(`Ignoring unreadable state file ${this.file}: ${err.message}`)
      }
      this.#data = {}
    }
    return this.#data
  }

  get (key) {
    return this.#data[key]
  }

  all () {
    return { ...this.#data }
  }

  /**
   * Persist a value. Writes to a temp file and renames, so a crash mid-write
   * cannot leave a truncated state file behind.
   * @returns {boolean} whether the value reached disk
   */
  set (key, value) {
    if (value === undefined) delete this.#data[key]
    else this.#data[key] = value
    return this.#flush()
  }

  delete (key) {
    if (!(key in this.#data)) return true
    delete this.#data[key]
    return this.#flush()
  }

  #flush () {
    const tmp = `${this.file}.${process.pid}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.#data, null, 2) + '\n')
      fs.renameSync(tmp, this.file)
      return true
    } catch (err) {
      this.log.error(`Could not write state file ${this.file}: ${err.message}`)
      try { fs.unlinkSync(tmp) } catch { /* nothing to clean up */ }
      return false
    }
  }
}

module.exports = { State }
