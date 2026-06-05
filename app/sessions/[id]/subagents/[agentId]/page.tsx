'use client'

import { use } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { TopBar } from '@/components/layout/top-bar'
import { SessionSidebar } from '@/components/sessions/replay/session-sidebar'
import { UserTurnCard, AssistantTurnCard } from '@/components/sessions/replay/turn-cards'
import { TokenAccumulationChart } from '@/components/sessions/replay/token-accumulation-chart'
import { formatCost, formatTokens, formatDurationMs } from '@/lib/decode'
import type { ReplayData, SubagentMeta, AgentToolResult } from '@/types/claude'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, MessageSquare, Coins, DollarSign, Clock, ArrowLeft, Bot, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const fetcher = (url: string) =>
  fetch(url).then(r => { if (!r.ok) throw new Error(`API error ${r.status}`); return r.json() })

type SubagentResponse = { replay: ReplayData; meta: SubagentMeta | null }

export default function SubagentDetailPage({ params }: { params: Promise<{ id: string; agentId: string }> }) {
  const { id, agentId } = use(params)

  const { data, error, isLoading } =
    useSWR<SubagentResponse>(`/api/sessions/${id}/subagents/${agentId}`, fetcher)

  if (error) {
    return (
      <div className="flex flex-col min-h-screen">
        <TopBar title="Subagent Session" subtitle="Error" />
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Error loading subagent: {String(error)}</AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col min-h-screen">
        <TopBar title="Subagent Session" subtitle="Loading…" />
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className={`h-${i % 2 === 0 ? '16' : '28'} rounded-xl`} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const { replay, meta } = data

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0
  for (const t of replay.turns) {
    if (t.usage) {
      totalInput      += t.usage.input_tokens ?? 0
      totalOutput     += t.usage.output_tokens ?? 0
      totalCacheWrite += t.usage.cache_creation_input_tokens ?? 0
      totalCacheRead  += t.usage.cache_read_input_tokens ?? 0
    }
  }
  const totalTokens = totalInput + totalOutput + totalCacheWrite + totalCacheRead

  const toolResults = new Map<string, { content: string; is_error: boolean; agentResult?: AgentToolResult }>()
  for (const t of replay.turns) {
    if (t.type === 'user' && t.tool_results) {
      for (const r of t.tool_results) {
        toolResults.set(r.tool_use_id, { content: r.content, is_error: r.is_error, agentResult: r.agentResult })
      }
    }
  }

  const compactionByTurnIndex = new Map(replay.compactions.map(c => [c.turn_index, c]))
  const description = meta?.description ?? agentId.slice(0, 16)

  // Compute tool use count from turns
  let toolUseCount = 0
  for (const t of replay.turns) {
    toolUseCount += t.tool_calls?.length ?? 0
  }

  // Compute duration from first to last turn timestamp
  const timestamps = replay.turns
    .map(t => t.timestamp)
    .filter(Boolean)
    .map(ts => new Date(ts).getTime())
    .filter(n => !isNaN(n))
  const durationMs = timestamps.length >= 2
    ? Math.max(...timestamps) - Math.min(...timestamps)
    : 0

  let assistantTurnNum = 0

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <TopBar
        title={`Subagent · ${description.slice(0, 60)}${description.length > 60 ? '…' : ''}`}
        subtitle={`${replay.git_branch ?? '?'} · v${replay.version ?? '?'} · ${formatCost(replay.total_cost ?? 0)}`}
      />

      {/* Back link + meta banner */}
      <div className="border-b border-border bg-muted/20 px-4 py-2 flex items-center gap-3">
        <Link
          href={`/sessions/${id}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to parent session
        </Link>
        <span className="text-muted-foreground/30">·</span>
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-violet-400" />
          <Badge variant="outline" className="border-violet-500/30 text-violet-400 text-[11px] px-1.5 py-0 h-5">
            {meta?.agentType ?? 'general-purpose'}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground/60 font-mono truncate max-w-xs">{agentId}</span>
      </div>

      {/* Stats cards */}
      <div className="border-b border-border bg-muted/30 px-4 py-4 md:px-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="gap-0">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Turns
              </CardDescription>
              <CardTitle className="text-3xl font-bold tabular-nums">
                {replay.turns.filter(t => t.type === 'assistant').length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Assistant messages</p>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Coins className="h-4 w-4" /> Tokens
              </CardDescription>
              <CardTitle className="text-3xl font-bold tabular-nums text-blue-700 dark:text-[#60a5fa]">
                {formatTokens(totalTokens)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Input + output + cache</p>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Cost
              </CardDescription>
              <CardTitle className="text-3xl font-bold tabular-nums text-[#d97706]">
                {formatCost(replay.total_cost ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Estimated spend</p>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                {durationMs > 0 ? <Clock className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                {durationMs > 0 ? 'Duration' : 'Tool uses'}
              </CardDescription>
              <CardTitle className="text-3xl font-bold tabular-nums">
                {durationMs > 0 ? formatDurationMs(durationMs) : toolUseCount}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {durationMs > 0 ? 'Session span' : 'Total tool calls'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation replay */}
        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-6 max-w-6xl">
          {replay.turns.map((turn, i) => {
            const compactionBefore = compactionByTurnIndex.get(i)

            if (turn.type === 'user') {
              return (
                <UserTurnCard
                  key={turn.uuid || i}
                  turn={turn}
                  turnNumber={i + 1}
                  compactionBefore={compactionBefore}
                  toolResults={toolResults}
                />
              )
            }

            assistantTurnNum++
            return (
              <AssistantTurnCard
                key={turn.uuid || i}
                turn={turn}
                turnNumber={assistantTurnNum}
                compactionBefore={compactionBefore}
                toolResults={toolResults}
              />
            )
          })}
        </div>

        {/* Sidebar */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-border px-4 py-6">
          <SessionSidebar replay={replay} />
        </div>
      </div>

      {/* Token accumulation chart */}
      <div className="border-t border-border px-4 py-4">
        <TokenAccumulationChart turns={replay.turns} compactions={replay.compactions} />
      </div>
    </div>
  )
}
