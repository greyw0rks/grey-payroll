/**
 * wagmi configuration — Grey Payroll Arc module
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { arcTestnet, arcMainnet } from '@/grey/chain'

// Pre-register chain RPC URLs for trace panel
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, arcMainnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.io'),
    [arcMainnet.id]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
