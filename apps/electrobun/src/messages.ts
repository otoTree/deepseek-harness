/** Native menu and notification copy; no credential values are interpolated. */
export const messages = {
  en: { title: 'Enterprise Agent', login: 'Account and teams', logout: 'Sign out', loggedOut: 'Signed out and local credentials removed.',
    done: 'Signed in. The organization runtime is running in the background.', leaseLost: 'The organization runtime lease expired and local work was stopped.',
    failed: 'Sign-in failed. Check the deployment connection and Keychain access.', quit: 'Quit' },
  zh: { title: '企业 Agent', login: '账号与团队', logout: '退出登录', loggedOut: '已退出登录并删除本机凭据。',
    done: '登录成功，组织运行时已在后台运行。', leaseLost: '组织运行时租约已失效，本地工作已停止。',
    failed: '登录失败，请检查平台连接与钥匙串访问权限。', quit: '退出' },
} as const
