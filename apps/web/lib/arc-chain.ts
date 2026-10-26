import {
  ARC_TESTNET_CHAIN_ID,
  getArcChain,
  isArcChainId,
  type ArcChainId,
} from '@grey/config/arc'

const configuredChainId = Number(process.env.NEXT_PUBLIC_ARC_DEFAULT_CHAIN_ID)

export const DEFAULT_ARC_CHAIN_ID: ArcChainId = isArcChainId(configuredChainId)
  ? configuredChainId
  : ARC_TESTNET_CHAIN_ID

export const DEFAULT_ARC_CHAIN = getArcChain(DEFAULT_ARC_CHAIN_ID)
