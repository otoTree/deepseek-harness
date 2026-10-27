/** `command` namespace dictionaries for discovery, input hints, and the popup shell. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'catalog.compact.description': '压缩较早的对话记录',
  'catalog.export.description': '将当前会话记录下载为 ZIP 压缩包',
  'catalog.feedback.description': '反馈当前会话的问题或建议',
  'catalog.feedback.hint': '<反馈内容>',
  'catalog.goal.description': '设置或查看长期任务目标',
  'catalog.goal.hint': '[<目标>|clear 清除|edit <目标>|pause 暂停|resume 继续]',
  'catalog.permission.description': '切换权限预设（沙箱模式与审批策略）',
  'catalog.permission.hint': '<权限预设>',
  'catalog.plan.description': '进入或退出规划模式',
  'catalog.plan.hint': '[off 退出|任务描述]',
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.attachmentsUnsupported': '/{command} 不接受附件，请先移除附件',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'catalog.compact.description': 'Compact older conversation history',
  'catalog.export.description': 'Download this Session log as a ZIP archive',
  'catalog.feedback.description': 'record feedback about this session',
  'catalog.feedback.hint': '<text>',
  'catalog.goal.description': 'set or view the goal for a long-running task',
  'catalog.goal.hint': '[<objective>|clear|edit <objective>|pause|resume]',
  'catalog.permission.description': 'Switch the permission preset (sandbox mode + approval policy)',
  'catalog.permission.hint': '<preset>',
  'catalog.plan.description': 'Enter or leave plan mode',
  'catalog.plan.hint': '[off|message]',
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.attachmentsUnsupported': '/{command} does not accept attachments; remove them first',
} satisfies Record<CommandKey, string>
