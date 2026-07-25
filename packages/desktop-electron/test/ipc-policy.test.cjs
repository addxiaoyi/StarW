'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const {
  assertTrustedIpc,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  normalizeTheme,
} = require('../src/ipc-policy.cjs')

test('renderer URL policy accepts only the configured renderer', () => {
  const dev = { kind: 'url', value: 'http://127.0.0.1:4446/' }
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:4446/settings', dev), true)
  assert.equal(isTrustedRendererUrl('http://localhost:4446/', dev), false)
  assert.equal(isTrustedRendererUrl('https://example.com/', dev), false)

  const file = path.resolve('dist/index.html')
  const packaged = { kind: 'file', value: file }
  assert.equal(isTrustedRendererUrl(pathToFileURL(file).href, packaged), true)
  assert.equal(isTrustedRendererUrl(pathToFileURL(path.resolve('dist/other.html')).href, packaged), false)
})

test('external URL policy rejects privileged protocols and local networks', () => {
  assert.equal(isSafeExternalUrl('https://openai.com/'), true)
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('https://user:pass@example.com/'), false)
  assert.equal(isSafeExternalUrl('http://127.0.0.1:3000/'), false)
  assert.equal(isSafeExternalUrl('http://192.168.1.2/'), false)
  assert.equal(isSafeExternalUrl('http://[::1]/'), false)
})

test('IPC sender policy checks both webContents identity and renderer URL', () => {
  const webContents = { getURL: () => 'http://127.0.0.1:4446/' }
  const window = { isDestroyed: () => false, webContents }
  const target = { kind: 'url', value: 'http://127.0.0.1:4446/' }
  assert.doesNotThrow(() => assertTrustedIpc({ sender: webContents, senderFrame: { url: webContents.getURL() } }, window, target))
  assert.throws(() => assertTrustedIpc({ sender: {}, senderFrame: { url: webContents.getURL() } }, window, target), /Untrusted IPC sender/)
  assert.throws(() => assertTrustedIpc({ sender: webContents, senderFrame: { url: 'https://evil.test/' } }, window, target), /not trusted/)
})

test('theme policy accepts only known values', () => {
  assert.equal(normalizeTheme('system'), 'system')
  assert.throws(() => normalizeTheme('auto-dark'), /Invalid theme/)
})
