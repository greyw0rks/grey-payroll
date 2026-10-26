import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(`${root}/arc-module/package.json`)
const { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, keccak256 } = require('viem')

const MAINNET_CHAIN_ID = 5042
const RPC_URL = process.env.ARC_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io'
const EXPLORER_URL = 'https://explorer.arc.io'
const addressInput = process.argv[2]
const transactionHash = process.argv[3]

if (!isAddress(addressInput ?? '', { strict: false }) || /^0x0{40}$/i.test(addressInput ?? '')) {
  throw new Error('Usage: node scripts/verify-arc-mainnet.mjs <contract-address> <deployment-transaction-hash>')
}
if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash ?? '')) {
  throw new Error('Supply the public Arc Mainnet deployment transaction hash.')
}

const address = getAddress(addressInput.toLowerCase())
const artifact = JSON.parse(readFileSync(`${root}/arc-module/src/grey/bytecode.json`, 'utf8'))
let sequence = 0

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Arc Mainnet RPC returned HTTP ${response.status}.`)
  const payload = await response.json()
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`)
  return payload.result
}

const chainId = Number(BigInt(await rpc('eth_chainId')))
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`RPC chain ${chainId} is not Arc Mainnet ${MAINNET_CHAIN_ID}.`)

const [receipt, transaction, finalizedBlock] = await Promise.all([
  rpc('eth_getTransactionReceipt', [transactionHash]),
  rpc('eth_getTransactionByHash', [transactionHash]),
  rpc('eth_getBlockByNumber', ['finalized', false]),
])

if (!receipt || !transaction) throw new Error('Deployment transaction is not available from the Arc Mainnet RPC.')
if (!finalizedBlock?.number || !finalizedBlock.hash) throw new Error('Arc Mainnet did not return a finalized block.')
if (receipt.status !== '0x1') throw new Error('Deployment receipt is not successful.')
if (BigInt(receipt.blockNumber) > BigInt(finalizedBlock.number)) throw new Error('Deployment receipt is not finalized yet. Verify the same hash again later.')
if (transaction.to !== null) throw new Error('Expected the browser wallet direct CREATE deployment path, but transaction.to is not null.')
if ((receipt.contractAddress ?? '').toLowerCase() !== address.toLowerCase()) throw new Error('Receipt contractAddress does not match the reported contract.')
if ((transaction.input ?? '').toLowerCase() !== artifact.bytecode.toLowerCase()) throw new Error('Deployment transaction does not contain the canonical GreyPayroll creation bytecode.')
if (transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber) throw new Error('Transaction and receipt block attribution differ.')
if ((transaction.from ?? '').toLowerCase() !== (receipt.from ?? '').toLowerCase()) throw new Error('Transaction and receipt deployer attribution differ.')

const canonicalBlock = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
if (!canonicalBlock || canonicalBlock.hash !== receipt.blockHash) throw new Error('Deployment receipt is not in the canonical chain.')

const [codeAtDeployment, codeAtFinalized] = await Promise.all([
  rpc('eth_getCode', [address, receipt.blockNumber]),
  rpc('eth_getCode', [address, finalizedBlock.number]),
])
if (!codeAtDeployment || codeAtDeployment === '0x') throw new Error('No runtime bytecode exists at the receipt block.')
if (!codeAtFinalized || codeAtFinalized === '0x') throw new Error('No runtime bytecode exists at the finalized verification block.')

const deploymentRuntimeHash = keccak256(codeAtDeployment)
const finalizedRuntimeHash = keccak256(codeAtFinalized)
if (deploymentRuntimeHash !== artifact.deployedBytecodeKeccak || finalizedRuntimeHash !== artifact.deployedBytecodeKeccak) {
  throw new Error('Deployed runtime does not match the canonical GreyPayroll artifact.')
}

const maxRecipientsAbi = [{
  type: 'function',
  name: 'MAX_RECIPIENTS',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ type: 'uint256' }],
}]
const maxRecipientsData = encodeFunctionData({ abi: maxRecipientsAbi, functionName: 'MAX_RECIPIENTS' })
const maxRecipientsResult = await rpc('eth_call', [{ to: address, data: maxRecipientsData }, finalizedBlock.number])
const maxRecipients = decodeFunctionResult({ abi: maxRecipientsAbi, functionName: 'MAX_RECIPIENTS', data: maxRecipientsResult })
if (maxRecipients !== 50n) throw new Error(`MAX_RECIPIENTS returned ${maxRecipients}, expected 50.`)

const verifiedAt = new Date().toISOString()
const evidence = {
  status: 'verified',
  verifiedAt,
  chainId,
  chainName: 'Arc Mainnet',
  rpcUrl: RPC_URL,
  explorerBase: EXPLORER_URL,
  contractAddress: address,
  contractExplorerUrl: `${EXPLORER_URL}/address/${address}`,
  deploymentTransaction: transactionHash,
  deploymentTransactionExplorerUrl: `${EXPLORER_URL}/tx/${transactionHash}`,
  deployer: getAddress(transaction.from),
  receiptStatus: 'success',
  blockNumber: BigInt(receipt.blockNumber).toString(),
  blockHash: receipt.blockHash,
  finalizedVerificationBlock: BigInt(finalizedBlock.number).toString(),
  finalizedVerificationBlockHash: finalizedBlock.hash,
  canonicalCreationBytecodeMatch: true,
  canonicalRuntimeHash: artifact.deployedBytecodeKeccak,
  runtimeAtDeploymentMatch: true,
  runtimeAtFinalizedBlockMatch: true,
  maxRecipients: Number(maxRecipients),
  note: 'Independent read-only Arc Mainnet verification. The script never signs, broadcasts, funds the contract or sends payroll.',
}

const evidenceDir = `${root}/docs/arc/mainnet`
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(`${evidenceDir}/deployment-verification.json`, JSON.stringify(evidence, null, 2) + '\n')
writeFileSync(`${evidenceDir}/release-evidence.json`, JSON.stringify({
  status: 'deployment-verified',
  updatedAt: verifiedAt,
  chainId,
  contractAddress: address,
  deploymentTransaction: transactionHash,
  canonicalRuntimeHash: artifact.deployedBytecodeKeccak,
  deploymentEvidence: 'deployment-verification.json',
  payoutTransaction: null,
  payoutEvidence: null,
  publicAppUrl: null,
  publicRepositoryUrl: 'https://github.com/greyw0rks/grey-payroll',
  videoStatus: 'mainnet-proof-update-pending',
}, null, 2) + '\n')

console.log(JSON.stringify(evidence, null, 2))
