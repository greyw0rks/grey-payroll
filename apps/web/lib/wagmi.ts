import { createConfig, http } from 'wagmi'
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets'
import { arcMainnet, arcTestnet } from '@grey/config/arc'
import { DEFAULT_ARC_CHAIN_ID } from './arc-chain'

// injectedWallet catches MetaMask, Coinbase Wallet, Rabby, and any other EIP-1193
// injected wallet without importing their heavy SDKs. Add named connectors back when
// you need specific deep-link / mobile wallet support.
const connectors = connectorsForWallets(
  [{ groupName: 'Wallet', wallets: [injectedWallet] }],
  { appName: 'Grey Payroll', projectId: 'unused' }
)

const chains = DEFAULT_ARC_CHAIN_ID === arcMainnet.id
  ? [arcMainnet, arcTestnet] as const
  : [arcTestnet, arcMainnet] as const

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [arcTestnet.id]: http(),
    [arcMainnet.id]: http(),
  },
  ssr: true,
})
