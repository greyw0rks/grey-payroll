import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const pinataForm = new FormData()
  pinataForm.append('file', file)
  pinataForm.append('pinataMetadata', JSON.stringify({ name: `grey-${userId}-${Date.now()}` }))

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
    body: pinataForm,
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: 'IPFS upload failed', detail: err }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json({
    cid: data.IpfsHash,
    url: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
  })
}
