import { graphqlQuery, graphqlSubscribe } from '../client'
import type { FileTreeOpsApi } from '../../types'

const FILE_TREE_NODE_FIELDS = `
  name path relativePath isDirectory isSymlink extension
  children { name path relativePath isDirectory isSymlink extension }
`

const FLAT_FILE_FIELDS = `name path relativePath extension`

export function createFileTreeOpsAdapter(): FileTreeOpsApi {
  return {
    async scan(dirPath: string): Promise<{
      success: boolean
      tree?: FileTreeNode[]
      error?: string
    }> {
      const data = await graphqlQuery<{
        fileTreeScan: {
          success: boolean
          tree?: FileTreeNode[]
          error?: string
        }
      }>(
        `query ($dirPath: String!) {
          fileTreeScan(dirPath: $dirPath) {
            success error
            tree { ${FILE_TREE_NODE_FIELDS} }
          }
        }`,
        { dirPath }
      )
      return data.fileTreeScan
    },

    async scanFlat(dirPath: string): Promise<{
      success: boolean
      files?: FlatFile[]
      error?: string
    }> {
      const data = await graphqlQuery<{
        fileTreeScanFlat: {
          success: boolean
          files?: FlatFile[]
          error?: string
        }
      }>(
        `query ($dirPath: String!) {
          fileTreeScanFlat(dirPath: $dirPath) {
            success error
            files { ${FLAT_FILE_FIELDS} }
          }
        }`,
        { dirPath }
      )
      return data.fileTreeScanFlat
    },

    async loadChildren(
      dirPath: string,
      rootPath: string
    ): Promise<{
      success: boolean
      children?: FileTreeNode[]
      error?: string
    }> {
      const data = await graphqlQuery<{
        fileTreeLoadChildren: {
          success: boolean
          children?: FileTreeNode[]
          error?: string
        }
      }>(
        `query ($dirPath: String!, $rootPath: String!) {
          fileTreeLoadChildren(dirPath: $dirPath, rootPath: $rootPath) {
            success error
            children { ${FILE_TREE_NODE_FIELDS} }
          }
        }`,
        { dirPath, rootPath }
      )
      return data.fileTreeLoadChildren
    },

    async watch(worktreePath: string): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        fileTreeWatch: { success: boolean; error?: string }
      }>(
        `mutation ($worktreePath: String!) {
          fileTreeWatch(worktreePath: $worktreePath) { success error }
        }`,
        { worktreePath }
      )
      return data.fileTreeWatch
    },

    async unwatch(worktreePath: string): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        fileTreeUnwatch: { success: boolean; error?: string }
      }>(
        `mutation ($worktreePath: String!) {
          fileTreeUnwatch(worktreePath: $worktreePath) { success error }
        }`,
        { worktreePath }
      )
      return data.fileTreeUnwatch
    },

    onChange(callback: (event: FileTreeChangeEvent) => void): () => void {
      // The GraphQL subscription returns a single flat event with fields:
      //   { worktreePath, eventType, changedPath, relativePath }
      // but the renderer's FileTreeChangeEvent expects:
      //   { worktreePath, events: FileTreeChangeEventItem[] }
      // We subscribe with a raw type and transform to match.
      interface GqlFileTreeEvent {
        worktreePath: string
        eventType: string
        changedPath: string
        relativePath: string
      }

      return graphqlSubscribe<{ fileTreeChange: GqlFileTreeEvent }>(
        `subscription ($worktreePath: String) {
          fileTreeChange(worktreePath: $worktreePath) {
            worktreePath eventType changedPath relativePath
          }
        }`,
        undefined,
        (data) => {
          const evt = data.fileTreeChange
          callback({
            worktreePath: evt.worktreePath,
            events: [
              {
                eventType: evt.eventType,
                changedPath: evt.changedPath,
                relativePath: evt.relativePath
              }
            ]
          } as unknown as FileTreeChangeEvent)
        }
      )
    }
  }
}
