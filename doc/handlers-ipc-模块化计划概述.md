# `handlers.ts` 模块化计划概述

> **状态：已落地。** 主进程 IPC 入口 [src/main/ipc/handlers.ts](../src/main/ipc/handlers.ts) 现在只保留幂等保护与注册编排；具体 IPC 注册已经拆入 [src/main/ipc/handlers/](../src/main/ipc/handlers/) 下的多个领域模块。当前包含 `galleryHandlers.ts`、`configHandlers.ts`、`systemHandlers.ts`、`booruHandlers.ts`、`bulkDownloadHandlers.ts`，并已补充子模块 runtime 注册测试。

## 背景

当前主进程的 `src/main/ipc/handlers.ts` 既承担 IPC 通道注册，又直接聚合大量主进程 service、Booru 客户端、下载、图库、配置、备份等依赖。这个结构在功能不断扩展后已经呈现出两个明显问题：

1. **影响面过大**：单个文件承载几乎整个主进程 IPC 接入面，改动时容易跨域影响。
2. **运行时测试成本高**：尝试直接执行 `setupIPC()` 做真实注册测试时，会把大量重量级依赖一起拉入，导致 mock 复杂、测试脆弱且容易超时。

当前仓库已经具备：

- IPC channel 常量层
- handlers 源码级注册覆盖
- 关键 service 契约测试
- Renderer 层真实 render 级测试

下一阶段若要继续提高测试置信度和维护性，最值得做的不是继续在单个超大 `handlers.ts` 上硬堆 mock，而是先降低它的依赖耦合。

## 目标

将 `handlers.ts` 从“单一大型注册入口”调整为“轻量聚合入口 + 多个按域拆分的 handler 模块”，达到以下目标：

1. **缩小单文件影响范围**
2. **让 IPC 运行时注册测试更容易稳定实现**
3. **让 reviewer 更容易按模块理解主进程暴露面**
4. **让新功能的 IPC 扩展不必继续堆在一个超大文件里**

## 推荐拆分方向

建议优先按领域拆分，而不是按技术动作拆分。

例如：

- `src/main/ipc/handlers/galleryHandlers.ts`
- `src/main/ipc/handlers/booruHandlers.ts`
- `src/main/ipc/handlers/bulkDownloadHandlers.ts`
- `src/main/ipc/handlers/systemHandlers.ts`
- `src/main/ipc/handlers/configHandlers.ts`
- `src/main/ipc/handlers/backupHandlers.ts`

保留一个轻量的聚合入口，例如当前的 `src/main/ipc/handlers.ts`，只负责：

- 导入各个子模块的 `setupXxxHandlers()`
- 在统一入口中按顺序注册

这样主入口会从“超大业务文件”变成“注册编排文件”。

## 推荐实施顺序

### Phase 1：最小拆分（已完成）

先把与当前活跃功能最相关、依赖最集中的部分拆出去：

- Booru 相关 handlers：已拆至 `src/main/ipc/handlers/booruHandlers.ts`
- 批量下载相关 handlers：已拆至 `src/main/ipc/handlers/bulkDownloadHandlers.ts`

原因：

- 当前 favorite tag / bulk download / history / import-export 都在这块活跃演进
- 这两组逻辑本身耦合大，但和图库、Google、备份等模块并不属于同一层次

### Phase 2：图库 / 系统拆分（已完成）

再拆：

- gallery/image/db handlers：已拆至 `src/main/ipc/handlers/galleryHandlers.ts`
- config/page-preferences handlers：已拆至 `src/main/ipc/handlers/configHandlers.ts`
- system/network/backup handlers：已拆至 `src/main/ipc/handlers/systemHandlers.ts`

### Phase 3：测试重构（已完成）

拆分完成后，再补真正更强的执行级测试：

- 针对单个 `setupBooruHandlers()` 的 runtime 注册测试
- 针对 `setupBulkDownloadHandlers()` 的 runtime 注册测试
- 针对 `setupGalleryHandlers()`、`setupConfigHandlers()`、`setupSystemHandlers()` 的 runtime 注册测试

这些测试位于 `tests/main/ipc/handlerModules.runtime.test.ts`，直接调用各个 `setupXxxHandlers()` 并断言注册到 `ipcMain.handle` 的通道集合，避免只依赖 `setupIPC()` 整体注册或源码字符串检查。

## 预期收益

### 1. 测试更容易做深

当前要做整份 `handlers.ts` 的执行级测试，必须 mock 很多无关依赖。拆分后，可以只为当前测试目标准备有限依赖，明显降低复杂度。

### 2. Review 成本更低

现在 review `handlers.ts` 等于同时 review 多个领域。拆分后，reviewer 可以只看某个子系统 handler 模块。

### 3. 新功能接入更自然

后续新增类似 favorite tag 历史、gallery source 反查、下载任务扩展等能力时，不需要继续向一个总文件堆积逻辑。

### 4. 降低意外回归范围

单个子系统修改不会那么容易波及整份 IPC 注册入口。

## 当前不建议做的事情

在开始模块化之前，不建议：

- 先继续向 `handlers.ts` 内堆更多跨域 helper
- 为了做 runtime 测试而在现有超大文件上不断增加脆弱 mock
- 一次性大规模重写所有 handler 分组

更稳妥的方式是：

- 先按活跃模块拆出最有价值的 1-2 组
- 先确保行为不变
- 再补运行时注册测试

## 和当前仓库状态的关系

这份计划不代表当前 IPC 有功能缺口。当前主流程已经可用，相关测试也已经明显增强。

它的目标是：

- 解决 `handlers.ts` 长期演进后的结构问题
- 为更强的 IPC 执行级测试铺路
- 降低未来功能继续叠加时的维护成本

## 一句话总结

`handlers.ts` 模块化不是为了“补当前功能”，而是为了让**后续功能继续扩展时，主进程 IPC 层还能保持可维护、可测试、可 review**。
