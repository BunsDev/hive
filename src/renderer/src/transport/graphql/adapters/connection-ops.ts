import { graphqlQuery } from '../client'
import { notAvailableInWeb } from '../../stubs/electron-only'
import type { ConnectionOpsApi } from '../../types'

// Convert camelCase keys to snake_case for connection objects
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    result[snakeKey] = value
  }
  return result
}

function mapConnectionMember(
  member: Record<string, unknown>
): ConnectionMember {
  return toSnakeCase(member) as unknown as ConnectionMember
}

function mapConnectionWithMembers(
  conn: Record<string, unknown> | null | undefined
): ConnectionWithMembers | null {
  if (!conn) return null
  const mapped = toSnakeCase(conn) as Record<string, unknown>
  // Map nested members array
  if (Array.isArray(mapped.members)) {
    mapped.members = (mapped.members as Record<string, unknown>[]).map((m) =>
      toSnakeCase(m as Record<string, unknown>)
    )
  }
  return mapped as unknown as ConnectionWithMembers
}

function mapConnectionsArray(
  connections: Record<string, unknown>[] | null | undefined
): ConnectionWithMembers[] {
  if (!connections) return []
  return connections
    .map((c) => mapConnectionWithMembers(c))
    .filter(Boolean) as ConnectionWithMembers[]
}

const CONNECTION_FIELDS = `
  id name status path color createdAt updatedAt
  members {
    id connectionId worktreeId projectId symlinkName addedAt
    worktreeName worktreeBranch worktreePath projectName
  }
`

export function createConnectionOpsAdapter(): ConnectionOpsApi {
  return {
    // ─── Working via GraphQL ────────────────────────────────────
    async create(worktreeIds: string[]): Promise<{
      success: boolean
      connection?: ConnectionWithMembers
      error?: string
    }> {
      const data = await graphqlQuery<{
        createConnection: {
          success: boolean
          connection: Record<string, unknown> | null
          error?: string
        }
      }>(
        `mutation ($worktreeIds: [ID!]!) {
          createConnection(worktreeIds: $worktreeIds) {
            success error
            connection { ${CONNECTION_FIELDS} }
          }
        }`,
        { worktreeIds }
      )
      return {
        success: data.createConnection.success,
        connection: mapConnectionWithMembers(data.createConnection.connection) ?? undefined,
        error: data.createConnection.error ?? undefined
      }
    },

    async delete(connectionId: string): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        deleteConnection: { success: boolean; error?: string }
      }>(
        `mutation ($connectionId: ID!) {
          deleteConnection(connectionId: $connectionId) { success error }
        }`,
        { connectionId }
      )
      return data.deleteConnection
    },

    async addMember(
      connectionId: string,
      worktreeId: string
    ): Promise<{ success: boolean; member?: ConnectionMember; error?: string }> {
      const data = await graphqlQuery<{
        addConnectionMember: {
          success: boolean
          member?: Record<string, unknown>
          error?: string
        }
      }>(
        `mutation ($connectionId: ID!, $worktreeId: ID!) {
          addConnectionMember(connectionId: $connectionId, worktreeId: $worktreeId) {
            success member error
          }
        }`,
        { connectionId, worktreeId }
      )
      return {
        success: data.addConnectionMember.success,
        member: data.addConnectionMember.member
          ? mapConnectionMember(data.addConnectionMember.member)
          : undefined,
        error: data.addConnectionMember.error ?? undefined
      }
    },

    async removeMember(
      connectionId: string,
      worktreeId: string
    ): Promise<{ success: boolean; connectionDeleted?: boolean; error?: string }> {
      const data = await graphqlQuery<{
        removeConnectionMember: {
          success: boolean
          connectionDeleted?: boolean
          error?: string
        }
      }>(
        `mutation ($connectionId: ID!, $worktreeId: ID!) {
          removeConnectionMember(connectionId: $connectionId, worktreeId: $worktreeId) {
            success connectionDeleted error
          }
        }`,
        { connectionId, worktreeId }
      )
      return data.removeConnectionMember
    },

    async getAll(): Promise<{
      success: boolean
      connections?: ConnectionWithMembers[]
      error?: string
    }> {
      const data = await graphqlQuery<{
        connections: Record<string, unknown>[]
      }>(
        `query { connections { ${CONNECTION_FIELDS} } }`
      )
      return {
        success: true,
        connections: mapConnectionsArray(data.connections)
      }
    },

    async get(connectionId: string): Promise<{
      success: boolean
      connection?: ConnectionWithMembers
      error?: string
    }> {
      const data = await graphqlQuery<{
        connection: Record<string, unknown> | null
      }>(
        `query ($connectionId: ID!) {
          connection(connectionId: $connectionId) { ${CONNECTION_FIELDS} }
        }`,
        { connectionId }
      )
      if (!data.connection) {
        return { success: false, error: 'Connection not found' }
      }
      return {
        success: true,
        connection: mapConnectionWithMembers(data.connection) ?? undefined
      }
    },

    async removeWorktreeFromAll(
      worktreeId: string
    ): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        removeWorktreeFromAllConnections: { success: boolean; error?: string }
      }>(
        `mutation ($worktreeId: ID!) {
          removeWorktreeFromAllConnections(worktreeId: $worktreeId) { success error }
        }`,
        { worktreeId }
      )
      return data.removeWorktreeFromAllConnections
    },

    async rename(
      connectionId: string,
      customName: string | null
    ): Promise<{ success: boolean; connection?: ConnectionWithMembers; error?: string }> {
      const data = await graphqlQuery<{
        renameConnection: Record<string, unknown> | null
      }>(
        `mutation ($connectionId: ID!, $customName: String) {
          renameConnection(connectionId: $connectionId, customName: $customName) {
            ${CONNECTION_FIELDS}
          }
        }`,
        { connectionId, customName }
      )
      if (!data.renameConnection) {
        return { success: false, error: 'Connection not found' }
      }
      return {
        success: true,
        connection: mapConnectionWithMembers(data.renameConnection) ?? undefined
      }
    },

    async setPinned(
      _connectionId: string,
      _pinned: boolean
    ): Promise<{ success: boolean; error?: string }> {
      // No setPinned mutation for connections in the GraphQL schema
      return { success: false, error: 'setPinned not available in web mode' }
    },

    async getPinned(): Promise<ConnectionWithMembers[]> {
      const data = await graphqlQuery<{
        pinnedConnections: Record<string, unknown>[]
      }>(
        `query { pinnedConnections { ${CONNECTION_FIELDS} } }`
      )
      return mapConnectionsArray(data.pinnedConnections)
    },

    // ─── Electron-only stubs ────────────────────────────────────
    openInTerminal: notAvailableInWeb('connectionOps.openInTerminal') as unknown as (
      connectionPath: string
    ) => Promise<{ success: boolean; error?: string }>,

    openInEditor: notAvailableInWeb('connectionOps.openInEditor') as unknown as (
      connectionPath: string
    ) => Promise<{ success: boolean; error?: string }>
  }
}
