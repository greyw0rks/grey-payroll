/**
 * Strip the 4 heavy Skia platform binary packages from any package that depends on them.
 * These are optional 70–74 MB archives for iOS/Android/macOS/tvOS — only needed for EAS
 * cloud builds, not local Expo Go / Metro / web. They cause bus errors on WSL during download.
 */
const SKIA_BINARIES = new Set([
  'react-native-skia-android',
  'react-native-skia-apple-ios',
  'react-native-skia-apple-macos',
  'react-native-skia-apple-tvos',
  'canvaskit-wasm',
])

function readPackage(pkg) {
  if (pkg.optionalDependencies) {
    for (const key of Object.keys(pkg.optionalDependencies)) {
      if (SKIA_BINARIES.has(key)) {
        delete pkg.optionalDependencies[key]
      }
    }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
