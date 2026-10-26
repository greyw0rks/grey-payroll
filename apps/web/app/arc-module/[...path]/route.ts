import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { getCompanyPayment } from '@/lib/arc-payments'

export const runtime = 'nodejs'
const contentTypes: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  const { path: segments } = await params
  const app = segments.join('/') === 'app'
  const directory = path.resolve(process.cwd(), '.arc-dist')
  const file = path.resolve(directory, app ? 'index.html' : segments.join('/'))
  if (!file.startsWith(directory + path.sep) || (!app && !contentTypes[path.extname(file)])) return new NextResponse('Not found', { status: 404 })
  try {
    const data = await readFile(file)
    const headers = { 'Content-Type': app ? 'text/html; charset=utf-8' : contentTypes[path.extname(file)]!, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
    if (app) {
      const planId = new URL(request.url).searchParams.get('plan')
      const plan = planId ? await getCompanyPayment(identity.employer.id, planId) : null
      if (planId && !plan) return new NextResponse('Company payment plan not found.', { status: 404 })
      const context = JSON.stringify({ companyId: identity.employer.id, companyName: identity.employer.companyName }).replace(/</g, '\\u003c')
      const planContext = plan ? `<script type="application/json" id="grey-company-payment-plan">${JSON.stringify(plan).replace(/</g, '\\u003c')}</script>` : ''
      const html = data.toString('utf8').replace('<head>', `<head><script type="application/json" id="grey-company-context">${context}</script>${planContext}`)
      return new NextResponse(html, { headers })
    }
    return new NextResponse(new Uint8Array(data), { headers })
  } catch { return new NextResponse('Arc payroll is not bundled. Run pnpm arc:bundle from the repository root.', { status: 503 }) }
}
