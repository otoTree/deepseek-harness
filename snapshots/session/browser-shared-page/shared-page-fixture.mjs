/** Deterministic manual and Agent input on one browser provider page. */
export const name = 'shared-page-fixture'
export const inject = ['browsers', 'tools']

/** Register a single document shared by viewport requests and model tools. */
export function apply(ctx) {
  let page
  let navigations = 0
  let value = ''
  let focused = false
  let clicked = false
  const provider = {
    name: 'playwright',
    async open(_sessionId, _tabId, url) {
      navigations += 1
      page = { title: 'Shared page', url, loading: false, canGoBack: false, canGoForward: false }
      return page
    },
    async read() { return page },
    async close() { page = undefined },
    async clickAt() { focused = true; return page },
    async insertText(_sessionId, _tabId, text) {
      if (!focused) throw new Error('manual text requires focus on the provider page')
      value += text
      return page
    },
    async click(_sessionId, _tabId, selector) {
      if (navigations !== 1 || value !== 'Manual input' || selector !== '#continue') {
        throw new Error('Agent action must use the same document and manually entered value')
      }
      clicked = true
      page = { ...page, title: `Submitted: ${value}` }
      return page
    },
    async screenshot() { return new Uint8Array([137, 80, 78, 71]) },
    async snapshot() {
      return clicked ? '- heading "Submitted: Manual input"' : `- textbox "Name": ${value}\n- button "Continue"`
    },
  }
  ctx.effect(() => ctx.browsers.register(provider))
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === 'browser_open' && !result.isError) {
      const { browserId, tab } = result.value
      await ctx.browsers.clickAt(exec.agent.id, browserId, tab.tabId, 20, 20, 1)
      await ctx.browsers.insertText(exec.agent.id, browserId, tab.tabId, 'Manual input')
      await ctx.browsers.screenshot(exec.agent.id, browserId, tab.tabId)
    }
    return next()
  })
}
