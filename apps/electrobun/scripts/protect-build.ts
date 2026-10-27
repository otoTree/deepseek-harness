/** Protect staged application JavaScript and verify that release files match the protection record. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { transform } from 'esbuild'
import JavaScriptObfuscator from 'javascript-obfuscator'

const javascript = /\.(?:c|m)?js$/i
const sourceFile = /\.(?:map|tsx?|mts|cts|jsx|swift|cc|cpp|h|c|gyp)$/i
const sourceComment = /^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const owned = (path: string): boolean => !path.includes('/node_modules/') || path.includes('/node_modules/@deepseek-ai/')

async function replaceFile(path: string, code: string): Promise<void> {
  const temporary = `${path}.protected-${randomUUID()}`
  try {
    await writeFile(temporary, code, { flag: 'wx', mode: (await stat(path)).mode })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

async function files(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in application resources: ${path}`)
    if (entry.isDirectory()) result.push(...await files(path))
    else result.push(path)
  }
  return result.sort()
}

/** Obfuscate one module while preserving exported names, properties and function names used by Cordis.
 * @param code - Built JavaScript; TypeScript sources never enter this function.
 * @param filename - Stable module identity used for deterministic identifiers.
 * @returns Compact JavaScript without a source map or source comments.
 */
export async function obfuscateJavaScript(code: string, filename: string): Promise<string> {
  // Lower syntax before the obfuscator parses it; keep reflective names used by services.
  const lowered = await transform(code, { target: 'es2022', keepNames: true, legalComments: 'none' })
  return JavaScriptObfuscator.obfuscate(lowered.code.replace(sourceComment, ''), {
    compact: true,
    target: 'browser-no-eval',
    seed: Number.parseInt(digest(filename).slice(0, 8), 16),
    identifierNamesGenerator: 'hexadecimal',
    // Client combo scripts share the generated identifier namespace.
    identifiersPrefix: `dsh_${digest(filename).slice(0, 16)}_`,
    renameGlobals: false,
    renameProperties: false,
    // Escaped literals decode at parse time; render loops do not run string decoders.
    stringArray: false,
    unicodeEscapeSequence: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    sourceMap: false,
  }).getObfuscatedCode() + '\n'
}

/** Strip source files and protect every first-party JS module in a staged Resources directory.
 * @param resources - Private staging directory, never the source checkout or development app.
 * @returns Number of protected modules recorded in protection.json.
 */
export async function protectResources(resources: string): Promise<number> {
  const modules: Record<string, string> = {}
  for (const path of await files(resources)) {
    const name = relative(resources, path).split(sep).join('/')
    if (sourceFile.test(name) || /(?:^|\/)\.env(?:\.|$)/.test(name)) {
      await rm(path)
    } else if (javascript.test(name)) {
      const original = await readFile(path, 'utf8')
      const code = owned('/' + name)
        ? await obfuscateJavaScript(original, name)
        : original.replace(sourceComment, '')
      await replaceFile(path, code)
      if (owned('/' + name)) modules[name] = digest(code)
    }
  }
  await writeFile(join(resources, 'protection.json'), JSON.stringify({ version: 1, modules }, null, 2) + '\n')
  return Object.keys(modules).length
}

/** Reject leaked source files, debug maps, and first-party modules missing from the protection record.
 * @param resources - Completed application Resources directory.
 * @returns Resolves only when every protected module matches its recorded SHA-256.
 */
export async function verifyProtectedResources(resources: string): Promise<void> {
  const record = JSON.parse(await readFile(join(resources, 'protection.json'), 'utf8')) as {
    version: number
    modules: Record<string, string>
  }
  if (record.version !== 1 || !Object.keys(record.modules).length) throw new Error('Missing JavaScript protection record')
  const remaining = new Set(Object.keys(record.modules))
  for (const path of await files(resources)) {
    const name = relative(resources, path).split(sep).join('/')
    if (sourceFile.test(name) || /(?:^|\/)\.env(?:\.|$)/.test(name)) throw new Error(`Release contains source or debug files: ${name}`)
    if (!javascript.test(name)) continue
    const code = await readFile(path, 'utf8')
    if (sourceComment.test(code)) throw new Error(`Release contains a source map reference: ${name}`)
    sourceComment.lastIndex = 0
    if (!owned('/' + name)) continue
    if (record.modules[name] !== digest(code)) throw new Error(`Release contains unprotected or modified JavaScript: ${name}`)
    remaining.delete(name)
  }
  if (remaining.size) throw new Error(`Protected modules are missing: ${[...remaining].join(', ')}`)
}
