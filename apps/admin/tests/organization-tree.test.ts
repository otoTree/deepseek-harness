import assert from 'node:assert/strict'
import test from 'node:test'

type Node = { id: string; parentId: string | null; depth: number; displayPath: string; hasChildren: boolean }

function childrenByParent(nodes: Node[]): Map<string, Node[]> {
  const result = new Map<string, Node[]>()
  for (const node of nodes) {
    const children = result.get(node.parentId ?? '') ?? []
    children.push(node)
    result.set(node.parentId ?? '', children)
  }
  return result
}

test('组织树保留多级 parentId 关系和展示路径', () => {
  const nodes: Node[] = [
    { id: 'group', parentId: null, depth: 0, displayPath: '集团', hasChildren: true },
    { id: 'company', parentId: 'group', depth: 1, displayPath: '集团 / 事业群', hasChildren: true },
    { id: 'department', parentId: 'company', depth: 2, displayPath: '集团 / 事业群 / 研发部', hasChildren: true },
    { id: 'team', parentId: 'department', depth: 3, displayPath: '集团 / 事业群 / 研发部 / 一组', hasChildren: false },
  ]
  const tree = childrenByParent(nodes)
  assert.deepEqual(tree.get('')?.map(node => node.id), ['group'])
  assert.deepEqual(tree.get('company')?.map(node => node.id), ['department'])
  assert.equal(nodes[3]?.displayPath, '集团 / 事业群 / 研发部 / 一组')
})

test('同一 parentId 的子节点可缓存并复用', () => {
  const cache: Record<string, Node[]> = {}
  const response = [{ id: 'child', parentId: 'group', depth: 1, displayPath: '集团 / 子级', hasChildren: false }]
  cache.group = response
  assert.equal(cache.group, response)
  assert.equal(cache.group, cache.group)
})

test('组织节点可以挂载部门根节点', () => {
  const nodes = [
    { id: 'company', parentId: 'group', depth: 1, displayPath: '集团 / 事业群', hasChildren: true },
    { id: 'dept', parentId: 'company', depth: 2, displayPath: '集团 / 事业群 / 研发部', hasChildren: true },
  ]
  const children = new Map<string, typeof nodes>()
  children.set('company', [nodes[1]!])
  assert.equal(children.get('company')?.[0]?.id, 'dept')
  assert.equal(nodes[0]?.hasChildren, true)
})

test('账号归属使用单一 organizationNodeId', () => {
  const payload = { name: '张三', email: 'zhangsan@example.com', password: 'long-enough-password', organizationNodeId: 'department', role: 'member' }
  assert.equal(payload.organizationNodeId, 'department')
  assert.equal('organizationId' in payload, false)
  assert.equal('unitId' in payload, false)
})
