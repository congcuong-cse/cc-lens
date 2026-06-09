import { NextResponse } from 'next/server'
import { findSubagentJSONL, findSubagentMeta } from '@/lib/claude-reader'
import { parseSessionReplay } from '@/lib/replay-parser'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id, agentId } = await params
  const [jsonlPath, meta] = await Promise.all([
    findSubagentJSONL(id, agentId),
    findSubagentMeta(id, agentId),
  ])

  if (!jsonlPath) {
    return NextResponse.json({ error: 'Subagent not found' }, { status: 404 })
  }

  const replay = await parseSessionReplay(jsonlPath, agentId)
  return NextResponse.json({ replay, meta })
}
