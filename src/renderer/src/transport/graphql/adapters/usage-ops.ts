import { graphqlQuery } from '../client'
import type { UsageOpsApi } from '../../types'

export function createUsageOpsAdapter(): UsageOpsApi {
  return {
    async fetch() {
      const data = await graphqlQuery<{ usageFetch: { success: boolean; data?: unknown; error?: string } }>(
        `query { usageFetch { success data error } }`
      )
      return data.usageFetch as Awaited<ReturnType<UsageOpsApi['fetch']>>
    },

    async fetchOpenai() {
      const data = await graphqlQuery<{ usageFetchOpenai: { success: boolean; data?: unknown; error?: string } }>(
        `query { usageFetchOpenai { success data error } }`
      )
      return data.usageFetchOpenai as Awaited<ReturnType<UsageOpsApi['fetchOpenai']>>
    }
  }
}
