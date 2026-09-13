/** Isolated local provisioning; never adopts another Compose project's resources. */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const envPath = resolve(root, '.env.enterprise')
const project = 'deepseek-enterprise-local'
const action = process.argv[2]
const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', cwd: root })
const compose = ['compose', '--env-file', envPath, '-f', 'docker-compose.enterprise.yml']

function ensureDefault(name: string, value: string): void {
  const contents = readFileSync(envPath, 'utf8')
  if (new RegExp(`^${name}=`, 'm').test(contents)) return
  writeFileSync(envPath, contents.replace(/\s*$/, '') + `\n${name}=${value}\n`, { mode: 0o600 })
  console.log(`Added missing ${name} to .env.enterprise`)
}

if (action === 'init') {
  if (existsSync(envPath)) throw new Error('.env.enterprise already exists; credentials were not changed')
  const secret = () => randomBytes(32).toString('hex')
  const app = secret()
  const migration = secret()
  const redis = secret()
  const minio = secret()
  const values = {
    ENTERPRISE_PG_BOOTSTRAP_PASSWORD: secret(),
    ENTERPRISE_PG_MIGRATOR_PASSWORD: migration,
    ENTERPRISE_PG_APP_PASSWORD: app,
    ENTERPRISE_REDIS_PASSWORD: redis,
    ENTERPRISE_MINIO_ROOT_PASSWORD: secret(),
    ENTERPRISE_MINIO_APP_PASSWORD: minio,
    ENTERPRISE_DATABASE_URL: `postgres://enterprise_app:${app}@127.0.0.1:55439/dsh_enterprise`,
    ENTERPRISE_MIGRATION_URL: `postgres://enterprise_migrator:${migration}@127.0.0.1:55439/dsh_enterprise`,
    ENTERPRISE_REDIS_URL: `redis://:${redis}@127.0.0.1:56389`,
    ENTERPRISE_AUTH_SECRET: secret(),
    ENTERPRISE_ENCRYPTION_KEY: secret(),
    ENTERPRISE_API_URL: 'http://127.0.0.1:8787',
    ENTERPRISE_ADMIN_ORIGIN: 'http://127.0.0.1:3000',
    ENTERPRISE_PORTAL_ORIGIN: 'http://127.0.0.1:3001',
    ENTERPRISE_MINIO_ENDPOINT: 'http://127.0.0.1:59010',
    ENTERPRISE_MINIO_ACCESS_KEY: 'enterprise_app',
    ENTERPRISE_MINIO_BUCKET: 'dsh-enterprise',
  }
  writeFileSync(
    envPath,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  console.log('Created owner-readable .env.enterprise; no services started.')
} else if (action === 'check' || action === 'up' || action === 'status') {
  if (!existsSync(envPath)) throw new Error('Run pnpm exec tsx scripts/enterprise-infra.ts init first')
  ensureDefault('ENTERPRISE_PORTAL_ORIGIN', 'http://127.0.0.1:3001')
  ensureDefault('ENTERPRISE_MINIO_ENDPOINT', 'http://127.0.0.1:59010')
  ensureDefault('ENTERPRISE_MINIO_ACCESS_KEY', 'enterprise_app')
  ensureDefault('ENTERPRISE_MINIO_BUCKET', 'dsh-enterprise')
  const env = parseEnv(readFileSync(envPath, 'utf8'))
  const containers = docker(['ps', '-a', '--format', '{{json .}}'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { Names: string; Labels: string; Ports: string })
  const ports = [
    'ENTERPRISE_PG_PORT',
    'ENTERPRISE_REDIS_PORT',
    'ENTERPRISE_MINIO_PORT',
    'ENTERPRISE_MINIO_CONSOLE_PORT',
  ].map((key, i) => env[key] ?? ['55439', '56389', '59010', '59011'][i])
  for (const container of containers) {
    const labels = new Map(container.Labels.split(',').map(label => label.split('=', 2) as [string, string]))
    if (labels.get('com.docker.compose.project') === project) {
      if (labels.get('com.docker.compose.project.working_dir') !== root.replace(/\/$/, '')) {
        throw new Error(`Compose project ${project} belongs to another directory; refusing to adopt it`)
      }
    } else if (container.Names.startsWith(project) || ports.some(port => container.Ports.includes(`:${port}->`))) {
      throw new Error(`Resource conflict with ${container.Names}; no containers changed`)
    }
  }
  const names = docker(['volume', 'ls', '--format', '{{.Name}}']).trim().split('\n')
  for (const suffix of ['pgdata', 'redisdata', 'miniodata']) {
    const name = `${project}_${suffix}`
    if (!names.includes(name)) continue
    const [volume] = JSON.parse(docker(['volume', 'inspect', name])) as { Labels: Record<string, string> | null }[]
    if (
      volume?.Labels?.['com.docker.compose.project'] !== project ||
      volume.Labels['ai.deepseek.owner'] !== 'enterprise-local'
    ) {
      throw new Error(`Volume ${name} has no matching owner; refusing to adopt it`)
    }
  }
  docker([...compose, 'config', '--quiet'])
  if (action === 'up') {
    // Remove only stopped containers owned by this Compose project. This
    // repairs stale Docker Desktop task metadata without touching volumes or
    // resources belonging to another project.
    execFileSync('docker', [...compose, 'rm', '-f'], { cwd: root, stdio: 'inherit' })
    // Wait only on long-lived services. `minio-init` is intentionally a
    // one-shot job and a successful exit must not make Compose `--wait` fail.
    execFileSync('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'redis', 'minio'], { cwd: root, stdio: 'inherit' })
    execFileSync('docker', [...compose, 'run', '--rm', 'minio-init'], { cwd: root, stdio: 'inherit' })
  }
  else if (action === 'status') console.log(docker([...compose, 'ps']))
  else console.log('Compose ownership and Docker port checks passed. Host bind conflicts still fail at startup.')
} else {
  throw new Error('Expected init, check, up, or status; no destructive command is provided')
}
