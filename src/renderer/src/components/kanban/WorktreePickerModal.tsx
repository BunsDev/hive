import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Hammer, Map, Plus, GitBranch, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { toast } from '@/lib/toast'
import type { KanbanTicket } from '../../../../main/db/types'

// ── Types ───────────────────────────────────────────────────────────
type PickerMode = 'build' | 'plan'

interface WorktreePickerModalProps {
  ticket: KanbanTicket
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful send to complete the column move */
  onSendComplete?: () => void
}

// ── Prompt template builders ────────────────────────────────────────
function buildPrompt(mode: PickerMode, ticket: KanbanTicket): string {
  const prefix =
    mode === 'build'
      ? 'Please implement the following ticket.'
      : 'Please review the following ticket and create a detailed implementation plan.'

  const description = ticket.description ?? ''
  return `${prefix}\n\n<ticket title="${ticket.title}">${description}</ticket>`
}

// ── Component ───────────────────────────────────────────────────────
export function WorktreePickerModal({
  ticket,
  projectId,
  open,
  onOpenChange,
  onSendComplete
}: WorktreePickerModalProps) {
  const [mode, setMode] = useState<PickerMode>('build')
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null)
  const [isNewWorktree, setIsNewWorktree] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // ── Store access ────────────────────────────────────────────────
  const worktrees = useWorktreeStore(
    useCallback(
      (state) => state.worktreesByProject.get(projectId) ?? [],
      [projectId]
    )
  )

  const ticketsForProject = useKanbanStore(
    useCallback(
      (state) => state.tickets.get(projectId) ?? [],
      [projectId]
    )
  )

  const updateTicket = useKanbanStore((state) => state.updateTicket)
  const createSession = useSessionStore((state) => state.createSession)
  const setPendingMessage = useSessionStore((state) => state.setPendingMessage)
  const createWorktree = useWorktreeStore((state) => state.createWorktree)
  const selectWorktree = useWorktreeStore((state) => state.selectWorktree)

  const project = useProjectStore(
    useCallback(
      (state) => state.projects.find((p) => p.id === projectId) ?? null,
      [projectId]
    )
  )

  // ── Count in-progress tickets per worktree ──────────────────────
  const ticketCountByWorktree = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of ticketsForProject) {
      if (t.column === 'in_progress' && t.worktree_id) {
        counts[t.worktree_id] = (counts[t.worktree_id] || 0) + 1
      }
    }
    return counts
  }, [ticketsForProject])

  // ── Reset state when modal opens ────────────────────────────────
  useEffect(() => {
    if (open) {
      setMode('build')
      setSelectedWorktreeId(null)
      setIsNewWorktree(false)
      setPromptText(buildPrompt('build', ticket))
      setIsSending(false)
    }
  }, [open, ticket])

  // ── Handle mode toggle ──────────────────────────────────────────
  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'build' ? 'plan' : 'build'
      setPromptText(buildPrompt(next, ticket))
      return next
    })
  }, [ticket])

  // ── Handle Tab key for mode toggle ──────────────────────────────
  // Must use window-level capture-phase listener to beat SessionView's
  // global Tab handler which also uses capture and stops propagation.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        toggleMode()
      }
    }
    window.addEventListener('keydown', handler, true) // capture phase
    return () => {
      window.removeEventListener('keydown', handler, true)
    }
  }, [open, toggleMode])

  // Keep React keydown for test compatibility (jsdom doesn't have capture-phase issues)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        toggleMode()
      }
    },
    [toggleMode]
  )

  // ── Handle worktree selection ───────────────────────────────────
  const handleSelectWorktree = useCallback((wtId: string) => {
    setSelectedWorktreeId(wtId)
    setIsNewWorktree(false)
  }, [])

  const handleSelectNewWorktree = useCallback(() => {
    setSelectedWorktreeId(null)
    setIsNewWorktree(true)
  }, [])

  // ── Send flow ───────────────────────────────────────────────────
  const canSend = (selectedWorktreeId !== null || isNewWorktree) && !isSending

  const handleSend = useCallback(async () => {
    if (!canSend) return
    setIsSending(true)

    try {
      let worktreeId = selectedWorktreeId

      // Create new worktree if needed
      if (isNewWorktree && project) {
        const result = await createWorktree(projectId, project.path, project.name)
        if (!result.success || !result.worktree?.id) {
          toast.error(result.error || 'Failed to create worktree')
          setIsSending(false)
          return
        }
        worktreeId = result.worktree.id
      }

      if (!worktreeId) {
        toast.error('No worktree selected')
        setIsSending(false)
        return
      }

      // Create session in the selected worktree
      const sessionResult = await createSession(worktreeId, projectId, undefined, mode)

      if (!sessionResult.success || !sessionResult.session) {
        toast.error(sessionResult.error || 'Failed to create session')
        setIsSending(false)
        return
      }

      // Set the prompt as a pending message for the session
      if (promptText.trim()) {
        setPendingMessage(sessionResult.session.id, promptText.trim())
      }

      // Update the ticket with session info and move to in_progress
      const sortOrder = useKanbanStore
        .getState()
        .computeSortOrder(
          useKanbanStore.getState().getTicketsByColumn(projectId, 'in_progress'),
          0
        )

      await updateTicket(ticket.id, projectId, {
        current_session_id: sessionResult.session.id,
        worktree_id: worktreeId,
        mode,
        column: 'in_progress',
        sort_order: sortOrder
      })

      // Select the worktree in sidebar
      selectWorktree(worktreeId)

      // Notify parent and close
      onSendComplete?.()
      onOpenChange(false)
      toast.success('Session started')
    } catch {
      toast.error('Failed to start session')
    } finally {
      setIsSending(false)
    }
  }, [
    canSend,
    selectedWorktreeId,
    isNewWorktree,
    project,
    createWorktree,
    projectId,
    createSession,
    mode,
    promptText,
    setPendingMessage,
    updateTicket,
    ticket.id,
    selectWorktree,
    onSendComplete,
    onOpenChange
  ])

  // ── Mode toggle chip ────────────────────────────────────────────
  const ModeIcon = mode === 'build' ? Hammer : Map
  const modeLabel = mode === 'build' ? 'Build' : 'Plan'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="worktree-picker-modal"
        className="sm:max-w-lg"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Start Session
            {/* Build/Plan chip toggle */}
            <button
              data-testid="wt-picker-mode-toggle"
              data-mode={mode}
              type="button"
              onClick={toggleMode}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
                'border select-none',
                mode === 'build'
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20'
                  : 'bg-violet-500/10 border-violet-500/30 text-violet-500 hover:bg-violet-500/20'
              )}
              title={`${modeLabel} mode (Tab to toggle)`}
              aria-label={`Current mode: ${modeLabel}. Click or Tab to switch`}
            >
              <ModeIcon className="h-3 w-3" aria-hidden="true" />
              <span>{modeLabel}</span>
            </button>
          </DialogTitle>
          <DialogDescription>
            Pick a worktree for{' '}
            <span className="font-medium text-foreground">{ticket.title}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Worktree list ──────────────────────────────────── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Worktree
            </label>
            <div
              data-testid="worktree-list"
              className="max-h-[180px] overflow-y-auto rounded-md border border-border/60"
            >
              {/* "New worktree" option — always at top */}
              <button
                data-testid="worktree-item-new"
                type="button"
                onClick={handleSelectNewWorktree}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                  'border-b border-border/40',
                  'hover:bg-muted/30',
                  isNewWorktree && 'bg-primary/8 ring-1 ring-inset ring-primary/20'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                    'bg-primary/10 text-primary'
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                </span>
                <span className="font-medium text-foreground">New worktree</span>
              </button>

              {/* Existing worktrees */}
              {worktrees.map((wt) => {
                const count = ticketCountByWorktree[wt.id] || 0
                const isSelected = selectedWorktreeId === wt.id

                return (
                  <button
                    key={wt.id}
                    data-testid={`worktree-item-${wt.id}`}
                    type="button"
                    onClick={() => handleSelectWorktree(wt.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                      'border-b border-border/40 last:border-b-0',
                      'hover:bg-muted/30',
                      isSelected && 'bg-primary/8 ring-1 ring-inset ring-primary/20'
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate text-left font-medium text-foreground">
                      {wt.name}
                    </span>
                    {wt.is_default && (
                      <span className="rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        default
                      </span>
                    )}
                    {count > 0 && (
                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-500/10 px-1.5 text-[11px] font-medium text-blue-500">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Prompt preview / editor ────────────────────────── */}
          <div className="space-y-1.5">
            <label
              htmlFor="wt-picker-prompt-input"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              Prompt
            </label>
            <Textarea
              id="wt-picker-prompt-input"
              ref={promptRef}
              data-testid="wt-picker-prompt"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={6}
              className="resize-y font-mono text-xs leading-relaxed"
              placeholder="Enter prompt for the session..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="wt-picker-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="wt-picker-send-btn"
            disabled={!canSend}
            onClick={handleSend}
            className={cn(
              'gap-1.5',
              mode === 'build'
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-violet-600 hover:bg-violet-700 text-white'
            )}
          >
            <Send className="h-3.5 w-3.5" />
            {isSending ? 'Starting...' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
