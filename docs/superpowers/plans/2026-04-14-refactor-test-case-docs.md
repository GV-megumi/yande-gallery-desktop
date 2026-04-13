# 重构测试用例文档体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为整套重构文档建立一套按任务包（TP-01 ～ TP-13）组织的完整测试用例需求说明，落地到 `重构文档/测试用例/`。

**Architecture:** 采用“索引 + 总则 + 任务包分文档”的文档体系：`README.md` 负责导航与映射，`00-测试规范总则.md` 负责统一测试原则、证据要求、分层与缺陷判定，`TP-01` ～ `TP-13` 各自承接对应任务包的测试范围、前置条件、详细用例、验收标准与回归要求。文档内容必须对齐 `重构文档/02-优先级与分阶段整改路线图.md`、`重构文档/03-任务拆分总控.md` 和 `重构文档/10` ～ `16` 专项文档。

**Tech Stack:** Markdown 文档、现有重构文档体系、Git 变更校验

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| Create | `重构文档/测试用例/README.md` | 测试文档目录入口、阅读顺序、TP 映射、使用方式 |
| Create | `重构文档/测试用例/00-测试规范总则.md` | 统一测试目标、分层、证据标准、缺陷分级、回归规范 |
| Create | `重构文档/测试用例/TP-01-修下载状态机与暂停恢复取消语义.md` | 下载状态语义专项测试要求 |
| Create | `重构文档/测试用例/TP-02-修批量调度生命周期与原子领取.md` | 批量调度、claim、监听解绑测试要求 |
| Create | `重构文档/测试用例/TP-03-收紧下载文件协议与完整性校验.md` | `.part + rename`、校验、清理、恢复测试要求 |
| Create | `重构文档/测试用例/TP-04-修页面伪能力与功能闭环.md` | 页面伪设置、假按钮、失败态、恢复入口测试要求 |
| Create | `重构文档/测试用例/TP-05-统一IPC协议单一来源.md` | 通道来源、声明、签名一致性测试要求 |
| Create | `重构文档/测试用例/TP-06-收缩preload-shared-handler边界.md` | preload 收缩、DTO、子窗口能力集测试要求 |
| Create | `重构文档/测试用例/TP-07-收紧配置凭证与外部能力安全边界.md` | renderer-safe DTO、安全协议、外链与 webview 测试要求 |
| Create | `重构文档/测试用例/TP-08-修运行入口启动时序与退出治理.md` | Electron 启动、退出、异常治理测试要求 |
| Create | `重构文档/测试用例/TP-09-统一导航弹窗空错态与隐藏页副作用.md` | 导航、Modal、空错态、隐藏页副作用测试要求 |
| Create | `重构文档/测试用例/TP-10-建立桌面基础能力后台常驻托盘通知基础.md` | 后台常驻、托盘、通知、单实例测试要求 |
| Create | `重构文档/测试用例/TP-11-下沉页面层业务编排为hooks-facade.md` | hooks / facade 下沉与页面职责收敛测试要求 |
| Create | `重构文档/测试用例/TP-12-评估并接入成熟库与现代化能力.md` | 引库范围、收益风险、回归与性能验证要求 |
| Create | `重构文档/测试用例/TP-13-建立页面偏好持久化与配置边界分层.md` | config / DB / localStorage 分层与偏好持久化测试要求 |

---

### Task 1: 建立测试文档目录入口

**Files:**
- Create: `重构文档/测试用例/README.md`

- [ ] **Step 1: 写入 `重构文档/测试用例/README.md`**

```markdown
# 测试用例文档

本目录用于为 `重构文档` 对应的全部整改任务提供统一、可执行、可验收的测试用例需求说明。

## 目标

- 将测试要求从零散回归项提升为可分发、可复核、可签收的文档体系
- 与 [02-优先级与分阶段整改路线图.md](../02-优先级与分阶段整改路线图.md) 和 [03-任务拆分总控.md](../03-任务拆分总控.md) 保持一一映射
- 支持人工测试、自动化补测、阶段验收和交叉回归

## 阅读顺序

1. [00-测试规范总则.md](./00-测试规范总则.md)
2. 按当前实施任务阅读对应 TP 文档
3. 如测试范围跨专题，再回看对应专项文档：
   - [10-下载并发与调度链路重构.md](../10-下载并发与调度链路重构.md)
   - [11-Electron桌面能力重构.md](../11-Electron桌面能力重构.md)
   - [12-IPC与进程边界重构.md](../12-IPC与进程边界重构.md)
   - [13-页面功能完整性修补.md](../13-页面功能完整性修补.md)
   - [14-UI交互一致性修正.md](../14-UI交互一致性修正.md)
   - [15-稳定性错误恢复与安全性修正.md](../15-稳定性错误恢复与安全性修正.md)
   - [16-成熟库替代与现代化升级建议.md](../16-成熟库替代与现代化升级建议.md)

## 文档清单

- [00-测试规范总则.md](./00-测试规范总则.md)
- [TP-01-修下载状态机与暂停恢复取消语义.md](./TP-01-修下载状态机与暂停恢复取消语义.md)
- [TP-02-修批量调度生命周期与原子领取.md](./TP-02-修批量调度生命周期与原子领取.md)
- [TP-03-收紧下载文件协议与完整性校验.md](./TP-03-收紧下载文件协议与完整性校验.md)
- [TP-04-修页面伪能力与功能闭环.md](./TP-04-修页面伪能力与功能闭环.md)
- [TP-05-统一IPC协议单一来源.md](./TP-05-统一IPC协议单一来源.md)
- [TP-06-收缩preload-shared-handler边界.md](./TP-06-收缩preload-shared-handler边界.md)
- [TP-07-收紧配置凭证与外部能力安全边界.md](./TP-07-收紧配置凭证与外部能力安全边界.md)
- [TP-08-修运行入口启动时序与退出治理.md](./TP-08-修运行入口启动时序与退出治理.md)
- [TP-09-统一导航弹窗空错态与隐藏页副作用.md](./TP-09-统一导航弹窗空错态与隐藏页副作用.md)
- [TP-10-建立桌面基础能力后台常驻托盘通知基础.md](./TP-10-建立桌面基础能力后台常驻托盘通知基础.md)
- [TP-11-下沉页面层业务编排为hooks-facade.md](./TP-11-下沉页面层业务编排为hooks-facade.md)
- [TP-12-评估并接入成熟库与现代化能力.md](./TP-12-评估并接入成熟库与现代化能力.md)
- [TP-13-建立页面偏好持久化与配置边界分层.md](./TP-13-建立页面偏好持久化与配置边界分层.md)

## TP 映射表

| 任务包 | 阶段 | 主要专题 | 对应测试文档 |
|---|---|---|---|
| TP-01 | 阶段 0 | 下载状态机 | `TP-01-修下载状态机与暂停恢复取消语义.md` |
| TP-02 | 阶段 0 | 批量调度 | `TP-02-修批量调度生命周期与原子领取.md` |
| TP-03 | 阶段 0/1 | 文件协议 | `TP-03-收紧下载文件协议与完整性校验.md` |
| TP-04 | 阶段 0/1 | 页面闭环 | `TP-04-修页面伪能力与功能闭环.md` |
| TP-05 | 阶段 1 | IPC 协议 | `TP-05-统一IPC协议单一来源.md` |
| TP-06 | 阶段 1/3 | preload/shared/handler 边界 | `TP-06-收缩preload-shared-handler边界.md` |
| TP-07 | 阶段 0/1 | 安全边界 | `TP-07-收紧配置凭证与外部能力安全边界.md` |
| TP-08 | 阶段 0/1 | 启动与退出治理 | `TP-08-修运行入口启动时序与退出治理.md` |
| TP-09 | 阶段 2 | 交互一致性 | `TP-09-统一导航弹窗空错态与隐藏页副作用.md` |
| TP-10 | 阶段 2/4 | 桌面基础能力 | `TP-10-建立桌面基础能力后台常驻托盘通知基础.md` |
| TP-11 | 阶段 3 | hooks/facade | `TP-11-下沉页面层业务编排为hooks-facade.md` |
| TP-12 | 阶段 3/4 | 成熟库与现代化 | `TP-12-评估并接入成熟库与现代化能力.md` |
| TP-13 | 阶段 1/3 | 页面偏好持久化 | `TP-13-建立页面偏好持久化与配置边界分层.md` |

## 使用规则

1. 任何 TP 文档都必须遵循 [00-测试规范总则.md](./00-测试规范总则.md)
2. 测试通过不等于仅跑通 build/test，必须覆盖对应文档声明的页面、服务、IPC、生命周期和回归链路
3. 如果某项无法验证，必须在测试记录中说明阻塞原因、已做尝试和遗留风险
4. 每个 TP 文档都必须能被独立分发给执行者，不依赖口头补充
```

- [ ] **Step 2: 检查 README 中的链接和文件名是否与计划一致**

Run:
```bash
python - <<'PY'
from pathlib import Path
root = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例')
readme = root / 'README.md'
text = readme.read_text(encoding='utf-8')
required = [
    '00-测试规范总则.md',
    'TP-01-修下载状态机与暂停恢复取消语义.md',
    'TP-13-建立页面偏好持久化与配置边界分层.md'
]
missing = [item for item in required if item not in text]
print('missing:', missing)
PY
```
Expected: `missing: []`

- [ ] **Step 3: Commit**

```bash
git add "重构文档/测试用例/README.md"
git commit -m "docs: 新增重构测试用例目录索引"
```

---

### Task 2: 编写统一测试规范总则

**Files:**
- Create: `重构文档/测试用例/00-测试规范总则.md`

- [ ] **Step 1: 写入 `重构文档/测试用例/00-测试规范总则.md`**

```markdown
# 00-测试规范总则

## 1. 文档目的

本文件用于统一 `重构文档/测试用例/` 下全部 TP 文档的测试口径，避免不同任务包出现：

- 用例粒度不一致
- 通过标准不一致
- 证据要求不一致
- 只跑单点功能、不做交叉回归
- 只看 UI 表象、不验证主进程/IPC/配置/生命周期链路

## 2. 测试原则

1. **测试对象是“整改需求”，不是单点页面截图**
   - 必须同时覆盖页面行为、主进程服务、IPC/preload、配置/数据库、启动/关闭/恢复链路。
2. **测试通过不等于仅跑通自动化**
   - 任何 TP 若涉及桌面行为、窗口生命周期、隐藏页副作用、通知、托盘、webview、安全边界，必须有人机验证或明确说明无法验证的原因。
3. **必须保留证据**
   - 至少保留命令输出、日志、页面行为描述、异常现象、截图路径或复现步骤中的一种。
4. **必须做负向和边界验证**
   - 不能只验证黄金路径。
5. **必须做交叉回归**
   - 每个 TP 修复后都要回归其依赖链和相邻高风险包。

## 3. 统一文档结构

每个 TP 文档必须至少包含：

1. 文档目标
2. 对应任务包与关联文档
3. 测试范围
4. 风险摘要
5. 测试前置条件
6. 测试分层
7. 详细测试用例
8. 负向与边界场景
9. 验收标准
10. 交叉回归要求
11. 自动化建议
12. 不在本包主责任范围的说明

## 4. 用例编号规范

- 编号格式：`[TP编号]-TC-[三位序号]`
- 例如：
  - `TP-01-TC-001`
  - `TP-01-TC-002`
  - `TP-10-TC-014`
- 同一文档编号必须连续，不允许重复编号。

## 5. 测试分层定义

### 5.1 配置/数据层
- 配置读写、数据库状态、唯一约束、恢复数据、迁移结果。

### 5.2 主进程服务层
- 调度器、生命周期、文件系统、状态机、异常治理、通知、托盘等主进程职责。

### 5.3 IPC / preload / shared 边界层
- 通道名、参数签名、返回 DTO、安全收敛、事件广播。

### 5.4 渲染层交互层
- 页面入口、按钮、弹窗、空错态、列表、反馈消息、路径选择、过滤器、排序与分页。

### 5.5 生命周期与异常场景层
- 启动、关闭、最小化、隐藏、恢复、重复启动、崩溃、退出清理。

### 5.6 非功能层
- 性能、稳定性、并发、安全性、一致性、可解释性。

## 6. 缺陷级别建议

- **阻断**：直接导致功能不可用、状态污染、安全失守、数据误删误写。
- **严重**：主链路可走但结果不可信、伪能力、明显错误恢复缺失。
- **中等**：交互割裂、状态表达错误、回归风险高但存在替代路径。
- **一般**：文案、提示、低频边角问题，不影响本次阶段验收主结论。

## 7. 证据留存要求

每条关键用例至少记录：

- 执行时间
- 代码版本 / 分支 / 提交号
- 前置数据
- 执行步骤
- 实际结果
- 预期结果
- 是否通过
- 证据位置（日志、截图、录屏、命令输出）

## 8. 回归规则

1. 阶段 0 包至少回归：下载、配置、启动入口、关键高频页面。
2. 阶段 1 包至少回归：IPC、preload、Settings、Gallery、FavoriteTags、SavedSearch。
3. 阶段 2 包至少回归：App 主导航、Modal、空错态、隐藏页行为、桌面入口。
4. 阶段 3/4 包至少回归：性能、结构稳定性、成熟库接入前后行为一致性。

## 9. 自动化建议规则

- **必须自动化优先**：状态机、唯一约束、DTO 签名、纯函数转换、文件协议。
- **建议自动化**：高频页面查询条件、配置保存链路、错误态切换。
- **保留人工为主**：托盘、系统通知、窗口关闭/恢复、webview、真实桌面行为。

## 10. 禁止的验收方式

以下方式单独存在时，不能视为“测试通过”：

- 只跑 `npm run build`
- 只跑 `npm run test`
- 只开页面看一眼
- 只看代码没报错
- 只验证一条黄金路径
- 没有任何日志/行为/步骤证据就宣布通过
```

- [ ] **Step 2: 运行格式校验，确认文件中包含全部必需章节**

Run:
```bash
python - <<'PY'
from pathlib import Path
path = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例/00-测试规范总则.md')
text = path.read_text(encoding='utf-8')
required = ['## 1. 文档目的', '## 5. 测试分层定义', '## 10. 禁止的验收方式']
missing = [item for item in required if item not in text]
print('missing:', missing)
PY
```
Expected: `missing: []`

- [ ] **Step 3: Commit**

```bash
git add "重构文档/测试用例/00-测试规范总则.md"
git commit -m "docs: 新增重构测试规范总则"
```

---

### Task 3: 编写下载链路测试文档（TP-01 ～ TP-03）

**Files:**
- Create: `重构文档/测试用例/TP-01-修下载状态机与暂停恢复取消语义.md`
- Create: `重构文档/测试用例/TP-02-修批量调度生命周期与原子领取.md`
- Create: `重构文档/测试用例/TP-03-收紧下载文件协议与完整性校验.md`

- [ ] **Step 1: 写入 `TP-01-修下载状态机与暂停恢复取消语义.md`**

```markdown
# TP-01 修下载状态机与暂停恢复取消语义

## 1. 文档目标
验证普通下载与批量下载在 `pending / running / paused / cancelled / failed / completed` 上的状态语义一致，确保用户主动操作不再污染失败态，且重启恢复行为可解释。

## 2. 对应任务包与关联文档
- 任务包：TP-01
- 路线图阶段：阶段 0
- 主责任文档：[10-下载并发与调度链路重构.md](../10-下载并发与调度链路重构.md)
- 关联文档：[03-任务拆分总控.md](../03-任务拆分总控.md)

## 3. 测试范围
- `src/main/services/downloadManager.ts`
- `src/main/services/bulkDownloadService.ts`
- `src/main/services/init.ts`
- 下载页、批量下载页、应用重启后的恢复链路

## 4. 风险摘要
- 用户暂停被写成失败会污染统计、重试和恢复逻辑
- `pauseAll()` 写回 `pending` 会让 UI 无法区分等待和主动暂停
- 启动自动恢复 `paused` 会破坏用户预期

## 5. 测试前置条件
- 至少准备 3 个普通下载任务和 1 个批量下载会话
- 准备可稳定下载的测试目标
- 允许重复启动应用验证恢复链路

## 6. 详细测试用例

### TP-01-TC-001 普通下载单任务暂停后状态应为 paused
- 目的：验证单任务暂停不再进入 failed
- 步骤：启动单个下载 -> 在进行中点击暂停 -> 刷新列表 / 重启应用后再次查看
- 预期：任务状态为 `paused`；不计入失败统计；不会自动恢复
- 观察项：数据库状态、页面标签、日志输出是否一致
- 建议自动化：是

### TP-01-TC-002 普通下载 pauseAll 后已运行任务不应回写为 pending
- 目的：验证批量暂停语义
- 步骤：同时启动多个普通下载 -> 执行 pauseAll -> 观察列表与数据库
- 预期：原运行中任务进入 `paused`；等待中任务仍保留 `pending`
- 观察项：是否出现全部任务统一回写 `pending`
- 建议自动化：是

### TP-01-TC-003 用户取消普通下载不应被计入 failed
### TP-01-TC-004 批量下载记录级暂停后不应污染 failed
### TP-01-TC-005 批量下载记录级取消后不应污染 failed
### TP-01-TC-006 应用重启后 paused 任务不会自动恢复
### TP-01-TC-007 应用重启后 running/downloading 的恢复行为与设计一致
### TP-01-TC-008 页面能清晰区分 pending、paused、running、failed

## 7. 负向与边界场景
- 暂停后立即恢复
- 恢复后立刻取消
- pauseAll 与单任务 pause 混用
- 下载失败后再暂停/恢复的非法路径
- 关闭窗口、退出应用、重新打开期间的状态一致性

## 8. 验收标准
- 主动暂停/取消绝不落为 `failed`
- `pauseAll()` 不得把运行态统一回写为 `pending`
- `paused` 只能由显式恢复动作恢复
- 页面、日志、数据库三处状态一致

## 9. 交叉回归要求
- 回归 TP-02 的批量调度
- 回归 TP-08 的启动/退出治理
- 回归下载页和批量下载页的状态筛选与统计

## 10. 自动化建议
- 状态流转单元/集成测试必须补齐
- 重启恢复建议做集成测试
- 页面状态表达保留人工冒烟补充
```

- [ ] **Step 2: 写入 `TP-02-修批量调度生命周期与原子领取.md`**

```markdown
# TP-02 修批量调度生命周期与原子领取

## 1. 文档目标
验证批量下载会话具备单一活跃执行体、pending 记录领取具备原子性、监听注册与解绑对称，防止重复调度和取消失效。

## 2. 测试范围
- `src/main/services/bulkDownloadService.ts`
- `src/main/services/networkScheduler.ts`
- `src/main/services/database.ts`
- `src/main/services/init.ts`

## 3. 核心测试要求
- 会话活跃标记必须与真实 download loop 一致
- 同一记录不得被两个执行体重复领取
- 暂停/取消必须能命中真实 controller / session
- scheduler listener 必须存在解绑与退出清理

## 4. 详细测试用例
- `TP-02-TC-001` 同一会话重复点击开始，不会创建两个执行体
- `TP-02-TC-002` 同一 pending 记录在并发压力下不会被重复领取
- `TP-02-TC-003` 会话暂停后监听解除，恢复后重新注册且不重复叠加
- `TP-02-TC-004` 会话取消后 controller、活跃态、统计口径同步清理
- `TP-02-TC-005` 启动恢复与手动 start 并发触发时保持幂等
- `TP-02-TC-006` 网络调度器状态切换不会制造僵尸会话
- `TP-02-TC-007` 退出应用后恢复定时器和监听不会残留到下一轮启动

## 5. 负向与边界场景
- 重复 start / pause / resume / cancel 快速连击
- 会话处于 running 时应用崩溃再启动
- 监听回调内部抛错
- 多会话并存且共享站点限流

## 6. 验收标准
- 同一 session 任意时刻仅有一个活跃执行体
- 同一记录不会被重复领取或重复写状态
- 监听注册、解绑、退出清理具备生命周期对称性

## 7. 回归要求
- 回归 TP-01 状态语义
- 回归 TP-03 文件落盘与恢复
- 回归批量下载会话卡片、统计展示和按钮可用性
```

- [ ] **Step 3: 写入 `TP-03-收紧下载文件协议与完整性校验.md`**

```markdown
# TP-03 收紧下载文件协议与完整性校验

## 1. 文档目标
验证普通下载与批量下载在文件落盘、临时文件命名、完整性校验、取消清理、异常恢复上的规则一致且不误删最终文件。

## 2. 测试范围
- `src/main/services/downloadManager.ts`
- `src/main/services/bulkDownloadService.ts`
- `src/main/services/database.ts`
- `src/main/services/booruService.ts`

## 3. 测试前置条件
- 准备可下载的中小文件
- 准备同名已存在文件场景
- 准备下载中断、应用退出、取消、校验失败场景

## 4. 详细测试用例
- `TP-03-TC-001` 下载进行中只写 `.part`，最终路径在校验通过前不可见
- `TP-03-TC-002` 校验通过后才 rename 到最终路径
- `TP-03-TC-003` 校验失败时保留明确的失败态，不误标 completed
- `TP-03-TC-004` cancel 不会删除已完成的最终文件
- `TP-03-TC-005` failed 只清理临时产物，不清理有效最终文件
- `TP-03-TC-006` 重复下载同一目标时 DB 唯一约束/幂等逻辑成立
- `TP-03-TC-007` 异常退出后恢复逻辑不会把半文件误判为完成文件
- `TP-03-TC-008` 批量下载与普通下载的文件协议表现一致

## 5. 边界与异常场景
- rename 前进程退出
- 下载过程中磁盘空间不足
- 已存在目标文件但大小错误
- `.part` 文件残留后再次发起下载

## 6. 验收标准
- 成功前不污染最终文件路径
- 异常和取消不误删完整文件
- 恢复逻辑不依赖脆弱的“文件存在即完成”假设

## 7. 自动化建议
- 文件协议、唯一约束、校验结果建议做集成测试
- cancel/failed 误删保护建议做专门回归测试
```

- [ ] **Step 4: 运行目录级校验，确认三份下载文档都已创建且包含“验收标准”章节**

Run:
```bash
python - <<'PY'
from pathlib import Path
root = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例')
files = [
    'TP-01-修下载状态机与暂停恢复取消语义.md',
    'TP-02-修批量调度生命周期与原子领取.md',
    'TP-03-收紧下载文件协议与完整性校验.md',
]
for name in files:
    text = (root / name).read_text(encoding='utf-8')
    print(name, '## 8. 验收标准' in text or '## 6. 验收标准' in text)
PY
```
Expected: 三行输出均为 `True`

- [ ] **Step 5: Commit**

```bash
git add "重构文档/测试用例/TP-01-修下载状态机与暂停恢复取消语义.md" \
        "重构文档/测试用例/TP-02-修批量调度生命周期与原子领取.md" \
        "重构文档/测试用例/TP-03-收紧下载文件协议与完整性校验.md"
git commit -m "docs: 新增下载链路测试用例说明"
```

---

### Task 4: 编写页面闭环、交互一致性与偏好持久化测试文档（TP-04 / TP-09 / TP-13）

**Files:**
- Create: `重构文档/测试用例/TP-04-修页面伪能力与功能闭环.md`
- Create: `重构文档/测试用例/TP-09-统一导航弹窗空错态与隐藏页副作用.md`
- Create: `重构文档/测试用例/TP-13-建立页面偏好持久化与配置边界分层.md`

- [ ] **Step 1: 写入 `TP-04-修页面伪能力与功能闭环.md`**

```markdown
# TP-04 修页面伪能力与功能闭环

## 1. 文档目标
验证页面上已经暴露给用户的设置、按钮、失败态、重试入口、路径配置与结果表达形成真实闭环；短期无法兑现的入口必须被隐藏、禁用或明确说明。

## 2. 测试范围
- Settings、Booru Settings、Download、FavoriteTags、SavedSearch、Google、InvalidImages、Gallery 等页面
- 配置保存后行为同步
- 页面失败态与恢复路径

## 3. 关键测试用例
- `TP-04-TC-001` `pageMode` 设置修改后行为真实变化，或入口被移除/禁用
- `TP-04-TC-002` `autoGenThumbnail` 设置保存链路真实存在，或入口被撤下
- `TP-04-TC-003` Google Drive / Photos / Gemini 失败后存在显式错误态和重试/退路
- `TP-04-TC-004` InvalidImages 请求失败时不伪装为“没有无效图片”
- `TP-04-TC-005` FavoriteTags 下载路径在未绑定图库时仍有可解释闭环
- `TP-04-TC-006` SavedSearch 编辑态调用签名与 preload / IPC 一致
- `TP-04-TC-007` Download 单条取消入口要么真实可用，要么不再展示假按钮
- `TP-04-TC-008` 图库删除动作在 UI 中有明确入口和确认文案

## 4. 负向与边界场景
- 保存成功提示出现但行为未生效
- 页面失败后无日志但出现空白态
- 路径选择回填来源不明
- 编辑表单保存时参数签名漂移

## 5. 验收标准
- 用户可点击入口不再是空实现
- 失败态、重试入口、配置生效路径都具备可解释性
- 设置提示与真实运行行为一致
```

- [ ] **Step 2: 写入 `TP-09-统一导航弹窗空错态与隐藏页副作用.md`**

```markdown
# TP-09 统一导航弹窗空错态与隐藏页副作用

## 1. 文档目标
验证主导航、Modal、空态/错态/加载态、隐藏页副作用和反馈消息具备统一规则，用户能够建立稳定心智模型。

## 2. 测试范围
- `src/renderer/App.tsx`
- 各高频 Modal
- DownloadHub / TagManagement / FavoriteTags / Google / InvalidImages / Gallery / PostDetails

## 3. 关键测试用例
- `TP-09-TC-001` 一级导航切换时左栏、标题、右侧主内容同步切换
- `TP-09-TC-002` 普通表单弹窗统一支持或统一禁用系统 X / Esc / 遮罩关闭
- `TP-09-TC-003` 特殊沉浸式页面例外规则有明确说明且行为稳定
- `TP-09-TC-004` 错误态不再伪装成空态
- `TP-09-TC-005` 筛选无结果与真正无数据明确区分
- `TP-09-TC-006` 隐藏页不再继续恢复、轮询或重复监听
- `TP-09-TC-007` 批量下载不会逐条刷 success 噪音消息
- `TP-09-TC-008` 关键失败与恢复动作在同类页面中的位置一致

## 4. 边界场景
- display:none 保活页面切换
- navigation stack 非空时基础页隐藏
- 多个弹窗连续打开关闭
- 页面网络失败后切 tab 再返回

## 5. 验收标准
- 同类交互规则一致
- 用户不会再因隐藏页副作用或消息噪音误判当前系统状态
```

- [ ] **Step 3: 写入 `TP-13-建立页面偏好持久化与配置边界分层.md`**

```markdown
# TP-13 建立页面偏好持久化与配置边界分层

## 1. 文档目标
验证页面偏好状态在 config / database / localStorage 之间完成明确分层，FavoriteTags / Gallery / BlacklistedTags 等高频页面能够按规则恢复工作上下文，且 renderer 不再滥用整包配置对象。

## 2. 测试范围
- FavoriteTags、Gallery、BlacklistedTags、App 主导航固定项
- config DTO、页面偏好接口、数据库存储与本地体验偏好

## 3. 关键测试用例
- `TP-13-TC-001` FavoriteTags 的筛选、排序、分页、每页数量可跨会话恢复
- `TP-13-TC-002` Gallery 的搜索词、排序与排序方向可按设计恢复
- `TP-13-TC-003` BlacklistedTags 的过滤和分页状态可按设计恢复
- `TP-13-TC-004` 页面偏好不会继续写入敏感 config 总包
- `TP-13-TC-005` renderer 只获取页面偏好 DTO，而不是直接读写全量配置
- `TP-13-TC-006` localStorage 只承接轻量、无敏感性、renderer 独享偏好
- `TP-13-TC-007` 跨窗口打开时产品级偏好与 renderer 独享偏好边界符合设计

## 4. 边界场景
- 清空 localStorage 后重启
- 数据库偏好记录损坏或缺失
- config 中存在旧版 UI 偏好残留
- 多窗口同时修改偏好

## 5. 验收标准
- 偏好落点与边界清晰
- 高频页面重新进入后能恢复关键工作上下文
- config 不再继续膨胀为混合大包
```

- [ ] **Step 4: 校验三份文档均包含“关键测试用例”与“验收标准”**

Run:
```bash
python - <<'PY'
from pathlib import Path
root = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例')
files = [
    'TP-04-修页面伪能力与功能闭环.md',
    'TP-09-统一导航弹窗空错态与隐藏页副作用.md',
    'TP-13-建立页面偏好持久化与配置边界分层.md',
]
for name in files:
    text = (root / name).read_text(encoding='utf-8')
    print(name, '关键测试用例' in text and '验收标准' in text)
PY
```
Expected: 三行输出均为 `True`

- [ ] **Step 5: Commit**

```bash
git add "重构文档/测试用例/TP-04-修页面伪能力与功能闭环.md" \
        "重构文档/测试用例/TP-09-统一导航弹窗空错态与隐藏页副作用.md" \
        "重构文档/测试用例/TP-13-建立页面偏好持久化与配置边界分层.md"
git commit -m "docs: 新增页面闭环与交互测试用例说明"
```

---

### Task 5: 编写 IPC、边界、安全与运行入口测试文档（TP-05 ～ TP-08）

**Files:**
- Create: `重构文档/测试用例/TP-05-统一IPC协议单一来源.md`
- Create: `重构文档/测试用例/TP-06-收缩preload-shared-handler边界.md`
- Create: `重构文档/测试用例/TP-07-收紧配置凭证与外部能力安全边界.md`
- Create: `重构文档/测试用例/TP-08-修运行入口启动时序与退出治理.md`

- [ ] **Step 1: 写入 `TP-05-统一IPC协议单一来源.md`**

```markdown
# TP-05 统一IPC协议单一来源

## 1. 文档目标
验证 IPC 通道、preload 暴露、renderer 调用签名和 shared 类型来源统一，不再存在裸字符串扩散和已证实签名漂移。

## 2. 关键测试用例
- `TP-05-TC-001` `channels.ts`、preload、renderer 调用引用同一来源
- `TP-05-TC-002` 已知错误调用（如 SavedSearch 编辑签名）被修正
- `TP-05-TC-003` 新增/改动通道时 shared 声明同步更新
- `TP-05-TC-004` `handlers-full.ts` 不再作为误导性协议来源继续参与主链路
- `TP-05-TC-005` 高频页面（Gallery/Favorites/Character/Settings）调用签名与实际 handler 一致

## 3. 验收标准
- 通道名和签名只有一处权威来源
- 已知漂移问题消失
- 不再新增裸字符串通道
```

- [ ] **Step 2: 写入 `TP-06-收缩preload-shared-handler边界.md`**

```markdown
# TP-06 收缩preload-shared-handler边界

## 1. 文档目标
验证 preload 暴露面明显收缩、shared 类型恢复可信、handler 只保留边界职责，主窗口与子窗口能力分级清晰。

## 2. 关键测试用例
- `TP-06-TC-001` renderer 获取的是 DTO/command，而非内部原始对象
- `TP-06-TC-002` 子窗口不再默认拥有主窗口完整高权限 bridge
- `TP-06-TC-003` handler 不再继续承接重业务编排
- `TP-06-TC-004` shared 中误导性旧协议定义被清理或降权
- `TP-06-TC-005` preload 暴露面收缩后高频页面仍能正常运行

## 3. 验收标准
- preload 不是 God API
- shared 类型可信且边界清晰
- handler / service / page 三层职责更可解释
```

- [ ] **Step 3: 写入 `TP-07-收紧配置凭证与外部能力安全边界.md` 与 `TP-08-修运行入口启动时序与退出治理.md`**

```markdown
# TP-07 收紧配置凭证与外部能力安全边界

## 1. 文档目标
验证 renderer-safe 配置 DTO、生效的 `app://` / `openExternal` / webview / navigation 白名单与敏感信息收回策略已经落地。

## 2. 关键测试用例
- `TP-07-TC-001` renderer 无法直接读取代理密码、Google clientSecret、站点凭证
- `TP-07-TC-002` `config:changed` 不再广播完整敏感对象
- `TP-07-TC-003` 备份导出默认不裸带敏感信息
- `TP-07-TC-004` `app://` 不能访问受控目录外资源
- `TP-07-TC-005` `openExternal` 只允许安全协议与受控目标
- `TP-07-TC-006` webview / popup / will-navigate 受主进程规则约束

## 3. 验收标准
- renderer 看不到不该看的数据
- 外部链接和本地资源访问边界收紧且可证明

# TP-08 修运行入口启动时序与退出治理

## 1. 文档目标
验证默认 Electron 入口可启动、主窗口显示优先于非关键初始化、退出钩子/崩溃钩子/恢复定时器收口一致。

## 2. 关键测试用例
- `TP-08-TC-001` `npx electron .` 可受控启动
- `TP-08-TC-002` 主窗口首屏显示不再被长初始化阻塞到不可接受
- `TP-08-TC-003` `before-quit` / `will-quit` 时数据库、下载恢复定时器、监听完成清理
- `TP-08-TC-004` `uncaughtException` / `unhandledRejection` / `process-gone` 有统一兜底
- `TP-08-TC-005` 关闭窗口、显式退出、崩溃退出三条链路行为可区分

## 3. 验收标准
- 启动入口稳定可用
- 退出与异常治理不再裸奔
- 恢复、退出和初始化时序不再互相竞争
```

- [ ] **Step 4: 运行校验脚本，确认四份文档文件名与标题一致**

Run:
```bash
python - <<'PY'
from pathlib import Path
pairs = {
    'TP-05-统一IPC协议单一来源.md': '# TP-05 统一IPC协议单一来源',
    'TP-06-收缩preload-shared-handler边界.md': '# TP-06 收缩preload-shared-handler边界',
    'TP-07-收紧配置凭证与外部能力安全边界.md': '# TP-07 收紧配置凭证与外部能力安全边界',
    'TP-08-修运行入口启动时序与退出治理.md': '# TP-08 修运行入口启动时序与退出治理',
}
root = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例')
for name, title in pairs.items():
    text = (root / name).read_text(encoding='utf-8')
    print(name, title in text)
PY
```
Expected: 四行输出均为 `True`

- [ ] **Step 5: Commit**

```bash
git add "重构文档/测试用例/TP-05-统一IPC协议单一来源.md" \
        "重构文档/测试用例/TP-06-收缩preload-shared-handler边界.md" \
        "重构文档/测试用例/TP-07-收紧配置凭证与外部能力安全边界.md" \
        "重构文档/测试用例/TP-08-修运行入口启动时序与退出治理.md"
git commit -m "docs: 新增进程边界与安全测试用例说明"
```

---

### Task 6: 编写桌面能力、页面编排与现代化升级测试文档（TP-10 ～ TP-12）

**Files:**
- Create: `重构文档/测试用例/TP-10-建立桌面基础能力后台常驻托盘通知基础.md`
- Create: `重构文档/测试用例/TP-11-下沉页面层业务编排为hooks-facade.md`
- Create: `重构文档/测试用例/TP-12-评估并接入成熟库与现代化能力.md`

- [ ] **Step 1: 写入 `TP-10-建立桌面基础能力后台常驻托盘通知基础.md`**

```markdown
# TP-10 建立桌面基础能力后台常驻托盘通知基础

## 1. 文档目标
验证 close / hide / quit 分离、托盘入口、后台常驻、通知、单实例恢复与长任务承载基础能力成立。

## 2. 关键测试用例
- `TP-10-TC-001` 关闭主窗口不会默认等价于退出应用
- `TP-10-TC-002` 托盘可恢复主窗口并提供显式退出入口
- `TP-10-TC-003` 长任务进行中关闭窗口后任务继续运行
- `TP-10-TC-004` 任务完成 / 失败 / 需人工处理时通知按设置触发
- `TP-10-TC-005` 重复启动应用会唤醒已有窗口或恢复主窗口
- `TP-10-TC-006` 最小化到托盘与显式退出行为不混淆

## 3. 验收标准
- 桌面应用运行形态成立
- 托盘、通知、单实例恢复与长任务链路互相不打架
```

- [ ] **Step 2: 写入 `TP-11-下沉页面层业务编排为hooks-facade.md` 与 `TP-12-评估并接入成熟库与现代化能力.md`**

```markdown
# TP-11 下沉页面层业务编排为hooks-facade

## 1. 文档目标
验证页面层重复业务流程被 hooks / facade 吸收，页面职责收敛到展示与交互，行为保持一致且不引入回归。

## 2. 关键测试用例
- `TP-11-TC-001` Favorites / Artist / Popular / Pools 等页面共享流程不再各自复制实现
- `TP-11-TC-002` 页面仍能正确触发下载、收藏、喜欢、刷新、轮询等能力
- `TP-11-TC-003` facade / hooks 错误态、loading、success 语义统一
- `TP-11-TC-004` 页面卸载后副作用清理正确
- `TP-11-TC-005` handler 复杂度下降后边界职责仍完整

## 3. 验收标准
- 页面层明显变薄
- 重复流程收敛但行为不退化

# TP-12 评估并接入成熟库与现代化能力

## 1. 文档目标
验证成熟库引入目标、替代范围、前置条件、收益风险、回归要求清晰，且接入后行为与性能收益可证明。

## 2. 关键测试用例
- `TP-12-TC-001` `p-queue` 接入后执行池边界明确，不侵入领域状态机
- `TP-12-TC-002` `Bottleneck` 接入后限流行为与站点策略一致
- `TP-12-TC-003` 虚拟列表接入后滚动性能改善且布局语义不破坏
- `TP-12-TC-004` `electron-log` 接入后日志落盘可用且敏感字段脱敏
- `TP-12-TC-005` `@sentry/electron` 接入前后异常治理边界清晰，不泄露敏感配置
- `TP-12-TC-006` 引库后原有关键链路回归通过

## 3. 验收标准
- 引库不是替代边界设计的借口
- 收益、成本、风险和回归结果都有证据
```

- [ ] **Step 3: 校验桌面类文档包含人工验证要求与自动化建议**

Run:
```bash
python - <<'PY'
from pathlib import Path
root = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例')
checks = {
    'TP-10-建立桌面基础能力后台常驻托盘通知基础.md': ['托盘', '通知'],
    'TP-11-下沉页面层业务编排为hooks-facade.md': ['hooks', 'facade'],
    'TP-12-评估并接入成熟库与现代化能力.md': ['p-queue', 'Bottleneck'],
}
for name, needles in checks.items():
    text = (root / name).read_text(encoding='utf-8')
    print(name, all(n in text for n in needles))
PY
```
Expected: 三行输出均为 `True`

- [ ] **Step 4: Commit**

```bash
git add "重构文档/测试用例/TP-10-建立桌面基础能力后台常驻托盘通知基础.md" \
        "重构文档/测试用例/TP-11-下沉页面层业务编排为hooks-facade.md" \
        "重构文档/测试用例/TP-12-评估并接入成熟库与现代化能力.md"
git commit -m "docs: 新增桌面能力与现代化测试用例说明"
```

---

### Task 7: 全目录复核与一致性校验

**Files:**
- Modify: `重构文档/测试用例/README.md`
- Modify: `重构文档/测试用例/00-测试规范总则.md`
- Modify: `重构文档/测试用例/TP-01-*.md` ～ `TP-13-*.md`

- [ ] **Step 1: 通读全部文档，补齐缺失的“测试范围 / 负向与边界场景 / 验收标准 / 回归要求 / 自动化建议”章节**

重点检查：

```text
1. 是否每个 TP 文档都能独立分发，不依赖口头补充
2. 是否每个 TP 文档都把主责任范围和交叉依赖写清
3. 是否每个 TP 文档都写明“不能只跑 build/test 就算通过”
4. 是否所有文件名、标题、README 索引、TP 映射表完全一致
```

- [ ] **Step 2: 运行总校验脚本**

Run:
```bash
python - <<'PY'
from pathlib import Path
root = Path('m:/yande/yande-gallery-desktop/重构文档/测试用例')
files = sorted(root.glob('*.md'))
required = ['测试范围', '验收标准']
for path in files:
    if path.name == 'README.md':
        continue
    text = path.read_text(encoding='utf-8')
    ok = all(r in text for r in required)
    print(path.name, ok)
PY
```
Expected: 除 `README.md` 外全部输出 `True`

- [ ] **Step 3: 运行 diff 格式检查**

Run:
```bash
git diff --check -- "重构文档/测试用例"
```
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add "重构文档/测试用例"
git commit -m "docs: 完善重构任务包测试用例体系"
```

---

## Self-Review

### 1. Spec coverage
- 用户要求“整套重构文档对应的全部整改需求” → 已拆为 `README + 00 + TP-01~TP-13`
- 用户要求“先写上测试用例，给出足够详细的测试要求和测试规范” → `00-测试规范总则.md` 承担总规则；各 TP 文档承接详细测试要求
- 用户要求按任务包拆分 → 全部任务围绕 `TP-01 ~ TP-13`

### 2. Placeholder scan
- 未使用 `TODO`、`TBD`、`implement later`
- 每个任务均给出明确文件路径、文档标题、具体章节和至少一组明确测试用例

### 3. Type consistency
- 所有文件名、TP 编号和标题均与 `重构文档/03-任务拆分总控.md` 保持一致
- README 映射表与各 TP 文件命名一致

### 4. Gap check
- 本计划是“测试文档实施计划”，不是直接写测试文档本体
- 若执行中发现某个 TP 需要进一步细化到页面子模块，可在对应 TP 文档中继续补用例，但不得改动主文件命名与结构
