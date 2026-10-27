/** Arivo native application; enterprise login, services and update feeds are not composed here. */
import { BrowserView, BrowserWindow } from 'electrobun/main'
import { RESOURCES_FOLDER } from 'electrobun/main/paths'
import { setApplicationMenu, on } from 'electrobun/main/app-menu'
import { quit, showMessageBox } from 'electrobun/main/utils'
import { electrobunEventEmitter } from 'electrobun/main/events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { ArivoRuntime } from './arivo-runtime.ts'
import { desktopProductDataRoot, resolveDesktopDistribution } from './config.ts'
import { DesktopShutdown, type DesktopQuitEvent } from '../shutdown.ts'
import { NativeGuestCloseGuard } from '../browser-lifecycle.ts'
import { readArivoIdentitySettings } from './arivo-identity.ts'
import { prepareArivoNativeDeparture } from './arivo-native-departure.ts'

const product = resolveDesktopDistribution('arivo')
const copy = (process.env.LANG ?? '').startsWith('zh') ? {
  quit: '退出 Arivo', edit: '编辑', leaveBlocked: '尚有内容未确认保存，请返回编辑器处理后再退出。',
  failed: 'Arivo 无法启动', message: '本地工作台未能启动。请重新打开应用；如果仍然失败，请重新安装此版本。',
} : {
  quit: 'Quit Arivo', edit: 'Edit', leaveBlocked: 'Some input has not been confirmed saved. Return to the editor before quitting.',
  failed: 'Arivo could not start', message: 'The local workbench could not start. Reopen the app, or reinstall this release if it still fails.',
}
if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Arivo requires macOS or Windows')
if (process.platform === 'darwin') {
  const guests = new NativeGuestCloseGuard()
  BrowserView.on('created', (view) => { guests.observe(view) })
  electrobunEventEmitter.on('will-close', (event) => { guests.beforeClose(event as Parameters<NativeGuestCloseGuard['beforeClose']>[0]) })
}
const resources = join(RESOURCES_FOLDER, 'app')
const identity = readArivoIdentitySettings(process.env.ARIVO_IDENTITY_CONFIG)
let window: BrowserWindow | undefined
let windowOrigin: string | undefined
let generation = new AbortController()
const leaveTimeoutMs = z.coerce.number().int().min(1000).max(60000).default(20000).parse(process.env.ARIVO_EDITOR_LEAVE_TIMEOUT_MS)
const runtime = new ArivoRuntime({
  binary: join(resources, process.platform === 'win32' ? 'dsh.exe' : 'dsh'),
  installAnchor: join(resources, 'runtime', 'package.json'),
  home: join(desktopProductDataRoot(product, process.platform, process.env, homedir()), 'runtime'),
  instanceHelper: join(resources, 'native', process.platform === 'win32' ? 'instance.exe' : 'instance'),
  pluginDirectory: join(resources, 'plugins', 'arivo'),
  shellDirectory: join(resources, 'arivo-shell'),
  manifestSha256: process.env.ARIVO_BUNDLED_MANIFEST_SHA256 ?? '',
  pluginVersion: process.env.ARIVO_BUNDLED_PLUGIN_VERSION ?? '',
  target: process.platform === 'win32' ? 'win32-x64' : 'darwin-arm64',
  maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 10000,
  ...(identity ? { identity: { ...identity, keychainHelper: join(resources, 'native', process.platform === 'win32' ? 'keychain.exe' : 'keychain') } } : {}),
}, {
  switching: () => { generation.abort(); generation = new AbortController(); windowOrigin = undefined; window?.webview.loadURL('about:blank') },
  ready: (url) => { windowOrigin = new URL(url).origin; window?.webview.loadURL(url) },
})
let shutdownRequested = false
const isShutdownRequested = () => shutdownRequested
const showFailure = () => { void showMessageBox({ type: 'error', title: copy.failed, message: copy.message }) }
const shutdown = new DesktopShutdown(async () => {
  await runtime.stop()
  window?.close()
  window = undefined
}, () => { quit() }, showFailure)
let preparing: Promise<void> | undefined
const forceShutdown = () => { generation.abort(); shutdownRequested = true; void shutdown.shutdown().catch(showFailure) }
const requestShutdown = () => {
  if (shutdownRequested || preparing) return
  preparing = (async () => {
    const activeWindow = window, origin = windowOrigin, lifetime = generation.signal
    if (!activeWindow || !origin) { await showMessageBox({ type: 'warning', title: product.name, message: copy.leaveBlocked }); return }
    const release = await prepareArivoNativeDeparture({ origin, timeoutMs: leaveTimeoutMs, signal: lifetime,
      execute: (script) => { activeWindow.webview.executeJavascript(script) } })
    if (!release) { if (!lifetime.aborted) await showMessageBox({ type: 'warning', title: product.name, message: copy.leaveBlocked }); return }
    try {
      if (lifetime.aborted || window !== activeWindow || windowOrigin !== origin) return
      shutdownRequested = true
      await shutdown.shutdown()
    } catch (error) { shutdownRequested = false; throw error }
    finally { release() }
  })().catch(showFailure).finally(() => { preparing = undefined })
}
electrobunEventEmitter.on('before-quit', (event) => {
  if (shutdownRequested) { shutdown.beforeQuit(event as DesktopQuitEvent); return }
  (event as DesktopQuitEvent).response = { allow: false }; requestShutdown()
})
electrobunEventEmitter.on('will-close', (event) => {
  const close = event as { data: { id: number }; response: { allow: boolean } | undefined }
  if (!window || close.data.id !== window.id || close.response?.allow === false || shutdownRequested) return
  close.response = { allow: false }; requestShutdown()
})
setApplicationMenu([{ label: product.name, submenu: [{ label: copy.quit, action: 'arivo-quit' }] }, {
  label: copy.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'divider' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
}])
on('application-menu-clicked', (event) => {
  const parsed = z.object({ data: z.object({ action: z.string() }) }).safeParse(event)
  if (!parsed.success) return
  if (parsed.data.data.action === 'arivo-quit') requestShutdown()
})
process.once('SIGTERM', forceShutdown)
process.once('SIGINT', forceShutdown)
try {
  await runtime.start()
  const url = await runtime.agentUrl()
  windowOrigin = new URL(url).origin
  window = new BrowserWindow({ title: product.name, url, sandbox: true, frame: { width: 1280, height: 900 } })
  window.on('close', requestShutdown)
  void runtime.waitForExit().then(() => { if (!shutdownRequested) { showFailure(); forceShutdown() } }).catch(showFailure)
} catch {
  if (!isShutdownRequested()) showFailure()
  await shutdown.shutdown()
}
