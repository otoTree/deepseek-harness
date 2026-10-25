window.__ModuleLoader__.load({ id: '@arivo/production-checklist-client', factory: (require) => {
  const { createElement, useEffect } = require('react')
  const steps = ['确认剧本与分镜版本', '核对角色、场景和参考素材', '完成镜头生成与本机剪辑', '记录审片问题并完成修订', '锁定版本、检查声音与交付文件']
  function Panel() { return createElement('section', { style: { padding: 24, color: 'var(--dsw-alias-label-primary)' } },
    createElement('h2', null, '创作清单'), createElement('p', null, '与 Agent 一起检查项目进度，完成制作和交付。'),
    ...steps.map(item => createElement('label', { key: item, style: { display: 'flex', gap: 10, padding: '12px 0' } }, createElement('input', { type: 'checkbox' }), item)),
    createElement('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, '可在对话中让 Agent 使用“制作清单”工具整理检查项。此面板的勾选仅作当前查看，不替代项目任务。')) }
  function Tab({ activeTab, setActiveTab, registerTab }) {
    useEffect(() => registerTab({ id: 'arivo-production-checklist', key: 'arivo-checklist', label: '创作清单', closable: true, order: 80 }), [registerTab])
    return createElement('button', { type: 'button', onClick: () => setActiveTab('arivo-checklist'), 'aria-pressed': activeTab === 'arivo-checklist' }, '创作清单')
  }
  return { name: 'arivo-production-checklist-client', inject: ['slots'], apply(ctx) {
    ctx.slots.inject('workbench.panel', () => ctx.slots.register({ name: 'workbench.panel', id: 'arivo-checklist-panel', key: 'arivo-checklist' }, Panel))
    ctx.slots.inject('workbench.tabs', () => ctx.slots.register({ name: 'workbench.tabs', id: 'arivo-production-checklist', order: 80 }, Tab))
  } }
} })
