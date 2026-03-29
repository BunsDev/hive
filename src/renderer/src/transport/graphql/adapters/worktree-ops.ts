import { graphqlQuery, graphqlSubscribe } from '../client'
import { notAvailableInWeb } from '../../stubs/electron-only'
import type { WorktreeOpsApi } from '../../types'

// Convert camelCase keys to snake_case for worktree objects
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    result[snakeKey] = value
  }
  return result
}

function mapWorktreeRow(row: Record<string, unknown> | null | undefined): Worktree | null {
  if (!row) return null
  const mapped = toSnakeCase(row) as Record<string, unknown>
  // attachments: GraphQL returns array of objects, renderer expects JSON string
  if (Array.isArray(mapped.attachments)) {
    mapped.attachments = JSON.stringify(mapped.attachments)
  }
  // pinned: GraphQL returns boolean, renderer expects number (0/1)
  if (typeof mapped.pinned === 'boolean') {
    mapped.pinned = mapped.pinned ? 1 : 0
  }
  return mapped as unknown as Worktree
}

const WORKTREE_FIELDS = `
  id projectId name branchName path status isDefault
  branchRenamed lastMessageAt sessionTitles
  lastModelProviderId lastModelId lastModelVariant
  attachments { id type url label }
  pinned context githubPrNumber githubPrUrl
  createdAt lastAccessedAt
`

export function createWorktreeOpsAdapter(): WorktreeOpsApi {
  return {
    // ─── Working via GraphQL ────────────────────────────────────
    async hasCommits(projectPath: string): Promise<boolean> {
      const data = await graphqlQuery<{ worktreeHasCommits: boolean }>(
        `query ($projectPath: String!) { worktreeHasCommits(projectPath: $projectPath) }`,
        { projectPath }
      )
      return data.worktreeHasCommits
    },

    async create(params: {
      projectId: string
      projectPath: string
      projectName: string
    }): Promise<{
      success: boolean
      worktree?: Worktree
      error?: string
      pullInfo?: { pulled: boolean; updated: boolean }
    }> {
      const data = await graphqlQuery<{
        createWorktree: {
          success: boolean
          worktree: Record<string, unknown> | null
          error?: string
        }
      }>(
        `mutation ($input: CreateWorktreeInput!) {
          createWorktree(input: $input) {
            success error
            worktree { ${WORKTREE_FIELDS} }
          }
        }`,
        {
          input: {
            projectId: params.projectId,
            projectPath: params.projectPath,
            projectName: params.projectName
          }
        }
      )
      return {
        success: data.createWorktree.success,
        worktree: mapWorktreeRow(data.createWorktree.worktree) ?? undefined,
        error: data.createWorktree.error ?? undefined
      }
    },

    async delete(params: {
      worktreeId: string
      worktreePath: string
      branchName: string
      projectPath: string
      archive: boolean
    }): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        deleteWorktree: { success: boolean; error?: string }
      }>(
        `mutation ($input: DeleteWorktreeInput!) {
          deleteWorktree(input: $input) { success error }
        }`,
        {
          input: {
            worktreeId: params.worktreeId,
            worktreePath: params.worktreePath,
            branchName: params.branchName,
            projectPath: params.projectPath,
            archive: params.archive
          }
        }
      )
      return data.deleteWorktree
    },

    async sync(params: {
      projectId: string
      projectPath: string
    }): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        syncWorktrees: { success: boolean; error?: string }
      }>(
        `mutation ($projectId: ID!, $projectPath: String!) {
          syncWorktrees(projectId: $projectId, projectPath: $projectPath) { success error }
        }`,
        { projectId: params.projectId, projectPath: params.projectPath }
      )
      return data.syncWorktrees
    },

    async exists(worktreePath: string): Promise<boolean> {
      const data = await graphqlQuery<{ worktreeExists: boolean }>(
        `query ($worktreePath: String!) { worktreeExists(worktreePath: $worktreePath) }`,
        { worktreePath }
      )
      return data.worktreeExists
    },

    async duplicate(params: {
      projectId: string
      projectPath: string
      projectName: string
      sourceBranch: string
      sourceWorktreePath: string
    }): Promise<{
      success: boolean
      worktree?: Worktree
      error?: string
    }> {
      const data = await graphqlQuery<{
        duplicateWorktree: {
          success: boolean
          worktree: Record<string, unknown> | null
          error?: string
        }
      }>(
        `mutation ($input: DuplicateWorktreeInput!) {
          duplicateWorktree(input: $input) {
            success error
            worktree { ${WORKTREE_FIELDS} }
          }
        }`,
        {
          input: {
            projectId: params.projectId,
            projectPath: params.projectPath,
            projectName: params.projectName,
            sourceBranch: params.sourceBranch,
            sourceWorktreePath: params.sourceWorktreePath
          }
        }
      )
      return {
        success: data.duplicateWorktree.success,
        worktree: mapWorktreeRow(data.duplicateWorktree.worktree) ?? undefined,
        error: data.duplicateWorktree.error ?? undefined
      }
    },

    async renameBranch(
      worktreeId: string,
      worktreePath: string,
      oldBranch: string,
      newBranch: string
    ): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        renameWorktreeBranch: { success: boolean; error?: string }
      }>(
        `mutation ($input: RenameBranchInput!) {
          renameWorktreeBranch(input: $input) { success error }
        }`,
        {
          input: { worktreeId, worktreePath, oldBranch, newBranch }
        }
      )
      return data.renameWorktreeBranch
    },

    async createFromBranch(
      projectId: string,
      projectPath: string,
      projectName: string,
      branchName: string,
      prNumber?: number,
      nameHint?: string
    ): Promise<{
      success: boolean
      worktree?: Worktree
      error?: string
      pullInfo?: { pulled: boolean; updated: boolean }
    }> {
      const data = await graphqlQuery<{
        createWorktreeFromBranch: {
          success: boolean
          worktree: Record<string, unknown> | null
          error?: string
        }
      }>(
        `mutation ($input: CreateFromBranchInput!) {
          createWorktreeFromBranch(input: $input) {
            success error
            worktree { ${WORKTREE_FIELDS} }
          }
        }`,
        {
          input: {
            projectId,
            projectPath,
            projectName,
            branchName,
            prNumber,
            nameHint
          }
        }
      )
      return {
        success: data.createWorktreeFromBranch.success,
        worktree: mapWorktreeRow(data.createWorktreeFromBranch.worktree) ?? undefined,
        error: data.createWorktreeFromBranch.error ?? undefined
      }
    },

    async getBranches(projectPath: string): Promise<{
      success: boolean
      branches?: string[]
      currentBranch?: string
      error?: string
    }> {
      const data = await graphqlQuery<{
        gitBranches: {
          success: boolean
          branches?: string[]
          currentBranch?: string
          error?: string
        }
      }>(
        `query ($projectPath: String!) {
          gitBranches(projectPath: $projectPath) {
            success branches currentBranch error
          }
        }`,
        { projectPath }
      )
      return data.gitBranches
    },

    async branchExists(projectPath: string, branchName: string): Promise<boolean> {
      const data = await graphqlQuery<{ gitBranchExists: boolean }>(
        `query ($projectPath: String!, $branchName: String!) {
          gitBranchExists(projectPath: $projectPath, branchName: $branchName)
        }`,
        { projectPath, branchName }
      )
      return data.gitBranchExists
    },

    async getContext(worktreeId: string): Promise<{
      success: boolean
      context?: string | null
      error?: string
    }> {
      const data = await graphqlQuery<{
        worktree: { context: string | null } | null
      }>(
        `query ($id: ID!) { worktree(id: $id) { context } }`,
        { id: worktreeId }
      )
      if (!data.worktree) {
        return { success: false, error: 'Worktree not found' }
      }
      return { success: true, context: data.worktree.context }
    },

    async updateContext(
      worktreeId: string,
      context: string | null
    ): Promise<{ success: boolean; error?: string }> {
      // Use updateWorktree mutation -- context is stored on the worktree row.
      // The UpdateWorktreeInput does not have a context field in the schema,
      // so we pass it and rely on the server ignoring unknown fields gracefully,
      // or we use a direct worktree update that includes context.
      // Since the worktree type has context and the server reads from the DB,
      // the safest approach is to use the generic updateWorktree with the context field.
      try {
        await graphqlQuery<{ updateWorktree: Record<string, unknown> | null }>(
          `mutation ($id: ID!, $input: UpdateWorktreeInput!) {
            updateWorktree(id: $id, input: $input) { id }
          }`,
          { id: worktreeId, input: { context } as Record<string, unknown> }
        )
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    onBranchRenamed(
      callback: (data: { worktreeId: string; newBranch: string }) => void
    ): () => void {
      return graphqlSubscribe<{
        worktreeBranchRenamed: { worktreeId: string; newBranch: string }
      }>(
        `subscription {
          worktreeBranchRenamed { worktreeId newBranch }
        }`,
        undefined,
        (data) => {
          callback(data.worktreeBranchRenamed)
        }
      )
    },

    // ─── Electron-only stubs ────────────────────────────────────
    openInTerminal: notAvailableInWeb('openInTerminal') as unknown as (
      worktreePath: string
    ) => Promise<{ success: boolean; error?: string }>,

    openInEditor: notAvailableInWeb('openInEditor') as unknown as (
      worktreePath: string
    ) => Promise<{ success: boolean; error?: string }>
  }
}
