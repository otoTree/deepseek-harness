/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'results.title': '会话成果',
  'results.count': '{count} 个文件',
  'results.empty': '当前会话还没有可展示的成果',
  'results.openInFiles': '在文件中打开 {name}',
  'results.turn': '第 {turn} 轮',
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'results.title': 'Session results',
  'results.count': '{count} files',
  'results.empty': 'No deliverables in this Session yet',
  'results.openInFiles': 'Open {name} in Files',
  'results.turn': 'Turn {turn}',
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
