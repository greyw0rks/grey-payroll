import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/register(.*)',
  '/login(.*)',
  '/api/employees/invite/verify(.*)',
])

// Middleware only enforces authentication.
// Role-based routing happens in server components (layouts/pages) which
// can use Prisma directly — no JWT propagation delay issues.
export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return
  const { userId } = await auth()
  if (!userId) {
    if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
