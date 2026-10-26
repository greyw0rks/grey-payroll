import { SignUp } from '@clerk/nextjs'
import { AuthFrame } from '@/components/ui/AuthFrame'
export default function SignUpPage() {
  return <AuthFrame signup><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/register" appearance={{ variables: { colorPrimary: '#245C36', colorBackground: '#FFFFFF', borderRadius: '10px' }, elements: { cardBox: 'shadow-none', card: 'shadow-none border border-[#DDDFD5]', headerTitle: 'font-display', formButtonPrimary: 'bg-[#16181C] hover:bg-[#343831]' } }} /></AuthFrame>
}
