import type { Metadata } from 'next'
import { Sora, Inter, JetBrains_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import { Providers } from '@/components/providers'

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', weight: ['500', '600', '700'] })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', weight: ['400', '500', '600'] })
const jbMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbmono', weight: ['400', '500'] })

export const metadata: Metadata = {
  title: 'Grey — Crypto Payroll',
  description: 'Stablecoin payroll, dripped daily.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${sora.variable} ${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  )
}
