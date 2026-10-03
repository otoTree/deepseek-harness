import { runInNewContext } from 'node:vm'
import process from 'node:process'

type Message = { code: string; input: Record<string, unknown> }
process.on('message', async (message: Message) => {
  try {
    const module = { exports: {} as Record<string, unknown> }
    const sandbox = Object.freeze({ module, exports: module.exports, input: message.input, console: Object.freeze({ log: () => {}, error: () => {} }) })
    runInNewContext(message.code, sandbox, { timeout: 4_000 })
    const exported = module.exports.default ?? module.exports.transform ?? module.exports
    if (typeof exported !== 'function') throw new Error('Script must export default or transform(input)')
    const value = await exported(message.input)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Script result must be an object')
    process.send?.({ ok: true, value })
  } catch (error) {
    process.send?.({ ok: false, error: error instanceof Error ? error.message : 'Script failed' })
  }
})
