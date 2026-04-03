import type { Resolvers } from '../../__generated__/resolvers-types'
import { readFile, readFileAsBase64, readPromptFile } from '../../../main/services/file-ops'

export const fileQueryResolvers: Resolvers = {
  Query: {
    fileRead: async (_parent, { filePath }) => readFile(filePath),
    fileReadPrompt: async (_parent, { promptName }) => readPromptFile(promptName),
    fileReadImageAsBase64: async (_parent, { filePath }) => {
      const result = readFileAsBase64(filePath)
      return {
        success: result.success,
        content: result.data ?? null,
        mimeType: result.mimeType ?? null,
        error: result.error ?? null
      }
    }
  }
}
