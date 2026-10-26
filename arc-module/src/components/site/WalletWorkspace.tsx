import '../../tracing'
import '../../console-capture'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { config } from '../../config'
import { PayrollWorkspace } from '../grey/PayrollWorkspace'

const queryClient = new QueryClient()

export default function WalletWorkspace() {
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}><ConnectKitProvider><PayrollWorkspace /><Toaster position="top-center" /></ConnectKitProvider></QueryClientProvider></WagmiProvider>
}
