import { createPublicClient, http, isAddress, keccak256, type Address } from 'viem'
import {
  ARC_MAINNET_CHAIN_ID,
  arcPayrollReadAbi,
  getArcChain,
  isArcChainId,
  type ArcChainId,
} from '@grey/config/arc'
import artifact from '../../../arc-module/src/grey/bytecode.json'

function arcRpcUrl(chainId: ArcChainId) {
  const chain = getArcChain(chainId)
  return chainId === ARC_MAINNET_CHAIN_ID
    ? process.env.ARC_MAINNET_RPC_URL || chain.rpcUrls.default.http[0]
    : process.env.ARC_TESTNET_RPC_URL || chain.rpcUrls.default.http[0]
}

export function arcPublicClient(chainId: ArcChainId) {
  const chain = getArcChain(chainId)
  return createPublicClient({ chain, transport: http(arcRpcUrl(chainId), { timeout: 10000, retryCount: 1 }) })
}
export async function verifyArcTreasury(address: string, chainId: number) {
  if (!isArcChainId(chainId)) throw new Error('Select Arc Mainnet or Arc Testnet.')
  if (!isAddress(address) || /^0x0{40}$/i.test(address)) throw new Error('Enter a valid Arc treasury address.')
  const chain = getArcChain(chainId)
  const client = arcPublicClient(chainId)
  if (await client.getChainId() !== chain.id) throw new Error(`Treasury RPC is not ${chain.name}.`)
  const block = await client.getBlock({ blockTag: 'finalized' })
  const code = await client.getCode({ address: address as Address, blockNumber: block.number })
  if (!code || code === '0x' || keccak256(code) !== artifact.deployedBytecodeKeccak) throw new Error(`Address does not contain the verified GreyPayroll contract on ${chain.name}.`)
  return { client, address: address as Address, chainId, blockNumber: block.number, blockHash: block.hash, codeHash: artifact.deployedBytecodeKeccak }
}
export async function readArcTreasury(address: string, wallet: string, chainId: number) {
  if (!isAddress(wallet) || /^0x0{40}$/i.test(wallet)) throw new Error('Link an employer wallet to the Arc treasury.')
  const verified = await verifyArcTreasury(address, chainId)
  const balance = await verified.client.readContract({ address: verified.address, abi: arcPayrollReadAbi, functionName: 'balanceOf', args: [wallet as Address], blockNumber: verified.blockNumber })
  return { balance: balance.toString(), blockNumber: verified.blockNumber.toString(), blockHash: verified.blockHash, codeHash: verified.codeHash }
}
