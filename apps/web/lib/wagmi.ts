import { createConfig, http } from 'wagmi'
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets'
import { celo, celoSepolia } from '@grey/config/chains'

// injectedWallet catches MetaMask, Coinbase Wallet, Rabby, and any other EIP-1193
// injected wallet without importing their heavy SDKs. Add named connectors back when
// you need specific deep-link / mobile wallet support.
const connectors = connectorsForWallets(
  [{ groupName: 'Wallet', wallets: [injectedWallet] }],
  { appName: 'Grey Payroll', projectId: 'unused' }
)

export const wagmiConfig = createConfig({
  chains: [celoSepolia, celo],
  connectors,
  transports: {
    [celoSepolia.id]: http(),
    [celo.id]: http(),
  },
  ssr: true,
})
