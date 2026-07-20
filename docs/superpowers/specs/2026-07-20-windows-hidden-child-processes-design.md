# Port Cleaner Windows 子进程无窗口执行设计

## 目标

- Windows 扫描端口、读取进程详情和结束进程时不再短暂弹出黑色控制台窗口。
- 应用使用过程中只展示 Port Cleaner 主窗口。
- macOS 和 Linux 的命令执行行为保持不变。

## 方案

所有平台命令均通过 `platform::run_command_output` 创建 `tokio::process::Command`。在该公共入口中仅针对 Windows 设置 `CREATE_NO_WINDOW` 创建标志，使 `netstat.exe`、`tasklist.exe` 和 `taskkill.exe` 都不创建控制台窗口。

不通过 `cmd.exe`、PowerShell 或脚本包装系统命令，继续保留当前绝对路径、参数数组和标准输出捕获方式。

## 验证

- 静态回归测试确认公共命令执行入口导入并应用 `CREATE_NO_WINDOW`。
- 运行前端/配置测试、生产构建和全部 Rust 测试。
- Windows 重新构建后人工验证手动刷新、自动刷新、查看详情和结束进程均不弹出黑窗。
