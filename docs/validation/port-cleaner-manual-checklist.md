# Port Cleaner 人工发布检查清单

在 macOS、Linux 和 Windows 的隔离测试环境中分别执行。仅使用可安全终止、没有未保存数据的测试进程；不要以管理员/root 身份启动 Port Cleaner，除非专门验证部署环境且已理解风险。

## 启动可复现监听器

在对应平台的普通用户终端运行，并保持终端打开：

**macOS / Linux（需要 Python 3）：**

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

**Windows PowerShell：**

```powershell
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3000); $listener.Start(); Write-Host "Listening on 127.0.0.1:3000 (PID $PID)"; try { while ($true) { Start-Sleep -Seconds 3600 } } finally { $listener.Stop() }
```

使用 `Ctrl+C` 可在不测试 Port Cleaner 终止功能时停止监听器。

## 受限记录的必需自动化证据

真实操作系统不一定隐藏 PID 或所有者信息，因此发布证据必须先包含以下三个可重复测试。逐条运行并保存完整输出；记录测试日期、操作系统、命令、退出码 `0` 和输出中的通过测试名。

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test platform_parsing parses_macos_lsof_rows_with_a_header_and_restricted_udp_socket --locked
cargo test --manifest-path src-tauri/Cargo.toml --test termination refuses_restricted_processes_without_revalidation_or_termination --locked
npm test -- src/App.test.tsx -t "disables termination when ownership is restricted"
```

这些输出分别证明：解析器把缺失 PID 的记录标记为 `Restricted`；服务在调用终止器前拒绝受限进程；UI 禁用受限记录的终止按钮。任一命令未通过或未保存输出时，受限记录验证不得签字通过。

## 本机监听器流程

1. Start a local listener on TCP port 3000.
2. Confirm Port Cleaner displays TCP, 127.0.0.1, port 3000, PID, and process name.
3. Select the row and verify the detail panel process name and PID match the process. On Windows, user, executable path, and command line are optional and may correctly show `Unavailable`.
4. Cancel the termination dialog and verify the listener remains reachable.
5. Confirm termination, verify the listener exits, then refresh and verify the row disappears.

## 条件性真实受限记录检查

此检查取决于操作系统是否向当前普通用户隐藏其他用户的 PID/进程信息，因此不是每台机器都会出现受限行。

- 如果扫描结果中出现真实 `Restricted` 行，必须选择该行并验证没有可用终止控制，同时保存截图和对应原生命令输出。
- 安全创建方式：使用专门的第二个**非管理员**测试账户，在该账户的交互式终端运行同样的监听器命令，但改用端口 `3001`；然后回到主要普通用户会话运行 Port Cleaner。不要使用系统服务、受保护进程或重要应用制造受限记录。
- 如果平台仍公开进程信息，或无法提供第二个测试账户，将该项标记为 `N/A`。记录操作系统版本、Port Cleaner 运行账户权限、端口 `3001` 行的截图，以及平台命令输出（Linux `ss -ltnup`、macOS `lsof -nP -iTCP:3001 -sTCP:LISTEN`、Windows `netstat.exe -ano -p tcp`）作为证据。
- 应用本身必须始终以普通用户运行；创建测试账户/会话所需的管理员操作只用于测试准备，不代表应用会自动提权。

## 补充检查

- 验证搜索可按 `3000`、PID、协议和进程名过滤。
- 验证详情中的进程名和 PID 与系统工具一致。仅在平台确实返回时核对用户、可执行文件和命令行；Windows 当前允许这些字段为 `Unavailable`。
- 在确认对话框打开后让测试监听器退出或改绑，确认终止请求被拒绝为绑定已变化。
- 验证 PID `0`、未知 PID 和权限受限记录没有可用的终止操作。
- 验证应用不会出现 `sudo`、UAC 或其他自动提权提示。
- 验证失败后列表仍保留，错误可见，并可安全刷新。
- 记录操作系统版本、CPU 架构、安装包格式和结果；Windows 同时确认弹窗展示 `taskkill.exe /PID <pid> /T /F`，且 `/T /F` 的强制进程树影响符合预期。

## 发布产物

- macOS：确认 `.app` 及所选安装包可启动；签名/公证不在当前 MVP 自动化范围内。
- Linux：确认当前发行版生成的 AppImage、deb 或 rpm（以 Tauri 实际输出为准）可启动，并具备 `ss`/`ps` 运行依赖。
- Windows：确认 NSIS/MSI（以 Tauri 实际输出为准）可安装和启动；代码签名不在当前 MVP 自动化范围内。

CI 和单元测试不得执行真实终止；真实终止仅限上述人工测试进程。
