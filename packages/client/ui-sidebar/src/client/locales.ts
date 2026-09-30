/** `sidebar` namespace dictionaries: shell controls (New Session, fold toggle, and rail labels). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'nav.sessions': '会话',
  'nav.cloudDrive': '云盘',
  'nav.triggers': '触发器',
  'nav.plugins': '插件市场',
  'nav.settings': '设置',
  'topbar.workbench': '工作区',
  'topbar.newSession': '新会话',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'nav.sessions': 'Sessions',
  'nav.cloudDrive': 'Cloud drive',
  'nav.triggers': 'Triggers',
  'nav.plugins': 'Plugin marketplace',
  'nav.settings': 'Settings',
  'topbar.workbench': 'Workbench',
  'topbar.newSession': 'New session',
} satisfies Record<SidebarKey, string>
