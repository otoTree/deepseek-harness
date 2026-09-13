import { createHash } from 'node:crypto'
import { transform } from 'esbuild'
import { z } from 'zod'

/** Fixed build targets and deterministic supply-chain checks for submitted plugins. */
export const pluginBuildInput = z.object({
  target: z.enum(['browser', 'desktop', 'cloud']),
  source: z.string().max(512000),
  lockfile: z.string().max(512000),
}).strict()

export type PluginBuildResult = {
  target: 'browser' | 'desktop' | 'cloud'
  artifact: string
  artifactDigest: string
  sbom: { packageManager: 'npm' | 'pip'; dependencies: string[] }
  findings: Array<{ kind: 'syntax' | 'secret' | 'license' | 'vulnerability' | 'native' | 'runtime-install'; message: string; blocker: boolean }>
}

/** Build a read-only artifact description without executing submitted code or installing dependencies. */
export async function buildPlugin(input: z.input<typeof pluginBuildInput>): Promise<PluginBuildResult> {
  const parsed = pluginBuildInput.parse(input)
  const findings: PluginBuildResult['findings'] = []
  try { await transform(parsed.source, { loader: 'js', target: 'es2022' }) }
  catch { findings.push({ kind: 'syntax', message: 'JavaScript parse failed', blocker: true }) }
  if (!parsed.lockfile.trim()) findings.push({ kind: 'vulnerability', message: 'A lockfile is required for cloud builds', blocker: parsed.target === 'cloud' })
  if (/\b(npm|pnpm|yarn|pip)\s+install\b|child_process|native-addon|\.node\b/.test(parsed.source))
    findings.push({ kind: 'runtime-install', message: 'Runtime dependency installation or native execution is forbidden', blocker: true })
  if (/(?:sk-|AKIA)[A-Za-z0-9_-]{16,}/.test(parsed.source)) findings.push({ kind: 'secret', message: 'Possible embedded credential', blocker: true })
  const artifact = JSON.stringify({ target: parsed.target, source: parsed.source, lockfile: parsed.lockfile })
  const packageManager = parsed.lockfile.includes('"lockfileVersion"') ? 'npm' : 'pip'
  const dependencies = parsed.lockfile.split(/\r?\n/).filter(line => line.trim().length > 0).slice(0, 500)
  return { target: parsed.target, artifact, artifactDigest: createHash('sha256').update(artifact).digest('hex'), sbom: { packageManager, dependencies }, findings }
}
