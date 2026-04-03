import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createStaticHandler } from '../../src/server/static-handler'

function mockReq(url: string): IncomingMessage {
  return { url } as IncomingMessage
}

function mockRes(): ServerResponse & {
  _statusCode: number
  _headers: Record<string, string>
  _body: Buffer | null
  _ended: boolean
} {
  const headers: Record<string, string> = {}
  let statusCode = 200
  let body: Buffer | null = null
  let ended = false

  const res = {
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
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v
        }
      }
    },
    end(data?: Buffer | string) {
      ended = true
      if (data) {
        body = Buffer.isBuffer(data) ? data : Buffer.from(data)
      }
    }
  }

  return res as unknown as ReturnType<typeof mockRes>
}

describe('createStaticHandler', () => {
  let webRoot: string
  let handler: ReturnType<typeof createStaticHandler>

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'static-handler-test-'))
    // Create index.html
    writeFileSync(join(webRoot, 'index.html'), '<html>hello</html>')
    // Create assets directory with a hashed JS file
    mkdirSync(join(webRoot, 'assets'))
    writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), 'console.log("app")')
    writeFileSync(join(webRoot, 'assets', 'style-def456.css'), 'body {}')
    // Create a favicon
    writeFileSync(join(webRoot, 'favicon.ico'), 'icon-data')
    handler = createStaticHandler(webRoot)
  })

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true })
  })

  describe('serving static files', () => {
    it('serves index.html for root path', () => {
      const req = mockReq('/')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._headers['content-type']).toBe('text/html')
      expect(res._body?.toString()).toBe('<html>hello</html>')
    })

    it('serves JS files with correct content type', () => {
      const req = mockReq('/assets/app-abc123.js')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._headers['content-type']).toBe('application/javascript')
    })

    it('serves CSS files with correct content type', () => {
      const req = mockReq('/assets/style-def456.css')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._headers['content-type']).toBe('text/css')
    })

    it('serves favicon.ico with correct content type', () => {
      const req = mockReq('/favicon.ico')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._headers['content-type']).toBe('image/x-icon')
    })
  })

  describe('cache headers', () => {
    it('sets no-cache for root path', () => {
      const req = mockReq('/')
      const res = mockRes()
      handler(req, res)
      expect(res._headers['cache-control']).toBe('no-cache')
    })

    it('sets no-cache for index.html', () => {
      const req = mockReq('/index.html')
      const res = mockRes()
      handler(req, res)
      expect(res._headers['cache-control']).toBe('no-cache')
    })

    it('sets immutable cache for /assets/* files', () => {
      const req = mockReq('/assets/app-abc123.js')
      const res = mockRes()
      handler(req, res)
      expect(res._headers['cache-control']).toBe(
        'public, max-age=31536000, immutable'
      )
    })

    it('does not set cache-control for other files', () => {
      const req = mockReq('/favicon.ico')
      const res = mockRes()
      handler(req, res)
      expect(res._headers['cache-control']).toBeUndefined()
    })
  })

  describe('passthrough routes', () => {
    it('returns false for /graphql', () => {
      const req = mockReq('/graphql')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(false)
      expect(res._ended).toBe(false)
    })

    it('returns false for /api/* paths', () => {
      const req = mockReq('/api/health')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(false)
    })

    it('returns false for /api/ root', () => {
      const req = mockReq('/api/')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(false)
    })
  })

  describe('SPA fallback', () => {
    it('serves index.html for unknown paths', () => {
      const req = mockReq('/dashboard/settings')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._headers['content-type']).toBe('text/html')
      expect(res._body?.toString()).toBe('<html>hello</html>')
    })

    it('sets no-cache on SPA fallback index.html', () => {
      const req = mockReq('/some/deep/route')
      const res = mockRes()
      handler(req, res)
      expect(res._headers['cache-control']).toBe('no-cache')
    })
  })

  describe('path traversal prevention', () => {
    it('blocks directory traversal with ..', () => {
      const req = mockReq('/../../../etc/passwd')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(403)
      expect(res._body).toBeNull()
    })

    it('blocks encoded traversal', () => {
      const req = mockReq('/%2e%2e/%2e%2e/etc/passwd')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(403)
      expect(res._body).toBeNull()
    })

    it('blocks prefix collision path traversal via sibling directory', () => {
      // Create a sibling directory whose name starts with the same prefix as webRoot
      // e.g. webRoot = /tmp/test-web, sibling = /tmp/test-web-evil
      const siblingDir = webRoot + '-evil'
      mkdirSync(siblingDir, { recursive: true })
      writeFileSync(join(siblingDir, 'secret.txt'), 'stolen-secret')

      try {
        // Craft a request that escapes to the sibling via prefix collision:
        // If webRoot is /tmp/test-web, requesting /../test-web-evil/secret.txt
        // resolves to /tmp/test-web-evil/secret.txt which would pass a naive
        // startsWith('/tmp/test-web') check
        const req = mockReq('/../' + siblingDir.split('/').pop() + '/secret.txt')
        const res = mockRes()
        const handled = handler(req, res)
        expect(handled).toBe(true)
        expect(res._statusCode).toBe(403)
        expect(res._body).toBeNull()
      } finally {
        rmSync(siblingDir, { recursive: true, force: true })
      }
    })
  })

  describe('query strings and fragments', () => {
    it('strips query strings before resolving path', () => {
      const req = mockReq('/index.html?v=123')
      const res = mockRes()
      const handled = handler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(200)
      expect(res._body?.toString()).toBe('<html>hello</html>')
    })
  })

  describe('missing webRoot content', () => {
    it('returns 404 when index.html does not exist and path is unknown', () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), 'static-empty-'))
      const emptyHandler = createStaticHandler(emptyRoot)
      const req = mockReq('/anything')
      const res = mockRes()
      const handled = emptyHandler(req, res)
      expect(handled).toBe(true)
      expect(res._statusCode).toBe(404)
      rmSync(emptyRoot, { recursive: true, force: true })
    })
  })
})
