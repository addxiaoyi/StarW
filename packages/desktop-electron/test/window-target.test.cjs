const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { resolveWindowTarget } = require('../src/window-target.cjs')

const desktopDir = path.resolve(__dirname, '..')
const resourcesDir = path.join(desktopDir, 'test-resources')

test('uses the Vite server when an explicit development URL is present', () => {
  const target = resolveWindowTarget({
    desktopDir,
    resourcesDir,
    isPackaged: false,
    devServerUrl: 'http://127.0.0.1:4444',
    existsSync: () => true,
  })

  assert.deepEqual(target, {
    kind: 'url',
    value: 'http://127.0.0.1:4444/',
  })
})

test('loads the built Solid renderer when Electron runs from the monorepo', () => {
  const target = resolveWindowTarget({
    desktopDir,
    resourcesDir,
    isPackaged: false,
    existsSync: () => true,
  })

  assert.deepEqual(target, {
    kind: 'file',
    value: path.resolve(desktopDir, '..', 'ui-web', 'dist', 'index.html'),
  })
  assert.notEqual(target.value, path.join(desktopDir, 'src', 'index.html'))
})

test('loads the packaged Solid renderer from Electron resources', () => {
  const target = resolveWindowTarget({
    desktopDir,
    resourcesDir,
    isPackaged: true,
    existsSync: () => true,
  })

  assert.deepEqual(target, {
    kind: 'file',
    value: path.join(resourcesDir, 'ui-web', 'index.html'),
  })
})

test('fails with a useful build instruction when the renderer is missing', () => {
  assert.throws(
    () => resolveWindowTarget({
      desktopDir,
      resourcesDir,
      isPackaged: false,
      existsSync: () => false,
    }),
    /bun run --cwd packages\/ui-web build/,
  )
})

test('rejects unsupported development URL protocols', () => {
  assert.throws(
    () => resolveWindowTarget({
      desktopDir,
      resourcesDir,
      isPackaged: false,
      devServerUrl: 'file:///retired-shell.html',
      existsSync: () => true,
    }),
    /http or https/,
  )
})
