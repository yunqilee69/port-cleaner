# Port Cleaner Windows 强制结束与命令预览设计

## 目标

- Windows 结束进程始终执行 `taskkill.exe /PID <pid> /T /F`。
- 确认弹窗展示即将执行的命令，让用户明确了解结束方式。
- Windows 文案明确说明会强制结束目标及其子进程。
- macOS 和 Linux 继续使用 `/bin/kill -TERM <pid>`，不改变现有行为。

## 方案

Windows 平台的 `termination_command` 增加 `/F` 参数，继续使用 System32 中的绝对可执行文件路径和 `CREATE_NO_WINDOW`。服务层现有的端口绑定与进程身份复核保持不变，强制命令只会在所有复核完成后执行。

前端增加一个纯函数，根据 Tauri WebView 的 user agent 生成平台对应的命令展示和是否强制结束的标记。确认弹窗使用该展示信息生成警告、命令预览和确认按钮文案；成功提示也与实际结束方式保持一致。

## 验证

- Rust 测试确认 Windows 命令包含 `/PID`、`/T` 和 `/F`。
- 前端纯函数测试确认 Windows 与 Unix 命令展示。
- 组件测试确认 Windows 弹窗显示强制警告和完整命令。
- 运行完整前端检查、构建、Rust 测试和 Windows 配置回归检查。
