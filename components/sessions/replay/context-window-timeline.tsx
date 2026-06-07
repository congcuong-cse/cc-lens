'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { formatTokens, formatTokensExact, formatCost, formatDateTime } from '@/lib/decode'
import { getContextLimit } from '@/lib/pricing'
import type { ReplayTurn, CompactionEvent } from '@/types/claude'

interface Props {
  turns: ReplayTurn[]
  compactions: CompactionEvent[]
  // Reports the pinned turn's 0-based index into `turns`, so the conversation
  // can show only messages up to and including the selected turn.
  onSelectTurn?: (turnIndex: number) => void
}

// Honest, real categories that make up the prompt sent on each turn. These map
// directly to the `usage` fields Claude Code records — no synthetic attribution.
const SEGMENTS = [
  { key: 'cacheRead',  label: 'Reused context', hint: 'Cache read — prior conversation, files, system prompt replayed from cache', color: '#34d399' },
  { key: 'cacheWrite', label: 'Newly cached',    hint: 'Cache creation — fresh content written to the cache this turn',          color: '#a78bfa' },
  { key: 'freshInput', label: 'Fresh input',     hint: 'Uncached input tokens billed at full rate this turn',                    color: 'var(--viz-sky)' },
] as const

// Auto-compaction kicks in as the window approaches full. The exact trigger
// isn't recorded, but it's near the top of the window — shade that zone.
const AUTO_COMPACT_FRACTION = 0.92

interface Point {
  turn: number
  occupancy: number
  cacheRead: number
  cacheWrite: number
  freshInput: number
  output: number
  cost: number
  model?: string
  timestamp: string
  pct: number
}

export function ContextWindowTimeline({ turns, compactions, onSelectTurn }: Props) {
  const points = useMemo<Point[]>(() => {
    const out: Point[] = []
    let turnIdx = 0
    for (const t of turns) {
      turnIdx++
      if (t.type !== 'assistant' || !t.usage) continue
      const u = t.usage
      const cacheRead = u.cache_read_input_tokens ?? 0
      const cacheWrite = u.cache_creation_input_tokens ?? 0
      const freshInput = u.input_tokens ?? 0
      const occupancy = cacheRead + cacheWrite + freshInput
      out.push({
        turn: turnIdx,
        occupancy,
        cacheRead,
        cacheWrite,
        freshInput,
        output: u.output_tokens ?? 0,
        cost: t.estimated_cost ?? 0,
        model: t.model,
        timestamp: t.timestamp,
        pct: 0, // filled below once we know the limit
      })
    }
    return out
  }, [turns])

  // Context limit: from the model id, but bump to the extended window if any
  // turn's real occupancy already exceeds the standard 200K window.
  const limit = useMemo(() => {
    const fromModel = Math.max(
      200_000,
      ...points.map(p => getContextLimit(p.model)),
    )
    const peak = points.reduce((m, p) => Math.max(m, p.occupancy), 0)
    return peak > fromModel ? 1_000_000 : fromModel
  }, [points])

  const data = useMemo(
    () => points.map(p => ({ ...p, pct: (p.occupancy / limit) * 100 })),
    [points, limit],
  )

  const compactionTurns = useMemo(
    () => new Set(compactions.map(c => c.turn_index)),
    [compactions],
  )

  const peak = useMemo(() => data.reduce((m, p) => Math.max(m, p.occupancy), 0), [data])

  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  // Default the pin to the last turn so the full conversation shows; scrubbing
  // back reveals the window state — and conversation — at an earlier turn.
  const [pinnedIdx, setPinnedIdx] = useState(() => Math.max(0, points.length - 1))

  // Tell the parent which turn is pinned so it can trim the conversation. When
  // pinned to the latest turn, report the full length so trailing non-usage
  // turns stay visible — only scrubbing back trims the conversation.
  const atLatest = pinnedIdx >= data.length - 1
  const pinnedTurn = data[Math.min(pinnedIdx, data.length - 1)]?.turn
  useEffect(() => {
    if (pinnedTurn == null) return
    onSelectTurn?.(atLatest ? turns.length - 1 : pinnedTurn - 1)
  }, [pinnedTurn, atLatest, turns.length, onSelectTurn])

  if (data.length === 0) return null

  const activeIdx = Math.min(hoverIdx ?? pinnedIdx, data.length - 1)
  const active = data[activeIdx]
  const limitColor = active.pct > 90 ? '#dc2626' : active.pct > 75 ? '#d97706' : '#16a34a'
  const free = Math.max(0, limit - active.occupancy)

  // Header fill bar segments (selected turn) vs the whole window.
  const fillSegments = [
    ...SEGMENTS.map(s => ({ ...s, value: active[s.key as 'cacheRead' | 'cacheWrite' | 'freshInput'] })),
    { key: 'free', label: 'Free space', hint: 'Unused context window', color: 'var(--muted)', value: free },
  ]

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Context Window Timeline
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            How full the context window was on each assistant turn — hover to inspect, click to pin
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold tabular-nums leading-none" style={{ color: limitColor }}>
            {active.pct.toFixed(1)}%
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">full</span>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {formatTokens(active.occupancy)} / {formatTokens(limit)}
            {limit >= 1_000_000 && <span className="ml-1 text-emerald-500">· 1M</span>}
          </div>
        </div>
      </div>

      {/* /context-style fill bar for the selected turn */}
      <div className="mb-1.5 flex h-5 overflow-hidden rounded-md border border-border bg-muted">
        {fillSegments.map(s => {
          const w = (s.value / limit) * 100
          if (w <= 0) return null
          return (
            <div
              key={s.key}
              className="h-full transition-all"
              style={{
                width: `${w}%`,
                background: s.key === 'free' ? 'var(--muted)' : s.color,
                opacity: s.key === 'free' ? 1 : 0.85,
              }}
              title={`${s.label}: ${formatTokensExact(s.value)} tokens`}
            />
          )
        })}
      </div>
      <div className="mb-4 flex items-center justify-between text-[11px] text-muted-foreground/70">
        <span>
          Turn {active.turn}
          {active.model && <span className="ml-1.5 font-mono">{active.model.replace(/^claude-/, '')}</span>}
        </span>
        <span className="font-mono">{formatDateTime(active.timestamp)}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        {/* Chart */}
        <div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              onMouseMove={state => {
                if (state?.activeTooltipIndex != null) setHoverIdx(state.activeTooltipIndex as number)
              }}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={state => {
                if (state?.activeTooltipIndex != null) setPinnedIdx(state.activeTooltipIndex as number)
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="turn"
                tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                label={{ value: 'Turn', position: 'insideBottom', offset: -2, fontSize: 9, fill: 'var(--muted-foreground)' }}
              />
              <YAxis
                domain={[0, limit]}
                tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatTokens}
                width={48}
              />

              {/* Auto-compaction zone near the top of the window */}
              <ReferenceArea
                y1={limit * AUTO_COMPACT_FRACTION}
                y2={limit}
                fill="#dc2626"
                fillOpacity={0.06}
                ifOverflow="hidden"
              />
              <ReferenceLine
                y={limit}
                stroke="#dc2626"
                strokeDasharray="2 2"
                label={{ value: 'limit', position: 'right', fontSize: 9, fill: '#dc2626' }}
              />

              {/* Compaction events */}
              {[...compactionTurns].map(idx => (
                <ReferenceLine
                  key={idx}
                  x={idx}
                  stroke="#f59e0b"
                  strokeDasharray="4 2"
                  label={{ value: '⚡', position: 'top', fontSize: 11 }}
                />
              ))}

              {/* Selected turn marker */}
              <ReferenceLine x={active.turn} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />

              {SEGMENTS.map(s => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="ctx"
                  stroke={s.color}
                  strokeWidth={0.5}
                  fill={s.color}
                  fillOpacity={0.55}
                  isAnimationActive={false}
                  activeDot={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend + scrubber */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {SEGMENTS.map(s => (
              <div key={s.key} className="flex items-center gap-1.5" title={s.hint}>
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color, opacity: 0.85 }} />
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: '#f59e0b' }} />
              <span className="text-[11px] text-muted-foreground">Compaction</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#dc2626', opacity: 0.25 }} />
              <span className="text-[11px] text-muted-foreground">Auto-compact zone</span>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={data.length - 1}
            value={pinnedIdx}
            onChange={e => { setPinnedIdx(Number(e.target.value)); setHoverIdx(null) }}
            className="mt-3 w-full accent-[var(--viz-sky)]"
            aria-label="Scrub through turns"
          />
        </div>

        {/* Detail panel for the selected turn */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-foreground">Turn {active.turn}</span>
            <span className="font-mono text-xs text-[#d97706]">{formatCost(active.cost)}</span>
          </div>

          <div className="space-y-2.5">
            {SEGMENTS.map(s => {
              const val = active[s.key as 'cacheRead' | 'cacheWrite' | 'freshInput']
              const segPct = active.occupancy > 0 ? (val / active.occupancy) * 100 : 0
              return (
                <div key={s.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground" title={s.hint}>{s.label}</span>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: s.color }}>
                      {formatTokens(val)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(1, segPct)}%`, background: s.color, opacity: 0.8 }} />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3 text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Window used</span>
              <span className="font-mono font-semibold" style={{ color: limitColor }}>{formatTokensExact(active.occupancy)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Headroom</span>
              <span className="font-mono text-foreground/80">{formatTokens(free)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Output generated</span>
              <span className="font-mono text-foreground/80">{formatTokens(active.output)}</span>
            </div>
          </div>

          <div className="mt-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Peak this session</span>
              <span className="font-mono font-semibold text-foreground/80">
                {formatTokens(peak)} · {((peak / limit) * 100).toFixed(0)}%
              </span>
            </div>
            {compactions.length > 0 && (
              <div className="mt-1 flex items-center justify-between">
                <span>Compactions</span>
                <span className="font-mono font-semibold text-amber-500">{compactions.length}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
