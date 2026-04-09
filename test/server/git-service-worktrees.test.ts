import { beforeEach, describe, expect, test, vi } from 'vitest'

const { rawMock, branchMock, realpathSyncMock } = vi.hoisted(() => ({
  rawMock: vi.fn(),
  branchMock: vi.fn(),
  realpathSyncMock: vi.fn((worktreePath: string) =>
    worktreePath === '/repo' ? '/private/repo' : worktreePath
  )
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    realpathSync: realpathSyncMock
  }
})

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
    raw: rawMock,
    branch: branchMock
  }))
}))

import { GitService } from '../../src/main/services/git-service'

describe('GitService.listWorktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realpathSyncMock.mockImplementation((worktreePath: string) =>
      worktreePath === '/repo' ? '/private/repo' : worktreePath
    )
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
    expect(realpathSyncMock).toHaveBeenCalledWith('/repo')
  })
})

describe('GitService.archiveWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes the remote-tracking branch after the local branch', async () => {
    rawMock.mockResolvedValue('')
    branchMock.mockResolvedValue({})

    const service = new GitService('/repo')
    const result = await service.archiveWorktree('/worktrees/feat-x', 'feat-x')

    expect(result).toEqual({ success: true })
    expect(branchMock).toHaveBeenCalledTimes(2)
    expect(branchMock).toHaveBeenNthCalledWith(1, ['-D', 'feat-x'])
    expect(branchMock).toHaveBeenNthCalledWith(2, ['-dr', 'origin/feat-x'])
  })

  test('succeeds when remote-tracking ref does not exist', async () => {
    rawMock.mockResolvedValue('')
    branchMock
      .mockResolvedValueOnce({}) // -D succeeds
      .mockRejectedValueOnce(new Error("remote-tracking branch 'origin/feat-x' not found")) // -dr fails

    const service = new GitService('/repo')
    const result = await service.archiveWorktree('/worktrees/feat-x', 'feat-x')

    expect(result).toEqual({ success: true })
  })

  test('succeeds when both local and remote-tracking branch deletions fail', async () => {
    rawMock.mockResolvedValue('')
    branchMock.mockRejectedValue(new Error('branch not found'))

    const service = new GitService('/repo')
    const result = await service.archiveWorktree('/worktrees/feat-x', 'feat-x')

    expect(result).toEqual({ success: true })
  })

  test('skips branch cleanup when worktree removal fails', async () => {
    rawMock.mockRejectedValue(new Error('worktree remove failed'))

    const service = new GitService('/repo')
    const result = await service.archiveWorktree('/worktrees/feat-x', 'feat-x')

    expect(result).toEqual({ success: false, error: 'worktree remove failed' })
    expect(branchMock).not.toHaveBeenCalled()
  })
})
