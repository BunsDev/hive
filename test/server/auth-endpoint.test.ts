import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAuthEndpoint } from '../../src/server/plugins/auth-endpoint'
import { BruteForceTracker, generateApiKey, hashApiKey } from '../../src/server/plugins/auth'

// --- Test helpers ---

function mockReq(
  method: string,
  url: string,
  body?: string,
  remoteAddress = '127.0.0.1'
): IncomingMessage {
  const emitter = new EventEmitter()
  const req = Object.assign(emitter, {
    method,
    url,
    socket: { remoteAddress }
  }) as unknown as IncomingMessage

  // Schedule body emission on next tick so the handler can attach listeners
  if (body !== undefined) {
    process.nextTick(() => {
      emitter.emit('data', Buffer.from(body))
      emitter.emit('end')
    })
  } else {
    process.nextTick(() => {
      emitter.emit('end')
    })
  }

  return req
}

interface MockRes extends ServerResponse {
  _statusCode: number
  _headers: Record<string, string>
  _body: string | null
  _ended: boolean
}

function mockRes(): MockRes {
  const headers: Record<string, string> = {}
  let statusCode = 200
  let body: string | null = null
  let ended = false

  return {
    get _statusCode() {
      return statusCode
    },
    get _headers() {
      return headers
    },
    get _body() {
      return body
    },
    get _ended() {
      return ended
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v
        }
      }
    },
    end(data?: string) {
      ended = true
      if (data) body = data
    }
  } as unknown as MockRes
}

function parseBody(res: MockRes): Record<string, unknown> {
  return JSON.parse(res._body!)
}

// --- Tests ---

describe('handleAuthEndpoint', () => {
  let bruteForce: BruteForceTracker
  let apiKey: string
  let keyHash: string
  let getKeyHash: () => string

  beforeEach(() => {
    bruteForce = new BruteForceTracker({
      maxAttempts: 5,
      windowMs: 60_000,
      blockMs: 300_000
    })
    apiKey = generateApiKey()
    keyHash = hashApiKey(apiKey)
    getKeyHash = () => keyHash
  })

  describe('route matching', () => {
    it('returns false for non-matching paths', async () => {
      const req = mockReq('POST', '/api/other')
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)
      expect(result).toBe(false)
      expect(res._ended).toBe(false)
    })

    it('returns false for GET /api/auth/validate', async () => {
      const req = mockReq('GET', '/api/auth/validate')
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)
      expect(result).toBe(false)
      expect(res._ended).toBe(false)
    })

    it('returns false for POST to wrong path', async () => {
      const req = mockReq('POST', '/graphql')
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)
      expect(result).toBe(false)
    })

    it('matches POST /api/auth/validate with query string', async () => {
      const req = mockReq('POST', '/api/auth/validate?foo=bar', JSON.stringify({ apiKey }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)
      expect(result).toBe(true)
      expect(res._statusCode).toBe(200)
    })
  })

  describe('successful authentication', () => {
    it('returns { valid: true } with 200 for correct key', async () => {
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._headers['content-type']).toBe('application/json')
      expect(parseBody(res)).toEqual({ valid: true })
    })

    it('calls recordSuccess on valid key', async () => {
      const spy = vi.spyOn(bruteForce, 'recordSuccess')
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey }))
      const res = mockRes()
      await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(spy).toHaveBeenCalledWith('127.0.0.1')
    })
  })

  describe('failed authentication', () => {
    it('returns 401 for wrong key', async () => {
      const wrongKey = generateApiKey()
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey: wrongKey }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(401)
      const body = parseBody(res)
      expect(body.valid).toBe(false)
      expect(body.error).toBe('Invalid API key')
    })

    it('calls recordFailure on invalid key', async () => {
      const spy = vi.spyOn(bruteForce, 'recordFailure')
      const wrongKey = generateApiKey()
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey: wrongKey }))
      const res = mockRes()
      await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(spy).toHaveBeenCalledWith('127.0.0.1')
    })
  })

  describe('brute force protection', () => {
    it('returns 429 when IP is blocked', async () => {
      // Exhaust attempts
      for (let i = 0; i < 5; i++) {
        bruteForce.recordFailure('10.0.0.1')
      }
      expect(bruteForce.isBlocked('10.0.0.1')).toBe(true)

      const req = mockReq(
        'POST',
        '/api/auth/validate',
        JSON.stringify({ apiKey }),
        '10.0.0.1'
      )
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(429)
      const body = parseBody(res)
      expect(body.valid).toBe(false)
      expect(body.error).toContain('Too many')
    })

    it('does not attempt verification when blocked', async () => {
      for (let i = 0; i < 5; i++) {
        bruteForce.recordFailure('10.0.0.1')
      }

      const spy = vi.spyOn(bruteForce, 'recordFailure')
      const req = mockReq(
        'POST',
        '/api/auth/validate',
        JSON.stringify({ apiKey: 'anything' }),
        '10.0.0.1'
      )
      const res = mockRes()
      await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      // recordFailure should NOT be called again during block check
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('input validation', () => {
    it('returns 400 for invalid JSON', async () => {
      const req = mockReq('POST', '/api/auth/validate', 'not json{{{')
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(400)
      expect(parseBody(res).error).toBe('Invalid JSON body')
    })

    it('returns 400 for missing apiKey field', async () => {
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ key: 'value' }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(400)
      expect(parseBody(res).error).toBe('Missing apiKey field')
    })

    it('returns 400 for empty apiKey', async () => {
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey: '' }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(400)
      expect(parseBody(res).error).toBe('apiKey must be a non-empty string')
    })

    it('returns 400 for non-string apiKey', async () => {
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey: 12345 }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(400)
      expect(parseBody(res).error).toBe('apiKey must be a non-empty string')
    })

    it('returns 400 for empty body', async () => {
      const req = mockReq('POST', '/api/auth/validate', '')
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(400)
    })
  })

  describe('edge cases', () => {
    it('returns 401 when server has no key hash configured', async () => {
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey: 'some-key' }))
      const res = mockRes()
      const result = await handleAuthEndpoint(req, res, () => '', bruteForce)

      expect(result).toBe(true)
      expect(res._statusCode).toBe(401)
      expect(parseBody(res).error).toBe('Server has no API key configured')
    })

    it('uses socket remoteAddress for IP identification', async () => {
      const spy = vi.spyOn(bruteForce, 'recordSuccess')
      const req = mockReq('POST', '/api/auth/validate', JSON.stringify({ apiKey }), '192.168.1.50')
      const res = mockRes()
      await handleAuthEndpoint(req, res, getKeyHash, bruteForce)

      expect(spy).toHaveBeenCalledWith('192.168.1.50')
    })
  })
})
