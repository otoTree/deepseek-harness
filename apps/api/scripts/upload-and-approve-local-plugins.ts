/** Upload and publish the approved local Harness plugin workspace packages. */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { z } from 'zod'
import { parsePluginPackage, type ParsedPluginPackage } from '../src/plugin-package.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const defaultWorkspace = '/Users/hjr/Desktop/plugins'
const pluginDirectories = [
  'feishu-daily-report', 'weknora', 'personal-mail', 'yuandian', 'qcc', 'tencent-cloud-doctor',
  'tencent-docs-mcp', 'tencent-meeting-mcp', 'notion-mcp', 'dida365-mcp', 'dify-mcp',
  'openalex-mcp', 'tencent-lexiang-mcp', 'tencent-ardot-mcp',
  'llm-wiki', 'clinical-learning', 'wechat-publisher', 'tencent-cloud-skill', 'cvm-doctor', 'cordis-reference',
] as const

type PlatformRelease = {
  id: string
  pluginId: string
  version: string
  status: string
  visibility: string
  digest: string
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value === '' ? undefined : value
}

function requiredEnv(name: string): string {
  const value = env(name)
  if (!value) throw new Error(`Set ${name} before uploading local plugins`)
  return value
}

async function loadPackages(workspace: string): Promise<readonly { path: string; parsed: ParsedPluginPackage }[]> {
  const packages: { path: string; parsed: ParsedPluginPackage }[] = []
  const selected = env('DSH_PLUGIN_IDS')
  const requested = selected?.split(',').map(value => value.trim()).filter(Boolean)
  const directories = requested
    ? pluginDirectories.filter(directory => requested.includes(directory))
    : pluginDirectories
  if (requested && directories.length !== requested.length) {
    const known = new Set(pluginDirectories)
    const unknown = requested.filter(directory => !known.has(directory))
    throw new Error(`Unknown local plugin id(s): ${unknown.join(', ')}`)
  }
  for (const directory of directories) {
    const dist = join(workspace, directory, 'dist')
    const files = await readdir(dist)
    const manifest = z.object({ pluginId: z.string(), version: z.string() }).parse(JSON.parse(await readFile(join(workspace, directory, 'manifest.json'), 'utf8')))
    const filename = `${manifest.pluginId}-${manifest.version}.dsh-plugin.zip`
    if (!files.includes(filename)) throw new Error(`${directory}/dist is missing ${filename}; build the current source version first`)
    const path = join(dist, filename)
    const bytes = await readFile(path)
    const parsed = parsePluginPackage(bytes)
    if (parsed.manifest.pluginId !== manifest.pluginId || parsed.manifest.version !== manifest.version) throw new Error(`${filename} does not match the source manifest`)
    packages.push({ path, parsed })
  }
  return packages
}

async function responseError(response: Response): Promise<never> {
  const body = await response.text()
  throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`)
}

async function main(): Promise<void> {
  loadEnvFile(join(root, '.env.enterprise'))
  const adminEnv = join(root, '.env.enterprise.admin')
  if (existsSync(adminEnv)) {
    if ((statSync(adminEnv).mode & 0o077) !== 0) throw new Error('.env.enterprise.admin must be owner-readable only (chmod 600)')
    loadEnvFile(adminEnv)
  }
  const apiUrl = new URL(env('ENTERPRISE_API_URL') ?? 'http://127.0.0.1:8787')
  const workspace = resolve(env('DSH_PLUGIN_WORKSPACE') ?? defaultWorkspace)
  const email = requiredEnv('ENTERPRISE_BOOTSTRAP_EMAIL')
  const password = requiredEnv('ENTERPRISE_BOOTSTRAP_PASSWORD')
  const packages = await loadPackages(workspace)

  const login = await fetch(new URL('/auth/sign-in/email', apiUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: env('ENTERPRISE_ADMIN_ORIGIN') ?? 'http://127.0.0.1:4000' },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) await responseError(login)
  const cookies = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  if (!cookies) throw new Error('Platform login did not return a session cookie')
  const headers = { Cookie: cookies, Origin: env('ENTERPRISE_ADMIN_ORIGIN') ?? 'http://127.0.0.1:4000' }

  const list = await fetch(new URL('/v1/platform/plugins', apiUrl), { headers })
  if (!list.ok) await responseError(list)
  const existing = z.array(z.object({
    id: z.string(), pluginId: z.string(), version: z.string(), status: z.string(), visibility: z.string(), digest: z.string(),
  })).parse(await list.json()) as PlatformRelease[]
  const byVersion = new Map(existing.map(release => [`${release.pluginId}@${release.version}`, release]))

  for (const item of packages) {
    const manifest = item.parsed.manifest
    const key = `${manifest.pluginId}@${manifest.version}`
    let release = byVersion.get(key)
    if (release && release.digest !== item.parsed.packageDigest) {
      throw new Error(`${key} already exists with a different digest`)
    }
    if (!release) {
      const upload = await fetch(new URL('/v1/platform/plugins/packages', apiUrl), {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: Buffer.from(item.parsed.bytes),
      })
      if (!upload.ok) await responseError(upload)
      release = z.object({
        id: z.string(), pluginId: z.string(), version: z.string(),
        status: z.string(), visibility: z.string(), digest: z.string(),
      }).parse(await upload.json())
      byVersion.set(key, release)
      console.log(`uploaded ${key} ${release.digest}`)
    }
    if (release.status === 'awaiting_platform_review') {
      const approve = await fetch(new URL(`/v1/platform/plugins/${release.id}/approve`, apiUrl), {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest: release.digest }),
      })
      if (!approve.ok) await responseError(approve)
      const approved = z.object({ id: z.string(), status: z.literal('published'), digest: z.string() }).parse(await approve.json())
      if (approved.id !== release.id || approved.digest !== release.digest) throw new Error(`${key} approval did not match the uploaded package`)
      release = { ...release, status: approved.status }
      byVersion.set(key, release)
      console.log(`published ${key}`)
    } else if (release.status !== 'published') {
      throw new Error(`${key} is ${release.status}; automatic approval cannot continue`)
    } else {
      console.log(`already published ${key}`)
    }
  }

  const verify = await fetch(new URL('/v1/platform/plugins?status=published', apiUrl), { headers })
  if (!verify.ok) await responseError(verify)
  const published = z.array(z.object({
    pluginId: z.string(), version: z.string(), status: z.string(), visibility: z.string(),
  })).parse(await verify.json())
  const missing = packages.filter(({ parsed }) => !published.some(row =>
    row.pluginId === parsed.manifest.pluginId && row.version === parsed.manifest.version))
  if (missing.length > 0) throw new Error(`Published verification missing: ${missing.map(item => item.parsed.manifest.pluginId).join(', ')}`)
  console.log(`Verified ${packages.length} local plugins as published in the platform directory.`)
}

await main()
