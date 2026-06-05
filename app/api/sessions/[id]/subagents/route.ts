import { NextResponse } from 'next/server'
import { listSessionSubagents } from '@/lib/claude-reader'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const subagents = await listSessionSubagents(id)
  return NextResponse.json({ subagents })
}
