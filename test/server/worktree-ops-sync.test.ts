import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DatabaseService } from '../../src/main/db/database'

const { existsSyncMock, listWorktreesMock, pruneWorktreesMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  listWorktreesMock: vi.fn(),
  pruneWorktreesMock: vi.fn()
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: existsSyncMock
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

vi.mock('../../src/main/services/git-service', async () => {
  return {
    createGitService: vi.fn(() => ({
      listWorktrees: listWorktreesMock,
      pruneWorktrees: pruneWorktreesMock
    })),
    isAutoNamedBranch: vi.fn(() => false)
  }
})

import { syncWorktreesOp } from '../../src/main/services/worktree-ops'

function createDbMock(overrides: Record<string, unknown> = {}) {
  return {
    getActiveWorktreesByProject: vi.fn(() => []),
    createWorktree: vi.fn(),
    updateWorktree: vi.fn(),
    archiveWorktree: vi.fn(),
    ...overrides
  } as unknown as DatabaseService
}

describe('syncWorktreesOp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSyncMock.mockReturnValue(false)
    listWorktreesMock.mockResolvedValue([])
    pruneWorktreesMock.mockResolvedValue(undefined)
  })

  test('imports git worktrees missing from the database and skips the main project path', async () => {
    listWorktreesMock.mockResolvedValue([
      { path: '/repos/app', branch: 'main', isMain: true },
      { path: '/external/feat-auth', branch: 'feat/auth', isMain: false }
    ])

    const db = createDbMock({
      getActiveWorktreesByProject: vi.fn(() => [
        {
          id: 'wt-default',
          path: '/repos/app',
          branch_name: 'main',
          name: '(no-worktree)',
          is_default: true,
          branch_renamed: 0
        }
      ])
    })

    const result = await syncWorktreesOp(db, {
      projectId: 'proj-1',
      projectPath: '/repos/app'
    })

    expect(result).toEqual({ success: true })
    expect(db.createWorktree).toHaveBeenCalledTimes(1)
    expect(db.createWorktree).toHaveBeenCalledWith({
      project_id: 'proj-1',
      name: 'feat/auth',
      branch_name: 'feat/auth',
      path: '/external/feat-auth'
    })
    expect(pruneWorktreesMock).toHaveBeenCalledOnce()
  })

  test('falls back to the worktree folder name when git has no branch name', async () => {
    listWorktreesMock.mockResolvedValue([
      { path: '/external/detached-preview', branch: '', isMain: false }
    ])

    const db = createDbMock()

    await syncWorktreesOp(db, {
      projectId: 'proj-1',
      projectPath: '/repos/app'
    })

    expect(db.createWorktree).toHaveBeenCalledWith({
      project_id: 'proj-1',
      name: 'detached-preview',
      branch_name: '',
      path: '/external/detached-preview'
    })
  })

  test('archives stale non-default database worktrees that are missing from git and disk', async () => {
    const db = createDbMock({
      getActiveWorktreesByProject: vi.fn(() => [
        {
          id: 'wt-default',
          path: '/repos/app',
          branch_name: 'main',
          name: '(no-worktree)',
          is_default: true,
          branch_renamed: 0
        },
        {
          id: 'wt-stale',
          path: '/external/stale',
          branch_name: 'feat/stale',
          name: 'feat/stale',
          is_default: false,
          branch_renamed: 0
        }
      ])
    })

    await syncWorktreesOp(db, {
      projectId: 'proj-1',
      projectPath: '/repos/app'
    })

    expect(db.archiveWorktree).toHaveBeenCalledTimes(1)
    expect(db.archiveWorktree).toHaveBeenCalledWith('wt-stale')
  })
})
