import { memo, useCallback, useMemo, useState } from 'react'
import { Paperclip, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/useSessionStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { setKanbanDragData } from '@/stores/useKanbanStore'
import type { KanbanTicket } from '../../../../main/db/types'

// ── Pulsing border keyframes (injected once) ────────────────────────
const STYLE_ID = 'kanban-pulse-keyframes'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes kanban-border-pulse {
      0%, 100% { box-shadow: 0 0 0 1px var(--pulse-color), 0 0 4px 0 var(--pulse-color); opacity: 1; }
      50% { box-shadow: 0 0 0 1px var(--pulse-color), 0 0 10px 2px var(--pulse-color); opacity: 0.7; }
    }
  `
  document.head.appendChild(style)
}

interface KanbanTicketCardProps {
  ticket: KanbanTicket
  /** Position index within the column (used for drag transfer data) */
  index?: number
}

export const KanbanTicketCard = memo(function KanbanTicketCard({
  ticket,
  index = 0
}: KanbanTicketCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  // ── Lookup worktree name ────────────────────────────────────────
  const worktreeName = useWorktreeStore(
    useCallback(
      (state) => {
        if (!ticket.worktree_id) return null
        for (const worktrees of state.worktreesByProject.values()) {
          const found = worktrees.find((w) => w.id === ticket.worktree_id)
          if (found) return found.name
        }
        return null
      },
      [ticket.worktree_id]
    )
  )

  // ── Lookup linked session status ────────────────────────────────
  const sessionStatus = useSessionStore(
    useCallback(
      (state) => {
        if (!ticket.current_session_id) return null
        for (const sessions of state.sessionsByWorktree.values()) {
          const found = sessions.find((s) => s.id === ticket.current_session_id)
          if (found) return found.status
        }
        for (const sessions of state.sessionsByConnection.values()) {
          const found = sessions.find((s) => s.id === ticket.current_session_id)
          if (found) return found.status
        }
        return null
      },
      [ticket.current_session_id]
    )
  )

  const isActive = sessionStatus === 'active'
  const isError = sessionStatus === 'error'
  const hasAttachments = ticket.attachments.length > 0

  // ── Border state computation ────────────────────────────────────
  const borderState = useMemo(() => {
    if (isActive && ticket.mode === 'build') return 'pulse-blue'
    if (isActive && ticket.mode === 'plan') return 'pulse-violet'
    if (ticket.plan_ready) return 'static-violet'
    return 'default'
  }, [isActive, ticket.mode, ticket.plan_ready])

  // ── Drag handlers ──────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // Store drag data in module-level state (reliable across Electron)
      const dragPayload = {
        ticketId: ticket.id,
        sourceColumn: ticket.column,
        sourceIndex: index
      }
      setKanbanDragData(dragPayload)
      // Also set DataTransfer for native drag feedback (ghost image, cursor)
      e.dataTransfer.setData('text/plain', ticket.id)
      e.dataTransfer.effectAllowed = 'move'
      setIsDragging(true)
    },
    [ticket.id, ticket.column, index]
  )

  const handleDragEnd = useCallback(() => {
    setKanbanDragData(null)
    setIsDragging(false)
  }, [])

  // ── Click handler (stub for future modal) ───────────────────────
  const handleClick = useCallback(() => {
    // Future: open ticket detail modal
  }, [])

  return (
    <div
      data-testid={`kanban-ticket-${ticket.id}`}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      className={cn(
        'group cursor-pointer rounded-md border bg-muted/15 p-3 transition-all duration-200',
        'hover:bg-muted/30',
        isDragging && 'opacity-50',
        borderState === 'default' && 'border-border/60',
        borderState === 'static-violet' && 'border-violet-500/60',
        borderState === 'pulse-blue' && 'border-blue-500/60',
        borderState === 'pulse-violet' && 'border-violet-500/60'
      )}
      style={
        borderState === 'pulse-blue'
          ? ({
              '--pulse-color': 'rgb(59 130 246 / 0.5)',
              animation: 'kanban-border-pulse 2s ease-in-out infinite'
            } as React.CSSProperties)
          : borderState === 'pulse-violet'
            ? ({
                '--pulse-color': 'rgb(139 92 246 / 0.5)',
                animation: 'kanban-border-pulse 2s ease-in-out infinite'
              } as React.CSSProperties)
            : undefined
      }
    >
      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">{ticket.title}</p>

      {/* Badges row */}
      {(hasAttachments || worktreeName || ticket.plan_ready || isError) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {/* Attachment badge */}
          {hasAttachments && (
            <span
              data-testid="kanban-ticket-attachments"
              className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              <Paperclip className="h-3 w-3" />
              {ticket.attachments.length}
            </span>
          )}

          {/* Worktree name badge */}
          {worktreeName && (
            <span className="inline-flex items-center rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {worktreeName}
            </span>
          )}

          {/* Plan ready badge */}
          {ticket.plan_ready && (
            <span className="inline-flex items-center rounded-full bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 text-[11px] font-medium text-violet-500">
              Plan ready
            </span>
          )}

          {/* Error badge */}
          {isError && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/30 px-2 py-0.5 text-[11px] font-medium text-red-500">
              <AlertCircle className="h-3 w-3" />
              Error
            </span>
          )}
        </div>
      )}
    </div>
  )
})
