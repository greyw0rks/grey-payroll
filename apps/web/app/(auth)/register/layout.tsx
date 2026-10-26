import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
export default async function RegistrationLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-up')
  return children
}
