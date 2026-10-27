# Agent Note: 本机桌面安装包保护

Status: implemented

[English](2026-10-19-local-desktop-installer-protection.md) | 中文

## 问题

企业桌面需要在尚无 Apple 开发者账号时提供可安装的 macOS 和 Windows 产物。开发包包含可读的应用 JavaScript、TypeScript 声明和 source map。仅有原生可执行文件无法保护动态加载的 Host 和 Client 插件，而且从仓库附近启动构建产物时，可能误选开发运行时。

## 决策

[安装包构建器](../../../../apps/electrobun/scripts/build-installer.ts) 生成带 ad-hoc 签名的本机 Apple Silicon DMG。Developer ID 发布遵循[可续办公证决策](../process/2026-10-21-macos-release-notarization.zh.md)。应用包清单拥有版本号。独立的临时 Electrobun 项目拥有原生暂存构建及其锁；打包元数据选择 stable 通道，开发进程继续使用已有资源。发布主进程编译固定选择包内运行时，同时保留运维人员显式覆盖运行时的能力。 它还会校验并嵌入构建环境的 `ENTERPRISE_API_URL`，使从 Finder 启动的应用保留预期部署地址。HTTPS 来源和明确的 HTTP 回环来源使用与原生登录相同的校验；格式错误或不安全的远程来源会在打包前失败。源码开发继续读取启动时的配置。 原生账号来源遵循[仅依赖 API 的认证决策](2026-10-21-desktop-api-only-authentication.zh.md)。

在 x64 Windows 上，同一构建器会准备宿主原生的 Electrobun 投影，使用 Zig 或 MSVC 编译 DPAPI 凭据辅助程序和 Node 启动器，并生成 stable `智域OS-Setup.zip`。ZIP 会把 Electrobun 的 `Setup.exe`、`.installer` 元数据和 Zstandard 应用载荷放在一起；只有完整解压归档后才能安装应用。本机 Windows 产物没有 Authenticode 身份。验证器检查 SHA-256 校验文件、x64 PE 文件头、stable 元数据和载荷魔数；交互式安装仍由 Windows 主机验收。

[资源保护器](../../../../apps/electrobun/scripts/protect-build.ts) 使用固定版本的 `javascript-obfuscator` 转换 Resources 中的第一方 JavaScript，包括应用壳、浏览器 bundle、复制的插件和 `@deepseek-ai` 运行时依赖。原生 DSH 启动器将自身替换为随包官方 Node，以执行磁盘上的受保护 CLI，保留 PID 和信号传递。CLI 和插件从同一随包生产依赖树解析导入，该树包含桌面依赖和声明的工作区 peer。依赖遍历与部署清单排除企业客户端已编译的 API 依赖，防止仅提供源码的服务端文件进入运行时依赖树。官方 Node 归档与构建宿主版本一致，并按 Node 发布的 SHA-256 验证；许可证随应用分发。生成的标识符使用由文件名派生的前缀，因为 Client 合并脚本共享全局作用域。字符串采用由 JavaScript 解析器处理的转义字面量；受保护的渲染路径不执行生成的字符串数组查找或 Base64 解码。导出名、属性名和通过反射读取的服务名保持稳定。暂存内容会移除 source map、source-map 注释、TypeScript、原生源码文件和环境文件。资源写入会替换暂存文件，保持硬链接的构建输入不变。第三方 JavaScript 和许可证保持可用。保护器回归测试执行拼接后的经典脚本注册并调用两个工厂；单靠文件哈希不能证明浏览器可执行性。模块哈希用于检测保护后的意外替换或遗漏；面对可以替换记录的攻击者，它不提供密码学真实性保证。

保护先于验证及 ad-hoc 签名。 打包 profile 冒烟测试运行器根据脚本 URL 定位桌面项目，不依赖调用者的工作目录。[安装包验证器](../../../../apps/electrobun/scripts/verify-installer.ts) 检查 DMG 校验和，将应用复制到仓库外，验证已签名应用及保护资源，并使用无需密钥的本地 API fixture 启动包内企业 Web profile。在 Windows 上，它检查完整解压的安装载荷；包装器的 post-wrap 钩子会在生成 ZIP 前运行包内 profile 冒烟测试。有模型与空模型目录会验证真实依赖解析及认证后的 HTML。[SDK 可执行文件分发](2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md) 保留自身打包策略；[开发启动](../bug-fix/2026-09-16-enterprise-start-builds-runtime.zh.md) 保留源码运行时选择。

[桌面品牌决策](2026-10-21-zhiyu-desktop-brand.zh.md)负责产品名、图标及安装包更名时保留的稳定身份。

## 考虑过的替代方案

**只归档资源而不转换。** 归档保留原始 JavaScript 和 source map，普通解压即可读取应用源码。

**仅压缩代码。** 压缩可缩小体积并移除注释，但应用字面量和大量模块结构仍然可读。标识符转换与转义字面量在保留 ESM 互操作的同时增加独立障碍。

**运行时字符串数组解码。** 反复查表与 Base64 解码会增加受保护长对话的切换成本。解析期转义字面量保留源码变换，无需在每次渲染中增加解码调用。手动[浏览器基准](../../../../apps/web/tests/complex-history.perf.ts)可提供暂存或已安装的 Client 资源，并分别报告插件生命周期变更与脚本、样式和布局耗时；它不对实际耗时设置断言。

**仅使用字节码的 Electrobun 主进程。** Electrobun 2.0.1 将 Cottontail 字节码配置声明为尚未实现。桌面使用 Bun，因为固定版本的 Cottontail 运行时在当前 Apple Silicon 宿主上崩溃。仅对应用壳使用字节码也会暴露浏览器及动态加载插件的 JavaScript。

**没有开发者身份却要求 Apple 信任的分发。** ad-hoc 签名验证本地代码完整性，但不提供 Developer ID 身份或公证票据。面向公众的 Gatekeeper 验收需要独立的 Apple 签名和公证流程。

## 影响

本机构建提供可安装产物，并检测随包资源中的可读源码和调试文件。混淆增加构建时间并降低生产堆栈的可读性。客户端可执行逻辑仍可恢复；协议、公开名称和第三方代码仍可检查。密钥必须保留在应用之外。本机冒烟不能证明 Intel 支持、全新机器上的原生模块可移植性、真实模型运行、Windows 发布者信任或 Gatekeeper 信任。
