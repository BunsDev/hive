let cachedMode: 'electron' | 'web' | null = null

export function detectTransportMode(): 'electron' | 'web' {
  if (cachedMode) return cachedMode
  // If the preload script ran, window.db exists (it's set synchronously by Electron's contextBridge).
  // This MUST be called before installTransport(), which also sets window.db for web mode.
  cachedMode =
    typeof window !== 'undefined' && window.db !== undefined ? 'electron' : 'web'
  return cachedMode
}
