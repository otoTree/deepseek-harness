/** Shared build/runtime selection of the embedded Chromium debugging listener. */
const port = Number(process.env.DSH_DESKTOP_CDP_PORT ?? 9333)
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('DSH_DESKTOP_CDP_PORT must be an integer between 1024 and 65535')
}

/** Loopback endpoint used by the organization runtime to attach to native pages. */
export const desktopCdpEndpoint = `http://127.0.0.1:${port}`
/** Embedded Chromium flags shared by desktop builds on all supported platforms. */
export const desktopChromiumFlags = { 'remote-debugging-address': '127.0.0.1', 'remote-debugging-port': String(port) }
