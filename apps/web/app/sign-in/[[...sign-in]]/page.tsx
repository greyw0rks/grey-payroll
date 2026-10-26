import { SignIn } from '@clerk/nextjs'
import { AuthFrame } from '@/components/ui/AuthFrame'
export default function SignInPage() {
  return <AuthFrame><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" appearance={{ variables: { colorPrimary: '#245C36', colorBackground: '#FFFFFF', borderRadius: '10px' }, elements: { cardBox: 'shadow-none', card: 'shadow-none border border-[#DDDFD5]', headerTitle: 'font-display', formButtonPrimary: 'bg-[#16181C] hover:bg-[#343831]' } }} /></AuthFrame>
}
