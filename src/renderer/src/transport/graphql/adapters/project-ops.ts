import { graphqlQuery } from '../client'
import { notAvailableInWeb } from '../../stubs/electron-only'
import type { ProjectOpsApi } from '../../types'

export function createProjectOpsAdapter(): ProjectOpsApi {
  return {
    // ─── Working via GraphQL ────────────────────────────────────
    async validateProject(path: string): Promise<{
      success: boolean
      path?: string
      name?: string
      error?: string
    }> {
      const data = await graphqlQuery<{
        projectValidate: {
          success: boolean
          path?: string
          name?: string
          error?: string
        }
      }>(
        `query ($path: String!) {
          projectValidate(path: $path) { success path name error }
        }`,
        { path }
      )
      return data.projectValidate
    },

    async detectLanguage(projectPath: string): Promise<string | null> {
      const data = await graphqlQuery<{ projectDetectLanguage: string | null }>(
        `query ($projectPath: String!) { projectDetectLanguage(projectPath: $projectPath) }`,
        { projectPath }
      )
      return data.projectDetectLanguage
    },

    async loadLanguageIcons(): Promise<Record<string, string>> {
      const data = await graphqlQuery<{ projectLanguageIcons: Record<string, string> }>(
        `query { projectLanguageIcons }`
      )
      return data.projectLanguageIcons
    },

    async findXcworkspace(_projectPath: string): Promise<string | null> {
      // No GraphQL query available for findXcworkspace
      return null
    },

    async isAndroidProject(_projectPath: string): Promise<boolean> {
      // No GraphQL query available for isAndroidProject
      return false
    },

    async getProjectIconPath(filename: string): Promise<string | null> {
      const data = await graphqlQuery<{ projectIconPath: string | null }>(
        `query ($filename: String!) { projectIconPath(filename: $filename) }`,
        { filename }
      )
      return data.projectIconPath
    },

    async detectFavicon(projectPath: string): Promise<string | null> {
      const data = await graphqlQuery<{ projectDetectFavicon: string | null }>(
        `query ($projectPath: String!) { projectDetectFavicon(projectPath: $projectPath) }`,
        { projectPath }
      )
      return data.projectDetectFavicon
    },

    async getAbsoluteIconDataUrl(_absolutePath: string): Promise<string | null> {
      // Intentionally not exposed over GraphQL to avoid arbitrary file reads.
      // Favicon resolution via absolute path is only available in the Electron IPC transport.
      return null
    },

    async isGitRepository(path: string): Promise<boolean> {
      const data = await graphqlQuery<{ projectIsGitRepository: boolean }>(
        `query ($path: String!) { projectIsGitRepository(path: $path) }`,
        { path }
      )
      return data.projectIsGitRepository
    },

    async initRepository(path: string): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        projectInitRepository: { success: boolean; error?: string }
      }>(
        `mutation ($path: String!) {
          projectInitRepository(path: $path) { success error }
        }`,
        { path }
      )
      return data.projectInitRepository
    },

    async removeProjectIcon(projectId: string): Promise<{ success: boolean; error?: string }> {
      const data = await graphqlQuery<{
        projectRemoveIcon: { success: boolean; error?: string }
      }>(
        `mutation ($projectId: ID!) {
          projectRemoveIcon(projectId: $projectId) { success error }
        }`,
        { projectId }
      )
      return data.projectRemoveIcon
    },

    async copyToClipboard(text: string): Promise<void> {
      await navigator.clipboard.writeText(text)
    },

    async readFromClipboard(): Promise<string> {
      return navigator.clipboard.readText()
    },

    // ─── Electron-only stubs ────────────────────────────────────
    async openDirectoryDialog(): Promise<string | null> {
      // Web UI will show a text input instead of a native dialog
      return null
    },

    showInFolder: notAvailableInWeb('showInFolder') as unknown as (
      path: string
    ) => Promise<void>,

    openPath: notAvailableInWeb('openPath') as unknown as (
      path: string
    ) => Promise<string>,

    pickProjectIcon: notAvailableInWeb('pickProjectIcon') as unknown as (
      projectId: string
    ) => Promise<{ success: boolean; filename?: string; error?: string }>
  }
}
