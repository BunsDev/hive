import { graphqlQuery } from '../client'
import type { DbApi } from '../../types'

// Convert camelCase keys to snake_case for DB entity objects
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    result[snakeKey] = value
  }
  return result
}

function mapRow<T>(row: Record<string, unknown> | null | undefined): T | null {
  if (!row) return null
  return toSnakeCase(row) as T
}

function mapRows<T>(rows: Record<string, unknown>[] | null | undefined): T[] {
  if (!rows) return []
  return rows.map((r) => toSnakeCase(r) as T)
}

// --- GraphQL field fragments ---

const PROJECT_FIELDS = `
  id name path description tags language customIcon
  setupScript runScript archiveScript autoAssignPort
  sortOrder createdAt lastAccessedAt
`

const WORKTREE_FIELDS = `
  id projectId name branchName path status isDefault
  branchRenamed lastMessageAt sessionTitles
  lastModelProviderId lastModelId lastModelVariant
  attachments { id type url label }
  pinned context githubPrNumber githubPrUrl
  createdAt lastAccessedAt
`

const SESSION_FIELDS = `
  id worktreeId projectId connectionId name status
  opencodeSessionId agentSdk mode
  modelProviderId modelId modelVariant
  createdAt updatedAt completedAt
`

const SESSION_WITH_WORKTREE_FIELDS = `
  ${SESSION_FIELDS}
  worktreeName worktreeBranchName projectName
`

const SPACE_FIELDS = `id name iconType iconValue sortOrder createdAt`

// Worktree rows need special handling: attachments come as array of objects from GraphQL
// but the renderer expects a JSON string, and pinned comes as boolean but renderer expects number
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
  // is_default: GraphQL returns boolean, renderer expects boolean (this is fine)
  return mapped as unknown as Worktree
}

function mapWorktreeRows(rows: Record<string, unknown>[] | null | undefined): Worktree[] {
  if (!rows) return []
  return rows.map((r) => mapWorktreeRow(r)!).filter(Boolean)
}

// Session rows: agentSdk enum uses underscore in GraphQL (claude_code) but renderer expects hyphen (claude-code)
function mapSessionRow(row: Record<string, unknown> | null | undefined): Session | null {
  if (!row) return null
  const mapped = toSnakeCase(row) as Record<string, unknown>
  // Map GraphQL enum value claude_code -> claude-code
  if (mapped.agent_sdk === 'claude_code') {
    mapped.agent_sdk = 'claude-code'
  }
  return mapped as unknown as Session
}

function mapSessionRows(rows: Record<string, unknown>[] | null | undefined): Session[] {
  if (!rows) return []
  return rows.map((r) => mapSessionRow(r)!).filter(Boolean)
}

function mapSessionWithWorktreeRow(
  row: Record<string, unknown> | null | undefined
): SessionWithWorktree | null {
  if (!row) return null
  const mapped = toSnakeCase(row) as Record<string, unknown>
  if (mapped.agent_sdk === 'claude_code') {
    mapped.agent_sdk = 'claude-code'
  }
  return mapped as unknown as SessionWithWorktree
}

function mapSessionWithWorktreeRows(
  rows: Record<string, unknown>[] | null | undefined
): SessionWithWorktree[] {
  if (!rows) return []
  return rows.map((r) => mapSessionWithWorktreeRow(r)!).filter(Boolean)
}

// Map agentSdk for session create/update input: hyphenated to underscore for GraphQL enum
function mapAgentSdkToEnum(
  sdk?: string | null
): string | undefined {
  if (!sdk) return undefined
  if (sdk === 'claude-code') return 'claude_code'
  return sdk
}

export function createDbAdapter(): DbApi {
  return {
    // ─── Settings ───────────────────────────────────────────────
    setting: {
      async get(key: string): Promise<string | null> {
        const data = await graphqlQuery<{ setting: string | null }>(
          `query ($key: String!) { setting(key: $key) }`,
          { key }
        )
        return data.setting
      },

      async set(key: string, value: string): Promise<boolean> {
        const data = await graphqlQuery<{ setSetting: boolean }>(
          `mutation ($key: String!, $value: String!) { setSetting(key: $key, value: $value) }`,
          { key, value }
        )
        return data.setSetting
      },

      async delete(key: string): Promise<boolean> {
        const data = await graphqlQuery<{ deleteSetting: boolean }>(
          `mutation ($key: String!) { deleteSetting(key: $key) }`,
          { key }
        )
        return data.deleteSetting
      },

      async getAll(): Promise<Setting[]> {
        const data = await graphqlQuery<{ allSettings: { key: string; value: string }[] }>(
          `query { allSettings { key value } }`
        )
        return data.allSettings
      }
    },

    // ─── Projects ───────────────────────────────────────────────
    project: {
      async create(input: {
        name: string
        path: string
        description?: string | null
        tags?: string[] | null
      }): Promise<Project> {
        const data = await graphqlQuery<{ createProject: Record<string, unknown> }>(
          `mutation ($input: CreateProjectInput!) {
            createProject(input: $input) { ${PROJECT_FIELDS} }
          }`,
          { input: { name: input.name, path: input.path, description: input.description, tags: input.tags } }
        )
        return mapRow<Project>(data.createProject)!
      },

      async get(id: string): Promise<Project | null> {
        const data = await graphqlQuery<{ project: Record<string, unknown> | null }>(
          `query ($id: ID!) { project(id: $id) { ${PROJECT_FIELDS} } }`,
          { id }
        )
        return mapRow<Project>(data.project)
      },

      async getByPath(path: string): Promise<Project | null> {
        const data = await graphqlQuery<{ projectByPath: Record<string, unknown> | null }>(
          `query ($path: String!) { projectByPath(path: $path) { ${PROJECT_FIELDS} } }`,
          { path }
        )
        return mapRow<Project>(data.projectByPath)
      },

      async getAll(): Promise<Project[]> {
        const data = await graphqlQuery<{ projects: Record<string, unknown>[] }>(
          `query { projects { ${PROJECT_FIELDS} } }`
        )
        return mapRows<Project>(data.projects)
      },

      async update(
        id: string,
        updateData: {
          name?: string
          description?: string | null
          tags?: string[] | null
          language?: string | null
          custom_icon?: string | null
          setup_script?: string | null
          run_script?: string | null
          archive_script?: string | null
          auto_assign_port?: boolean
          last_accessed_at?: string
        }
      ): Promise<Project | null> {
        // Convert snake_case input to camelCase for GraphQL
        const input: Record<string, unknown> = {}
        if (updateData.name !== undefined) input.name = updateData.name
        if (updateData.description !== undefined) input.description = updateData.description
        if (updateData.tags !== undefined) input.tags = updateData.tags
        if (updateData.language !== undefined) input.language = updateData.language
        if (updateData.custom_icon !== undefined) input.customIcon = updateData.custom_icon
        if (updateData.setup_script !== undefined) input.setupScript = updateData.setup_script
        if (updateData.run_script !== undefined) input.runScript = updateData.run_script
        if (updateData.archive_script !== undefined) input.archiveScript = updateData.archive_script
        if (updateData.auto_assign_port !== undefined) input.autoAssignPort = updateData.auto_assign_port
        if (updateData.last_accessed_at !== undefined) input.lastAccessedAt = updateData.last_accessed_at

        const data = await graphqlQuery<{ updateProject: Record<string, unknown> | null }>(
          `mutation ($id: ID!, $input: UpdateProjectInput!) {
            updateProject(id: $id, input: $input) { ${PROJECT_FIELDS} }
          }`,
          { id, input }
        )
        return mapRow<Project>(data.updateProject)
      },

      async delete(id: string): Promise<boolean> {
        const data = await graphqlQuery<{ deleteProject: boolean }>(
          `mutation ($id: ID!) { deleteProject(id: $id) }`,
          { id }
        )
        return data.deleteProject
      },

      async touch(id: string): Promise<boolean> {
        const data = await graphqlQuery<{ touchProject: boolean }>(
          `mutation ($id: ID!) { touchProject(id: $id) }`,
          { id }
        )
        return data.touchProject
      },

      async reorder(orderedIds: string[]): Promise<boolean> {
        const data = await graphqlQuery<{ reorderProjects: boolean }>(
          `mutation ($orderedIds: [ID!]!) { reorderProjects(orderedIds: $orderedIds) }`,
          { orderedIds }
        )
        return data.reorderProjects
      },

      async sortByLastMessage(): Promise<string[]> {
        const data = await graphqlQuery<{ projectIdsSortedByLastMessage: string[] }>(
          `query { projectIdsSortedByLastMessage }`
        )
        return data.projectIdsSortedByLastMessage
      }
    },

    // ─── Worktrees ──────────────────────────────────────────────
    worktree: {
      async create(input: {
        project_id: string
        name: string
        branch_name: string
        path: string
      }): Promise<Worktree> {
        // The IPC interface takes {project_id, name, branch_name, path} but the GraphQL
        // createWorktree mutation takes CreateWorktreeInput {projectId, projectPath, projectName}.
        // We need to look up the project to get projectPath and projectName, then call the mutation.
        // However, we can use the project_id to get the project first.
        const projectData = await graphqlQuery<{ project: Record<string, unknown> | null }>(
          `query ($id: ID!) { project(id: $id) { path name } }`,
          { id: input.project_id }
        )
        const project = projectData.project
        if (!project) throw new Error('Project not found')

        const data = await graphqlQuery<{
          createWorktree: { success: boolean; worktree: Record<string, unknown> | null; error?: string }
        }>(
          `mutation ($input: CreateWorktreeInput!) {
            createWorktree(input: $input) {
              success error
              worktree { ${WORKTREE_FIELDS} }
            }
          }`,
          {
            input: {
              projectId: input.project_id,
              projectPath: project.path,
              projectName: project.name
            }
          }
        )
        if (!data.createWorktree.success || !data.createWorktree.worktree) {
          throw new Error(data.createWorktree.error || 'Failed to create worktree')
        }
        return mapWorktreeRow(data.createWorktree.worktree)!
      },

      async get(id: string): Promise<Worktree | null> {
        const data = await graphqlQuery<{ worktree: Record<string, unknown> | null }>(
          `query ($id: ID!) { worktree(id: $id) { ${WORKTREE_FIELDS} } }`,
          { id }
        )
        return mapWorktreeRow(data.worktree)
      },

      async getByProject(projectId: string): Promise<Worktree[]> {
        const data = await graphqlQuery<{ worktreesByProject: Record<string, unknown>[] }>(
          `query ($projectId: ID!) { worktreesByProject(projectId: $projectId) { ${WORKTREE_FIELDS} } }`,
          { projectId }
        )
        return mapWorktreeRows(data.worktreesByProject)
      },

      async getActiveByProject(projectId: string): Promise<Worktree[]> {
        const data = await graphqlQuery<{ activeWorktreesByProject: Record<string, unknown>[] }>(
          `query ($projectId: ID!) { activeWorktreesByProject(projectId: $projectId) { ${WORKTREE_FIELDS} } }`,
          { projectId }
        )
        return mapWorktreeRows(data.activeWorktreesByProject)
      },

      async getRecentlyActive(cutoffMs: number): Promise<Worktree[]> {
        const data = await graphqlQuery<{ recentlyActiveWorktrees: Record<string, unknown>[] }>(
          `query ($cutoffMs: Int!) { recentlyActiveWorktrees(cutoffMs: $cutoffMs) { ${WORKTREE_FIELDS} } }`,
          { cutoffMs }
        )
        return mapWorktreeRows(data.recentlyActiveWorktrees)
      },

      async update(
        id: string,
        updateData: {
          name?: string
          status?: 'active' | 'archived'
          last_message_at?: number | null
          last_accessed_at?: string
        }
      ): Promise<Worktree | null> {
        const input: Record<string, unknown> = {}
        if (updateData.name !== undefined) input.name = updateData.name
        if (updateData.status !== undefined) input.status = updateData.status
        if (updateData.last_message_at !== undefined) input.lastMessageAt = updateData.last_message_at
        if (updateData.last_accessed_at !== undefined) input.lastAccessedAt = updateData.last_accessed_at

        const data = await graphqlQuery<{ updateWorktree: Record<string, unknown> | null }>(
          `mutation ($id: ID!, $input: UpdateWorktreeInput!) {
            updateWorktree(id: $id, input: $input) { ${WORKTREE_FIELDS} }
          }`,
          { id, input }
        )
        return mapWorktreeRow(data.updateWorktree)
      },

      async delete(id: string): Promise<boolean> {
        // The db.worktree.delete in IPC just deletes the DB row.
        // The GraphQL deleteWorktree mutation requires more params (worktreePath, branchName, projectPath, archive).
        // For the db adapter, we first get the worktree, then call the mutation.
        const wtData = await graphqlQuery<{ worktree: Record<string, unknown> | null }>(
          `query ($id: ID!) { worktree(id: $id) { id path branchName projectId } }`,
          { id }
        )
        if (!wtData.worktree) return false

        const projectData = await graphqlQuery<{ project: Record<string, unknown> | null }>(
          `query ($id: ID!) { project(id: $id) { path } }`,
          { id: wtData.worktree.projectId }
        )

        const data = await graphqlQuery<{ deleteWorktree: { success: boolean } }>(
          `mutation ($input: DeleteWorktreeInput!) {
            deleteWorktree(input: $input) { success }
          }`,
          {
            input: {
              worktreeId: id,
              worktreePath: wtData.worktree.path,
              branchName: wtData.worktree.branchName,
              projectPath: projectData.project?.path || '',
              archive: false
            }
          }
        )
        return data.deleteWorktree.success
      },

      async archive(id: string): Promise<Worktree | null> {
        const data = await graphqlQuery<{ archiveWorktree: Record<string, unknown> | null }>(
          `mutation ($id: ID!) { archiveWorktree(id: $id) { ${WORKTREE_FIELDS} } }`,
          { id }
        )
        return mapWorktreeRow(data.archiveWorktree)
      },

      async touch(id: string): Promise<boolean> {
        const data = await graphqlQuery<{ touchWorktree: boolean }>(
          `mutation ($id: ID!) { touchWorktree(id: $id) }`,
          { id }
        )
        return data.touchWorktree
      },

      async appendSessionTitle(
        worktreeId: string,
        title: string
      ): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          appendWorktreeSessionTitle: { success: boolean; error?: string }
        }>(
          `mutation ($worktreeId: ID!, $title: String!) {
            appendWorktreeSessionTitle(worktreeId: $worktreeId, title: $title) { success error }
          }`,
          { worktreeId, title }
        )
        return data.appendWorktreeSessionTitle
      },

      async updateModel(params: {
        worktreeId: string
        modelProviderId: string
        modelId: string
        modelVariant: string | null
      }): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          updateWorktreeModel: { success: boolean; error?: string }
        }>(
          `mutation ($input: UpdateWorktreeModelInput!) {
            updateWorktreeModel(input: $input) { success error }
          }`,
          {
            input: {
              worktreeId: params.worktreeId,
              modelProviderId: params.modelProviderId,
              modelId: params.modelId,
              modelVariant: params.modelVariant
            }
          }
        )
        return data.updateWorktreeModel
      },

      async addAttachment(
        worktreeId: string,
        attachment: { type: 'jira' | 'figma'; url: string; label: string }
      ): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          worktreeAddAttachment: { success: boolean; error?: string }
        }>(
          `mutation ($worktreeId: ID!, $attachment: AttachmentInput!) {
            worktreeAddAttachment(worktreeId: $worktreeId, attachment: $attachment) { success error }
          }`,
          { worktreeId, attachment }
        )
        return data.worktreeAddAttachment
      },

      async removeAttachment(
        worktreeId: string,
        attachmentId: string
      ): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          worktreeRemoveAttachment: { success: boolean; error?: string }
        }>(
          `mutation ($worktreeId: ID!, $attachmentId: String!) {
            worktreeRemoveAttachment(worktreeId: $worktreeId, attachmentId: $attachmentId) { success error }
          }`,
          { worktreeId, attachmentId }
        )
        return data.worktreeRemoveAttachment
      },

      async attachPR(
        worktreeId: string,
        prNumber: number,
        prUrl: string
      ): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          worktreeAttachPR: { success: boolean; error?: string }
        }>(
          `mutation ($worktreeId: ID!, $prNumber: Int!, $prUrl: String!) {
            worktreeAttachPR(worktreeId: $worktreeId, prNumber: $prNumber, prUrl: $prUrl) { success error }
          }`,
          { worktreeId, prNumber, prUrl }
        )
        return data.worktreeAttachPR
      },

      async detachPR(worktreeId: string): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          worktreeDetachPR: { success: boolean; error?: string }
        }>(
          `mutation ($worktreeId: ID!) {
            worktreeDetachPR(worktreeId: $worktreeId) { success error }
          }`,
          { worktreeId }
        )
        return data.worktreeDetachPR
      },

      async setPinned(
        worktreeId: string,
        pinned: boolean
      ): Promise<{ success: boolean; error?: string }> {
        const data = await graphqlQuery<{
          worktreeSetPinned: { success: boolean; error?: string }
        }>(
          `mutation ($worktreeId: ID!, $pinned: Boolean!) {
            worktreeSetPinned(worktreeId: $worktreeId, pinned: $pinned) { success error }
          }`,
          { worktreeId, pinned }
        )
        return data.worktreeSetPinned
      },

      async getPinned(): Promise<Worktree[]> {
        const data = await graphqlQuery<{ pinnedWorktrees: Record<string, unknown>[] }>(
          `query { pinnedWorktrees { ${WORKTREE_FIELDS} } }`
        )
        return mapWorktreeRows(data.pinnedWorktrees)
      }
    },

    // ─── Sessions ───────────────────────────────────────────────
    session: {
      async create(input: {
        worktree_id: string | null
        project_id: string
        connection_id?: string | null
        name?: string | null
        opencode_session_id?: string | null
        agent_sdk?: 'opencode' | 'claude-code' | 'codex' | 'terminal'
        model_provider_id?: string | null
        model_id?: string | null
        model_variant?: string | null
      }): Promise<Session> {
        const gqlInput: Record<string, unknown> = {
          worktreeId: input.worktree_id,
          projectId: input.project_id
        }
        if (input.connection_id !== undefined) gqlInput.connectionId = input.connection_id
        if (input.name !== undefined) gqlInput.name = input.name
        if (input.opencode_session_id !== undefined)
          gqlInput.opencodeSessionId = input.opencode_session_id
        if (input.agent_sdk !== undefined) gqlInput.agentSdk = mapAgentSdkToEnum(input.agent_sdk)
        if (input.model_provider_id !== undefined) gqlInput.modelProviderId = input.model_provider_id
        if (input.model_id !== undefined) gqlInput.modelId = input.model_id
        if (input.model_variant !== undefined) gqlInput.modelVariant = input.model_variant

        const data = await graphqlQuery<{ createSession: Record<string, unknown> }>(
          `mutation ($input: CreateSessionInput!) {
            createSession(input: $input) { ${SESSION_FIELDS} }
          }`,
          { input: gqlInput }
        )
        return mapSessionRow(data.createSession)!
      },

      async get(id: string): Promise<Session | null> {
        const data = await graphqlQuery<{ session: Record<string, unknown> | null }>(
          `query ($id: ID!) { session(id: $id) { ${SESSION_FIELDS} } }`,
          { id }
        )
        return mapSessionRow(data.session)
      },

      async getByWorktree(worktreeId: string): Promise<Session[]> {
        const data = await graphqlQuery<{ sessionsByWorktree: Record<string, unknown>[] }>(
          `query ($worktreeId: ID!) { sessionsByWorktree(worktreeId: $worktreeId) { ${SESSION_FIELDS} } }`,
          { worktreeId }
        )
        return mapSessionRows(data.sessionsByWorktree)
      },

      async getByProject(projectId: string): Promise<Session[]> {
        const data = await graphqlQuery<{ sessionsByProject: Record<string, unknown>[] }>(
          `query ($projectId: ID!) { sessionsByProject(projectId: $projectId) { ${SESSION_FIELDS} } }`,
          { projectId }
        )
        return mapSessionRows(data.sessionsByProject)
      },

      async getActiveByWorktree(worktreeId: string): Promise<Session[]> {
        const data = await graphqlQuery<{ activeSessionsByWorktree: Record<string, unknown>[] }>(
          `query ($worktreeId: ID!) { activeSessionsByWorktree(worktreeId: $worktreeId) { ${SESSION_FIELDS} } }`,
          { worktreeId }
        )
        return mapSessionRows(data.activeSessionsByWorktree)
      },

      async update(
        id: string,
        updateData: {
          name?: string | null
          status?: 'active' | 'completed' | 'error'
          opencode_session_id?: string | null
          agent_sdk?: 'opencode' | 'claude-code' | 'codex' | 'terminal'
          mode?: 'build' | 'plan'
          model_provider_id?: string | null
          model_id?: string | null
          model_variant?: string | null
          updated_at?: string
          completed_at?: string | null
        }
      ): Promise<Session | null> {
        const input: Record<string, unknown> = {}
        if (updateData.name !== undefined) input.name = updateData.name
        if (updateData.status !== undefined) input.status = updateData.status
        if (updateData.opencode_session_id !== undefined)
          input.opencodeSessionId = updateData.opencode_session_id
        if (updateData.agent_sdk !== undefined) input.agentSdk = mapAgentSdkToEnum(updateData.agent_sdk)
        if (updateData.mode !== undefined) input.mode = updateData.mode
        if (updateData.model_provider_id !== undefined)
          input.modelProviderId = updateData.model_provider_id
        if (updateData.model_id !== undefined) input.modelId = updateData.model_id
        if (updateData.model_variant !== undefined) input.modelVariant = updateData.model_variant
        if (updateData.updated_at !== undefined) input.updatedAt = updateData.updated_at
        if (updateData.completed_at !== undefined) input.completedAt = updateData.completed_at

        const data = await graphqlQuery<{ updateSession: Record<string, unknown> | null }>(
          `mutation ($id: ID!, $input: UpdateSessionInput!) {
            updateSession(id: $id, input: $input) { ${SESSION_FIELDS} }
          }`,
          { id, input }
        )
        return mapSessionRow(data.updateSession)
      },

      async delete(id: string): Promise<boolean> {
        const data = await graphqlQuery<{ deleteSession: boolean }>(
          `mutation ($id: ID!) { deleteSession(id: $id) }`,
          { id }
        )
        return data.deleteSession
      },

      async search(options: SessionSearchOptions): Promise<SessionWithWorktree[]> {
        const input: Record<string, unknown> = {}
        if (options.keyword) input.keyword = options.keyword
        if (options.project_id) input.projectId = options.project_id
        if (options.worktree_id) input.worktreeId = options.worktree_id
        if (options.dateFrom) input.dateFrom = options.dateFrom
        if (options.dateTo) input.dateTo = options.dateTo
        if (options.includeArchived !== undefined) input.includeArchived = options.includeArchived

        const data = await graphqlQuery<{ searchSessions: Record<string, unknown>[] }>(
          `query ($input: SessionSearchInput!) {
            searchSessions(input: $input) { ${SESSION_WITH_WORKTREE_FIELDS} }
          }`,
          { input }
        )
        return mapSessionWithWorktreeRows(data.searchSessions)
      },

      async getDraft(sessionId: string): Promise<string | null> {
        const data = await graphqlQuery<{ sessionDraft: string | null }>(
          `query ($sessionId: ID!) { sessionDraft(sessionId: $sessionId) }`,
          { sessionId }
        )
        return data.sessionDraft
      },

      async updateDraft(sessionId: string, draft: string | null): Promise<void> {
        await graphqlQuery(
          `mutation ($sessionId: ID!, $draft: String) {
            updateSessionDraft(sessionId: $sessionId, draft: $draft)
          }`,
          { sessionId, draft }
        )
      },

      async getByConnection(connectionId: string): Promise<Session[]> {
        const data = await graphqlQuery<{ sessionsByConnection: Record<string, unknown>[] }>(
          `query ($connectionId: ID!) { sessionsByConnection(connectionId: $connectionId) { ${SESSION_FIELDS} } }`,
          { connectionId }
        )
        return mapSessionRows(data.sessionsByConnection)
      },

      async getActiveByConnection(connectionId: string): Promise<Session[]> {
        const data = await graphqlQuery<{ activeSessionsByConnection: Record<string, unknown>[] }>(
          `query ($connectionId: ID!) { activeSessionsByConnection(connectionId: $connectionId) { ${SESSION_FIELDS} } }`,
          { connectionId }
        )
        return mapSessionRows(data.activeSessionsByConnection)
      }
    },

    // ─── Session Messages ───────────────────────────────────────
    sessionMessage: {
      async list(_sessionId: string): Promise<SessionMessage[]> {
        // No direct GraphQL query for session messages in the schema.
        // Messages are fetched via opencodeMessages which returns JSON.
        // Return empty array as a stub -- the renderer fetches messages via opencodeOps.getMessages.
        return []
      }
    },

    // ─── Session Activity ───────────────────────────────────────
    sessionActivity: {
      async list(_sessionId: string): Promise<SessionActivity[]> {
        // No direct GraphQL query for session activity in the schema.
        // Activity is streamed via the opencodeStream subscription.
        // Return empty array as a stub.
        return []
      }
    },

    // ─── Spaces ─────────────────────────────────────────────────
    space: {
      async list(): Promise<Space[]> {
        const data = await graphqlQuery<{ spaces: Record<string, unknown>[] }>(
          `query { spaces { ${SPACE_FIELDS} } }`
        )
        return mapRows<Space>(data.spaces)
      },

      async create(input: {
        name: string
        icon_type?: string
        icon_value?: string
      }): Promise<Space> {
        const gqlInput: Record<string, unknown> = { name: input.name }
        if (input.icon_type !== undefined) gqlInput.iconType = input.icon_type
        if (input.icon_value !== undefined) gqlInput.iconValue = input.icon_value

        const data = await graphqlQuery<{ createSpace: Record<string, unknown> }>(
          `mutation ($input: CreateSpaceInput!) {
            createSpace(input: $input) { ${SPACE_FIELDS} }
          }`,
          { input: gqlInput }
        )
        return mapRow<Space>(data.createSpace)!
      },

      async update(
        id: string,
        updateData: {
          name?: string
          icon_type?: string
          icon_value?: string
          sort_order?: number
        }
      ): Promise<Space | null> {
        const input: Record<string, unknown> = {}
        if (updateData.name !== undefined) input.name = updateData.name
        if (updateData.icon_type !== undefined) input.iconType = updateData.icon_type
        if (updateData.icon_value !== undefined) input.iconValue = updateData.icon_value
        if (updateData.sort_order !== undefined) input.sortOrder = updateData.sort_order

        const data = await graphqlQuery<{ updateSpace: Record<string, unknown> | null }>(
          `mutation ($id: ID!, $input: UpdateSpaceInput!) {
            updateSpace(id: $id, input: $input) { ${SPACE_FIELDS} }
          }`,
          { id, input }
        )
        return mapRow<Space>(data.updateSpace)
      },

      async delete(id: string): Promise<boolean> {
        const data = await graphqlQuery<{ deleteSpace: boolean }>(
          `mutation ($id: ID!) { deleteSpace(id: $id) }`,
          { id }
        )
        return data.deleteSpace
      },

      async assignProject(projectId: string, spaceId: string): Promise<boolean> {
        const data = await graphqlQuery<{ assignProjectToSpace: boolean }>(
          `mutation ($projectId: ID!, $spaceId: ID!) {
            assignProjectToSpace(projectId: $projectId, spaceId: $spaceId)
          }`,
          { projectId, spaceId }
        )
        return data.assignProjectToSpace
      },

      async removeProject(projectId: string, spaceId: string): Promise<boolean> {
        const data = await graphqlQuery<{ removeProjectFromSpace: boolean }>(
          `mutation ($projectId: ID!, $spaceId: ID!) {
            removeProjectFromSpace(projectId: $projectId, spaceId: $spaceId)
          }`,
          { projectId, spaceId }
        )
        return data.removeProjectFromSpace
      },

      async getProjectIds(spaceId: string): Promise<string[]> {
        const data = await graphqlQuery<{ spaceProjectIds: string[] }>(
          `query ($spaceId: ID!) { spaceProjectIds(spaceId: $spaceId) }`,
          { spaceId }
        )
        return data.spaceProjectIds
      },

      async getAllAssignments(): Promise<ProjectSpaceAssignment[]> {
        const data = await graphqlQuery<{
          allSpaceAssignments: { projectId: string; spaceId: string }[]
        }>(
          `query { allSpaceAssignments { projectId spaceId } }`
        )
        // Convert camelCase to snake_case
        return data.allSpaceAssignments.map((a) => ({
          project_id: a.projectId,
          space_id: a.spaceId
        }))
      },

      async reorder(orderedIds: string[]): Promise<boolean> {
        const data = await graphqlQuery<{ reorderSpaces: boolean }>(
          `mutation ($orderedIds: [ID!]!) { reorderSpaces(orderedIds: $orderedIds) }`,
          { orderedIds }
        )
        return data.reorderSpaces
      }
    },

    // ─── Schema / DB utility stubs ──────────────────────────────
    async schemaVersion(): Promise<number> {
      const data = await graphqlQuery<{ dbSchemaVersion: number }>(
        `query { dbSchemaVersion }`
      )
      return data.dbSchemaVersion
    },

    async tableExists(_tableName: string): Promise<boolean> {
      // Not meaningful over GraphQL -- always return true
      return true
    },

    async getIndexes(): Promise<{ name: string; tbl_name: string }[]> {
      // Not meaningful over GraphQL -- return empty
      return []
    }
  }
}
