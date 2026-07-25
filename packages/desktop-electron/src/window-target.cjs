const fs = require('node:fs')
const path = require('node:path')

function resolveDevUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid OPENSTAR_DEV_SERVER_URL: ${value}`)
  }

  const isWebUrl = url.protocol === 'http:' || url.protocol === 'https:'
  if (!isWebUrl) {
    throw new Error('OPENSTAR_DEV_SERVER_URL must use http or https')
  }

  return url.href
}

function resolveWindowTarget(options) {
  const {
    desktopDir,
    resourcesDir,
    isPackaged,
    devServerUrl,
    existsSync = fs.existsSync,
  } = options

  if (devServerUrl) {
    return { kind: 'url', value: resolveDevUrl(devServerUrl) }
  }

  const file = isPackaged
    ? path.join(resourcesDir, 'ui-web', 'index.html')
    : path.resolve(desktopDir, '..', 'ui-web', 'dist', 'index.html')

  if (!existsSync(file)) {
    throw new Error(
      `Solid renderer not found at ${file}. Run "bun run --cwd packages/ui-web build" or set OPENSTAR_DEV_SERVER_URL.`,
    )
  }

  return { kind: 'file', value: file }
}

module.exports = { resolveWindowTarget }
