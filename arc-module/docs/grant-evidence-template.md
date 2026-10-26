# Grey Payroll — Grant Evidence Template

**Deadline:** 2026-11-01 (conservative) / 2026-11-02 05:59 UTC+1 (portal)

Fill in each item below before submission.

---

## Project Description (public)

Grey Payroll is an employer-approved USDC payroll module for Arc chain. Employers fund their own isolated contract balance and atomically pay a batch of recipients in a single wallet-signed transaction. Native USDC (Arc's gas token) is used throughout — no bridges, no ERC-20 approval flow. The Arc Studio-built payment engine is integrated into Grey’s company payroll workspace.

---

## Evidence Checklist

| Item | Status | Value |
|------|--------|-------|
| Public app URL | **PENDING** | `https://...` |
| Public repository | **PENDING** | `https://github.com/...` |
| Mainnet contract address | **PENDING** | `0x...` (on explorer.arc.io) |
| Payroll transaction | **PENDING** | `https://explorer.arc.io/tx/0x...` |
| Walkthrough video | **PENDING** | `https://...` |
| Builder profile | **PENDING** | `https://...` |
| Studio build session | Completed 2026-10-24 | Arc Studio (studio.arc.io) |

---

## Technical Artifacts (completed)

| Artifact | Status | Path |
|----------|--------|------|
| Contract source | Done | `contracts/GreyPayroll.sol` |
| Contract ABI | Done | `src/grey/abi.ts` |
| Forge bytecode | Done | `contracts/out/GreyPayroll.sol/GreyPayroll.json` |
| Unit tests (84/84) | Done | `contracts/test/` |
| Security review | Done | `docs/security-review.md` |
| Frontend source | Done | `src/` |
| README | Done | `README.md` |
| Build log | Done | `BUILD_LOG.md` |

---

## Remaining Steps

1. **Deploy to Arc Testnet** — self-deploy with `forge create` (see `BUILD_LOG.md`). Record the contract address.
2. **Run a tiny testnet payroll** — fund with test USDC, add one or two test recipient addresses, execute. Confirm `PaymentSent` events on the testnet explorer.
3. **Deploy to Arc Mainnet** — only after testnet rehearsal passes and you have reviewed all code. Record the mainnet contract address.
4. **Run a real payroll on Arc Mainnet** — first run should be tiny (e.g. $0.01 per recipient). Record the transaction hash.
5. **Publish the repository** — push to a public GitHub repo.
6. **Deploy the frontend** — deploy to Netlify/Vercel/Hugging Face via the Arc Studio Integrations menu. Record the public URL.
7. **Record the walkthrough video** — show the Arc Studio build session, testnet run, and the mainnet transaction on the explorer.
8. **Submit the grant** — fill in all PENDING fields above and submit before the deadline.

---

## Arc Network Facts

| | Testnet | Mainnet |
|-|---------|---------|
| Chain ID | 5042002 | 5042 |
| RPC | https://rpc.testnet.arc.io | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.testnet.arc.io | https://explorer.arc.io |
| Native USDC decimals | 18 | 18 |
| ERC-20 USDC address | 0x3600000000000000000000000000000000000000 | 0x3600000000000000000000000000000000000000 |

---

## Important Disclaimers

- **Arc Studio preview** (studio.arc.io) is a development workspace, not a public app URL. Obtain a standalone public deployment for grant submission.
- **Standard EVM tests** cannot prove Arc-specific blocklist behavior. Test on Arc Testnet before mainnet.
- **Max-preset security review** is Arc Studio's internal rule corpus analysis — not a paid third-party audit. Consider a professional audit before running real payroll at scale.
- **No real funds were moved** in the Arc Studio build session. All deployment and execution steps require human wallet signatures.
