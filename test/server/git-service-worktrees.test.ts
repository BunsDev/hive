import { beforeEach, describe, expect, test, vi } from 'vitest'

const rawMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('../../src/main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    raw: rawMock
  }))
}))

import { GitService } from '../../src/main/services/git-service'

describe('GitService.listWorktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('includes detached HEAD worktrees with an empty branch name', async () => {
    rawMock.mockResolvedValue(
      [
        'worktree /repo',
        'HEAD 1111111',
        'branch refs/heads/main',
        '',
        'worktree /detached-preview',
        'HEAD 2222222',
        'detached',
        ''
      ].join('\n')
    )

    const service = new GitService('/repo')

    await expect(service.listWorktrees()).resolves.toEqual([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/detached-preview', branch: '', isMain: false }
    ])
  })
})
