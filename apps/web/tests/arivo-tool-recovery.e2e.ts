/** Packaged original Agent tool recovery. Cloud replies are explicitly unpaid fixtures. */
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, TOOL_OUTCOME_UNKNOWN } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { ArivoRuntime } from '../../electrobun/src/distribution/arivo-runtime.ts'

const execute = promisify(execFile)
interface Input { tools: { name: string }[]; messages: { role: string; toolCallId?: string; content: { text?: string }[] }[] }

it.skipIf(!process.env.ARIVO_TEST_APPLICATION || process.platform !== 'darwin')('packaged Agent preserves an interrupted bash effect and resumes unknown outcome without replay', async (context) => {
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-packaged-tool-')), home = join(temporary, 'home'), workspace = join(temporary, 'workspace')
  await mkdir(workspace, { mode: 0o700 })
  const workspaceId = randomUUID(), projectId = randomUUID(), adapterId = randomUUID(), userId = randomUUID()
  const failures: string[] = [], commands: string[] = [], pageErrors: string[] = []
  const counts = { quotes: 0, creates: 0, streams: 0, reads: 0, cancels: 0, agentCreates: 0, auxiliaryCreates: 0 }
  const calls = new Map<string, { call: Record<string, unknown>; events: Record<string, unknown>[] }>()
  const command = "printf 'once\\n' >> effect; printf '%s' \"$$\" > effect-ready; exec /bin/sleep 300"
  const server = createServer((req, res) => { void (async () => {
    expect(req.headers.authorization).toBe('Bearer ' + 'a'.repeat(43))
    expect(req.headers.cookie).toBeUndefined(); expect(req.headers.origin).toBeUndefined()
    const parts: Buffer[] = []; for await (const part of req as AsyncIterable<Buffer>) parts.push(part)
    const body = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) as { input: Input; adapterId: string } : undefined
    const path = new URL(req.url!, 'http://127.0.0.1').pathname
    const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (path === '/api/v1/workspaces') { json({ items: [{ id: workspaceId, name: 'Owned tool space', status: 'active' }], nextCursor: null }); return }
    if (path === '/api/v1/projects') { json({ items: [{ id: projectId, workspaceId, name: 'Owned tool project', status: 'active' }], nextCursor: null }); return }
    expect(req.headers['x-workspace-id']).toBe(workspaceId); expect(req.headers['x-project-id']).toBe(projectId)
    if (path === '/api/v1/language-models') { json({ items: [{ id: adapterId, key: 'unpaid-tool', displayName: 'Unpaid tool model', model: 'fixture', configVersion: 1, protocolVersion: 1, tools: true, maxOutputTokens: 4096 }], nextCursor: null }); return }
    if (path === '/api/v1/language-calls/quote') { counts.quotes++; expect(body?.adapterId).toBe(adapterId); json({ protocolVersion: 1, inputHash: 'c'.repeat(64), adapterConfigVersion: 1, estimatedCredits: '0.1' }); return }
    if (path === '/api/v1/language-calls' && req.method === 'POST') {
      counts.creates++; commands.push(String(req.headers['idempotency-key']))
      const auxiliary = body!.input.tools.length === 0
      if (auxiliary) { counts.auxiliaryCreates++; expect(counts.auxiliaryCreates).toBe(1) }
      else { counts.agentCreates++; expect(counts.agentCreates).toBeLessThanOrEqual(2); expect(body!.input.tools.map(tool => tool.name)).toContain('bash') }
      const callId = randomUUID(), attemptId = randomUUID(), now = new Date().toISOString()
      let output: Record<string, unknown>[]
      if (auxiliary) output = [
        { type: 'block-start', index: 0, kind: 'text' }, { type: 'text-delta', index: 0, text: 'Arivo packaged interruption' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'Arivo packaged interruption' } }, { type: 'finish', reason: 'stop' },
      ]
      else if (counts.agentCreates === 1) output = [
        { type: 'block-start', index: 0, kind: 'tool-call', id: 'owned-bash-effect', name: 'bash' },
        { type: 'tool-call-delta', index: 0, id: 'owned-bash-effect', name: 'bash', arguments: JSON.stringify({ command, description: 'Record owned effect and await interruption', timeoutMs: 300000 }) },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'owned-bash-effect', name: 'bash', arguments: JSON.stringify({ command, description: 'Record owned effect and await interruption', timeoutMs: 300000 }) } },
        { type: 'finish', reason: 'tool-calls' },
      ]
      else {
        const recovered = body!.input.messages.find(message => message.role === 'tool')
        expect(recovered?.toolCallId).toMatch(/^arivo_[a-f0-9]{64}$/u)
        expect(recovered?.content.some(block => block.text?.includes('Do not retry blindly.'))).toBe(true)
        output = [{ type: 'block-start', index: 0, kind: 'text' }, { type: 'text-delta', index: 0, text: 'VERIFY_EXTERNAL_STATE' },
          { type: 'block-end', index: 0, block: { type: 'text', text: 'VERIFY_EXTERNAL_STATE' } }, { type: 'finish', reason: 'stop' }]
      }
      const call = { protocolVersion: 1, callId, taskId: randomUUID(), attemptId, status: 'succeeded', billingState: 'settled', estimatedCredits: '0.1', actualCredits: '0.08', errorCode: null, createdAt: now, updatedAt: now, cancelRequestedAt: null }
      const events = output.map((event, index) => ({ protocolVersion: 1, callId, attemptId, sequence: index + 1, event }))
      calls.set(callId, { call, events })
      json(call); return
    }
    const stream = /^\/api\/v1\/generations\/([^/]+)\/language-stream$/u.exec(path)
    if (stream) {
      counts.streams++; const entry = calls.get(stream[1]!)!; expect(entry).toBeDefined()
      const after = Number(new URL(req.url!, 'http://127.0.0.1').searchParams.get('afterSequence'))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(entry.events.filter(event => Number(event.sequence) > after).map(event => `event: language-model\nid: ${String(event.attemptId)}:${String(event.sequence)}\ndata: ${JSON.stringify(event)}\n\n`).join('')); return
    }
    const read = /^\/api\/v1\/language-calls\/([^/]+)$/u.exec(path)
    if (read && req.method === 'GET') { counts.reads++; json(calls.get(read[1]!)!.call); return }
    if (path.endsWith('/cancel')) counts.cancels++
    throw new Error('Unexpected route during packaged tool recovery')
  })().catch((error: unknown) => { failures.push(error instanceof Error ? error.message : 'Fixture failure'); res.destroy() }) })
  let runtime: ArivoRuntime | undefined, browser: Browser | undefined, toolPid: number | undefined
  let removeCredential: (() => Promise<number>) | undefined
  function killTool() {
    if (toolPid === undefined) return
    try { process.kill(-toolPid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    toolPid = undefined
  }
  context.onTestFinished(async () => {
    killTool()
    try { await browser?.close() } finally {
      try { await runtime?.stop() } finally {
        try { await removeCredential?.() } finally {
          server.closeAllConnections()
          await new Promise<void>(resolve => server.close(() => { resolve() }))
          await rm(temporary, { recursive: true, force: true })
        }
      }
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not listen')
  const origin = `http://127.0.0.1:${address.port}`, helper = join(payload, 'native/keychain')
  const key = `arivo-desktop-v1:${createHash('sha256').update(`${origin}\0${origin}`).digest('hex')}`
  const credential = (operation: 'get' | 'set' | 'delete', input = '') => new Promise<number>((resolve, reject) => {
    const child = spawn(helper, [operation, key], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'] })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Credential helper timed out')) }, 10000)
    child.once('error', reject); child.once('close', (code) => { clearTimeout(timeout); resolve(code ?? -1) })
    child.stdin.on('error', () => { /* Native exit reports failure without exposing token input. */ }); child.stdin.end(input)
  })
  const config = { binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home,
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'), shellDirectory: join(payload, 'arivo-shell'), manifestSha256: metadata.hash, pluginVersion: metadata.version,
    target: 'darwin-arm64' as const, maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000,
    identity: { apiOrigin: origin, webOrigin: origin, keychainHelper: helper, requestTimeoutMs: 10000, loginTimeoutMs: 30000 } }
  const output = join(process.cwd(), 'output/playwright/arivo-packaged-tool'); await mkdir(output, { recursive: true })
  const readSession = async () => {
    const accounts = await readdir(join(home, 'accounts')); expect(accounts).toHaveLength(1)
    const reader = new Context()
    try {
      await reader.plugin(JsonlSessionPersistence, { root: join(home, 'accounts', accounts[0]!, 'agent/sessions') })
      const logs = await reader.sessionPersistence.list(); expect(logs).toHaveLength(1)
      const handle = await reader.sessionPersistence.open(SessionId(logs[0]!.header.id), 'read')
      try { return { id: logs[0]!.header.id, events: await handle.read() } } finally { await handle.close() }
    } finally { await reader.fiber.dispose() }
  }
  try {
    expect(await credential('get')).toBe(44)
    removeCredential = () => credential('delete')
    expect(await credential('set', JSON.stringify({ format: 1, apiOrigin: origin, webOrigin: origin, phase: 'active', tokens: {
      protocolVersion: 1, tokenType: 'Bearer', accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43), sessionId: randomUUID(), accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 7200000).toISOString(), user: { id: userId, name: 'Unpaid fixture', email: 'tool@arivo.test', locale: 'zh-CN' },
    } }))).toBe(0)
    runtime = new ArivoRuntime(config); await runtime.start()
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(await runtime.agentUrl())
    await page.getByRole('button', { name: 'Arivo 模型', exact: true }).click()
    await page.getByLabel('工作空间', { exact: true }).selectOption(workspaceId)
    await page.getByLabel('计费项目', { exact: true }).selectOption(projectId)
    await page.getByLabel('语言模型', { exact: true }).selectOption(adapterId)
    await page.getByRole('button', { name: '设为默认模型', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '默认模型已保存。' }).waitFor()
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await page.getByRole('button', { name: '添加工作区', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(workspace)
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click(); await picker.waitFor({ state: 'hidden' })
    await page.locator('[contenteditable="true"]').fill('Arivo packaged interruption: record one effect, then wait.')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(() => readFile(join(workspace, 'effect-ready'), 'utf8').catch(() => ''), { timeout: 20000, interval: 20 }).toMatch(/^\d+$/u)
    toolPid = Number(await readFile(join(workspace, 'effect-ready'), 'utf8'))
    const rows = (await execute('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,command='])).stdout.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line)).filter(row => row !== null)
    const hostPrefix = `${await realpath(join(payload, 'node'))} ${await realpath(join(payload, 'runtime/bin.js'))} --profile arivo-studio-`
    const hosts = rows.filter(row => Number(row[2]) === process.pid && row[4]!.startsWith(hostPrefix))
    expect(hosts).toHaveLength(1); const hostPid = Number(hosts[0]![1]); expect(Number(hosts[0]![3])).toBe(hostPid)
    const tool = rows.find(row => Number(row[1]) === toolPid); expect(tool).toBeDefined(); expect(Number(tool![3])).toBe(toolPid)
    let ancestor = Number(tool![2]); const visited = new Set<number>()
    while (ancestor !== hostPid && !visited.has(ancestor)) {
      visited.add(ancestor)
      const parent = rows.find(row => Number(row[1]) === ancestor)
      if (!parent) break
      ancestor = Number(parent[2])
    }
    expect(ancestor).toBe(hostPid)
    expect(await readFile(join(workspace, 'effect'), 'utf8')).toBe('once\n')
    await page.getByRole('treeitem').filter({ hasText: 'Arivo packaged interruption' }).waitFor()
    expect(counts.auxiliaryCreates).toBe(1)
    process.kill(-hostPid, 'SIGKILL'); killTool(); await runtime.waitForExit(); await page.goto('about:blank'); await runtime.stop()
    const before = await readSession()
    expect(before.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(before.events.filter(event => event.type === 'tool/result')).toHaveLength(0)
    expect(counts.agentCreates).toBe(1); expect(counts.cancels).toBe(0)
    runtime = new ArivoRuntime(config); await runtime.start(); await page.goto(await runtime.agentUrl())
    await page.getByRole('tree', { name: '会话', exact: true }).getByRole('treeitem').filter({ hasText: 'Arivo packaged interruption' }).click()
    await page.getByText('Arivo packaged interruption: record one effect, then wait.', { exact: true }).waitFor()
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor()
    expect(counts.agentCreates).toBe(1); expect(await readFile(join(workspace, 'effect'), 'utf8')).toBe('once\n')
    await writeFile(join(output, 'restored-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.locator('[contenteditable="true"]').fill('Report the unknown outcome. Do not repeat the prior tool.')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByText('VERIFY_EXTERNAL_STATE', { exact: true }).last().waitFor()
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor()
    await writeFile(join(output, 'continued-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.goto('about:blank'); await runtime.stop()
    const after = await readSession(), results = after.events.filter(event => event.type === 'tool/result')
    expect(after.id).toBe(before.id); expect(after.events.filter(event => event.type === 'tool/call')).toHaveLength(1); expect(results).toHaveLength(1)
    expect(results[0]?.data.error?.code).toBe(TOOL_OUTCOME_UNKNOWN)
    expect(counts).toMatchObject({ quotes: 3, creates: 3, streams: 3, cancels: 0, agentCreates: 2, auxiliaryCreates: 1 })
    expect(new Set(commands).size).toBe(3); expect(failures).toEqual([]); expect(pageErrors).toEqual([])
    expect(await readFile(join(workspace, 'effect'), 'utf8')).toBe('once\n')
    expect(await credential('delete')).toBe(0); expect(await credential('get')).toBe(44)
    removeCredential = undefined
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ fixture: 'explicit unpaid cloud replies; real packaged Host, tools and Session persistence', manifestSha256: metadata.hash,
      originalToolCalls: 1, originalToolEffects: 1, originalResultBeforeCrash: false,
      restoredOutcome: TOOL_OUTCOME_UNKNOWN, automaticModelCallsOnResume: 0,
      followupModelCalls: 1, uniqueCommands: commands.length, sameSession: true,
      nativeCredentialRemoved: true, separateOwnedToolGroupKilled: true, counts, pageErrors,
      nativeWindow: 'pending', windows: 'pending', failures }, null, 2) + '\n')
  } catch (error) {
    await writeFile(join(output, 'fixture-errors.json'), JSON.stringify(failures, null, 2) + '\n')
    for (const page of browser?.contexts().flatMap(item => item.pages()) ?? []) {
      await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    }
    throw error
  }
}, 120000)
