// Read-only receipt verification. Signing remains in the user's wallet.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GREY_PAYROLL_ABI } from '../arc-module/src/grey/abi.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(`${root}/arc-module/package.json`)
const { createPublicClient, http, decodeEventLog, keccak256, parseUnits } = require('viem')
const [stage, txHash] = process.argv.slice(2)
if (!['deposit', 'payroll', 'withdraw', 'replay'].includes(stage) || !/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) throw new Error('Usage: node scripts/verify-arc-rehearsal.mjs deposit|payroll|withdraw|replay <public transaction hash; original payroll hash for replay>')
const evidenceDir = `${root}/docs/arc/testnet/`
const plan = JSON.parse(readFileSync(`${evidenceDir}wallet-rehearsal.json`, 'utf8'))
if (plan.chainId !== 5042002) throw new Error('Rehearsal must use Arc Testnet.')
const step = plan.steps.find(item => item.action === (stage === 'replay' ? 'replay-check' : stage))
if (!step) throw new Error('The rehearsal step is missing.')
if (step.status === 'verified' && step.transactionHash !== txHash) throw new Error('This step is already verified under another hash. Do not replace a completed rehearsal.')
if (stage === 'payroll' && plan.steps.find(item => item.action === 'deposit')?.status !== 'verified') throw new Error('Verify the deposit before payroll.')
if (stage === 'withdraw' && plan.steps.find(item => item.action === 'payroll')?.status !== 'verified') throw new Error('Verify payroll before withdrawal.')
const client = createPublicClient({ transport: http('https://rpc.testnet.arc.io', { timeout: 20000, retryCount: 1 }) })
if (await client.getChainId() !== 5042002) throw new Error('RPC is not Arc Testnet.')
const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n'
if (stage === 'replay') {
  const payroll = plan.steps.find(item => item.action === 'payroll')
  if (payroll?.status !== 'verified' || payroll.transactionHash !== txHash || !payroll.runId) throw new Error('Replay check requires the original verified payroll hash and runId.')
  const finalized = await client.getBlock({ blockTag: 'finalized' })
  const [code, executed] = await Promise.all([
    client.getCode({ address: plan.contractAddress, blockNumber: finalized.number }),
    client.readContract({ address: plan.contractAddress, abi: GREY_PAYROLL_ABI, functionName: 'hasExecuted', args: [plan.employer, payroll.runId], blockNumber: finalized.number }),
  ])
  if (!code || keccak256(code) !== plan.runtimeHash || !executed) throw new Error('Canonical runtime or original executed-run marker is missing.')
  let replayRejected = false
  try {
    await client.simulateContract({ address: plan.contractAddress, abi: GREY_PAYROLL_ABI, functionName: 'executePayroll', args: [payroll.runId, payroll.recipients.map(item => item.address), payroll.recipients.map(item => parseUnits(item.amountUsdc, 18))], account: plan.employer, blockNumber: finalized.number })
  } catch (error) {
    const revert = error.walk?.(item => item?.data?.errorName === 'RunAlreadyExecuted')
    replayRejected = revert?.data?.errorName === 'RunAlreadyExecuted'
    if (!replayRejected) throw error
  }
  if (!replayRejected) throw new Error('Replay simulation unexpectedly succeeded.')
  const proof = { verifiedAt: new Date().toISOString(), status: 'verified', stage, chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.io', employer: plan.employer, contractAddress: plan.contractAddress, originalPayrollHash: txHash, runId: payroll.runId, runtimeHash: plan.runtimeHash, finalizedBlock: finalized.number, finalizedBlockHash: finalized.hash, hasExecuted: true, simulationRevert: 'RunAlreadyExecuted', broadcast: false }
  writeFileSync(`${evidenceDir}replay-verification.json`, serialize(proof))
  Object.assign(step, { status: 'verified', transactionHash: txHash, runId: payroll.runId, verifiedAt: proof.verifiedAt })
  writeFileSync(`${evidenceDir}wallet-rehearsal.json`, serialize(plan))
  const deployment = JSON.parse(readFileSync(`${evidenceDir}deployment-verification.json`, 'utf8'))
  deployment.payments.replay = { status: 'verified', originalPayrollHash: txHash, runId: payroll.runId, evidence: 'replay-verification.json', broadcast: false }
  writeFileSync(`${evidenceDir}deployment-verification.json`, serialize(deployment))
  console.log(serialize(proof))
  process.exit(0)
}
const [receipt, finalized] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getBlock({ blockTag: 'finalized' })])
if (receipt.status !== 'success') throw new Error('The transaction reverted. This is not a completed rehearsal step.')
if (receipt.blockNumber > finalized.number) throw new Error('Receipt is not finalized yet; wait and verify the same hash again.')
const [block, code, ledger] = await Promise.all([
  client.getBlock({ blockNumber: receipt.blockNumber }),
  client.getCode({ address: plan.contractAddress, blockNumber: receipt.blockNumber }),
  client.readContract({ address: plan.contractAddress, abi: GREY_PAYROLL_ABI, functionName: 'balanceOf', args: [plan.employer], blockNumber: receipt.blockNumber }),
])
if (block.hash !== receipt.blockHash) throw new Error('Receipt block is not canonical.')
const artifact = JSON.parse(readFileSync(`${root}/arc-module/src/grey/bytecode.json`, 'utf8'))
if (!code || keccak256(code) !== artifact.deployedBytecodeKeccak || plan.runtimeHash !== artifact.deployedBytecodeKeccak) throw new Error('Receipt contract is not the canonical GreyPayroll deployment.')
const events = receipt.logs.filter(log => log.address.toLowerCase() === plan.contractAddress.toLowerCase()).map(log => decodeEventLog({ abi: GREY_PAYROLL_ABI, data: log.data, topics: log.topics, strict: true }))
const sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase()
let runId = null
if (stage === 'payroll') {
  const executions = events.filter(event => event.eventName === 'PayrollExecuted')
  const transfers = events.filter(event => event.eventName === 'PaymentSent')
  const expected = step.recipients.map(item => ({ address: item.address, amount: parseUnits(item.amountUsdc, 18) }))
  if (expected.length !== 2 || new Set(expected.map(item => item.address.toLowerCase())).size !== 2) throw new Error('Saved recipient snapshot is invalid.')
  const execution = executions[0]
  if (executions.length !== 1 || !sameAddress(execution.args.employer, plan.employer) || execution.args.totalPaid !== expected.reduce((sum, item) => sum + item.amount, 0n) || execution.args.recipientCount !== BigInt(expected.length)) throw new Error('Successful receipt has missing or mismatched payroll execution proof; outcome is unverified.')
  runId = execution.args.runId
  if (/^0x0{64}$/.test(runId) || transfers.length !== expected.length) throw new Error('Payment event count or runId does not match.')
  for (const item of expected) {
    if (transfers.filter(event => sameAddress(event.args.employer, plan.employer) && event.args.runId === runId && sameAddress(event.args.recipient, item.address) && event.args.amount === item.amount).length !== 1) throw new Error('Exact recipient payment proof is missing; outcome is unverified.')
  }
  if (step.runId && step.runId !== runId) throw new Error('Confirmed runId differs from the saved original runId.')
} else {
  const name = stage === 'deposit' ? 'Deposited' : 'Withdrawn'
  const matching = events.filter(event => event.eventName === name)
  if (matching.length !== 1 || !sameAddress(matching[0].args.employer, plan.employer) || matching[0].args.amount !== parseUnits(step.amountUsdc, 18)) throw new Error('Successful receipt has missing or mismatched funding proof; outcome is unverified.')
}
if (ledger !== BigInt(step.expectedLedgerWei)) throw new Error('Employer ledger at the receipt block differs from the saved rehearsal. Review intervening operations before proceeding.')
const proof = { verifiedAt: new Date().toISOString(), status: 'verified', stage, chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.io', transactionHash: txHash, explorerUrl: `https://explorer.testnet.arc.io/tx/${txHash}`, employer: plan.employer, contractAddress: plan.contractAddress, runtimeHash: artifact.deployedBytecodeKeccak, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedBlock: finalized.number, finalizedBlockHash: finalized.hash, receiptStatus: receipt.status, employerLedgerWei: ledger, runId, events, note: 'Independent read-only finalized receipt, canonical runtime, exact event and employer-ledger verification. This script never signs or broadcasts.' }
writeFileSync(`${evidenceDir}${stage}-verification.json`, serialize(proof))
step.status = 'verified'
step.transactionHash = txHash
step.verifiedAt = proof.verifiedAt
if (runId) step.runId = runId
writeFileSync(`${evidenceDir}wallet-rehearsal.json`, serialize(plan))
const deployment = JSON.parse(readFileSync(`${evidenceDir}deployment-verification.json`, 'utf8'))
deployment.payments[stage === 'withdraw' ? 'withdrawal' : stage] = { status: 'verified', transactionHash: txHash, evidence: `${stage}-verification.json` }
writeFileSync(`${evidenceDir}deployment-verification.json`, serialize(deployment))
console.log(serialize(proof))
