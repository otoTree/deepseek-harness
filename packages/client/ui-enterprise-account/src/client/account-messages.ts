/** Locale-owned copy for the desktop's bundled identity and organization screens. */
const en = {
  brand: 'Enterprise Agent', welcome: 'Welcome back', subtitle: 'Sign in to start working with your Agent.',
  registerTitle: 'Create your account', registerSubtitle: 'Create an account, then join or create your team.',
  email: 'Email', password: 'Password', name: 'Name', login: 'Sign in', register: 'Create account',
  passwordHint: 'Use at least 12 characters.', back: 'Already have an account? Sign in',
  newAccount: 'New here? Create an account', registered: 'Account created. If email verification is required, check your inbox before signing in.',
  organization: 'Choose your team', organizationHint: 'Your conversations, models and plugins belong to the team you select.',
  empty: 'Create a team or join with an invitation to get started.', enter: 'Open workspace',
  teamName: 'Team name', create: 'Create team', invitation: 'Invitation token', join: 'Join team',
  logout: 'Sign out', waiting: 'Please wait…', starting: 'Opening your local workspace…',
  retry: 'Retry', failed: 'Unable to connect. Check the enterprise service and try again.',
  invalid: 'Check your email, password or invitation and try again.',
  denied: 'Access denied. Check your account verification, invitation or organization policy.',
  conflict: 'The request conflicts with the current account or device state. Refresh and try again.',
  limited: 'Too many requests. Please try again shortly.',
  startFailed: 'The workspace could not start. Check the device quota and local Runtime, then try again.',
  local: 'Your Agent runs on this Mac.', language: 'Language', english: 'English', chinese: '简体中文',
}
type Messages = { [Key in keyof typeof en]: string }
const zh: Messages = {
  brand: '企业 Agent', welcome: '欢迎回来', subtitle: '登录后，开始与你的 Agent 一起工作。',
  registerTitle: '创建你的账号', registerSubtitle: '注册账号，然后加入或创建你的团队。',
  email: '邮箱', password: '密码', name: '姓名', login: '登录', register: '创建账号',
  passwordHint: '请使用至少 12 个字符。', back: '已有账号？登录', newAccount: '还没有账号？注册',
  registered: '账号已创建。如果平台要求验证邮箱，请先查收验证邮件，再登录。',
  organization: '选择你的团队', organizationHint: '会话、模型和插件将归属于你选择的团队。',
  empty: '创建团队，或使用邀请凭据加入团队，即可开始。', enter: '进入工作空间',
  teamName: '团队名称', create: '创建团队', invitation: '邀请凭据', join: '加入团队',
  logout: '退出登录', waiting: '请稍候…', starting: '正在打开本机工作空间…',
  retry: '重试', failed: '无法连接，请检查企业服务后重试。', invalid: '请检查邮箱、密码或邀请凭据后重试。',
  denied: '访问被拒绝，请检查邮箱验证状态、邀请或组织策略。',
  conflict: '请求与当前账号或设备状态冲突，请刷新后重试。', limited: '请求过于频繁，请稍后重试。',
  startFailed: '工作空间启动失败，请检查设备额度和本机 Runtime 后重试。',
  local: '你的 Agent 在这台 Mac 上运行。', language: '语言', english: 'English', chinese: '简体中文',
}
/** Both locales expose exactly the same product-copy keys. */
export const accountMessages: Record<'en' | 'zh', Messages> = { en, zh }
