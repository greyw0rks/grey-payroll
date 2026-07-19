import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: '#F4F3EE' }}
    >
      <SignIn
        appearance={{
          variables: {
            colorPrimary: '#3DDC84',
            colorBackground: '#FFFFFF',
            borderRadius: '12px',
          },
          elements: {
            card: 'shadow-none border border-[#ECEBE6] rounded-2xl',
            headerTitle: 'font-display',
          },
        }}
      />
    </div>
  )
}
