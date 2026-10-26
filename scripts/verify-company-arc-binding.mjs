// Read-only proof of the actual company binding and finalized Arc ledger.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(`${root}/apps/web/.env.local`)
const require = createRequire(`${root}/apps/web/package.json`), { prisma } = require('@grey/db')
const arcRequire = createRequire(`${root}/arc-module/package.json`)
const { keccak256, encodeFunctionData, decodeFunctionResult, formatUnits } = arcRequire('viem')
const rpcUrl = 'https://rpc.testnet.arc.io'
let sequence = 0
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('Arc RPC unavailable; no verified company balance.')
  const value = await response.json()
  if (value.error) throw new Error('Arc RPC could not verify the finalized company treasury.')
  return value.result
}
try {
  const company = await prisma.employer.findUniqueOrThrow({ where: { clerkUserId: 'user_3LCN228tAh8QNpd7xy2TfSUmS0u' }, select: { companyName: true, arcChainId: true, arcTreasuryAddress: true, arcEmployerWallet: true, arcBindingChallenge: true } })
  const address = company.arcTreasuryAddress, wallet = company.arcEmployerWallet
  if (company.companyName !== 'Kola Foods Ltd (Demo)' || company.arcChainId !== 5042002 || address?.toLowerCase() !== '0xb3bd28388099c84d33090b0e53330863b26567b9' || wallet?.toLowerCase() !== '0xb9e3a2d811729c11f64313f59922ab37afa52010' || company.arcBindingChallenge !== null) throw new Error('The expected company/wallet binding is not complete. No balance proof was saved.')
  if (Number(BigInt(await rpc('eth_chainId'))) !== company.arcChainId) throw new Error('RPC is not the company Arc Testnet chain.')
  const block = await rpc('eth_getBlockByNumber', ['finalized', false])
  if (!block?.number || !block.hash) throw new Error('A finalized Arc block is unavailable.')
  const abi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'employer', type: 'address' }], outputs: [{ type: 'uint256' }] }]
  const data = encodeFunctionData({ abi, functionName: 'balanceOf', args: [wallet] })
  const [code, ledgerData] = await Promise.all([rpc('eth_getCode', [address, block.number]), rpc('eth_call', [{ to: address, data }, block.number])])
  const artifact = JSON.parse(readFileSync(`${root}/arc-module/src/grey/bytecode.json`, 'utf8'))
  if (!code || code === '0x' || keccak256(code) !== artifact.deployedBytecodeKeccak) throw new Error('Company treasury runtime does not match canonical GreyPayroll.')
  if ((await rpc('eth_getBlockByNumber', [block.number, false]))?.hash !== block.hash) throw new Error('Finalized company treasury block changed during verification.')
  const ledger = decodeFunctionResult({ abi, functionName: 'balanceOf', data: ledgerData })
  const report = { verifiedAt: new Date().toISOString(), company: company.companyName, chainId: company.arcChainId, contractAddress: address, employerWallet: wallet, challengeConsumed: true, rpcUrl, finalizedBlockNumber: BigInt(block.number).toString(), finalizedBlockHash: block.hash, runtimeHash: keccak256(code), employerLedgerNative: ledger.toString(), employerLedgerUsdc: formatUnits(ledger, 18), readOnly: true, companyPaymentRecorded: false, note: 'Live company binding, consumed signature challenge, canonical finalized GreyPayroll runtime and employer-scoped ledger. No transaction was signed or broadcast by this verifier; the prior standalone payments are not company-plan settlement.' }
  writeFileSync(`${root}/docs/arc/company-treasury-verification.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL]') : 'Company binding verification failed.')
  process.exitCode = 1
} finally { await prisma.$disconnect() }
