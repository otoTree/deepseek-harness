/** Reset local enterprise demo data while preserving the two screenshot accounts. */
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import postgres, { type TransactionSql } from 'postgres'
import { hashPassword } from 'better-auth/crypto'

loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))

const url = process.env.ENTERPRISE_MIGRATION_URL
const databaseUrl = url ? new URL(url) : undefined
if (!databaseUrl || databaseUrl.pathname !== '/dsh_enterprise' || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('A local dsh_enterprise migration URL is required')
}

const connection = postgres(databaseUrl.href, { max: 1 })
const keepEmails = ['test@test.com', 'testtest@test.com', 'admin@example.com']
const screenshotOrganizationIds = [
  '8933b6b3-4ce9-4714-85b3-abf1d4b8d408',
  'd1fe7255-bb7a-4d91-aea3-73a41427dff1',
  '7955240c-d5a5-4137-ac37-44edcb66192a',
]
const demoPassword = 'ZhiyuOS-Demo-2026!'

const demo = {
  root: '20000000-0000-4000-8000-000000000001',
  companies: ['20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000013'],
  users: [
    ['20000000-0000-4000-8000-000000000101', 'demo.admin@zhiyuos.local', '智域演示管理员'],
    ['20000000-0000-4000-8000-000000000102', 'zhang.wei@zhiyuos.local', '张伟'],
    ['20000000-0000-4000-8000-000000000103', 'li.na@zhiyuos.local', '李娜'],
    ['20000000-0000-4000-8000-000000000104', 'wang.qiang@zhiyuos.local', '王强'],
    ['20000000-0000-4000-8000-000000000105', 'chen.yu@zhiyuos.local', '陈宇'],
  ] as const,
} as const

type Tx = TransactionSql<Record<string, never>>

async function reset(tx: Tx, keepUserIds: string[], keepOrganizationIds: string[]): Promise<void> {
  await tx.unsafe("select set_config('enterprise.platform_admin','true',true)")
  await tx.unsafe("select set_config('enterprise.organization_id','',true)")
  const users = '$1::text[]'
  const organizations = '$2::text[]'
  const tenantUser = (column: string) => `(${column} is not null and ${column} <> all(${users}))`
  const tenantOrg = (column = 'organization_id') => `${column} is not null and ${column} <> all(${organizations})`
  const remove = async (table: string, condition: string): Promise<void> => {
    const hasUser = condition.includes('$1::text[]')
    const hasOrganization = condition.includes('$2::text[]')
    if (hasUser && hasOrganization) {
      await tx.unsafe(`delete from ${table} where ${condition}`, [keepUserIds, keepOrganizationIds])
    } else if (hasUser) {
      await tx.unsafe(`delete from ${table} where ${condition}`, [keepUserIds])
    } else if (hasOrganization) {
      await tx.unsafe(`delete from ${table} where ${condition.replaceAll('$2::text[]', '$1::text[]')}`, [keepOrganizationIds])
    } else {
      await tx.unsafe(`delete from ${table} where ${condition}`)
    }
  }

  // Remove dependent rows first, keeping every row belonging to the retained organizations and users.
  await remove('enterprise.session_approval', `${tenantOrg()} or ${tenantUser('requester_id')} or ${tenantUser('decided_by')}`)
  await remove('enterprise.session_event', tenantOrg())
  await remove('enterprise.conversation', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.model_task_ledger', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.model_task', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.wallet_ledger', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.usage', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.runtime', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.workspace', `${tenantOrg()} or ${tenantUser('account_id')}`)

  const doomedSpaces = `(select id from enterprise.drive_space where ${tenantOrg()} or ${tenantUser('account_id')})`
  const doomedNodes = `(select id from enterprise.drive_node where space_id in ${doomedSpaces})`
  await tx.unsafe(`update enterprise.drive_node set version_id = null where id in ${doomedNodes}`, [keepUserIds, keepOrganizationIds])
  await tx.unsafe(`delete from enterprise.drive_description where node_id in ${doomedNodes} or version_id in (select id from enterprise.drive_version where node_id in ${doomedNodes})`, [keepUserIds, keepOrganizationIds])
  await tx.unsafe(`delete from enterprise.drive_upload where space_id in ${doomedSpaces}`, [keepUserIds, keepOrganizationIds])
  await tx.unsafe(`delete from enterprise.drive_version where node_id in ${doomedNodes}`, [keepUserIds, keepOrganizationIds])
  await tx.unsafe(`delete from enterprise.drive_node where id in ${doomedNodes}`, [keepUserIds, keepOrganizationIds])
  await remove('enterprise.drive_edit_session', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.drive_audit', tenantOrg())
  await tx.unsafe(`delete from enterprise.drive_space where id in ${doomedSpaces}`, [keepUserIds, keepOrganizationIds])

  await remove('enterprise.plugin_activation', tenantOrg())
  await remove('enterprise.plugin_device_activation', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.plugin_object', tenantOrg())
  await remove('enterprise.plugin_operation', tenantOrg())
  await remove('enterprise.plugin_installation', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise.plugin_release', tenantOrg())

  await remove('enterprise.sync_diff', `${tenantOrg()} or ${tenantUser('decided_by')}`)
  await remove('enterprise.sync_rollback', `${tenantOrg()} or ${tenantUser('requested_by')}`)
  await remove('enterprise.sync_run', tenantOrg())
  await remove('enterprise.sync_script', `${tenantOrg()} or ${tenantUser('approved_by')}`)
  await remove('enterprise.identity_field_mapping', tenantOrg())
  await remove('enterprise.identity_login_failure', tenantOrg())
  await remove('enterprise.identity_provider', tenantOrg())
  await remove('enterprise.audit', tenantOrg())

  await tx.unsafe('delete from enterprise.custom_role_permission where role_id in (select id from enterprise.custom_role where organization_id <> all($1::text[]))', [keepOrganizationIds])
  await remove('enterprise.custom_role', tenantOrg())
  await remove('enterprise.unit_assignment', `${tenantOrg()} or membership_id in (select id from enterprise.membership where ${tenantUser('account_id')})`)
  await remove('enterprise.role_binding', `${tenantOrg()} or membership_id in (select id from enterprise.membership where ${tenantUser('account_id')})`)
  await remove('enterprise.invitation', `${tenantOrg()} or ${tenantUser('inviter_id')}`)
  await remove('enterprise.membership', `${tenantOrg()} or ${tenantUser('account_id')}`)

  // org_unit has a self-reference, so remove leaves until no non-retained unit remains.
  for (;;) {
    const result = await tx.unsafe('delete from enterprise.org_unit unit where unit.organization_id <> all($1::text[]) and not exists (select 1 from enterprise.org_unit child where child.organization_id = unit.organization_id and child.parent_id = unit.id)', [keepOrganizationIds])
    if (result.count === 0) break
  }
  await remove('enterprise.subscription', tenantOrg())
  await remove('enterprise.organization_wallet', tenantOrg())
  await remove('enterprise_auth.desktop_code', `${tenantOrg()} or ${tenantUser('account_id')}`)
  await remove('enterprise_auth.redemption_code', `${tenantOrg('redeemed_organization_id')} or ${tenantUser('created_by')} or ${tenantUser('redeemed_by')}`)

  // Organizations also have a parent reference; remove leaves before their roots.
  for (;;) {
    const result = await tx.unsafe('delete from enterprise.organization organization where organization.id <> all($1::text[]) and not exists (select 1 from enterprise.organization child where child.parent_id = organization.id)', [keepOrganizationIds])
    if (result.count === 0) break
  }

  await tx.unsafe('delete from enterprise_auth.platform_admin where account_id <> all($1::text[])', [keepUserIds])
  await tx.unsafe('delete from enterprise_auth.user where id <> all($1::text[])', [keepUserIds])
}

async function seed(tx: Tx): Promise<void> {
  const password = await hashPassword(demoPassword)
  await tx.unsafe("select set_config('enterprise.platform_admin','true',true)")
  const setTenant = async (organizationId: string): Promise<void> => {
    await tx.unsafe("select set_config('enterprise.organization_id',$1,true)", [organizationId])
  }

  const organizations = [
    [demo.root, null, demo.root, '智域科技集团', 'group'],
    [demo.companies[0], demo.root, demo.root, '智域智能产品事业群', 'company'],
    [demo.companies[1], demo.root, demo.root, '智域企业服务事业群', 'company'],
    [demo.companies[2], demo.root, demo.root, '智域国际业务事业群', 'company'],
  ] as const
  for (const [id, parentId, rootId, name, kind] of organizations) {
    await tx.unsafe('insert into enterprise.organization (id,parent_id,root_id,name,kind,status) values ($1,$2,$3,$4,$5,\'active\') on conflict (id) do update set parent_id=excluded.parent_id,root_id=excluded.root_id,name=excluded.name,kind=excluded.kind,status=\'active\'', [id, parentId, rootId, name, kind])
  }

  const unitRows: Array<[string, string, string | null, string, string]> = [[demo.root.replace('001', '101'), demo.root, null, '智域科技集团', 'root']]
  const departmentNames = [
    ['产品研发中心', '平台工程部', '模型应用部', '质量保障部'],
    ['企业交付中心', '客户成功部', '解决方案部', '财务运营部'],
    ['国际业务中心', '海外销售部', '跨境支持部', '合规与风控部'],
  ] as const
  for (const [index, organizationId] of demo.companies.entries()) {
    const unitId = (number: number): string => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`
    const unitBase = unitId(111 + index * 10)
    unitRows.push([unitBase, organizationId, null, organizations[index + 1]?.[3] ?? '事业群', 'root'])
    for (const [departmentIndex, department] of departmentNames[index]!.entries()) {
      const departmentId = unitId(112 + index * 10 + departmentIndex)
      unitRows.push([departmentId, organizationId, unitBase, department, 'department'])
      for (const [teamIndex, team] of ['一组', '二组'].entries()) {
        const teamId = unitId(115 + index * 10 + departmentIndex * 2 + teamIndex)
        unitRows.push([teamId, organizationId, departmentId, `${department}${team}`, 'team'])
      }
    }
  }
  for (const [id, organizationId, parentId, name, unitType] of unitRows) {
    await setTenant(organizationId)
    await tx.unsafe('insert into enterprise.org_unit (id,organization_id,parent_id,name,unit_type) values ($1,$2,$3,$4,$5) on conflict (id) do update set organization_id=excluded.organization_id,parent_id=excluded.parent_id,name=excluded.name,unit_type=excluded.unit_type', [id, organizationId, parentId, name, unitType])
  }

  for (const [id, email, name] of demo.users) {
    await tx.unsafe('insert into enterprise_auth.user (id,email,name,email_verified) values ($1,$2,$3,true) on conflict (id) do update set email=excluded.email,name=excluded.name,email_verified=true', [id, email, name])
    await tx.unsafe('insert into enterprise_auth.account (id,user_id,account_id,provider_id,password) values ($1,$2,$2,\'credential\',$3) on conflict (id) do update set password=excluded.password,account_id=excluded.account_id,provider_id=excluded.provider_id', [`${id}-credential`, id, password])
  }

  const memberships: Array<[string, string, string, string]> = [
    ['20000000-0000-4000-8000-000000000201', demo.root, demo.users[0]![0], 'active'],
    ['20000000-0000-4000-8000-000000000202', demo.companies[0]!, demo.users[0]![0], 'active'],
    ['20000000-0000-4000-8000-000000000203', demo.companies[1]!, demo.users[0]![0], 'active'],
    ['20000000-0000-4000-8000-000000000204', demo.companies[2]!, demo.users[0]![0], 'active'],
    ['20000000-0000-4000-8000-000000000205', demo.companies[0]!, demo.users[1]![0], 'active'],
    ['20000000-0000-4000-8000-000000000206', demo.companies[1]!, demo.users[2]![0], 'active'],
    ['20000000-0000-4000-8000-000000000207', demo.companies[2]!, demo.users[3]![0], 'active'],
    ['20000000-0000-4000-8000-000000000208', demo.companies[2]!, demo.users[4]![0], 'suspended'],
  ]
  for (const [id, organizationId, accountId, status] of memberships) {
    await setTenant(organizationId)
    await tx.unsafe('insert into enterprise.membership (id,organization_id,account_id,status) values ($1,$2,$3,$4) on conflict (id) do update set organization_id=excluded.organization_id,account_id=excluded.account_id,status=excluded.status', [id, organizationId, accountId, status])
  }
  const rootUnits = [demo.root.replace('001', '101'), '20000000-0000-4000-8000-000000000111', '20000000-0000-4000-8000-000000000121', '20000000-0000-4000-8000-000000000131']
  for (const [index, membership] of memberships.entries()) {
    await setTenant(membership[1])
    const companyIndex = demo.companies.indexOf(membership[1] as (typeof demo.companies)[number])
    const unitId = rootUnits[companyIndex < 0 ? 0 : companyIndex + 1]!
    await tx.unsafe('insert into enterprise.unit_assignment (organization_id,membership_id,unit_id) values ($1,$2,$3) on conflict do nothing', [membership[1], membership[0], unitId])
    const role = index === 0 ? 'owner' : index < 4 ? 'administrator' : index === 5 ? 'finance_auditor' : 'member'
    await tx.unsafe('insert into enterprise.role_binding (id,organization_id,membership_id,unit_id,role,effect) values ($1,$2,$3,$4,$5,\'allow\') on conflict (id) do update set role=excluded.role,unit_id=excluded.unit_id,effect=\'allow\'', [`${membership[0]}-role`, membership[1], membership[0], unitId, role])
  }
  for (const organizationId of [demo.root, ...demo.companies]) {
    await setTenant(organizationId)
    await tx.unsafe('insert into enterprise.subscription (organization_id,plan,seats,runtimes,budget_micros,spent_micros,reserved_micros) values ($1,\'enterprise\',500,100,100000000,0,0) on conflict (organization_id) do update set plan=excluded.plan,seats=excluded.seats,runtimes=excluded.runtimes,budget_micros=excluded.budget_micros', [organizationId])
    await tx.unsafe('insert into enterprise.organization_wallet (organization_id,balance_micros_cny) values ($1,500000000) on conflict (organization_id) do update set balance_micros_cny=greatest(enterprise.organization_wallet.balance_micros_cny, excluded.balance_micros_cny)', [organizationId])
  }
}

try {
  const [identity] = await connection`select current_user as role`
  if (identity?.role !== 'enterprise_migrator') throw new Error('Refusing demo reset without the enterprise_migrator role')
  await connection.begin(async (tx) => {
    const retained = await tx.unsafe('select id,email from enterprise_auth.user where email = any($1::text[])', [keepEmails])
    const keepUserIds = retained.map(row => String(row.id))
    if (keepUserIds.length !== keepEmails.length) throw new Error(`Expected retained accounts are missing: ${keepEmails.join(', ')}`)
    const platformAdmin = await tx.unsafe('select account_id from enterprise_auth.platform_admin')
    keepUserIds.push(...platformAdmin.map(row => String(row.account_id)).filter(id => !keepUserIds.includes(id)))
    const screenshotUserIds = retained.filter(row => row.email !== 'admin@example.com').map(row => String(row.id))
    const platformAdminIds = platformAdmin.map(row => String(row.account_id))
    const keepOrganizations = await tx.unsafe('select distinct organization_id from enterprise.membership where account_id = any($1::text[]) or (account_id = any($2::text[]) and organization_id = any($3::text[]))', [screenshotUserIds, platformAdminIds, screenshotOrganizationIds])
    const keepOrganizationIds = keepOrganizations.map(row => String(row.organization_id))
    await reset(tx, keepUserIds, keepOrganizationIds)
    await seed(tx)
  })
  console.log(`保留账号：${keepEmails.join('、')}`)
  console.log('新增演示管理员：demo.admin@zhiyuos.local')
  console.log(`演示密码：${demoPassword}`)
  console.log('组织层级：智域科技集团 > 三个事业群 > 部门 > 小组')
} finally {
  await connection.end()
}
