export const name = 'arivo-production-checklist'
export const inject = ['tools', 'skills']
export function apply(ctx) {
  ctx.tools.register({
    name: 'arivo_production_checklist', description: '根据剧集、镜头和交付目标整理制作清单。',
    parameters: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' }, maxItems: 100 } }, required: ['title', 'items'], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return `# ${args.title}\n\n${args.items.map(item => `- [ ] ${item}`).join('\n')}` },
  })
  ctx.skills.register({ name: 'arivo-production-checklist', description: '制作清单：剧本、镜头、素材、审片和交付', source: 'plugin',
    content: '先确认用户当前项目和制作目标，再调用 arivo_production_checklist 整理剧本、镜头、素材、审片和交付检查项。插件不生成媒体，不读取其他项目，也不自动写入文件。' })
}
