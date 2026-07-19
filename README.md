# Grey — AI-Native Crypto Payroll

**IBM AI Builders Challenge · Wildcard: Build Intelligent Systems for the Future of Work**

Grey is a stablecoin payroll platform for employers in emerging markets. Employees check in daily,
salary is released automatically on-chain, and staff can request salary advances, expense refunds,
and leave. This submission adds an **AI Request Reviewer** — an AI HR co-worker that gives the
employer a grounded second opinion on every pending advance and refund, reasoning over real
attendance, loan load, salary ratios, and expense patterns.

---

## Problem statement

Small and mid-size employers drown in payroll admin. Every salary advance and expense claim is a
judgment call — *Can this person afford to repay? Have they actually been showing up? Is this the
same taxi receipt I approved last week?* The data to answer these questions exists (attendance logs,
prior requests, outstanding balances), but it's scattered, and a busy owner rubber-stamps or
guesses. The result is over-extended advances, duplicate-expense leakage, and slow approvals.

## Solution description

Grey already runs the payroll rails: on-chain daily salary release on Celo, a treasury with a
2-month buffer, and a request inbox for advances/refunds/leave. This submission makes the inbox
**intelligent**. When an employer opens the inbox, each pending advance or refund is automatically
reviewed by AI, which returns a verdict — **APPROVE / REVIEW / REJECT** — with a confidence score,
a one-sentence rationale, and risk flags (e.g. *High absenteeism*, *Possible duplicate receipt*).
The AI advises; the employer still clicks the button. Human-in-the-loop by design.

Example verdicts produced on the demo dataset:

| Employee | Request | Signal | AI verdict |
|---|---|---|---|
| Ada (Store Manager) | $300 advance | Perfect 30-day attendance, no loans, 25% of salary | **APPROVE** · 95% |
| Emeka (Rider) | $500 advance | 10 missed days, $350 already owed, 83% of salary | **REVIEW** · flags: high absenteeism, high %, outstanding loan |
| Bisi (Sales) | $85 Transport refund | Identical category+amount to a prior claim | **REVIEW** · flag: possible duplicate |
| Ada | $40 Supplies refund | Receipt attached, no duplicates | **APPROVE** · 95% |

## AI approach and architecture

- **Model**: pluggable via a small provider adapter (`apps/web/lib/ai.ts`). Set `AI_PROVIDER=watsonx`
  to run the reviewer on **IBM watsonx.ai (Granite)**, or leave the default `anthropic` to use an
  Anthropic-compatible messages API (Claude directly, or any gateway via `ANTHROPIC_BASE_URL`). Both
  paths take the same system+user prompt and return strict JSON, so the feature is identical either way.
- **Grounded, not generative-guesswork**: the review route (`apps/web/app/api/requests/[kind]/[id]/review/route.ts`)
  first pulls **real data** from Postgres — last-30-day check-in counts, sum of outstanding approved
  advances, salary ratio, and a duplicate-expense heuristic (same category + amount) — then feeds
  that structured context to the model with a strict-JSON system prompt.
- **Structured, safe output**: the model must return `{ verdict, confidence, reasoning, flags }`.
  Confidence is normalized to 0–100. If the model is unavailable or returns malformed JSON, the
  route degrades to a neutral `REVIEW` and the UI shows "AI unavailable" — the manual Approve/Decline
  buttons are never blocked.
- **Architecture layering**: AI is the *insight* layer; the blockchain is the *execution* layer.
  The AI never moves money — it annotates a human decision that then flows through the existing
  `PayrollTreasury` / `SalaryAdvance` / `RefundVault` contracts on Celo.

```
Employer inbox (Next.js client)
        │  auto-fetch per pending advance/refund
        ▼
GET /api/requests/{kind}/{id}/review   ── Clerk auth (requireEmployer)
        │  gather context: attendance, loan load, salary ratio, duplicate check (Prisma)
        ▼
Claude-compatible model  ──►  { verdict, confidence, reasoning, flags }
        │
        ▼
AiInsightCard  →  employer still clicks Approve / Decline  →  on-chain contract call
```

**Stack**: Next.js 15 (App Router), Prisma + Postgres, Clerk auth, wagmi/RainbowKit, Foundry
(Solidity 0.8.24) on Celo Sepolia. Monorepo via pnpm + Turborepo.

## Selected challenge theme

**Wildcard — Build Intelligent Systems for the Future of Work.** Grey turns a repetitive HR/finance
approval workflow into an AI-assisted decision system: it reduces repetitive review work, improves
decision quality with grounded risk signals, and keeps the human in control.

## How IBM Bob was used

IBM Bob is the primary development tool for the AI Request Reviewer feature. It is used to:
- Map the existing monorepo (contracts, workers, web app) and locate the request-approval flow.
- Design the AI Request Reviewer to reuse the existing document-parse AI pattern and auth guards.
- Implement the review API route, the `AiInsightCard` inbox UI, the provider adapter, and the demo seed.
- Debug and verify end-to-end — including the HTTP 403 model-access issue and the model emitting
  confidence on a 0–1 scale, both fixed before they could break the live demo.

> **TODO before submission — do NOT ship this README with this note still present.**
> Reconcile this section with what was actually built in IBM Bob vs. other tooling, and replace the
> bullets above with an honest, specific account (which files/commits Bob produced, what prompts were
> used). The challenge rules require IBM Bob as the primary development tool and judges verify the
> claim, so every line here must be true. See `ibm.biz/university-bob` (40 Bobcoins / 30 days).

---

## Run it locally

```bash
pnpm install

# 1. Seed contrasting demo data (clean / risky / duplicate-expense / borderline)
pnpm --filter @grey/db db:seed

# 2. Attach the seeded employer to your Clerk login (so the inbox is yours):
#    UPDATE "Employer" SET "clerkUserId"='<your-clerk-id>' WHERE id='seed-employer-grey';

# 3. Start the web app and open /inbox
cd apps/web && pnpm dev
```

Required env in `apps/web/.env.local`: pick a provider — either `ANTHROPIC_API_KEY` (+ optional
`ANTHROPIC_BASE_URL`, `AI_MODEL`), or `AI_PROVIDER=watsonx` with `WATSONX_API_KEY` +
`WATSONX_PROJECT_ID` — plus the existing `DATABASE_URL` and Clerk keys. See `.env.example`.

## Demo script (≤ 3 min)

1. Seed the demo data; open the employer **Requests inbox**.
2. Each pending advance/refund shows a "Grey AI reviewing…" shimmer, then a verdict pill appears.
3. Walk the four cases: Ada → APPROVE, Emeka → REVIEW with three risk flags, Bisi → duplicate-receipt
   flag, Ada's supplies refund → clean APPROVE.
4. Click **Approve** on Ada to show the human stays in control and the on-chain flow is untouched.
