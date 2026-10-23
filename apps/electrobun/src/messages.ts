/** Native menu and notification copy; no credential values are interpolated. */
export const messages = {
  en: { title: '智域OS', edit: 'Edit', login: 'Account and teams', logout: 'Sign out', loggedOut: 'Signed out and local credentials removed.',
    done: 'Signed in. The organization runtime is running in the background.', leaseLost: 'The organization runtime lease expired and local work was stopped.',
    failed: 'Sign-in failed. Check the deployment connection and Keychain access.', quit: 'Quit' },
  zh: { title: '智域OS', edit: '编辑', login: '账号与团队', logout: '退出登录', loggedOut: '已退出登录并删除本机凭据。',
    done: '登录成功，组织运行时已在后台运行。', leaseLost: '组织运行时租约已失效，本地工作已停止。',
    failed: '登录失败，请检查平台连接与钥匙串访问权限。', quit: '退出' },
} as const

/** Native updater copy; release notes come only from authenticated publisher metadata. */
export const updateMessages = {
  en: {
    title: 'Desktop updates', check: 'Check for updates…', cancel: 'Cancel update download', ok: 'OK',
    unconfigured: 'Updates are not configured for this build. Ask your administrator for a newer installer.',
    checking: 'Checking for desktop updates…', current: 'Version {version} is up to date.',
    available: 'Version {version} is available.', later: 'Later', download: 'Download',
    downloading: 'Downloading and verifying the installer. You can cancel from the application menu.',
    ready: 'Version {version} is ready to install.', install: 'Quit and open installer',
    windowsInstall: 'Local tasks will stop and the app will quit. Follow Setup to install, then reopen the app. Account and organization data are preserved.',
    macInstall: 'Local tasks will stop and the app will quit. In the disk image, drag the app to Applications and confirm replacement, then reopen it. Account and organization data are preserved.',
    failed: 'The update could not be verified, downloaded or opened. Try again or ask your administrator for an installer. If the app has stopped, quit and reopen it.',
  },
  zh: {
    title: '桌面端更新', check: '检查更新…', cancel: '取消更新下载', ok: '确定',
    unconfigured: '此构建未配置更新服务，请联系管理员获取新版安装包。',
    checking: '正在检查桌面端更新…', current: '当前版本 {version} 已是最新版本。',
    available: '发现新版本 {version}。', later: '稍后', download: '下载',
    downloading: '正在下载并校验安装包，可从应用菜单取消。',
    ready: '版本 {version} 已准备好安装。', install: '退出并打开安装器',
    windowsInstall: '本地任务将停止，应用将退出。请按 Setup 提示安装，然后重新打开应用。账号和组织数据会保留。',
    macInstall: '本地任务将停止，应用将退出。请在磁盘映像中将应用拖入“应用程序”并确认替换，然后重新打开应用。账号和组织数据会保留。',
    failed: '更新校验、下载或打开失败。请重试或联系管理员获取安装包。如果应用已停止，请退出并重新打开。',
  },
} as const
