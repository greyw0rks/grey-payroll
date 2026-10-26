import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(`${root}/arc-module/package.json`)
const { keccak256, isAddress, getAddress, encodeFunctionData, decodeFunctionData, decodeFunctionResult, decodeEventLog, formatUnits } = require('viem')
const address = process.argv[2]
if (!isAddress(address)) throw new Error('Supply the reported Arc Testnet contract address.')
const walletInput = process.argv[3]
const recipientInput = process.argv[4]
const deploymentHash = process.argv[5]
if (deploymentHash && !/^0x[0-9a-fA-F]{64}$/.test(deploymentHash)) throw new Error('Supply a valid deployment transaction hash.')
for (const input of [walletInput, recipientInput].filter(Boolean)) {
  if (!isAddress(input, { strict: false }) || /^0x0{40}$/i.test(input)) throw new Error('Supply valid nonzero public wallet addresses.')
}
if (recipientInput && !walletInput) throw new Error('Supply the employer wallet before a recipient.')
const wallet = walletInput ? getAddress(walletInput.toLowerCase()) : null
const recipient = recipientInput ? getAddress(recipientInput.toLowerCase()) : null
if (recipient && (recipient === wallet || recipient.toLowerCase() === address.toLowerCase())) throw new Error('The second recipient must differ from the employer and contract.')
const rpcUrl = 'https://rpc.testnet.arc.io'
let sequence = 0
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Arc RPC returned HTTP ${response.status}`)
  const data = await response.json()
  if (data.error) throw new Error(`${method}: ${data.error.message}`)
  return data.result
}
const chainId = Number(BigInt(await rpc('eth_chainId')))
if (chainId !== 5042002) throw new Error('RPC is not Arc Testnet.')
const block = await rpc('eth_getBlockByNumber', ['finalized', false])
if (!block?.number || !block.hash) throw new Error('No finalized Arc block available.')
const code = await rpc('eth_getCode', [address, block.number])
const artifact = JSON.parse(readFileSync(`${root}/arc-module/src/grey/bytecode.json`, 'utf8'))
const runtimeHash = code && code !== '0x' ? keccak256(code) : null
if (runtimeHash !== artifact.deployedBytecodeKeccak) throw new Error('Reported deployment does not match the canonical compiled runtime.')
function previousEvidence(filename) {
  try { return JSON.parse(readFileSync(`${root}/docs/arc/testnet/${filename}`, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
const previousDeployment = previousEvidence('deployment-verification.json')
const evidence = { verifiedAt: new Date().toISOString(), rpcUrl, chainId, address, finalizedBlock: block.number, finalizedBlockHash: block.hash, runtimeHash, explorerUrl: `https://explorer.testnet.arc.io/address/${address}`, deploymentTransaction: null, payments: { deposit: 'pending', payroll: 'pending', withdrawal: 'pending', replay: 'pending' }, note: 'Independent read-only verification of reported deployment runtime. Payment lifecycle and deployment transaction receipt remain separate evidence.' }
if (previousDeployment?.chainId === chainId && previousDeployment.address.toLowerCase() === address.toLowerCase()) {
  evidence.deploymentTransaction = previousDeployment.deploymentTransaction
  evidence.payments = previousDeployment.payments
}
if (deploymentHash) {
  const [receipt, transaction] = await Promise.all([
    rpc('eth_getTransactionReceipt', [deploymentHash]),
    rpc('eth_getTransactionByHash', [deploymentHash]),
  ])
  if (!receipt || receipt.status !== '0x1' || !transaction?.to || receipt.transactionHash.toLowerCase() !== deploymentHash.toLowerCase() || BigInt(receipt.blockNumber) > BigInt(block.number)) throw new Error('Deployment receipt is not successful and finalized.')
  const canonicalBlock = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
  if (canonicalBlock?.hash !== receipt.blockHash || transaction.blockHash !== receipt.blockHash) throw new Error('Deployment block is not canonical.')
  // Studio deployed through an ERC-4337 v0.6 smart account. An outer successful
  // handleOps receipt alone does not prove the inner operation succeeded.
  if (transaction.to.toLowerCase() !== '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789') throw new Error('Unsupported deployment transaction path; review independently.')
  const userOpComponents = [
    { name: 'sender', type: 'address' }, { name: 'nonce', type: 'uint256' },
    { name: 'initCode', type: 'bytes' }, { name: 'callData', type: 'bytes' },
    { name: 'callGasLimit', type: 'uint256' }, { name: 'verificationGasLimit', type: 'uint256' },
    { name: 'preVerificationGas', type: 'uint256' }, { name: 'maxFeePerGas', type: 'uint256' },
    { name: 'maxPriorityFeePerGas', type: 'uint256' }, { name: 'paymasterAndData', type: 'bytes' },
    { name: 'signature', type: 'bytes' },
  ]
  const entryPointAbi = [
    { type: 'function', name: 'handleOps', stateMutability: 'nonpayable', inputs: [{ name: 'ops', type: 'tuple[]', components: userOpComponents }, { name: 'beneficiary', type: 'address' }], outputs: [] },
    { type: 'event', name: 'UserOperationEvent', inputs: [{ name: 'userOpHash', type: 'bytes32', indexed: true }, { name: 'sender', type: 'address', indexed: true }, { name: 'paymaster', type: 'address', indexed: true }, { name: 'nonce', type: 'uint256', indexed: false }, { name: 'success', type: 'bool', indexed: false }, { name: 'actualGasCost', type: 'uint256', indexed: false }, { name: 'actualGasUsed', type: 'uint256', indexed: false }] },
  ]
  const operations = decodeFunctionData({ abi: entryPointAbi, data: transaction.input }).args[0]
  if (operations.length !== 1) throw new Error('Deployment batch needs separate operation attribution.')
  const operation = operations[0]
  const executeAbi = [{ type: 'function', name: 'execute', stateMutability: 'nonpayable', inputs: [{ name: 'dest', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'func', type: 'bytes' }], outputs: [] }]
  const [factory, , factoryData] = decodeFunctionData({ abi: executeAbi, data: operation.callData }).args
  const factoryAbi = [
    { type: 'function', name: 'deploy', stateMutability: 'payable', inputs: [{ name: 'bytecode', type: 'bytes' }, { name: 'salt', type: 'bytes32' }], outputs: [{ name: 'deployedAddress', type: 'address' }] },
    { type: 'event', name: 'ContractDeployed', inputs: [{ name: 'deployedAddress', type: 'address', indexed: true }, { name: 'deploymentId', type: 'bytes32', indexed: false }] },
  ]
  const [creationBytecode, inputSalt] = decodeFunctionData({ abi: factoryAbi, data: factoryData }).args
  if (creationBytecode.toLowerCase() !== artifact.bytecode.toLowerCase()) throw new Error('Inner factory call does not contain the canonical creation bytecode.')
  function decodedEvents(emitter, abi, eventName) {
    return receipt.logs.filter(log => log.address.toLowerCase() === emitter.toLowerCase()).flatMap(log => {
      try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); return event.eventName === eventName ? [event] : [] }
      catch { return [] }
    })
  }
  const opEvents = decodedEvents(transaction.to, entryPointAbi, 'UserOperationEvent').filter(event => event.args.sender.toLowerCase() === operation.sender.toLowerCase() && event.args.nonce === operation.nonce)
  if (opEvents.length !== 1 || !opEvents[0].args.success) throw new Error('Inner smart-wallet deployment operation did not succeed.')
  const deploymentEvents = decodedEvents(factory, factoryAbi, 'ContractDeployed').filter(event => event.args.deployedAddress.toLowerCase() === address.toLowerCase())
  if (deploymentEvents.length !== 1) throw new Error('Exact inner factory deployment event is missing.')
  const deploymentCode = await rpc('eth_getCode', [address, receipt.blockNumber])
  if (keccak256(deploymentCode) !== runtimeHash) throw new Error('Canonical runtime was absent at the deployment block.')
  evidence.deploymentTransaction = { hash: deploymentHash, status: 'independently-verified', from: transaction.from, smartAccount: operation.sender, entryPoint: transaction.to, factory, inputSalt, deploymentId: deploymentEvents[0].args.deploymentId, userOperationHash: opEvents[0].args.userOpHash, userOperationSuccess: true, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receiptStatus: receipt.status, creationBytecodeMatch: true, deploymentEventMatch: true, runtimeAtDeploymentMatch: true, explorerUrl: `https://explorer.testnet.arc.io/tx/${deploymentHash}` }
  evidence.note = 'Independent finalized receipt, successful inner smart-wallet operation, canonical creation bytecode, exact factory deployment event and runtime verification. Payment lifecycle proofs are recorded separately below.'
}
mkdirSync(`${root}/docs/arc/testnet`, { recursive: true })
writeFileSync(`${root}/docs/arc/testnet/deployment-verification.json`, JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence))
if (wallet) {
  const balanceAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'employer', type: 'address' }], outputs: [{ type: 'uint256' }] }]
  const data = encodeFunctionData({ abi: balanceAbi, functionName: 'balanceOf', args: [wallet] })
  const [nativeHex, ledgerHex] = await Promise.all([
    rpc('eth_getBalance', [wallet, block.number]),
    rpc('eth_call', [{ to: address, data }, block.number]),
  ])
  const nativeBalance = BigInt(nativeHex)
  const ledgerBalance = decodeFunctionResult({ abi: balanceAbi, functionName: 'balanceOf', data: ledgerHex })
  const previousWallet = previousEvidence('wallet-rehearsal.json')
  const sameRehearsal = previousWallet?.chainId === chainId && previousWallet.contractAddress.toLowerCase() === address.toLowerCase() && previousWallet.employer === wallet && previousWallet.secondRecipient === recipient
  const initialLedger = sameRehearsal ? BigInt(previousWallet.initialEmployerLedgerWei ?? previousWallet.employerLedgerWei) : ledgerBalance
  const walletEvidence = {
    verifiedAt: new Date().toISOString(), rpcUrl, chainId, decimals: 18,
    employer: wallet, secondRecipient: recipient, contractAddress: address, runtimeHash,
    finalizedBlock: block.number, finalizedBlockHash: block.hash,
    walletBalanceWei: nativeBalance.toString(), walletBalanceUsdc: formatUnits(nativeBalance, 18),
    employerLedgerWei: ledgerBalance.toString(), employerLedgerUsdc: formatUnits(ledgerBalance, 18),
    initialEmployerLedgerWei: initialLedger.toString(),
    plannedDepositUsdc: '0.10', depositPrincipalAvailable: nativeBalance >= 100000000000000000n,
    gasCheck: 'Re-estimate gas, fees and current wallet balance in the application immediately before signing. Principal availability alone is not sufficient.',
    steps: [
      { action: 'deposit', amountUsdc: '0.10', expectedLedgerWei: (initialLedger + 100000000000000000n).toString(), status: 'awaiting-wallet-signature' },
      { action: 'payroll', recipients: [{ address: wallet, amountUsdc: '0.01' }, { address: recipient, amountUsdc: '0.02' }], expectedLedgerWei: (initialLedger + 70000000000000000n).toString(), status: recipient ? 'awaiting-deposit-and-wallet-signature' : 'awaiting-second-recipient' },
      { action: 'withdraw', amountUsdc: '0.01', expectedLedgerWei: (initialLedger + 60000000000000000n).toString(), status: 'awaiting-payroll-and-wallet-signature' },
      { action: 'replay-check', method: 'Read-only simulation of the original confirmed runId; expect RunAlreadyExecuted. Do not broadcast a replay.', status: 'awaiting-confirmed-payroll' },
    ],
    note: 'Public-address reads only; this verifier never signs or broadcasts, links a company or changes company records. Steps retain their original snapshot and receipt verification across refreshes. Preserve the application-generated runId and verify finalized receipts and exact events between steps.',
  }
  if (sameRehearsal) walletEvidence.steps = previousWallet.steps
  writeFileSync(`${root}/docs/arc/testnet/wallet-rehearsal.json`, JSON.stringify(walletEvidence, null, 2) + '\n')
  if (recipient) writeFileSync(`${root}/docs/arc/testnet/wallet-rehearsal.csv`, `name,wallet,amount\nEmployer test recipient,${wallet},0.01\nSecond test recipient,${recipient},0.02\n`)
  console.log(JSON.stringify(walletEvidence))
}
