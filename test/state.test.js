/* eslint-env mocha */
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { State } = require('../lib/state')

const silent = { debug () {}, info () {}, warn () {}, error () {} }

describe('State', () => {
  let dir
  let file

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitbot-state-'))
    file = path.join(dir, 'state.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const make = () => new State({ file, logger: silent })

  it('starts empty when there is no state file', () => {
    assert.deepStrictEqual(make().load(), {})
  })

  it('persists a value across instances', () => {
    const a = make()
    a.load()
    assert.strictEqual(a.set('kitHome', { x: 1, z: 2 }), true)

    const b = make()
    b.load()
    assert.deepStrictEqual(b.get('kitHome'), { x: 1, z: 2 })
  })

  it('writes readable JSON', () => {
    const s = make()
    s.load()
    s.set('kitHome', { x: -5, z: 12 })
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { kitHome: { x: -5, z: 12 } })
  })

  it('deletes a key', () => {
    const s = make()
    s.load()
    s.set('kitHome', { x: 1, z: 2 })
    assert.strictEqual(s.delete('kitHome'), true)
    assert.strictEqual(s.get('kitHome'), undefined)

    const reloaded = make()
    reloaded.load()
    assert.strictEqual(reloaded.get('kitHome'), undefined)
  })

  it('treats deleting a missing key as success', () => {
    const s = make()
    s.load()
    assert.strictEqual(s.delete('nope'), true)
  })

  it('setting undefined removes the key', () => {
    const s = make()
    s.load()
    s.set('kitHome', { x: 1, z: 2 })
    s.set('kitHome', undefined)
    assert.strictEqual(s.get('kitHome'), undefined)
  })

  it('recovers from a corrupt state file instead of throwing', () => {
    fs.writeFileSync(file, '{ not json')
    const s = make()
    assert.deepStrictEqual(s.load(), {})
  })

  it('rejects a state file that is not an object', () => {
    fs.writeFileSync(file, '["nope"]')
    assert.deepStrictEqual(make().load(), {})
  })

  it('leaves no temp files behind', () => {
    const s = make()
    s.load()
    s.set('kitHome', { x: 1, z: 2 })
    assert.deepStrictEqual(fs.readdirSync(dir), ['state.json'])
  })

  it('reports failure when the file cannot be written', () => {
    const s = new State({ file: path.join(dir, 'sub'), logger: silent })
    s.load()
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true }) // a directory, not a file
    assert.strictEqual(s.set('kitHome', { x: 1, z: 2 }), false)
  })

  it('all() returns a copy, not the live object', () => {
    const s = make()
    s.load()
    s.set('kitHome', { x: 1, z: 2 })
    const snapshot = s.all()
    snapshot.kitHome = 'tampered'
    assert.deepStrictEqual(s.get('kitHome'), { x: 1, z: 2 })
  })
})
