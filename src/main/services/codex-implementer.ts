import type { BrowserWindow } from 'electron'

import type { AgentSdkCapabilities, AgentSdkImplementer } from './agent-sdk-types'
import { CODEX_CAPABILITIES } from './agent-sdk-types'
import { getAvailableCodexModels, getCodexModelInfo, CODEX_DEFAULT_MODEL } from './codex-models'
import { createLogger } from './logger'
import { CodexAppServerManager } from './codex-app-server-manager'

const log = createLogger({ component: 'CodexImplementer' })

// ── Session state ─────────────────────────────────────────────────

export interface CodexSessionState {
  threadId: string
  hiveSessionId: string
  worktreePath: string
  status: 'connecting' | 'ready' | 'running' | 'error' | 'closed'
  messages: unknown[]
}

export class CodexImplementer implements AgentSdkImplementer {
  readonly id = 'codex' as const
  readonly capabilities: AgentSdkCapabilities = CODEX_CAPABILITIES

  private mainWindow: BrowserWindow | null = null
  private selectedModel: string = CODEX_DEFAULT_MODEL
  private selectedVariant: string | undefined
  private manager: CodexAppServerManager = new CodexAppServerManager()
  private sessions = new Map<string, CodexSessionState>()

  // ── Window binding ───────────────────────────────────────────────

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async connect(worktreePath: string, hiveSessionId: string): Promise<{ sessionId: string }> {
    log.info('Connecting', { worktreePath, hiveSessionId, model: this.selectedModel })

    const providerSession = await this.manager.startSession({
      cwd: worktreePath,
      model: this.selectedModel
    })

    const threadId = providerSession.threadId
    if (!threadId) {
      throw new Error('Codex session started but no thread ID was returned.')
    }

    const key = this.getSessionKey(worktreePath, threadId)
    const state: CodexSessionState = {
      threadId,
      hiveSessionId,
      worktreePath,
      status: this.mapProviderStatus(providerSession.status),
      messages: []
    }
    this.sessions.set(key, state)

    // Notify renderer that the session has materialized
    this.sendToRenderer('opencode:stream', {
      type: 'session.materialized',
      sessionId: hiveSessionId,
      data: { newSessionId: threadId, wasFork: false }
    })

    log.info('Connected', { worktreePath, hiveSessionId, threadId })
    return { sessionId: threadId }
  }

  async reconnect(
    worktreePath: string,
    agentSessionId: string,
    hiveSessionId: string
  ): Promise<{
    success: boolean
    sessionStatus?: 'idle' | 'busy' | 'retry'
    revertMessageID?: string | null
  }> {
    const key = this.getSessionKey(worktreePath, agentSessionId)

    // If session already exists locally, just update the hiveSessionId
    const existing = this.sessions.get(key)
    if (existing) {
      existing.hiveSessionId = hiveSessionId
      const sessionStatus = this.statusToHive(existing.status)
      log.info('Reconnect: session already registered, updated hiveSessionId', {
        worktreePath,
        agentSessionId,
        hiveSessionId,
        sessionStatus
      })
      return { success: true, sessionStatus, revertMessageID: null }
    }

    // Otherwise, start a new session with thread resume
    try {
      const providerSession = await this.manager.startSession({
        cwd: worktreePath,
        model: this.selectedModel,
        resumeThreadId: agentSessionId
      })

      const threadId = providerSession.threadId
      if (!threadId) {
        throw new Error('Codex session started but no thread ID was returned.')
      }

      const newKey = this.getSessionKey(worktreePath, threadId)
      const state: CodexSessionState = {
        threadId,
        hiveSessionId,
        worktreePath,
        status: this.mapProviderStatus(providerSession.status),
        messages: []
      }
      this.sessions.set(newKey, state)

      log.info('Reconnected via thread resume', { worktreePath, agentSessionId, threadId })
      return { success: true, sessionStatus: this.statusToHive(state.status), revertMessageID: null }
    } catch (error) {
      log.error(
        'Reconnect failed',
        error instanceof Error ? error : new Error(String(error)),
        { worktreePath, agentSessionId }
      )
      return { success: false }
    }
  }

  async disconnect(worktreePath: string, agentSessionId: string): Promise<void> {
    const key = this.getSessionKey(worktreePath, agentSessionId)
    const session = this.sessions.get(key)

    if (!session) {
      log.warn('Disconnect: session not found, ignoring', { worktreePath, agentSessionId })
      return
    }

    // Stop the manager session
    this.manager.stopSession(agentSessionId)

    // Clean up local state
    this.sessions.delete(key)

    log.info('Disconnected', { worktreePath, agentSessionId })
  }

  async cleanup(): Promise<void> {
    log.info('Cleaning up CodexImplementer state', { sessionCount: this.sessions.size })

    // Stop all manager sessions
    this.manager.stopAll()

    // Clear local state
    this.sessions.clear()
    this.mainWindow = null
    this.selectedModel = CODEX_DEFAULT_MODEL
    this.selectedVariant = undefined
  }

  // ── Messaging ────────────────────────────────────────────────────

  async prompt(
    _worktreePath: string,
    _agentSessionId: string,
    _message:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'file'; mime: string; url: string; filename?: string }
        >,
    _modelOverride?: { providerID: string; modelID: string; variant?: string }
  ): Promise<void> {
    throw new Error('CodexImplementer.prompt() not yet implemented')
  }

  async abort(_worktreePath: string, _agentSessionId: string): Promise<boolean> {
    throw new Error('CodexImplementer.abort() not yet implemented')
  }

  async getMessages(_worktreePath: string, _agentSessionId: string): Promise<unknown[]> {
    throw new Error('CodexImplementer.getMessages() not yet implemented')
  }

  // ── Models ───────────────────────────────────────────────────────

  async getAvailableModels(): Promise<unknown> {
    return getAvailableCodexModels()
  }

  async getModelInfo(
    _worktreePath: string,
    modelId: string
  ): Promise<{
    id: string
    name: string
    limit: { context: number; input?: number; output: number }
  } | null> {
    return getCodexModelInfo(modelId)
  }

  setSelectedModel(model: { providerID: string; modelID: string; variant?: string }): void {
    this.selectedModel = model.modelID
    this.selectedVariant = model.variant
    log.info('Selected model set', { model: model.modelID, variant: model.variant })
  }

  // ── Session info ─────────────────────────────────────────────────

  async getSessionInfo(
    _worktreePath: string,
    _agentSessionId: string
  ): Promise<{
    revertMessageID: string | null
    revertDiff: string | null
  }> {
    throw new Error('CodexImplementer.getSessionInfo() not yet implemented')
  }

  // ── Human-in-the-loop ────────────────────────────────────────────

  async questionReply(
    _requestId: string,
    _answers: string[][],
    _worktreePath?: string
  ): Promise<void> {
    throw new Error('CodexImplementer.questionReply() not yet implemented')
  }

  async questionReject(_requestId: string, _worktreePath?: string): Promise<void> {
    throw new Error('CodexImplementer.questionReject() not yet implemented')
  }

  async permissionReply(
    _requestId: string,
    _decision: 'once' | 'always' | 'reject',
    _worktreePath?: string
  ): Promise<void> {
    throw new Error('CodexImplementer.permissionReply() not yet implemented')
  }

  async permissionList(_worktreePath?: string): Promise<unknown[]> {
    throw new Error('CodexImplementer.permissionList() not yet implemented')
  }

  // ── Undo/Redo ────────────────────────────────────────────────────

  async undo(
    _worktreePath: string,
    _agentSessionId: string,
    _hiveSessionId: string
  ): Promise<unknown> {
    throw new Error('CodexImplementer.undo() not yet implemented')
  }

  async redo(
    _worktreePath: string,
    _agentSessionId: string,
    _hiveSessionId: string
  ): Promise<unknown> {
    throw new Error('CodexImplementer.redo() not yet implemented')
  }

  // ── Commands ─────────────────────────────────────────────────────

  async listCommands(_worktreePath: string): Promise<unknown[]> {
    throw new Error('CodexImplementer.listCommands() not yet implemented')
  }

  async sendCommand(
    _worktreePath: string,
    _agentSessionId: string,
    _command: string,
    _args?: string
  ): Promise<void> {
    throw new Error('CodexImplementer.sendCommand() not yet implemented')
  }

  // ── Session management ───────────────────────────────────────────

  async renameSession(
    _worktreePath: string,
    _agentSessionId: string,
    _name: string
  ): Promise<void> {
    throw new Error('CodexImplementer.renameSession() not yet implemented')
  }

  // ── Internal helpers (exposed for testing) ───────────────────────

  /** @internal */
  getSelectedModel(): string {
    return this.selectedModel
  }

  /** @internal */
  getSelectedVariant(): string | undefined {
    return this.selectedVariant
  }

  /** @internal */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /** @internal */
  getManager(): CodexAppServerManager {
    return this.manager
  }

  /** @internal */
  getSessions(): Map<string, CodexSessionState> {
    return this.sessions
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getSessionKey(worktreePath: string, agentSessionId: string): string {
    return `${worktreePath}::${agentSessionId}`
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    } else {
      log.debug('sendToRenderer: no window (headless)')
    }
  }

  private mapProviderStatus(
    status: 'connecting' | 'ready' | 'running' | 'error' | 'closed'
  ): CodexSessionState['status'] {
    return status
  }

  private statusToHive(
    status: CodexSessionState['status']
  ): 'idle' | 'busy' | 'retry' {
    if (status === 'running') return 'busy'
    return 'idle'
  }
}
