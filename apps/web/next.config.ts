import type { NextConfig } from 'next'

const { PrismaPlugin } = require('@prisma/nextjs-monorepo-workaround-plugin')

const nextConfig: NextConfig = {
  transpilePackages: ['@grey/config'],
  serverExternalPackages: ['@prisma/client', '@grey/db'],
  outputFileTracingIncludes: { '/arc-module/[...path]': ['./.arc-dist/**/*'] },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
    ],
  },
  webpack(config, { isServer }) {
    config.resolve.alias['pino-pretty'] = false
    // The bundled client must find its schema and engines inside the function,
    // including when a local prebuilt deployment runs on Vercel's Linux runtime.
    if (isServer) config.plugins.push(new PrismaPlugin())
    return config
  },
}

export default nextConfig
