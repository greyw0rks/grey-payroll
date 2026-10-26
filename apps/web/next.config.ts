import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@grey/config'],
  serverExternalPackages: ['@prisma/client', '@grey/db'],
  outputFileTracingIncludes: { '/arc-module/[...path]': ['./.arc-dist/**/*'] },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
    ],
  },
  webpack(config) {
    config.resolve.alias['pino-pretty'] = false
    return config
  },
}

export default nextConfig
