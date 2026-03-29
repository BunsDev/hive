import { graphqlQuery } from '../client'
import type { LoggingOpsApi } from '../../types'

export function createLoggingOpsAdapter(): LoggingOpsApi {
  return {
    async createResponseLog(sessionId: string): Promise<string> {
      const data = await graphqlQuery<{ createResponseLog: string }>(
        `mutation ($sessionId: ID!) {
          createResponseLog(sessionId: $sessionId)
        }`,
        { sessionId }
      )
      return data.createResponseLog
    },

    async appendResponseLog(filePath: string, logData: unknown): Promise<void> {
      await graphqlQuery<{ appendResponseLog: boolean }>(
        `mutation ($filePath: String!, $data: JSON!) {
          appendResponseLog(filePath: $filePath, data: $data)
        }`,
        { filePath, data: logData }
      )
    }
  }
}
