import { describe, it, expect, afterEach } from 'vitest'
import { parseCompanyPayrollCsv } from './company-csv'
import { loadState, saveState, saveChainContractConfig, loadChainContractConfig } from './storage'
const wallet = '0x1111111111111111111111111111111111111111'
describe('company payroll import', () => {
  it('keeps amounts exact and parses quoted employee names', () => {
    const rows = parseCompanyPayrollCsv(`name,wallet,amount\r\n"Ada, ""Example""",${wallet},1.000000000000000001`)
    expect(rows).toHaveLength(1); expect(rows[0].amountStr).toBe('1.000000000000000001')
  })
  it('rejects malformed addresses, duplicate wallets and excess precision', () => {
    expect(() => parseCompanyPayrollCsv('name,wallet,amount\nAda,invalid,1')).toThrow()
    expect(() => parseCompanyPayrollCsv(`name,wallet,amount\nAda,${wallet},1\nBob,${wallet},2`)).toThrow('duplicate')
    expect(() => parseCompanyPayrollCsv(`name,wallet,amount\nAda,${wallet},0.0000000000000000001`)).toThrow()
  })
  it('rejects an empty export and batches larger than fifty', () => {
    expect(() => parseCompanyPayrollCsv('name,wallet,amount')).toThrow()
    expect(() => parseCompanyPayrollCsv('name,wallet,amount\n' + Array.from({ length: 51 }, () => `Ada,${wallet},1`).join('\n'))).toThrow('50')
  })
})
describe('company-scoped Arc persistence', () => {
  afterEach(() => { document.getElementById('grey-company-context')?.remove(); localStorage.clear() })
  const company = (id: string) => {
    document.getElementById('grey-company-context')?.remove()
    const script = document.createElement('script'); script.type = 'application/json'; script.id = 'grey-company-context'; script.textContent = JSON.stringify({ companyId: id, companyName: id }); document.head.append(script)
  }
  it('keeps drafts and chain contract settings separate for the same wallet', () => {
    company('A')
    const state = loadState(5042002, wallet, wallet)
    saveState(5042002, wallet, wallet, { ...state, runs: [{ runId: 'company-a' } as never] })
    saveChainContractConfig({ chainId: 5042002, contractAddress: wallet, deployBlock: 1, verified: true, verifiedAt: 'now' })
    company('B')
    expect(loadState(5042002, wallet, wallet).runs).toHaveLength(0)
    expect(loadChainContractConfig(5042002)).toBeNull()
    company('A')
    expect(loadState(5042002, wallet, wallet).runs[0].runId).toBe('company-a')
    expect(loadChainContractConfig(5042002)?.contractAddress).toBe(wallet)
  })
})
