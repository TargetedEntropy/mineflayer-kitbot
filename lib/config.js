'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  minecraft: {
    host: null,
    port: 25565,
    username: null,
    auth: 'microsoft',
    version: false, // false => let mineflayer negotiate with the server
    profilesFolder: null // null => node-minecraft-protocol default (.minecraft)
  },
  discord: {
    token: null,
    channelId: null
  },
  kit: {
    pickup: null, // { x, z } the pressure plate in front of the dropper
    home: null, // optional { x, z }: where the bot respawns, used to confirm it got back
    trigger: '!kit',
    cooldownMs: 60_000, // per-player, stops one player draining the dropper
    pickupTimeoutMs: 60_000, // give up walking to the dropper after this
    acceptTimeoutMs: 30_000, // how long a player has to accept the /tpa
    returnTimeoutMs: 15_000 // grace period before force-/kill back home
  },
  owners: [], // UUIDs allowed to issue privileged whispers
  logLevel: 'info'
}

// The original config was a flat blob with some genuinely misleading names
// (`kit_pos_y` held a Z coordinate). Accept it, but say so.
const LEGACY_KEYS = {
  server: 'minecraft.host',
  email: 'minecraft.username',
  server_version: 'minecraft.version',
  token: 'discord.token',
  channelID: 'discord.channelId',
  kit_pos_x: 'kit.pickup.x',
  kit_pos_y: 'kit.pickup.z',
  bed_pos_x: 'kit.home.x',
  whitelist_uuid: 'owners'
}

function isPlainObject (v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge (base, override) {
  const out = { ...base }
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v
  }
  return out
}

function looksLegacy (raw) {
  return Object.keys(LEGACY_KEYS).some((k) => k in raw)
}

function migrateLegacy (raw, warn) {
  const out = {}
  const setPath = (dotted, value) => {
    const parts = dotted.split('.')
    let cursor = out
    for (const part of parts.slice(0, -1)) {
      cursor[part] = cursor[part] ?? {}
      cursor = cursor[part]
    }
    cursor[parts.at(-1)] = value
  }

  for (const [legacy, modern] of Object.entries(LEGACY_KEYS)) {
    if (!(legacy in raw)) continue
    const value = raw[legacy]
    if (value === '' || value === null || (Array.isArray(value) && value.every((v) => v === ''))) continue
    setPath(modern, modern.endsWith('.x') || modern.endsWith('.z') ? Number(value) : value)
  }

  // The legacy format had bed_pos_x but no matching Z, so it could never
  // actually locate home. Drop the half-coordinate rather than pretend.
  if (out.kit?.home && !Number.isFinite(out.kit.home.z)) {
    delete out.kit.home
    warn('Legacy bed_pos_x has no matching Z coordinate, so kit.home was dropped. Set kit.home = { x, z } to re-enable the "made it home" check.')
  }

  warn(
    'config.json uses the legacy flat format; it was migrated in memory. ' +
    'See config.sample.json for the current layout (note: kit_pos_y was really a Z coordinate).'
  )
  return out
}

// Env vars win over the file so the bot can run in a container without baking
// secrets into an image.
function applyEnv (cfg, env) {
  const map = {
    KITBOT_MC_HOST: 'minecraft.host',
    KITBOT_MC_PORT: 'minecraft.port',
    KITBOT_MC_USERNAME: 'minecraft.username',
    KITBOT_MC_VERSION: 'minecraft.version',
    KITBOT_MC_AUTH: 'minecraft.auth',
    KITBOT_DISCORD_TOKEN: 'discord.token',
    KITBOT_DISCORD_CHANNEL_ID: 'discord.channelId',
    KITBOT_LOG_LEVEL: 'logLevel'
  }
  const out = structuredClone(cfg)
  for (const [envKey, dotted] of Object.entries(map)) {
    const value = env[envKey]
    if (value === undefined || value === '') continue
    const parts = dotted.split('.')
    let cursor = out
    for (const part of parts.slice(0, -1)) cursor = cursor[part]
    cursor[parts.at(-1)] = dotted === 'minecraft.port' ? Number(value) : value
  }
  return out
}

function validateCoord (name, value, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${name} must be an object like { "x": 0, "z": 0 }`)
    return
  }
  for (const axis of ['x', 'z']) {
    if (!Number.isFinite(value[axis])) errors.push(`${name}.${axis} must be a finite number`)
  }
}

function validate (cfg) {
  const errors = []

  if (!cfg.minecraft.host) errors.push('minecraft.host is required (the server address)')
  if (!cfg.minecraft.username) errors.push('minecraft.username is required (your Microsoft account email)')
  if (!Number.isInteger(cfg.minecraft.port) || cfg.minecraft.port < 1 || cfg.minecraft.port > 65535) {
    errors.push('minecraft.port must be an integer between 1 and 65535')
  }
  if (!['microsoft', 'offline', 'mojang'].includes(cfg.minecraft.auth)) {
    errors.push("minecraft.auth must be one of 'microsoft', 'offline', 'mojang'")
  }

  validateCoord('kit.pickup', cfg.kit.pickup, errors)
  // home is optional: without it the bot just trusts the return timeout.
  if (cfg.kit.home !== null && cfg.kit.home !== undefined) {
    validateCoord('kit.home', cfg.kit.home, errors)
  }

  if (!cfg.kit.trigger) errors.push('kit.trigger must be a non-empty string')

  if (!Array.isArray(cfg.owners)) {
    errors.push('owners must be an array of Minecraft UUIDs')
  }

  // Discord is optional; but half-configured Discord is a mistake, not a choice.
  const hasToken = Boolean(cfg.discord.token)
  const hasChannel = Boolean(cfg.discord.channelId)
  if (hasToken !== hasChannel) {
    errors.push('discord.token and discord.channelId must be set together (or both left empty to disable Discord)')
  }

  if (errors.length) {
    const err = new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`)
    err.name = 'ConfigError'
    err.errors = errors
    throw err
  }
  return cfg
}

// UUIDs are compared case-insensitively and without dashes, because servers,
// Mojang and humans all disagree about the canonical form.
function normalizeUuid (uuid) {
  return String(uuid ?? '').toLowerCase().replace(/-/g, '')
}

function loadConfig (options = {}) {
  const file = options.file ?? path.join(__dirname, '..', 'config.json')
  const env = options.env ?? process.env
  const warn = options.warn ?? (() => {})

  let raw = options.raw
  if (raw === undefined) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') {
        const e = new Error(`No config file at ${file}. Copy config.sample.json to config.json and fill it in.`)
        e.name = 'ConfigError'
        throw e
      }
      throw err
    }
    try {
      raw = JSON.parse(text)
    } catch (err) {
      const e = new Error(`${file} is not valid JSON: ${err.message}`)
      e.name = 'ConfigError'
      throw e
    }
  }

  const shaped = looksLegacy(raw) ? migrateLegacy(raw, warn) : raw
  const merged = applyEnv(deepMerge(DEFAULTS, shaped), env)
  merged.owners = (merged.owners ?? []).filter(Boolean).map(normalizeUuid)
  return validate(merged)
}

module.exports = { loadConfig, normalizeUuid, DEFAULTS, LEGACY_KEYS }
