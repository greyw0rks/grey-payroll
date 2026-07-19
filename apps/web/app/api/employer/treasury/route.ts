import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { createPublicClient, http } from 'viem'
import { celoSepolia, celo } from '@grey/config/chains'
import { PayrollTreasuryABI } from '@grey/config/abis'

export async function GET() {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const employer = await prisma.employer.findUnique({
    where: { clerkUserId: userId },
    include: { _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
  })

  if (!employer?.treasuryContractAddress) {
    return NextResponse.json({ balance: '0', available: '0', totalBuffer: '0', activeEmployees: 0 })
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11142220)
  const chain = chainId === 42220 ? celo : celoSepolia
  const rpcUrl = chainId === 42220 ? process.env.CELO_RPC_URL : process.env.CELO_TESTNET_RPC_URL

  const client = createPublicClient({ chain, transport: http(rpcUrl) })
  const address = employer.treasuryContractAddress as `0x${string}`

  const [balance, available, totalBuffer] = await Promise.all([
    client.readContract({ address, abi: PayrollTreasuryABI, functionName: 'getBalance' }),
    client.readContract({ address, abi: PayrollTreasuryABI, functionName: 'availableBalance' }),
    client.readContract({ address, abi: PayrollTreasuryABI, functionName: 'totalBuffer' }),
  ])

  return NextResponse.json({
    balance: String(balance),
    available: String(available),
    totalBuffer: String(totalBuffer),
    activeEmployees: employer._count.employees,
  })
}
