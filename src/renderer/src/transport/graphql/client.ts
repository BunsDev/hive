import { createClient as createWsClient, type Client as WsClient } from 'graphql-ws'

interface GraphQLClientConfig {
  httpUrl: string
  wsUrl: string
  apiKey: string
}

let httpUrl: string
let wsUrl: string
let apiKey: string
let wsClient: WsClient

export function initGraphQLClient(config: GraphQLClientConfig): void {
  httpUrl = config.httpUrl
  wsUrl = config.wsUrl
  apiKey = config.apiKey
  wsClient = createWsClient({
    url: wsUrl,
    connectionParams: { apiKey: config.apiKey }
  })
}

export async function graphqlQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(httpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ query, variables })
  })
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(json.errors[0].message)
  }
  return json.data as T
}

export function graphqlSubscribe<T = unknown>(
  query: string,
  variables: Record<string, unknown> | undefined,
  onData: (data: T) => void,
  onError?: (error: Error) => void
): () => void {
  const cleanup = wsClient.subscribe(
    { query, variables },
    {
      next: (result) => {
        if (result.data) onData(result.data as T)
        if (result.errors?.length) onError?.(new Error(result.errors[0].message))
      },
      error: (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
      complete: () => {}
    }
  )
  return cleanup
}

export function getWsClient(): WsClient {
  return wsClient
}
