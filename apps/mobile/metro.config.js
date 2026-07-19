const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Tell Metro where to find packages in the pnpm monorepo
config.watchFolders = [monorepoRoot]

// Block Metro from crawling directories that contain bracket-named paths.
// FallbackWatcher (used on Linux/WSL) crashes on paths like [...nextauth].
const existing = config.resolver.blockList
const existingList = Array.isArray(existing)
  ? existing
  : existing
    ? [existing]
    : []

config.resolver.blockList = [
  ...existingList,
  // Next.js build output — contains [...nextauth], (employer), etc.
  /apps[/\\]web[/\\]\.next[/\\].*/,
  // Desktop build output
  /apps[/\\]desktop[/\\]dist[/\\].*/,
  // pnpm virtual store — Metro doesn't need to crawl this
  /node_modules[/\\]\.cache[/\\].*/,
]

module.exports = config
