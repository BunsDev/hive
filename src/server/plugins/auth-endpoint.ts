import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifyApiKey, type BruteForceTracker } from './auth'

function getClientIp(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? 'unknown'
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const MAX_BODY = 4096

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

export async function handleAuthEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  getKeyHash: () => string,
  bruteForce: BruteForceTracker
): Promise<boolean> {
  // Only match POST /api/auth/validate
  const url = req.url ?? ''
  const pathname = url.split('?')[0]
  if (req.method !== 'POST' || pathname !== '/api/auth/validate') {
    return false
  }

  const ip = getClientIp(req)

  // Check brute force block
  if (bruteForce.isBlocked(ip)) {
    jsonResponse(res, 429, { valid: false, error: 'Too many failed attempts. Try again later.' })
    return true
  }

  // Read and parse body
  let body: unknown
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw)
  } catch {
    jsonResponse(res, 400, { valid: false, error: 'Invalid JSON body' })
    return true
  }

  // Validate payload shape
  if (!body || typeof body !== 'object' || !('apiKey' in body)) {
    jsonResponse(res, 400, { valid: false, error: 'Missing apiKey field' })
    return true
  }

  const { apiKey } = body as { apiKey: unknown }
  if (typeof apiKey !== 'string' || apiKey === '') {
    jsonResponse(res, 400, { valid: false, error: 'apiKey must be a non-empty string' })
    return true
  }

  // Verify the key
  const hash = getKeyHash()
  if (!hash) {
    jsonResponse(res, 401, { valid: false, error: 'Server has no API key configured' })
    return true
  }

  if (verifyApiKey(apiKey, hash)) {
    bruteForce.recordSuccess(ip)
    jsonResponse(res, 200, { valid: true })
  } else {
    bruteForce.recordFailure(ip)
    jsonResponse(res, 401, { valid: false, error: 'Invalid API key' })
  }

  return true
}
