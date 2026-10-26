import { beforeEach, it, expect, vi } from 'vitest'
import artifact from '../../../arc-module/src/grey/bytecode.json'
import { verifyArcTreasury, readArcTreasury } from '@/lib/arc-treasury'
const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), getBlock: vi.fn(), getCode: vi.fn(), readContract: vi.fn() }))
vi.mock('viem', async () => ({ ...await vi.importActual('viem'), createPublicClient: () => rpc }))
const address = `0x${'ab'.repeat(20)}`, wallet = `0x${'ef'.repeat(20)}`
beforeEach(() => { rpc.getChainId.mockReset().mockResolvedValue(5042002); rpc.getBlock.mockReset().mockResolvedValue({ number: 123n, hash: 'fixture-finalized-hash' }); rpc.getCode.mockReset().mockResolvedValue(artifact.deployedBytecode); rpc.readContract.mockReset().mockResolvedValue(1230000000000000000n) })
it('pins contract code and employer ledger to the same finalized block', async () => {
  const result = await readArcTreasury(address, wallet, 5042002)
  expect(result.balance).toBe('1230000000000000000')
  expect(rpc.getBlock).toHaveBeenCalledWith({ blockTag: 'finalized' })
  expect(rpc.getCode).toHaveBeenCalledWith({ address, blockNumber: 123n })
  expect(rpc.readContract.mock.calls[0]![0]).toMatchObject({ address, args: [wallet], blockNumber: 123n })
})
it('supports the canonical Arc Mainnet RPC identity', async () => { rpc.getChainId.mockResolvedValue(5042); expect((await readArcTreasury(address, wallet, 5042)).balance).toBe('1230000000000000000') })
it('rejects a wrong network before reading any ledger', async () => { rpc.getChainId.mockResolvedValue(5042); await expect(verifyArcTreasury(address, 5042002)).rejects.toThrow('not Arc Testnet'); expect(rpc.getCode).not.toHaveBeenCalled() })
it('rejects absent or spoofed runtime code', async () => { rpc.getCode.mockResolvedValue('0x'); await expect(verifyArcTreasury(address, 5042002)).rejects.toThrow('verified GreyPayroll'); rpc.getCode.mockResolvedValue('0x6000'); await expect(verifyArcTreasury(address, 5042002)).rejects.toThrow('verified GreyPayroll'); expect(rpc.readContract).not.toHaveBeenCalled() })
it('does not fall back to latest state when finality is unavailable', async () => { rpc.getBlock.mockRejectedValue(new Error('finalized unavailable')); await expect(readArcTreasury(address, wallet, 5042002)).rejects.toThrow('finalized unavailable'); expect(rpc.readContract).not.toHaveBeenCalled() })
