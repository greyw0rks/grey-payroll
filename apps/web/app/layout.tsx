import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import { Providers } from '@/components/providers'

const sora = localFont({ variable: '--font-sora', display: 'swap', src: [{ path: '../public/fonts/space-grotesk-latin-500-normal.woff2', weight: '500' }, { path: '../public/fonts/space-grotesk-latin-600-normal.woff2', weight: '600' }, { path: '../public/fonts/space-grotesk-latin-700-normal.woff2', weight: '700' }] })
const inter = localFont({ variable: '--font-inter', display: 'swap', src: [{ path: '../public/fonts/dm-sans-latin-400-normal.woff2', weight: '400' }, { path: '../public/fonts/dm-sans-latin-500-normal.woff2', weight: '500' }, { path: '../public/fonts/dm-sans-latin-600-normal.woff2', weight: '600' }] })
const jbMono = localFont({ variable: '--font-jbmono', display: 'swap', src: '../public/fonts/jetbrains-mono-latin-400-normal.woff2' })

export const metadata: Metadata = {
  title: 'Grey Finance — Company Payroll',
  description: 'Your company’s payroll, employees, attendance and requests in one workspace.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/register">
      <html lang="en" className={`${sora.variable} ${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  )
}
