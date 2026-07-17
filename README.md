# Port Cleaner

Port Cleaner 是一个本地桌面工具，用于查看当前机器上的 TCP/UDP 端口绑定、检查对应进程，并在明确确认后尝试终止该进程。应用基于 Tauri 2、Rust、React 与 TypeScript，所有扫描和终止操作都在本机完成。

> [!WARNING]
> 终止进程可能导致未保存数据丢失、开发服务中断或系统组件异常。执行前请核对协议、地址、端口、PID 和进程信息。Port Cleaner 不会自动提权，也不会绕过操作系统权限。

## 支持平台

| 平台 | 状态 | 主要系统接口 |
| --- | --- | --- |
| macOS | 支持 | `lsof`、`ps`、`/bin/kill -TERM`、`proc_pidinfo` |
| Linux | 支持 | `ss`、`ps`、`/proc/<pid>/stat`、`/bin/kill -TERM` |
| Windows | 支持 | `netstat.exe`、单次 `tasklist.exe /fo csv /nh`、`taskkill.exe /PID <pid> /T`、Windows Process API |

实际可见范围取决于当前用户权限、系统工具输出和操作系统安全策略。CI 会在 macOS、Ubuntu 和 Windows 上编译并运行 Rust 测试，但真实端口发现和真实进程终止仍需在各平台人工验证。

## 功能

- 列出本机 TCP 监听和 UDP 绑定，并显示地址、端口、PID、进程和访问状态。
- 按端口、地址、协议、进程名或 PID 过滤结果。
- 查看可用的进程详情；字段受平台和权限限制。
- 对受限/未知所有者和 PID `0` 禁用终止操作。
- 终止前要求显式确认，并重新验证目标绑定和进程生命周期身份。
- 仅使用非强制终止：Unix 发送 `SIGTERM`；Windows 调用不带 `/F` 的 `taskkill /T`。

## 架构

- `src/`：React UI、类型定义和 Tauri `invoke` 封装；不直接执行系统命令。
- `src-tauri/src/domain.rs`：前后端共享语义的序列化 DTO。
- `src-tauri/src/platform/`：固定路径/系统目录中的受信任命令、平台 API 和纯解析器。
- `src-tauri/src/process_service.rs`：详情读取、权限检查、精确绑定与生命周期复核、终止编排。
- `src-tauri/src/commands.rs`：暴露给前端的最小 Tauri 命令边界。

WebView 使用限制性 CSP；主窗口 capability 的权限列表为空。前端仅能调用应用注册的三个 Tauri 命令，没有通用 Core 或 Shell 权限，不能提交任意可执行文件或参数。

## 前置条件

通用开发环境：

- Node.js 20.19+ 或 22.12+，以及与 `package-lock.json` 配套的 npm。
- Rust stable toolchain，并安装 `rustfmt` 与 `clippy` 组件。
- Tauri 2 对应平台的原生编译工具链。

平台要求：

- **macOS**：Xcode Command Line Tools；系统提供 `/usr/sbin/lsof`、`/bin/ps` 和 `/bin/kill`。
- **Linux**：`iproute2`（提供 `ss`）、`procps`（提供 `ps`）、`procfs`，以及 Tauri/WebKitGTK 构建依赖。Debian/Ubuntu 可安装：

  ```bash
  sudo apt-get update
  sudo apt-get install -y \
    build-essential curl file wget \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev libssl-dev libxdo-dev iproute2 procps
  ```

- **Windows**：Microsoft C++ Build Tools 与 WebView2；系统目录中提供 `netstat.exe`、`tasklist.exe` 和 `taskkill.exe`。

上述 `sudo` 仅用于开发者安装 Linux 构建依赖。Port Cleaner 应用自身不会运行 `sudo`、UAC 提权或任何自动提权流程。

## 开发与构建

```bash
npm ci                         # 安装锁定的前端/Tauri CLI 依赖
npm run dev                    # 仅启动 Vite 前端
npm run tauri dev              # 启动桌面开发模式
npm test                       # 运行 Vitest 组件与 API 测试
npm run verify:release         # 校验 package/Cargo/Tauri 发布元数据与 CSP
npm run test:release-metadata  # 运行发布元数据校验器的负向变异测试
npm run build                  # TypeScript 检查并生成前端生产构建
npm run check                  # 依次运行元数据校验、前端测试和生产构建

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked

npm run tauri build            # 为当前操作系统生成 release 安装包/应用包
npm run tauri build -- --debug # 可选：生成当前平台 debug 包
```

Tauri 只能为当前宿主平台构建对应格式；例如 DMG 只能在 macOS 上生成。产物位于 `src-tauri/target/{release,debug}/bundle/`。完整人工检查见 `docs/validation/port-cleaner-manual-checklist.md`。

## 安全模型与限制

### 受信任的本机依赖

- Linux 只从固定白名单选择 `/usr/bin/ss` 或 `/bin/ss`、`/bin/ps` 或 `/usr/bin/ps`，终止只调用 `/bin/kill -TERM`。
- macOS 只调用 `/usr/sbin/lsof`、`/bin/ps` 和 `/bin/kill -TERM`。
- Windows 通过 `GetSystemDirectoryW` 定位原生系统目录，再调用其中的 `netstat.exe`、`tasklist.exe` 和 `taskkill.exe`；端口扫描后用一次 `tasklist.exe /fo csv /nh` 建立 PID 到映像名的映射，生命周期身份来自 Windows Process API。
- Unix 命令强制使用 `LC_ALL=C` 和 `LANG=C`，降低本地化输出造成的解析差异。

应用不接受任意可执行文件路径，不通过 Shell 拼接命令，也不扫描远程主机。

### 终止前复核

一次终止请求必须携带用户所选行的 PID、协议、本地地址和端口。后端会：

1. 拒绝 PID `0`、不存在进程以及 `Restricted` 进程。
2. 读取进程生命周期身份（Linux 启动时钟、macOS 启动时间、Windows 创建时间）。
3. 重新扫描并确认同一 PID 仍精确绑定同一协议、规范化地址和端口。
4. 在启动终止命令前再次读取生命周期身份，防止 PID 已被复用。

这些检查缩小了误杀窗口，但无法提供原子保证：最后一次身份复核与操作系统实际启动 `kill`/`taskkill` 之间仍存在很小的命令启动 TOCTOU（检查时与使用时）竞争窗口。对该残余风险敏感时，请不要使用终止功能，改为在终端中人工确认。

### 权限与终止语义

- 不自动请求管理员/root 权限，不显示系统提权提示，也不重试为高权限操作。
- 无法确定所有者、无法读取 PID 或权限受限的记录只用于查看，不能终止。
- 不提供 `SIGKILL`、`kill -9`、`taskkill /F` 或“强制终止”回退。
- Windows 的 `/T` 会作用于目标进程树，但未使用 `/F`；具体退出行为仍由 Windows 和目标进程决定。

### 本地范围与非目标

- 仅处理当前机器可见的端口和进程；没有远程扫描、远程控制、遥测或云端服务。
- 不修改防火墙、端口转发、容器/虚拟机网络、服务启动项或系统网络配置。
- 不保证识别容器、WSL、网络命名空间、沙箱或其他用户会话中的全部绑定。
- 不负责释放内核仍处于 `TIME_WAIT` 等状态的端口；只有拥有进程的活跃绑定才可能通过终止进程消失。
- UDP 通常没有类似 TCP 的连接状态，界面可能显示 `Unknown`。

## 平台注意事项

- **Linux**：`ss -p` 对其他用户进程可能隐藏 PID/进程名；缺少 `procfs` 或受限 `/proc` 挂载会阻止生命周期复核。
- **macOS**：系统隐私/权限和 `lsof` 可见性会影响结果；受保护进程通常不可终止。
- **Windows**：绑定列表和详情会在 `tasklist` 仍能找到该 PID 时暴露映像名/进程名与 PID；若进程在两次系统查询之间退出，名称可能暂时不可用。`tasklist` 不提供用户、可执行文件路径或完整命令行，因此这些字段可能显示 `Unavailable`，不是发布必需元数据。受保护进程、服务和其他用户进程可能返回 Access Denied；32/64 位系统目录解析由 Windows API 决定。
- 系统命令输出格式若被操作系统版本改变，相关行可能被拒绝或扫描失败；fixture 测试覆盖的是仓库中已知格式。

## 验证

CI 不启动真实监听器，也不执行真实进程终止。Rust 终止测试使用替身 terminator 验证调用顺序和安全条件；真实行为应按人工清单在隔离的测试进程上验证，切勿选择重要服务或未保存工作的应用。
