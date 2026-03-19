import { cn } from '@/lib/utils'
import { usePRCommentStore } from '@/stores/usePRCommentStore'
import { MarkdownRenderer } from '@/components/sessions/MarkdownRenderer'
import type { PRReviewComment, PRReviewThread } from '@shared/types/pr-comment'

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths}mo ago`
}

interface CommentBodyProps {
  comment: PRReviewComment
  isRoot?: boolean
}

function CommentBody({ comment, isRoot }: CommentBodyProps): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <img
          src={comment.author_avatar_url}
          alt={comment.author_login}
          className="w-4 h-4 rounded-full flex-shrink-0"
        />
        <span className="text-xs font-medium truncate">{comment.author_login}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {formatRelativeTime(comment.created_at)}
        </span>
        {isRoot && comment.is_outdated && (
          <span className="text-[10px] px-1.5 py-0 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30 flex-shrink-0">
            Outdated
          </span>
        )}
      </div>
      {isRoot && comment.diff_hunk && (
        <pre className="text-xs bg-muted/50 rounded px-2 py-1.5 mb-1.5 overflow-x-auto max-h-24 font-mono leading-tight">
          {comment.diff_hunk}
        </pre>
      )}
      {isRoot && (
        <div className="text-xs text-muted-foreground mb-1">
          {comment.path}
          {comment.line !== null && `:${comment.line}`}
        </div>
      )}
      <div className="text-sm prose-sm max-w-none">
        <MarkdownRenderer content={comment.body} />
      </div>
    </div>
  )
}

interface PRCommentThreadProps {
  thread: PRReviewThread
}

export function PRCommentThreadView({ thread }: PRCommentThreadProps): React.JSX.Element {
  const selectedThreadIds = usePRCommentStore((s) => s.selectedThreadIds)
  const toggleThreadSelection = usePRCommentStore((s) => s.toggleThreadSelection)
  const isSelected = selectedThreadIds.has(thread.rootComment.id)

  return (
    <div
      className={cn(
        'border-b border-border last:border-b-0 py-2 px-3',
        isSelected && 'bg-primary/5'
      )}
    >
      {/* Root comment with checkbox */}
      <div className="flex gap-2">
        <div className="flex-shrink-0 pt-0.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleThreadSelection(thread.rootComment.id)}
            className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-primary"
          />
        </div>
        <CommentBody comment={thread.rootComment} isRoot />
      </div>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="ml-6 mt-1.5 pl-3 border-l-2 border-border space-y-2">
          {thread.replies.map((reply) => (
            <CommentBody key={reply.id} comment={reply} />
          ))}
        </div>
      )}
    </div>
  )
}
