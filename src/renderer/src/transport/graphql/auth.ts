const STORAGE_KEY = 'hive-web-auth'

interface WebAuthConfig {
  serverUrl: string
  apiKey: string
}

export function getWebAuth(): WebAuthConfig | null {
  const stored = sessionStorage.getItem(STORAGE_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as WebAuthConfig
  } catch {
    return null
  }
}

export function saveWebAuth(config: WebAuthConfig): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function clearWebAuth(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
