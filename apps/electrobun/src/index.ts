import { BrowserView, BrowserWindow } from 'electrobun/main'
import { z } from 'zod'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { RESOURCES_FOLDER } from 'electrobun/main/paths'
import { setApplicationMenu, on } from 'electrobun/main/app-menu'
import { openExternal, quit, showNotification } from 'electrobun/main/utils'
import { electrobunEventEmitter } from 'electrobun/main/events'
import { DesktopKeychain } from './keychain.ts'
import { LocalAccount } from './local-account.ts'
import { startAccountServer, validateAccountUrl } from './account-server.ts'
import { messages } from './messages.ts'
import { DesktopSession } from './desktop-session.ts'
import { resolveEnterpriseRuntimeBinary } from './runtime-binary.ts'
import { createNativeBridge, DriveEditManager, type EnterpriseNativeActions } from './native-bridge.ts'
import { validateLocalWebUrl } from './runtime.ts'
import { windowCapabilities } from './native-bridge-policy.ts'
import { startClientWindowBroker } from './client-window-platform.ts'
import { DesktopShutdown, type DesktopQuitEvent } from './shutdown.ts'
import { NativeGuestCloseGuard } from './browser-lifecycle.ts'
import { desktopDataRoot } from './desktop-paths.ts'
export { EnterpriseRuntimeController } from './runtime-controller.ts'

if (process.platform === 'darwin') {
  const guests = new NativeGuestCloseGuard()
  BrowserView.on('created', (view) => { guests.observe(view) })
  electrobunEventEmitter.on('will-close', (event) => { guests.beforeClose(event as Parameters<NativeGuestCloseGuard['beforeClose']>[0]) })
}

/** Runtime configuration for the desktop host. */
export const runtimeConfig = z.object({
  apiUrl: z.url(),
  portalUrl: z.url(),
  frontendIndex: z.string().min(1),
}).parse({
  apiUrl: process.env.ENTERPRISE_API_URL ?? 'http://127.0.0.1:8787',
  portalUrl: process.env.ENTERPRISE_PORTAL_URL ?? 'http://127.0.0.1:3001',
  frontendIndex: process.env.DSH_ENTERPRISE_FRONTEND_INDEX ?? join(RESOURCES_FOLDER, 'app', 'frontend', 'index.html'),
})
const t = (process.env.LANG ?? '').startsWith('zh') ? messages.zh : messages.en
/** Open bundled account assets or the authenticated local Agent UI.
 * @param options - Native-owned loopback URL and optional Agent bridge actions.
 * @returns Window with native RPC only for the authenticated Agent page.
 */
export function createMainWindow(options: { trustedLocal?: boolean; url: string; nativeActions?: EnterpriseNativeActions }): BrowserWindow {
  const trustedLocal = options.trustedLocal === true
  const url = trustedLocal ? validateLocalWebUrl(options.url) : validateAccountUrl(options.url)
  const capabilities = windowCapabilities(trustedLocal)
  return new BrowserWindow({
    title: t.title,
    url,
    sandbox: capabilities.sandbox,
    ...(capabilities.exposeNativeRpc ? { rpc: createNativeBridge(options.nativeActions ?? {
      switchOrganization: () => {}, logout: () => {}, quit: shutdown,
    }) } : {}),
    frame: { width: 1440, height: 960, x: 120, y: 80 },
  })
}

/** Install the narrow browser facade only inside an authenticated local page. */
function installNativeBridgeClient(window: BrowserWindow, runtimeStorageIdentity: string, windowId: string): void {
  const serializedRuntimeStorageIdentity = JSON.stringify(runtimeStorageIdentity)
  const serializedWindowId = JSON.stringify(windowId)
  window.webview.on('dom-ready', () => {
    window.webview.executeJavascript(`(() => {
      if (window.__dshNative) return;
      const pending = new Map();
      let nextId = 1;
      const previous = window.__electrobun?.receiveMessageFromHost;
      if (!window.__electrobun || !window.__electrobunHostBridge) return;
      window.__electrobun.receiveMessageFromHost = (message) => {
        if (message && message.type === 'response' && pending.has(message.id)) {
          const item = pending.get(message.id);
          pending.delete(message.id);
          if (message.success) item.resolve(message.payload);
          else item.reject(new Error(message.error || 'Native request failed'));
          return;
        }
        previous?.(message);
      };
      const request = (method, params) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        window.__electrobunHostBridge.postMessage(JSON.stringify({ type: 'request', id, method, params }));
      });
      window.__dshWindowId = ${serializedWindowId};
      window.__dshNative = Object.freeze({
        runtimeStorageIdentity: ${serializedRuntimeStorageIdentity},
        chooseDirectory: () => request('chooseDirectory', null),
        notify: (value) => request('notify', value),
        openExternal: (value) => request('openExternal', value),
        switchOrganization: () => request('switchOrganization', null),
        logout: () => request('logout', null),
        quit: () => request('quit', null),
        createDriveEditSession: (value) => request('createDriveEditSession', value),
        openDriveFile: (value) => request('openDriveFile', value),
        getDriveEditStatus: (value) => request('getDriveEditStatus', value),
        uploadDriveEdit: (value) => request('uploadDriveEdit', value),
        cancelDriveEditSession: (value) => request('cancelDriveEditSession', value),
        closeDriveEditSession: (value) => request('closeDriveEditSession', value),
        cleanupDriveCache: () => request('cleanupDriveCache', null),
        listLocalPluginPackages: () => request('listLocalPluginPackages', null),
        readLocalPluginPackage: (value) => request('readLocalPluginPackage', value),
      });
      window.dispatchEvent(new CustomEvent('dsh-native-bridge-ready'));
    })()`)
  })
}

const keychainHelper = join(RESOURCES_FOLDER, 'app', 'native', process.platform === 'win32' ? 'keychain.exe' : 'keychain')
const pluginRoot = process.env.DSH_ENTERPRISE_PLUGIN_ROOT ?? join(RESOURCES_FOLDER, 'app', 'plugins')
const pluginWorkspace = process.env.DSH_PLUGIN_WORKSPACE ?? join(homedir(), 'Desktop', 'plugins')
const launchRoot = process.env.DSH_REPOSITORY_ROOT ?? process.env.PWD ?? process.cwd()
const developmentRuntimeCandidates = [
  join(launchRoot, 'apps', 'electrobun', 'scripts', 'dev-runtime'),
  join(launchRoot, 'scripts', 'dev-runtime'),
  join(process.cwd(), 'apps', 'electrobun', 'scripts', 'dev-runtime'),
  join(process.cwd(), 'scripts', 'dev-runtime'),
]
const developmentAnchorCandidates = [
  join(launchRoot, 'apps', 'cli', 'package.json'),
  join(launchRoot, '..', 'cli', 'package.json'),
  join(process.cwd(), 'apps', 'cli', 'package.json'),
  join(process.cwd(), '..', 'cli', 'package.json'),
]
const packaged = process.env.DSH_DESKTOP_PACKAGED === '1'
const developmentRuntime = packaged || process.platform === 'win32'
  ? undefined
  : developmentRuntimeCandidates.find(path => existsSync(path))
const developmentAnchor = packaged ? undefined : developmentAnchorCandidates.find(path => existsSync(path))
const dshExecutable = process.platform === 'win32' ? 'dsh.exe' : 'dsh'
const runtimeBinary = process.env.DSH_ENTERPRISE_BINARY
  ?? (developmentRuntime ?? join(RESOURCES_FOLDER, 'app', dshExecutable))
const runtimeAnchor = process.env.DSH_ENTERPRISE_INSTALL_ANCHOR
  ?? (developmentAnchor ?? join(RESOURCES_FOLDER, 'app', 'runtime', 'package.json'))
const keychain = new DesktopKeychain(keychainHelper)
const desktopSession = new DesktopSession({
  apiUrl: runtimeConfig.apiUrl,
  frontendIndex: runtimeConfig.frontendIndex,
  binary: runtimeBinary,
  installAnchor: runtimeAnchor,
  dataRoot: process.env.DSH_ENTERPRISE_DATA_ROOT ?? desktopDataRoot(process.platform, process.env, homedir()),
  keychain,
  keychainHelper,
  plugins: {
    llmFiles: join(pluginRoot, 'llm-files.js'),
    gateway: join(pluginRoot, 'gateway-provider.js'),
    driveTools: join(pluginRoot, 'drive-tools.js'),
    sessionPersistence: join(pluginRoot, 'session-provider.js'),
    enterpriseClient: join(pluginRoot, 'enterprise-client', 'lib', 'index.js'),
  },
  installAtLogin: process.env.DSH_ENTERPRISE_LOGIN_START === '1',
  onLeaseLost: () => { showNotification({ title: t.title, body: t.leaseLost }) },
  get clientWindowBroker() { return clientWindowBroker },
})
const account = new LocalAccount({
  apiUrl: runtimeConfig.apiUrl,
  portalOrigin: runtimeConfig.portalUrl,
  keychain,
  enter: enterWorkspace,
  logout: () => desktopSession.logout(),
  openExternal: (url) => { openExternal(url); return Promise.resolve() },
})
const accountServer = await startAccountServer(dirname(runtimeConfig.frontendIndex), account)
let clientWindowBroker: Awaited<ReturnType<typeof startClientWindowBroker>> | undefined
let accountWindow: BrowserWindow | undefined = createMainWindow({ url: accountServer.url })
const workspaceWindows = new Map<string, BrowserWindow>()
const pluginWindows = new Map<string, BrowserWindow>()
function closeWindows(windows: Map<string, BrowserWindow>): void {
  for (const window of windows.values()) window.close()
  windows.clear()
}

function closeAuthenticatedWindows(): void {
  closeWindows(pluginWindows)
  closeWindows(workspaceWindows)
}

function replaceWithLoginWindow(): void {
  const previous = accountWindow
  accountWindow = createMainWindow({ url: accountServer.url })
  closeAuthenticatedWindows()
  previous?.close()
}

async function logout(): Promise<void> {
  await account.run({ action: 'logout' }, AbortSignal.timeout(30000))
  replaceWithLoginWindow()
  showNotification({ title: t.title, body: t.loggedOut })
}

async function enterWorkspace(keychainAccount: string): Promise<void> {
  await resolveEnterpriseRuntimeBinary(process.env.DSH_ENTERPRISE_BINARY)
  await clientWindowBroker?.close()
  clientWindowBroker = await startClientWindowBroker({
    get baseUrl() {
      const url = desktopSession.webUrl
      if (url === undefined) throw new Error('Managed Runtime is not running')
      return url
    },
    onCreated: (windowInstanceId, window) => { pluginWindows.set(windowInstanceId, window) },
    onClosed: (windowInstanceId) => { pluginWindows.delete(windowInstanceId) },
  })
  if (desktopSession.activeAccount) await desktopSession.switchOrganization(keychainAccount)
  else await desktopSession.start(keychainAccount)
  const localWebUrl = desktopSession.webUrl
  if (!localWebUrl) throw new Error('Managed Web UI did not report a URL')
  const runtimeStorageIdentity = desktopSession.runtimeStorageIdentity
  if (!runtimeStorageIdentity) throw new Error('Managed Runtime did not report a storage identity')
  // The Enterprise Client receives this platform through its Host bootstrap.
  // Keeping the adapter in the desktop process ensures plugin code never receives BrowserWindow.
  const previous = accountWindow
  const nativeActions: EnterpriseNativeActions = {
    switchOrganization: replaceWithLoginWindow,
    logout,
    quit: shutdown,
    drive: new DriveEditManager(),
    pluginWorkspace,
  }
  const windowId = randomUUID()
  const workspaceWindow = createMainWindow({ trustedLocal: true, url: localWebUrl, nativeActions })
  workspaceWindows.set(windowId, workspaceWindow)
  installNativeBridgeClient(workspaceWindow, runtimeStorageIdentity, windowId)
  accountWindow = undefined
  previous?.close()
  showNotification({ title: t.title, body: t.done })
}

const desktopShutdown = new DesktopShutdown(
  async () => {
    accountWindow?.close()
    accountWindow = undefined
    closeAuthenticatedWindows()
    await accountServer.close()
    await desktopSession.stop()
  },
  () => { quit() },
  () => { showNotification({ title: t.title, body: t.failed }) },
)
function shutdown(): Promise<void> {
  return desktopShutdown.shutdown()
}
electrobunEventEmitter.on('before-quit', (event: DesktopQuitEvent) => { desktopShutdown.beforeQuit(event) })

setApplicationMenu([
  { label: t.title, submenu: [
    { label: t.login, action: 'login' }, { label: t.logout, action: 'logout' },
    { label: t.quit, action: 'quit' },
  ] },
  { label: t.edit, submenu: [
    { role: 'undo' }, { role: 'redo' }, { type: 'divider' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
    { role: 'selectAll' },
  ] },
])
on('application-menu-clicked', (event) => {
  const parsed = z.object({ data: z.object({ action: z.string() }) }).safeParse(event)
  if (!parsed.success) return
  if (parsed.data.data.action === 'logout') {
    void logout().catch(() => { showNotification({ title: t.title, body: t.failed }) })
    return
  }
  if (parsed.data.data.action === 'quit') {
    void shutdown().catch(() => { showNotification({ title: t.title, body: t.failed }) })
    return
  }
  if (parsed.data.data.action !== 'login') return
  replaceWithLoginWindow()
})

process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
process.once('beforeExit', () => { void desktopSession.stop() })
