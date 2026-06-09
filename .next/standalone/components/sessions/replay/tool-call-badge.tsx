'use client'

import { useState } from 'react'
import Link from 'next/link'
import { categoryColorMix, parseMcpTool, isMcpTool, toolBarColor } from '@/lib/tool-categories'
import type { ToolCall, AgentToolResult } from '@/types/claude'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatTokens, formatDurationMs } from '@/lib/decode'
import {
  Wrench,
  Search,
  Globe,
  ClipboardList,
  CheckCircle2,
  ListTodo,
  Plug,
  Bot,
  ChevronDown,
  ExternalLink,
  Coins,
  Clock,
  type LucideIcon,
} from 'lucide-react'

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function getToolArg(tool: ToolCall): string {
  const inp = tool.input ?? {}
  if (inp.command) return String(inp.command).slice(0, 60)
  if (inp.file_path) return String(inp.file_path).split('/').slice(-2).join('/')
  if (inp.path) return String(inp.path).split('/').slice(-2).join('/')
  if (inp.pattern) return String(inp.pattern).slice(0, 60)
  if (inp.query) return String(inp.query).slice(0, 60)
  if (inp.url) return String(inp.url).slice(0, 60)
  if (inp.description) return String(inp.description).slice(0, 60)
  const keys = Object.keys(inp)
  if (keys.length > 0) return truncate(String(inp[keys[0]]))
  return ''
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Task:          Bot,
  Agent:         Bot,
  WebSearch:     Search,
  WebFetch:      Globe,
  EnterPlanMode: ClipboardList,
  ExitPlanMode:  CheckCircle2,
  TodoWrite:     ListTodo,
}

function ToolIcon({ name, color }: { name: string; color: string }) {
  const Icon = TOOL_ICONS[name] ?? (isMcpTool(name) ? Plug : Wrench)
  return <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" style={{ color }} />
}

interface ToolCallBadgeProps {
  tool: ToolCall
  result?: { content: string; is_error: boolean; agentResult?: AgentToolResult }
  sessionId?: string
}

function AgentCallCard({ tool, agentResult, sessionId }: {
  tool: ToolCall
  agentResult: AgentToolResult
  sessionId?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const description = typeof tool.input?.description === 'string'
    ? tool.input.description
    : typeof tool.input?.prompt === 'string'
      ? tool.input.prompt.slice(0, 120)
      : 'Subagent'

  return (
    <div className="overflow-hidden rounded-lg border border-violet-500/30 bg-violet-500/5 text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Bot className="h-4 w-4 shrink-0 text-violet-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-violet-400 font-mono text-sm">Agent</span>
            <span className="text-xs text-muted-foreground truncate max-w-xs">{description}</span>
          </div>
          {(agentResult.totalTokens || agentResult.totalDurationMs) && (
            <div className="flex items-center gap-3 flex-wrap">
              {agentResult.totalTokens && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                  <Coins className="h-3 w-3" />
                  {formatTokens(agentResult.totalTokens)} tokens
                </span>
              )}
              {agentResult.totalDurationMs && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                  <Clock className="h-3 w-3" />
                  {formatDurationMs(agentResult.totalDurationMs)}
                </span>
              )}
              {agentResult.totalToolUseCount != null && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                  <Wrench className="h-3 w-3" />
                  {agentResult.totalToolUseCount} tool uses
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sessionId && agentResult.agentId && (
            <Link
              href={`/sessions/${sessionId}/subagents/${agentResult.agentId}`}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-violet-400 hover:bg-violet-500/10 hover:text-violet-300 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              View session
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(e => !e)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')} />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-violet-500/20 px-3 py-2.5 space-y-2">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Prompt</p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/50 bg-background/80 p-2 text-xs text-muted-foreground">
              {truncate(typeof tool.input?.prompt === 'string' ? tool.input.prompt : JSON.stringify(tool.input, null, 2), 800)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export function ToolCallBadge({ tool, result, sessionId }: ToolCallBadgeProps) {
  const [expanded, setExpanded] = useState(false)

  // Render a special card for Agent tool calls that have a linked subagent session
  if (tool.name === 'Agent' && result?.agentResult?.agentId) {
    return (
      <AgentCallCard
        tool={tool}
        agentResult={result.agentResult}
        sessionId={sessionId}
      />
    )
  }

  const color = toolBarColor(tool.name)
  const mcp = parseMcpTool(tool.name)
  const arg = getToolArg(tool)
  const displayName = mcp ? `${mcp.server} · ${mcp.tool}` : tool.name

  return (
    <div
      className="overflow-hidden rounded-lg border text-sm font-mono"
      style={{
        borderColor: categoryColorMix(color, 32),
        backgroundColor: categoryColorMix(color, 9),
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setExpanded(e => !e)}
        className={cn(
          'h-auto min-h-8 w-full justify-between gap-2 rounded-none border-0 bg-transparent px-2.5 py-2 text-left shadow-none hover:bg-muted/50',
          'font-mono text-sm'
        )}
        style={{ color: 'var(--foreground)' }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ToolIcon name={tool.name} color={color} />
          <span className="font-bold" style={{ color }}>
            {displayName}
          </span>
          {arg ? <span className="truncate text-muted-foreground">{arg}</span> : null}
          {result?.is_error ? (
            <span className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-red-400">
              Error
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')}
        />
      </Button>
      {expanded && (
        <div className="space-y-2 border-t px-2.5 py-2.5" style={{ borderColor: categoryColorMix(color, 24) }}>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Input</p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/50 bg-background/80 p-2 text-xs text-muted-foreground">
              {truncate(JSON.stringify(tool.input, null, 2), 500)}
            </pre>
          </div>
          {result && (
            <div>
              <p
                className={cn(
                  'mb-1 text-[11px] font-medium uppercase tracking-wide',
                  result.is_error ? 'text-red-400' : 'text-muted-foreground/70'
                )}
              >
                {result.is_error ? 'Error' : 'Result'}
              </p>
              <pre
                className={cn(
                  'max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 text-xs',
                  result.is_error
                    ? 'border-red-500/25 bg-red-950/20 text-red-200/90'
                    : 'border-border/50 bg-background/80 text-muted-foreground'
                )}
              >
                {truncate(result.content, 500)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
