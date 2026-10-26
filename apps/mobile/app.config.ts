import { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'Grey',
  slug: 'grey-payroll',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0E1A',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'finance.grey.app',
    infoPlist: {
      NSFaceIDUsageDescription: 'Grey uses Face ID to confirm your check-in.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0E1A',
    },
    package: 'finance.grey.app',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-local-authentication', { faceIDPermission: 'Grey uses Face ID to confirm check-in.' }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    apiUrl: process.env.API_URL ?? 'http://localhost:3000',
    chainId: 5042002,
  },
}

export default config
