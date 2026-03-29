import type { AnalyticsOpsApi } from '../../types'

export function createAnalyticsOpsAdapter(): AnalyticsOpsApi {
  return {
    // No analytics in web mode - all methods are no-ops
    async track(): Promise<void> {},
    async setEnabled(): Promise<void> {},
    async isEnabled(): Promise<boolean> {
      return false
    }
  }
}
