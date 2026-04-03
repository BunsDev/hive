import { graphqlQuery } from '../client'
import { noopSubscription } from '../../stubs/electron-only'
import type { UpdaterOpsApi } from '../../types'

export function createUpdaterOpsAdapter(): UpdaterOpsApi {
  return {
    // ─── Stubs (auto-update doesn't apply to web) ──────────────
    async checkForUpdate(): Promise<void> {},
    async downloadUpdate(): Promise<void> {},
    async installUpdate(): Promise<void> {},
    async setChannel(): Promise<void> {},

    // ─── Working via GraphQL ────────────────────────────────────
    async getVersion(): Promise<string> {
      const data = await graphqlQuery<{ systemAppVersion: string }>(
        `query { systemAppVersion }`
      )
      return data.systemAppVersion
    },

    // ─── Event stubs ───────────────────────────────────────────
    onChecking: () => noopSubscription(),
    onUpdateAvailable: () => noopSubscription(),
    onUpdateNotAvailable: () => noopSubscription(),
    onProgress: () => noopSubscription(),
    onUpdateDownloaded: () => noopSubscription(),
    onError: () => noopSubscription()
  }
}
