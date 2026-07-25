'use strict'

const net = require('node:net')
const path = require('node:path')
const { fileURLToPath } = require('node:url')

function isTrustedRendererUrl(rawUrl, target) {
  if (!rawUrl || !target) return false

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (target.kind === 'url') {
    let expected
    try {
      expected = new URL(target.value)
    } catch {
      return false
    }
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === expected.origin &&
      !url.username &&
      !url.password
    )
  }

  if (target.kind === 'file' && url.protocol === 'file:') {
    try {
      return path.resolve(fileURLToPath(url)) === path.resolve(target.value)
    } catch {
      return false
    }
  }

  return false
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] === 0
  )
}

function isSafeExternalUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false

  const ipVersion = net.isIP(hostname)
  if (ipVersion === 4 && isPrivateIpv4(hostname)) return false
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase()
    if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return false
    }
  }

  return true
}

function assertTrustedIpc(event, mainWindow, target) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Desktop window is unavailable')
  if (!event || event.sender !== mainWindow.webContents) throw new Error('Untrusted IPC sender')

  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  if (!isTrustedRendererUrl(senderUrl, target)) throw new Error('IPC sender URL is not trusted')
}

function normalizeTheme(value) {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  throw new Error('Invalid theme')
}

module.exports = {
  assertTrustedIpc,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  normalizeTheme,
}
