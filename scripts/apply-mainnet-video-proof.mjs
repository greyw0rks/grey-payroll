import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const evidencePath = `${root}/docs/arc/mainnet/deployment-verification.json`
const manifestPath = `${root}/docs/arc/mainnet/release-evidence.json`
const videoPath = `${root}/videos/grey-finance-launch/index.html`
const narrationPath = `${root}/videos/grey-finance-launch/NARRATION.md`
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))

if (evidence.status !== 'verified' || evidence.chainId !== 5042) throw new Error('Verified Arc Mainnet deployment evidence is required.')
if (!/^0x[0-9a-fA-F]{40}$/.test(evidence.contractAddress ?? '')) throw new Error('Verified evidence has no valid contract address.')
if (!/^0x[0-9a-fA-F]{64}$/.test(evidence.deploymentTransaction ?? '')) throw new Error('Verified evidence has no valid deployment transaction.')

const shortHash = `${evidence.deploymentTransaction.slice(0, 10)}…${evidence.deploymentTransaction.slice(-8)}`
const proofLine = `ARC MAINNET · ${evidence.contractAddress} · DEPLOY TX ${shortHash} · VERIFIED`
let html = readFileSync(videoPath, 'utf8')

html = html.replace('07 / BUILT FOR ARC MAINNET', '07 / LIVE ON ARC MAINNET')
const pendingLine = 'MAINNET READY · Final deployment remains a human wallet signature. Replace this line with the verified contract address only after the mainnet verifier passes.'
if (html.includes(pendingLine)) html = html.replace(pendingLine, proofLine)
else if (!html.includes(evidence.contractAddress)) throw new Error('Video close copy is neither pending nor already updated with this verified address.')

let narration = readFileSync(narrationPath, 'utf8')
narration = narration.replace('Grey Finance. Payroll, settled properly on Arc.', 'Grey Finance. Live on Arc Mainnet. Payroll, settled properly.')

writeFileSync(videoPath, html)
writeFileSync(narrationPath, narration)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.videoStatus = 'mainnet-proof-applied'
manifest.updatedAt = new Date().toISOString()
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(JSON.stringify({ status: 'updated', contractAddress: evidence.contractAddress, deploymentTransaction: evidence.deploymentTransaction, videoPath: 'videos/grey-finance-launch/index.html' }, null, 2))
