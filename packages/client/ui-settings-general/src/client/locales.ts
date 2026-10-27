/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'general.description': '让工作环境更适合你的习惯。',
  'search': '搜索设置',
  'search.empty': '未找到相关设置',
  'group.preferences': '偏好设置',
  'group.organization': '企业与账户',
  'group.extensions': '扩展',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中，点击立即重连',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'general.description': 'Make your workspace feel right for you.',
  'search': 'Search settings',
  'search.empty': 'No matching settings',
  'group.preferences': 'Preferences',
  'group.organization': 'Organization & account',
  'group.extensions': 'Extensions',
  'connection.error': 'Disconnected',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Connecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Connecting, restart now',
} satisfies Record<SettingsKey, string>
