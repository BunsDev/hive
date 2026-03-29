import type { Resolvers } from '../../__generated__/resolvers-types'
import { fetchClaudeUsage } from '../../../main/services/usage-service'
import { fetchOpenAIUsage } from '../../../main/services/openai-usage-service'

export const usageQueryResolvers: Resolvers = {
  Query: {
    usageFetch: async (_parent, { providers }) => {
      try {
        // If providers is specified and includes 'openai', fetch OpenAI usage
        // Otherwise default to Claude usage
        if (providers?.includes('openai')) {
          return fetchOpenAIUsage()
        }
        return fetchClaudeUsage()
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    },

    usageFetchOpenai: async () => {
      try {
        return fetchOpenAIUsage()
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  }
}
