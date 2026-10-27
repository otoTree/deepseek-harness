/** Version-one public Host operations provided by the verified Arivo plugin artifact. */
export interface ArivoLanguageInput {
  protocolVersion: 1
  messages: ({ role: 'system' | 'user'; content: { type: 'text'; text: string }[] }
    | { role: 'assistant'; content: ({ type: 'text'; text: string } | { type: 'tool-call'; id: string; name: string; arguments: string })[] }
    | { role: 'tool'; toolCallId: string; content: { type: 'text'; text: string }[] })[]
  tools: { name: string; description: string; parameters: Record<string, unknown> }[]
  maxOutputTokens: number
  temperature?: number
}

/** Frozen local command identities and cloud billing scope; contains no native credentials. */
export interface ArivoLanguageStep {
  commandId: string
  cloudWorkspaceId: string
  cloudProjectId: string
  adapterId: string
  sessionId: string
  stepId: string
  input: ArivoLanguageInput
}

/** Validated durable event exposed by the plugin after local commit. */
export interface ArivoLanguageEvent {
  protocolVersion: 1
  callId: string
  attemptId: string
  sequence: number
  event: { type: 'block-start'; index: number; kind: 'text' | 'reasoning' | 'tool-call'; id?: string; name?: string }
    | { type: 'text-delta' | 'reasoning-delta'; index: number; text: string }
    | { type: 'tool-call-delta'; index: number; id: string; name: string; arguments: string }
    | { type: 'block-end'; index: number; block: { type: 'text' | 'reasoning'; text: string } | { type: 'tool-call'; id: string; name: string; arguments: string } }
    | { type: 'usage'; usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } }
    | { type: 'finish'; reason: 'stop' | 'tool-calls' | 'max-tokens' | 'aborted' | 'error'; code?: string }
}

/** Creator-authorized catalog metadata; model routes use adapter IDs, never provider keys. */
export interface ArivoLanguageModel {
  id: string
  displayName: string
  protocolVersion: 1
  tools: boolean
  maxOutputTokens: number
}

/** Account-fenced disposable handle. Closing it does not cancel accepted cloud work. */
export interface ArivoLanguageHandle {
  protocolVersion: number
  catalog?: {
    protocolVersion: number
    workspaces(signal: AbortSignal, cursor?: string): Promise<{ items: { id: string; name: string }[]; nextCursor: string | null }>
    projects(workspace: string, signal: AbortSignal, cursor?: string):
    Promise<{ items: { id: string; name: string }[]; nextCursor: string | null }>
  }
  session: {
    models(scope: { cloudWorkspaceId: string; cloudProjectId: string }, signal: AbortSignal, cursor?: string):
    Promise<{ items: ArivoLanguageModel[]; nextCursor: string | null }>
    run(step: ArivoLanguageStep, signal: AbortSignal): AsyncIterable<ArivoLanguageEvent>
    stop(commandId: string): Promise<unknown>
  }
  dispose(): void
}

/** Public same-process release operation; both sides require protocol version one. */
export interface ArivoLanguageHost {
  /** Open an account-fenced handle owned and disposed by the caller. */
  languageSession(): Promise<ArivoLanguageHandle>
}
