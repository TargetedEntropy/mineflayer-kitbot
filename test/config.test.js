/* eslint-env mocha */
'use strict'

const assert = require('assert')
const { loadConfig, normalizeUuid } = require('../lib/config')

const VALID = {
  minecraft: { host: 'mc.example.com', username: 'a@b.c' },
  kit: { pickup: { x: 1, z: 2 } },
  owners: []
}

const load = (raw, env = {}) => loadConfig({ raw, env, warn: () => {} })

describe('config', () => {
  it('applies defaults for omitted values', () => {
    const cfg = load(VALID)
    assert.strictEqual(cfg.minecraft.port, 25565)
    assert.strictEqual(cfg.minecraft.auth, 'microsoft')
    assert.strictEqual(cfg.kit.trigger, '!kit')
    assert.strictEqual(cfg.logLevel, 'info')
  })

  it('rejects a config missing required fields', () => {
    assert.throws(() => load({}), (err) => {
      assert.strictEqual(err.name, 'ConfigError')
      assert.ok(err.errors.some((e) => e.includes('minecraft.host')))
      assert.ok(err.errors.some((e) => e.includes('minecraft.username')))
      return true
    })
  })

  it('rejects an out-of-range port', () => {
    assert.throws(
      () => load({ ...VALID, minecraft: { ...VALID.minecraft, port: 99999 } }),
      /minecraft\.port/
    )
  })

  it('rejects a half-configured Discord section', () => {
    assert.throws(
      () => load({ ...VALID, discord: { token: 'abc', channelId: '' } }),
      /must be set together/
    )
  })

  it('allows Discord to be omitted entirely', () => {
    const cfg = load(VALID)
    assert.strictEqual(cfg.discord.token, null)
  })

  it('requires kit.pickup to be a real coordinate', () => {
    assert.throws(() => load({ ...VALID, kit: { pickup: { x: 1 } } }), /kit\.pickup\.z/)
  })

  it('treats kit.home as optional', () => {
    assert.doesNotThrow(() => load(VALID))
  })

  it('lets environment variables override the file', () => {
    const cfg = load(VALID, { KITBOT_MC_HOST: 'env.example.com', KITBOT_MC_PORT: '25577' })
    assert.strictEqual(cfg.minecraft.host, 'env.example.com')
    assert.strictEqual(cfg.minecraft.port, 25577)
  })

  it('ignores empty environment variables', () => {
    const cfg = load(VALID, { KITBOT_MC_HOST: '' })
    assert.strictEqual(cfg.minecraft.host, 'mc.example.com')
  })

  describe('legacy migration', () => {
    const LEGACY = {
      email: 'a@b.c',
      channelID: '123',
      server: 'mc.example.com',
      server_version: '1.12.2',
      kit_pos_x: '100',
      kit_pos_y: '-200',
      bed_pos_x: '50',
      token: 'tok',
      whitelist_uuid: ['ABC-DEF']
    }

    it('maps the old flat keys onto the new shape', () => {
      const cfg = load(LEGACY)
      assert.strictEqual(cfg.minecraft.host, 'mc.example.com')
      assert.strictEqual(cfg.minecraft.username, 'a@b.c')
      assert.strictEqual(cfg.discord.channelId, '123')
      assert.strictEqual(cfg.minecraft.version, '1.12.2')
    })

    it('reads kit_pos_y as a Z coordinate', () => {
      const cfg = load(LEGACY)
      assert.deepStrictEqual(cfg.kit.pickup, { x: 100, z: -200 })
    })

    it('drops bed_pos_x, which had no matching Z', () => {
      const cfg = load(LEGACY)
      assert.strictEqual(cfg.kit.home, null)
    })

    it('warns that the legacy format was migrated', () => {
      const warnings = []
      loadConfig({ raw: LEGACY, env: {}, warn: (m) => warnings.push(m) })
      assert.ok(warnings.some((w) => w.includes('legacy flat format')))
    })
  })

  describe('normalizeUuid', () => {
    it('strips dashes and lowercases', () => {
      assert.strictEqual(
        normalizeUuid('3B9A-4C7D'),
        '3b9a4c7d'
      )
    })

    it('makes dashed and undashed forms compare equal', () => {
      const dashed = '069a79f4-44e9-4726-a5be-fca90e38aaf5'
      assert.strictEqual(normalizeUuid(dashed), normalizeUuid(dashed.replace(/-/g, '').toUpperCase()))
    })

    it('handles null safely', () => {
      assert.strictEqual(normalizeUuid(null), '')
    })
  })
})
