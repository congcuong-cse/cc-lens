'use client'

import { use, useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { TopBar } from '@/components/layout/top-bar'
import { SessionSidebar } from '@/components/sessions/replay/session-sidebar'
import { UserTurnCard, AssistantTurnCard } from '@/components/sessions/replay/turn-cards'
import { TokenAccumulationChart } from '@/components/sessions/replay/token-accumulation-chart'
import { ContextWindowTimeline } from '@/components/sessions/replay/context-window-timeline'
import { SessionBadges } from '@/components/sessions/session-badges'
import { formatCost, formatTokens, formatDuration, projectDisplayName } from '@/lib/decode'
import type { ReplayData, SessionWithFacet, AgentToolResult } from '@/types/claude'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, MessageSquare, Coins, DollarSign, Clock, Zap } from 'lucide-react'

const fetcher = (url: string) =>
  fetch(url).then(r => { if (!r.ok) throw new Error(`API error ${r.status}`); return r.json() })

type ReplayResponse = ReplayData

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: replayData, error: replayError, isLoading: replayLoading } =
    useSWR<ReplayResponse>(`/api/sessions/${id}/replay`, fetcher)

  const { data: metaData } =
    useSWR<{ session: SessionWithFacet }>(`/api/sessions/${id}`, fetcher)

  const meta = metaData?.session

  // 0-based index into replay.turns; the timeline pins this and we show only
  // conversation up to and including it. Defaults to showing everything.
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(Number.MAX_SAFE_INTEGER)

  // When the pinned turn changes, jump the conversation down to the last
  // shown message so the newly-selected turn is in view. Skip the initial
  // settle (the timeline reports its default pin once on mount).
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevTurnRef = useRef(selectedTurnIndex)
  useEffect(() => {
    const prev = prevTurnRef.current
    prevTurnRef.current = selectedTurnIndex
    if (prev === Number.MAX_SAFE_INTEGER) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [selectedTurnIndex])

  if (replayError) {
    return (
      <div className="flex flex-col min-h-screen">
        <TopBar title="Session Replay" subtitle="Error" />
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Error loading session: {String(replayError)}</AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  if (replayLoading || !replayData) {
    return (
      <div className="flex flex-col min-h-screen">
        <TopBar title="Session Replay" subtitle="Loading…" />
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

  const replay = replayData
  const projectName = meta ? projectDisplayName(meta.project_path ?? '') : id.slice(0, 8)

  // Total token counts from replay
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

  // Build tool results map: tool_use_id -> result (from user turns)
  const toolResults = new Map<string, { content: string; is_error: boolean; agentResult?: AgentToolResult }>()
  for (const t of replay.turns) {
    if (t.type === 'user' && t.tool_results) {
      for (const r of t.tool_results) {
        toolResults.set(r.tool_use_id, { content: r.content, is_error: r.is_error, agentResult: r.agentResult })
      }
    }
  }

  // Build compaction map: index of turn before which a compaction occurred
  const compactionByTurnIndex = new Map(replay.compactions.map(c => [c.turn_index, c]))

  let assistantTurnNum = 0

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <TopBar
        title={`${projectName} · ${replay.slug ?? id.slice(0, 8)}`}
        subtitle={`${replay.git_branch ?? '?'} · v${replay.version ?? '?'} · ${formatCost(replay.total_cost ?? 0)}`}
      />

      {/* Two-column layout — fills the remaining height; each column scrolls
          on its own so the sticky timeline can pin to the conversation. */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Conversation replay — trimmed to the turn pinned in the timeline */}
        <div className="flex-1 min-w-0 overflow-y-auto px-4 pb-6 max-w-6xl">
          {/* Context window timeline stays pinned while scrolling messages */}
          <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 pb-4 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <ContextWindowTimeline turns={replay.turns} compactions={replay.compactions} onSelectTurn={setSelectedTurnIndex} />
          </div>
          {selectedTurnIndex < replay.turns.length - 1 && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--viz-sky)]/30 bg-[var(--viz-sky)]/5 px-3 py-2 text-xs text-muted-foreground">
              <span>
                Showing turns <span className="font-semibold text-foreground/80">1–{selectedTurnIndex + 1}</span> of {replay.turns.length} · pinned from the context window timeline
              </span>
              <button
                onClick={() => setSelectedTurnIndex(Number.MAX_SAFE_INTEGER)}
                className="font-medium text-[var(--viz-sky)] hover:underline"
              >
                Show all
              </button>
            </div>
          )}
          {replay.turns.slice(0, selectedTurnIndex + 1).map((turn, i) => {
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
                sessionId={id}
              />
            )
          })}

          {/* Scroll anchor — auto-scrolled into view when the turn changes */}
          <div ref={messagesEndRef} aria-hidden />

          {/* Token accumulation chart scrolls in below the conversation */}
          {/* <div className="mt-6 border-t border-border pt-6">
            <TokenAccumulationChart turns={replay.turns} compactions={replay.compactions} />
          </div> */}
        </div>

        {/* Sidebar */}
        <div className="w-72 shrink-0 overflow-y-auto border-l border-border px-4 py-6">
          {/* Stats cards — stacked above the session breakdown */}
          <div className="mb-5 grid gap-3">
            {/* <Card className="gap-0">
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
            </Card> */}

            {/* <Card className="gap-0">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Coins className="h-4 w-4" /> Tokens
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums text-blue-700 dark:text-[#60a5fa]">{formatTokens(totalTokens)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Input + output + cache</p>
              </CardContent>
            </Card> */}

            {/* <Card className="gap-0">
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
            </Card> */}

            {/* {meta && (
              <Card className="gap-0">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Duration
                  </CardDescription>
                  <CardTitle className="text-3xl font-bold tabular-nums">
                    {formatDuration(meta.duration_minutes ?? 0)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Session span</p>
                </CardContent>
              </Card>
            )} */}

            {/* {replay.compactions.length > 0 && (
              <Card className="gap-0 border-amber-500/25">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" /> Compactions
                  </CardDescription>
                  <CardTitle className="text-3xl font-bold tabular-nums text-amber-500">
                    {replay.compactions.length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Context window events</p>
                </CardContent>
              </Card>
            )} */}
          </div>

          {meta && (
            <div className="mb-5 flex flex-wrap gap-2">
              <SessionBadges
                has_compaction={replay.compactions.length > 0}
                uses_task_agent={meta.uses_task_agent}
                uses_mcp={meta.uses_mcp}
                uses_web_search={meta.uses_web_search}
                uses_web_fetch={meta.uses_web_fetch}
                has_thinking={meta.has_thinking}
              />
            </div>
          )}

          <SessionSidebar replay={replay} meta={meta} />
        </div>
      </div>
    </div>
  )
}
