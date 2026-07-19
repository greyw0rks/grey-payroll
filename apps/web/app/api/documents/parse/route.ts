import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
})

const SYSTEM_PROMPT = `You are a document parser for Grey Payroll, a crypto payroll platform.
Extract employment details from the provided document (employment letter, offer letter, or contract).
Return ONLY a JSON object with these exact fields — no markdown, no explanation:
{
  "employeeName": string | null,
  "jobTitle": string | null,
  "monthlySalary": number | null,
  "salaryCurrency": "NGN" | "USD" | "GBP" | "EUR" | null,
  "startDate": "YYYY-MM-DD" | null,
  "employmentType": "FULL_TIME" | "CONTRACT" | "PART_TIME" | null,
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}
If a field cannot be found with confidence, set it to null.`

export async function POST(req: NextRequest) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { userId, employer } = auth

  const formData = await req.formData()
  const file = formData.get('document') as File | null
  if (!file) return NextResponse.json({ error: 'No document provided' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const mediaType = file.type as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
  const isPdf = mediaType === 'application/pdf'

  const response = await anthropic.messages.create({
    model: process.env.AI_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          isPdf
            ? { type: 'document' as const, source: { type: 'base64' as const, media_type: mediaType, data: base64 } }
            : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Extract the employment details from this document.' },
        ],
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''

  try {
    const parsed = JSON.parse(text)
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({ error: 'Failed to parse document', raw: text }, { status: 422 })
  }
}
