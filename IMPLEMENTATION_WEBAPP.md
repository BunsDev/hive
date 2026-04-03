# Hive Web Mode: Implementation Plan

## Context

Hive is an Electron app (React 19 + Zustand + Vite) for managing git worktrees with AI coding sessions. It already has a `--headless` mode with a GraphQL server (GraphQL Yoga, port 8443, API key auth, WebSocket subscriptions).

**Goal:** Serve the React frontend as a web app from the headless server, accessible via Chrome from any machine. The Electron app continues using IPC (unchanged). Web mode uses GraphQL as transport.

**Approach:** Transport adapter pattern -- React calls the same `window.*` API shape. In Electron, preload bridge handles it. In web mode, adapters translate to GraphQL.

**Decisions:**
- HTTP mode (`--insecure`) for now. TLS via reverse proxy later.
- Vite dev server with proxy to headless server (no CORS needed).
- Full feature parity -- all 17 adapter modules, all GraphQL schema gaps.

---

## Session 1: Server-Side Foundation

**Goal:** Make the headless server capable of serving static web files and validating auth from a browser.

### Tasks

1. **Create `src/server/static-handler.ts`**
   - Export `createStaticHandler(webRoot: string)` that returns a `(req: IncomingMessage, res: ServerResponse) => boolean` handler
   - Resolve request paths against `webRoot` with path traversal prevention (`..` escaping)
   - Serve files with correct `Content-Type` based on extension (`.js`, `.css`, `.html`, `.svg`, `.png`, `.woff2`, `.ico`, `.json`, `.map`)
   - Cache headers: `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` (hashed filenames), `Cache-Control: no-cache` for `index.html`
   - SPA fallback: any path that doesn't match a file and isn't `/graphql` or `/api/*` serves `index.html`
   - Return `true` if request was handled, `false` to pass through

2. **Create `src/server/plugins/auth-endpoint.ts`**
   - Export `handleAuthEndpoint(req, res, getKeyHash, bruteForce)` function
   - Match only `POST /api/auth/validate`
   - Parse JSON body for `{ apiKey: string }`
   - Call existing `verifyApiKey()` from `src/server/plugins/auth.ts`
   - Respect `BruteForceTracker` -- check `isBlocked()`, call `recordFailure()`/`recordSuccess()`
   - Return `{ valid: true }` with 200, or `{ valid: false, error: string }` with 401/429
   - Return `false` for non-matching requests to pass through

3. **Modify `src/server/config.ts`**
   - Add `webRoot: string | null` field to `HeadlessConfig` (default: `null`)
   - When `null`, runtime resolves to `path.join(__dirname, 'web')` if that directory contains `index.html`

4. **Modify `src/server/index.ts`**
   - Add `webRoot?: string` to `ServerOptions` interface
   - Change server handler from `createHttpServer(yoga)` to `createHttpServer(requestHandler)` where `requestHandler` routes:
     1. `POST /api/auth/validate` -> auth endpoint handler
     2. Path starts with `/graphql` -> `yoga(req, res)`
     3. Everything else -> static handler (if webRoot configured) or yoga fallback
   - Same change for `createHttpsServer` path
   - If `webRoot` is not set or has no `index.html`, behavior is identical to current (no regression)

5. **Modify `src/server/headless-bootstrap.ts`**
   - Pass resolved `webRoot` to `startGraphQLServer()` options
   - Log whether web UI is being served: `"Web UI available at http://..."` or `"Web UI not found, API-only mode"`

### Definition of Done
- `hive --headless --insecure --port 8443` starts successfully
- Placing a test `index.html` in the expected web directory causes it to be served at `http://localhost:8443/`
- `POST http://localhost:8443/api/auth/validate` with correct API key returns `{ valid: true }`
- `POST http://localhost:8443/api/auth/validate` with wrong key returns 401
- `/graphql` endpoint continues to work exactly as before
- Brute force protection works on the auth endpoint
- No changes to Electron app behavior (IPC unaffected)

---

## Session 2: GraphQL Schema Gap-Filling

**Goal:** Add all missing GraphQL operations that have IPC equivalents, so the web adapter layer has complete coverage.

### Tasks

1. **Worktree extensions** -- modify `src/server/schema/types/project.graphql` and `src/server/schema/schema.graphql`
   - **Extend `Worktree` type** to include missing fields: `attachments`, `pinned`, `context`, `github_pr_number`, `github_pr_url` (these exist in the DB schema and `index.d.ts` but are absent from the GraphQL type)
   - **Extend `CreateFromBranchInput`** to include `prNumber` and `nameHint` fields (used by PR checkout flow)
   - Add `AttachmentInput` input type and `Attachment` type
   - Add mutations: `worktreeAddAttachment`, `worktreeRemoveAttachment`, `worktreeAttachPR`, `worktreeDetachPR`, `worktreeSetPinned`
   - Add queries: `pinnedWorktrees`, `recentlyActiveWorktrees(cutoffMs: Int!)`
   - Add resolvers in `src/server/resolvers/mutation/db.resolvers.ts` and `query/db.resolvers.ts`
   - Backing DB methods already exist in `database.ts`

2. **Connection extensions** -- modify schema and resolvers
   - Add mutation: `connectionSetPinned`
   - Add queries: `pinnedConnections`, `connectionOpenInTerminal` (or mark as server-side-only)
   - Add resolvers

3. **Project sorting and detection** -- modify schema and resolvers
   - Add query: `projectIdsSortedByLastMessage`
   - Add queries: `projectFindXcworkspace(projectPath)`, `projectIsAndroidProject(projectPath)`
   - Backing: `database.ts` + filesystem checks from `project-handlers.ts`

4. **Git operations** -- modify `src/server/schema/types/git.graphql`
   - Add types: `GitBranchDiffFile`, `GitBranchDiffFilesResult`, `GitBranchFileDiffResult`, `GitFileContentBase64Result`, `GitPRStateResult`, `PRReviewComment`, `PRReviewUser`, `GitPRReviewCommentsResult`
   - Add queries: `gitBranchDiffFiles`, `gitBranchFileDiff`, `gitFileContentBase64`, `gitRefContentBase64`, `gitPRState`, `gitPRReviewComments`
   - Add resolvers in `src/server/resolvers/query/git.resolvers.ts`
   - Backing: `git-service.ts` methods (`getBranchDiffFiles`, `getBranchFileDiff`) and `git-file-handlers.ts` PR logic

5. **Kanban board** -- create new schema and resolver files
   - Create `src/server/schema/types/kanban.graphql` with `KanbanTicket`, `KanbanTicketColumn` enum, `TicketFollowupMessage`, and input types
   - Add to `schema.graphql`: queries (`kanbanTicket`, `kanbanTicketsByProject`, `kanbanTicketsBySession`, `kanbanFollowupsByTicket`) and mutations (`kanbanCreateTicket`, `kanbanUpdateTicket`, `kanbanDeleteTicket`, `kanbanArchiveTicket`, `kanbanArchiveAllDone`, `kanbanUnarchiveTicket`, `kanbanMoveTicket`, `kanbanReorderTicket`, `kanbanToggleSimpleMode`, `kanbanCreateFollowup`)
   - Create `src/server/resolvers/query/kanban.resolvers.ts`
   - Create `src/server/resolvers/mutation/kanban.resolvers.ts`
   - Backing: `database.ts` lines 1614-1792

6. **Usage tracking** -- create resolver
   - Add queries: `usageFetch`, `usageFetchOpenai` returning `UsageResult` type
   - Create `src/server/resolvers/query/usage.resolvers.ts`
   - Backing: `usage-service.ts`, `openai-usage-service.ts`

7. **File operations** -- extend existing
   - Add query: `fileReadImageAsBase64(filePath)` returning base64 string + mimeType
   - Add resolver in `src/server/resolvers/query/file.resolvers.ts`

8. **OpenCode extensions** -- modify `src/server/schema/types/opencode.graphql`
   - Add mutation: `opencodeCommandApprovalReply(input)` -- needed for command filter approval UI
   - Verify all IPC channels in `opencode-handlers.ts` have GraphQL equivalents

9. **Merge all new resolvers**
   - Update `src/server/resolvers/index.ts` to import and merge kanban + usage resolvers

### Definition of Done
- All new GraphQL operations are callable via the `/graphql` endpoint
- Each new query/mutation returns the expected data shape matching the IPC handler equivalents
- Existing GraphQL operations are unaffected (no regressions)
- Schema validates without errors
- TypeScript compiles cleanly

---

## Session 3: Transport Adapter Foundation + Core Adapters

**Goal:** Create the adapter infrastructure and implement the four most critical adapters (db, opencode, git, file-tree) that cover ~80% of frontend functionality.

### Tasks

1. **Create `src/renderer/src/transport/detect.ts`**
   - Export `detectTransportMode(): 'electron' | 'web'`
   - Check `window.db !== undefined` -- if true, preload ran = Electron. Otherwise = web.
   - Simple, synchronous, no dependencies

2. **Create `src/renderer/src/transport/types.ts`**
   - Re-export Window sub-interfaces as named types: `DbApi = Window['db']`, `GitOpsApi = Window['gitOps']`, etc.
   - References existing `src/preload/index.d.ts` declarations (no duplication)

3. **Create `src/renderer/src/transport/graphql/client.ts`**
   - `initGraphQLClient({ httpUrl, wsUrl, apiKey })` -- configures fetch URL and `graphql-ws` client
   - `graphqlQuery<T>(query, variables?)` -- fetch-based query/mutation execution with Bearer auth header, error extraction
   - `graphqlSubscribe<T>(query, variables, onData, onError?)` -- returns `() => void` cleanup function using `graphql-ws` client
   - No Apollo/urql -- Zustand already manages state. Uses existing `graphql-ws` dependency.

4. **Create `src/renderer/src/transport/graphql/auth.ts`**
   - `getWebAuth(): { serverUrl, apiKey } | null` -- reads from localStorage, with URL param override (`?server=...&key=...`)
   - `saveWebAuth(config)` -- persists to localStorage
   - `clearWebAuth()` -- removes from localStorage
   - On URL param detection: save, then clean URL with `history.replaceState`

5. **Create `src/renderer/src/transport/stubs/electron-only.ts`**
   - `notAvailableInWeb(name)` -- returns async function that logs warning and returns `{ success: false }`
   - `noopSubscription()` -- returns `() => {}` cleanup function
   - `noopAsync()` -- returns `async () => {}`

6. **Create `src/renderer/src/transport/graphql/adapters/db.ts`**
   - Implement full `DbApi` interface using `graphqlQuery()`
   - Covers: `setting.*` (get, set, delete, getAll), `project.*` (create, get, getByPath, getAll, update, delete, touch, reorder, sortByLastMessage), `worktree.*` (full CRUD + archive, touch, updateModel, appendSessionTitle, addAttachment, removeAttachment, attachPR, detachPR, setPinned, getPinned), `session.*` (full CRUD + getByWorktree, getByProject, getActiveByWorktree, getByConnection, search, getDraft, updateDraft), `space.*` (list, create, update, delete, assignProject, removeProject, getProjectIds, getAllAssignments, reorder), `sessionMessage.list`, `sessionActivity.list`
   - Utility methods: `schemaVersion` -> existing GraphQL query `dbSchemaVersion`, `tableExists` and `getIndexes` -> stubs returning safe defaults (these are debug/utility methods)
   - Map GraphQL camelCase responses to snake_case DB row format expected by renderer (or handle in resolvers)

7. **Create `src/renderer/src/transport/graphql/adapters/opencode-ops.ts`**
   - Implement `OpenCodeOpsApi` interface
   - Request-response: `connect`, `reconnect`, `disconnect`, `prompt`, `abort`, `messages`, `sessionInfo`, `setModel`, `models`, `modelInfo`, `undo`, `redo`, `renameSession`, `fork`, `commands`, `capabilities`, `questionReply`, `questionReject`, `planApprove`, `planReject`, `permissionReply`, `permissionList`, `command`, `commandApprovalReply`
   - Critical subscription: `onStream` -> `graphqlSubscribe('opencodeStream(sessionIds)', ...)` -- this is the AI streaming backbone
   - `onQuestion`, `onPermission` events -- map to appropriate GraphQL subscriptions or poll

8. **Create `src/renderer/src/transport/graphql/adapters/git-ops.ts`**
   - Implement `GitOpsApi` interface
   - Request-response: all staging/unstaging, commit, push, pull, merge, diff, branch operations, PR listing/state/comments, file content, branch diff, watch/unwatch
   - Subscriptions: `onStatusChanged` -> `gitStatusChanged`, `onBranchChanged` -> `gitBranchChanged`
   - Electron-only stubs: `openInEditor`, `showInFinder` -> no-op stubs (can't launch desktop apps from browser)

9. **Create `src/renderer/src/transport/graphql/adapters/file-tree-ops.ts`**
   - Implement `FileTreeOpsApi` interface
   - Methods: `scan`, `scanFlat`, `loadChildren`, `watch`, `unwatch`
   - Subscription: `onChange` -> `fileTreeChange(worktreePath)` GraphQL subscription

10. **Create `src/renderer/src/transport/index.ts`** (partial -- bootstrap without all adapters)
    - `installTransport()`: detect mode -> if electron, return -> if web, check auth -> init client -> install core adapters on `window.*`
    - Returns `{ mode: 'electron' | 'web', needsAuth: boolean }`
    - For this session, only installs the 4 core adapters; remaining are added in Session 4

### Definition of Done
- `detect.ts` correctly identifies Electron vs web environments
- GraphQL client can make authenticated queries and subscriptions against the headless server
- The 4 core adapters pass type checking against the `Window` interface in `index.d.ts`
- `installTransport()` in web mode populates `window.db`, `window.opencodeOps`, `window.gitOps`, `window.fileTreeOps` with working GraphQL adapters
- In Electron mode, `installTransport()` is a no-op (zero changes to existing behavior)
- Manual test: loading the renderer in a browser (without Electron) and calling `window.db.project.getAll()` returns data from the headless server

---

## Session 4: Remaining Adapters (Complete Coverage)

**Goal:** Implement all 13 remaining adapter modules for full feature parity.

### Tasks

1. **Create `src/renderer/src/transport/graphql/adapters/terminal-ops.ts`**
   - PTY operations: `create`, `write`, `resize`, `destroy`, `getConfig` via GraphQL mutations/queries
   - Subscriptions: `onData(worktreeId)` -> `terminalData(worktreeId)`, `onExit(worktreeId)` -> `terminalExit(worktreeId)`
   - All Ghostty methods (`init`, `isAvailable`, `shutdown`, `createSurface`, `destroySurface`, `setFocus`, `pasteText`, `keyEvent`, `mouseButton`, `mousePos`, `mouseScroll`, `setFrame`, `setSize`) -> stubs returning `{ success: false }` or no-op. `isAvailable` returns `false`.

2. **Create `src/renderer/src/transport/graphql/adapters/worktree-ops.ts`**
   - Methods: `create`, `delete`, `sync`, `duplicate`, `createFromBranch`, `renameBranch`, `exists`, `hasCommits`, `getContext`, `updateContext`
   - Branch methods: `getBranches` -> GraphQL query `gitBranches`, `branchExists` -> GraphQL query `gitBranchExists`
   - `openInTerminal`, `openInEditor` -> stubs (no OS-level process launch from browser)
   - Subscription: `onBranchRenamed` -> `worktreeBranchRenamed` GraphQL subscription

3. **Create `src/renderer/src/transport/graphql/adapters/project-ops.ts`**
   - Methods: `validateProject`, `detectLanguage`, `loadLanguageIcons`, `findXcworkspace`, `isAndroidProject`, `getProjectIconPath`, `isGitRepository`
   - `openDirectoryDialog` -> web alternative: return empty/null (UI will show text input instead of native dialog)
   - `showInFolder`, `openPath` -> stubs (log warning)
   - `copyToClipboard` -> `navigator.clipboard.writeText()`
   - `readFromClipboard` -> `navigator.clipboard.readText()`
   - `pickProjectIcon` -> stub (web file upload handled differently)
   - `removeProjectIcon` -> GraphQL mutation `projectRemoveIcon`
   - `initRepository` -> GraphQL mutation `projectInitRepository`

4. **Create `src/renderer/src/transport/graphql/adapters/connection-ops.ts`**
   - Methods: `create`, `delete`, `rename`, `get`, `getAll`, `getPinned`, `addMember`, `removeMember`, `removeWorktreeFromAll`, `setPinned`
   - `openInTerminal`, `openInEditor` -> stubs

5. **Create `src/renderer/src/transport/graphql/adapters/system-ops.ts`**
   - `getLogDir` -> GraphQL query `systemLogDir`
   - `getAppVersion` -> GraphQL query `systemAppVersion`
   - `getAppPaths` -> GraphQL query `systemAppPaths`
   - `detectAgentSdks` -> GraphQL query `systemDetectAgentSdks`
   - `getPlatform` -> `navigator.userAgent` parsing (use existing `src/renderer/src/lib/platform.ts` logic)
   - `isPackaged` -> return `false`
   - `isLogMode` -> return `false`
   - `quitApp` -> no-op
   - `openInApp` -> stub for Cursor/Ghostty/Android Studio; for URLs use `window.open()`
   - `openInChrome` -> `window.open(url, '_blank')`
   - `installServerToPath`, `uninstallServerFromPath` -> stubs
   - `onNewSessionShortcut` -> `document.addEventListener('keydown', ...)` for Cmd/Ctrl+T
   - `onCloseSessionShortcut` -> keyboard listener for Cmd/Ctrl+W (with `preventDefault`)
   - `onFileSearchShortcut` -> keyboard listener for Cmd/Ctrl+D
   - `onWindowFocused` -> `document.addEventListener('visibilitychange')` + `window.addEventListener('focus')`
   - `onEditPaste` -> no-op (browser handles paste natively)
   - `onNotificationNavigate` -> no-op stub (no native OS notification deep-links in browser)
   - `updateMenuState`, `onMenuAction` -> no-op stubs (no native app menu in browser)

6. **Create `src/renderer/src/transport/graphql/adapters/settings-ops.ts`**
   - `detectEditors` -> GraphQL query `detectedEditors`
   - `detectTerminals` -> GraphQL query `detectedTerminals`
   - `openWithEditor`, `openWithTerminal` -> stubs (can't launch desktop apps from browser)
   - `onSettingsUpdated` -> no-op subscription stub (settings changes are local in web mode)

7. **Create `src/renderer/src/transport/graphql/adapters/file-ops.ts`**
   - `readFile` -> GraphQL query `fileRead`
   - `readImageAsBase64` -> GraphQL query `fileReadImageAsBase64`
   - `readPrompt` -> GraphQL query `fileReadPrompt`
   - `writeFile` -> GraphQL mutation `fileWrite`
   - `getPathForFile` -> return `file.name` (browser has no real path access via `webUtils`)
   - Note: verify exact interface in `index.d.ts` -- only implement methods that exist in the type definition

8. **Create `src/renderer/src/transport/graphql/adapters/script-ops.ts`**
   - Methods: `runSetup`, `runProject`, `kill`, `runArchive` via GraphQL mutations
   - `getPort` -> GraphQL query `scriptPort`
   - `onOutput` / `offOutput` -> `scriptOutput(worktreeId, channel)` GraphQL subscription with internal tracking of active subscriptions per channel

9. **Create `src/renderer/src/transport/graphql/adapters/logging-ops.ts`**
   - `createResponseLog` -> GraphQL mutation `createResponseLog`
   - `appendResponseLog` -> GraphQL mutation `appendResponseLog`

10. **Create `src/renderer/src/transport/graphql/adapters/updater-ops.ts`**
    - All methods stubbed: `check` -> `{ available: false }`, `download` -> no-op, `install` -> no-op, `setChannel` -> no-op
    - `getVersion` -> GraphQL query `systemAppVersion`
    - All event subscriptions (`onAvailable`, `onProgress`, etc.) -> `noopSubscription()`

11. **Create `src/renderer/src/transport/graphql/adapters/usage-ops.ts`**
    - `fetch` -> GraphQL query `usageFetch`
    - `fetchOpenai` -> GraphQL query `usageFetchOpenai`

12. **Create `src/renderer/src/transport/graphql/adapters/analytics-ops.ts`**
    - `isEnabled` -> return `false`
    - `setEnabled` -> no-op
    - `track` -> no-op (or POST to a lightweight endpoint if analytics desired in web mode)

13. **Create `src/renderer/src/transport/graphql/adapters/kanban.ts`**
    - Full CRUD: `ticket.create`, `ticket.get`, `ticket.getByProject`, `ticket.update`, `ticket.delete`, `ticket.archive`, `ticket.archiveAllDone`, `ticket.unarchive`, `ticket.move`, `ticket.reorder`, `ticket.getBySession`
    - `followup.create`, `followup.getByTicket`
    - `simpleMode.toggle`
    - All via GraphQL queries/mutations

14. **Update `src/renderer/src/transport/index.ts`**
    - Import and install all 17 adapters in `installTransport()` for web mode
    - Complete the full `window.*` assignment

### Definition of Done
- All 17 adapter modules compile against the `Window` interface types from `index.d.ts`
- `installTransport()` populates every `window.*` API module
- Keyboard shortcuts (Cmd+T, Cmd+D, Cmd+W) work via browser event listeners in web mode
- Clipboard operations use `navigator.clipboard` API in web mode
- All Ghostty methods safely return stubs without errors
- Electron mode is completely unaffected

---

## Session 5: Web Auth Screen, Entry Point, and Build Pipeline

**Goal:** Create the web login experience, modify the app entry point, and set up the build pipeline.

### Tasks

1. **Create `src/renderer/src/components/WebAuthScreen.tsx`**
   - Clean login UI using existing shadcn/ui components and Tailwind
   - Fields: Server URL (defaults to `window.location.origin` when served from headless), API Key (password input)
   - "Connect" button: POST to `/api/auth/validate` -> on success, `saveWebAuth()` and reload
   - Error states: invalid key, server unreachable, rate limited (429)
   - "Disconnect" action accessible from web mode to clear auth and return to login
   - Responsive layout that works on various screen sizes

2. **Modify `src/renderer/src/main.tsx`**
   - Import `installTransport` from `./transport`
   - Call `installTransport()` before `ReactDOM.createRoot`
   - Conditionally render `<WebAuthScreen />` when `needsAuth` is true, otherwise render `<App />`
   - Minimal change (3-5 lines added)

3. **Create `vite.config.web.ts`**
   - Use same React and Tailwind plugins as the renderer section in `electron.vite.config.ts`
   - Set `root` to `src/renderer`
   - Output to `dist/web/`
   - `base: '/'`
   - Dev server proxy configuration:
     ```
     '/graphql' -> 'http://localhost:8443' (with ws: true for WebSocket)
     '/api'     -> 'http://localhost:8443'
     ```
   - Resolve aliases matching existing config (`@shared`, `@renderer`, etc.)

4. **Update `package.json`**
   - Add `"dev:web": "vite --config vite.config.web.ts"` -- starts Vite dev server with proxy
   - Add `"build:web": "vite build --config vite.config.web.ts"` -- production build to `dist/web/`
   - Add `"build:headless": "pnpm build:web && cp -r dist/web out/web"` -- copies web build alongside server output

5. **Update `src/server/headless-bootstrap.ts`**
   - Auto-resolve `webRoot`: check `path.join(__dirname, '..', '..', 'out', 'web')` for `index.html`
   - Pass to `startGraphQLServer()`
   - Console output: `"Web UI: http://{bind}:{port}/"` when web root found, or `"Web UI: not bundled (API-only mode)"` otherwise

### Definition of Done
- `pnpm dev:web` starts Vite dev server on port 5173 with hot reload
- Navigating to `http://localhost:5173` shows the login screen
- After entering API key, the full Hive UI loads with data from the headless server
- `pnpm build:web` produces a production build in `dist/web/`
- `pnpm build:headless` creates a complete bundle with web assets
- Running `hive --headless --insecure` with bundled web assets serves the UI at `http://localhost:8443/`
- Electron app (`pnpm dev`) works identically to before -- no regressions

---

## Session 6: UI Adjustments and Integration Testing

**Goal:** Polish the web experience by hiding Electron-only features and perform end-to-end testing.

### Tasks

1. **Create `src/renderer/src/hooks/useIsWebMode.ts`**
   - Export `useIsWebMode()` hook that returns `boolean`
   - Backed by `detectTransportMode()` from `transport/detect.ts`
   - Memoized -- detection only runs once

2. **Conditional UI hiding** -- modify components that render Electron-only features:
   - "Open in Cursor" / "Open in Ghostty" / "Open in Android Studio" buttons -> hide when `isWebMode`
   - "Show in Finder" / "Reveal in Explorer" -> change label to "Copy Path" and copy to clipboard instead
   - Native file picker trigger -> show a text input with path entry instead
   - Auto-updater notification/banner -> hide when `isWebMode`
   - Ghostty terminal option in terminal selector -> hide when `isWebMode` (only show xterm.js)
   - "Install CLI" / "Uninstall CLI" options -> hide when `isWebMode`
   - "Quit App" menu item -> hide when `isWebMode`

3. **Web-specific additions:**
   - Add "Disconnect" button in settings/header for web mode (calls `clearWebAuth()` + reload)
   - Show connection status indicator (connected to `server:port`)
   - Handle GraphQL client disconnect/reconnect gracefully (show reconnecting UI)

4. **End-to-end testing checklist:**
   - [ ] Projects: create, list, update, delete, reorder
   - [ ] Worktrees: create, delete, sync, duplicate, archive
   - [ ] Sessions: create, connect, stream AI responses, abort, rename, disconnect
   - [ ] Git: view file statuses, stage/unstage, commit, push, pull, view diffs, branch switching
   - [ ] Terminal: create xterm.js terminal, type commands, see output, resize, destroy
   - [ ] File tree: scan directory, watch for changes, navigate files
   - [ ] Kanban: create tickets, move between columns, archive
   - [ ] Keyboard shortcuts: Cmd/Ctrl+T (new session), Cmd/Ctrl+D (file search), Cmd/Ctrl+W (close session)
   - [ ] Clipboard: copy/paste text works
   - [ ] Settings: detect editors/terminals, change settings
   - [ ] Connections: create multiplexed worktree connections
   - [ ] Scripts: run setup/project scripts, see output
   - [ ] Auth: login, disconnect, re-login, brute force lockout after 5 attempts
   - [ ] Electron regression: all above features still work in the Electron app via IPC

5. **Fix any issues found during testing**

### Definition of Done
- All Electron-only UI elements are hidden in web mode without affecting Electron mode
- "Disconnect" and connection status are visible in web mode
- All 14 end-to-end test scenarios pass in web mode (Chrome)
- All 14 end-to-end test scenarios pass in Electron mode (regression check)
- No TypeScript compilation errors
- No console errors in either mode

---

## Files Summary

### Created (new files)
| File | Session |
|------|---------|
| `src/server/static-handler.ts` | 1 |
| `src/server/plugins/auth-endpoint.ts` | 1 |
| `src/server/schema/types/kanban.graphql` | 2 |
| `src/server/resolvers/query/kanban.resolvers.ts` | 2 |
| `src/server/resolvers/mutation/kanban.resolvers.ts` | 2 |
| `src/server/resolvers/query/usage.resolvers.ts` | 2 |
| `src/renderer/src/transport/detect.ts` | 3 |
| `src/renderer/src/transport/types.ts` | 3 |
| `src/renderer/src/transport/index.ts` | 3 |
| `src/renderer/src/transport/graphql/client.ts` | 3 |
| `src/renderer/src/transport/graphql/auth.ts` | 3 |
| `src/renderer/src/transport/stubs/electron-only.ts` | 3 |
| `src/renderer/src/transport/graphql/adapters/db.ts` | 3 |
| `src/renderer/src/transport/graphql/adapters/opencode-ops.ts` | 3 |
| `src/renderer/src/transport/graphql/adapters/git-ops.ts` | 3 |
| `src/renderer/src/transport/graphql/adapters/file-tree-ops.ts` | 3 |
| `src/renderer/src/transport/graphql/adapters/terminal-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/worktree-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/project-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/connection-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/system-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/settings-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/file-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/script-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/logging-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/updater-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/usage-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/analytics-ops.ts` | 4 |
| `src/renderer/src/transport/graphql/adapters/kanban.ts` | 4 |
| `src/renderer/src/components/WebAuthScreen.tsx` | 5 |
| `vite.config.web.ts` | 5 |
| `src/renderer/src/hooks/useIsWebMode.ts` | 6 |

### Modified (existing files)
| File | Session | Change |
|------|---------|--------|
| `src/server/config.ts` | 1 | Add `webRoot` field |
| `src/server/index.ts` | 1 | Request routing (static + auth + yoga) |
| `src/server/headless-bootstrap.ts` | 1, 5 | Pass webRoot, log web UI status |
| `src/server/schema/schema.graphql` | 2 | Add new Query/Mutation entries |
| `src/server/schema/types/project.graphql` | 2 | Worktree type fields, attachment/pinning types |
| `src/server/schema/types/git.graphql` | 2 | Branch diff, base64, PR types |
| `src/server/schema/types/opencode.graphql` | 2 | Command approval reply mutation |
| `src/server/schema/types/results.graphql` | 2 | New result types |
| `src/server/resolvers/index.ts` | 2 | Merge new resolvers |
| `src/server/resolvers/query/git.resolvers.ts` | 2 | Branch diff, PR resolvers |
| `src/server/resolvers/query/db.resolvers.ts` | 2 | Sorting/pinning/recently-active queries |
| `src/server/resolvers/mutation/db.resolvers.ts` | 2 | Attachment/pinning mutations |
| `src/renderer/src/main.tsx` | 5 | 3-5 lines: import transport, conditional render |
| `package.json` | 5 | Add dev:web, build:web, build:headless scripts |
| Various UI components | 6 | Conditional hiding with `useIsWebMode()` |

---

## Key Risks & Mitigations

**OpenCode SDK unavailable in headless**: The headless bootstrap stubs OpenCode. Only Claude Code and Codex work in headless mode. This is an existing limitation, not introduced by this change.

**Terminal `write` is fire-and-forget**: IPC uses `ipcRenderer.send` (no response). The GraphQL `terminalWrite` mutation returns a boolean. The adapter ignores the return value.

**`webUtils.getPathForFile`**: Electron's file path utility doesn't exist in browsers. The adapter returns `file.name` instead. Drag-drop file upload may need a web-specific flow.

**Network security**: Using HTTP mode (`--insecure`) means traffic is unencrypted. Fine for localhost/LAN use. For remote access over the internet, add a reverse proxy (nginx/caddy) with a valid TLS cert later.
