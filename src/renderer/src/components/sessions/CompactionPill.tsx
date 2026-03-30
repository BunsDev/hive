import { memo } from 'react'
import { Minimize2, Loader2 } from 'lucide-react'

interface CompactionPillProps {
  auto: boolean
  status?: 'in-progress' | 'completed'
}

export const CompactionPill = memo(function CompactionPill({ auto, status = 'completed' }: CompactionPillProps) {
  const isInProgress = status === 'in-progress'
  const text = auto
    ? (isInProgress ? 'Auto-compacting context...' : 'Auto-compacted')
    : (isInProgress ? 'Compacting context...' : 'Context compacted')

  return (
    <div className="my-2 flex justify-center" data-testid="compaction-pill">
      <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground text-xs rounded-full px-2 py-0.5">
        {isInProgress ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Minimize2 className="h-3 w-3" />
        )}
        {text}
      </span>
    </div>
  )
})
