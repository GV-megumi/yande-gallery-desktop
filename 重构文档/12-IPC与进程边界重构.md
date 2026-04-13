# 12-IPC与进程边界重构

## 1. 本文档范围

本文件负责把 `审查报告.md` 中与 `main / preload / shared / renderer` 边界失控直接相关的问题，重组为一条可执行的进程边界收口方案。

主责任内容包括：
- IPC 协议单一来源
- preload 瘦身
- shared 类型纠偏
- handler 角色收缩
- 页面层业务编排下沉
- 子窗口 / bridge 暴露面控制

不展开的内容：
- 下载状态机与文件协议（见 [10](./10-下载并发与调度链路重构.md)）
- 托盘、通知、桌面运行形态（见 [11](./11-Electron桌面能力重构.md)）
- `app://`、`openExternal`、敏感配置与异常治理细节（见 [15](./15-稳定性错误恢复与安全性修正.md)）
- 成熟库替代方案（见 [16](./16-成熟库替代与现代化升级建议.md)）

## 2. 本专项核心问题概览

报告在 P0-04、P1-05 和第 8 章中已经确认：当前问题不是简单的“接口命名不统一”，而是协议来源、bridge 暴露、shared 定义、handler 职责和页面消费方式同时失控。

### 2.1 协议来源分裂

目前至少存在三套来源：
- `src/main/ipc/channels.ts`
- `src/preload/index.ts` 内部常量与暴露 API
- `src/main/ipc/handlers.ts` 中的裸字符串通道

结果是：
- 实际调用已经发生漂移
- shared 中的旧定义无法描述真实暴露面
- 页面可能调用不存在的 API 或依赖不一致签名

### 2.2 preload 过胖

preload 当前承载了过多桥接逻辑和暴露面，已经成为 God API。问题不只是“文件大”，而是：
- 受控边界不清
- 敏感数据穿透容易发生
- 子窗口也可能继承不必要的高权限能力

### 2.3 shared 已失去权威性

`shared` 中部分类型定义仍在，但已不能当作真正的协议总表。这意味着：
- 类型与实现不同步
- 页面与主进程的签名可能静默漂移
- 后续维护者会误判“真实接口是什么”

### 2.4 handler 与页面职责上浮

- handler 承担过多业务编排
- 页面重复承担下载、收藏、喜欢、轮询、防抖、刷新等流程

这导致两头同时变重：
- 主进程边界变混乱
- 页面层也越来越难维护

## 3. 详细问题拆分

### 3.1 子问题簇 A：统一 IPC 协议单一来源

#### 主要问题
- P0-04 协议来源分裂且已有真实调用漂移
- P1-05 协议来源分裂
- P2-15 `handlers-full.ts` 遗留 mock 文件未清理

#### 需要解决什么
- 定义唯一可信的协议源
- preload 暴露、全局声明、renderer 调用方式与之同源维护
- 停止在 handler 中新增裸字符串通道

#### 当前主要落点文件
- `src/main/ipc/channels.ts`
- `src/main/ipc/handlers.ts`
- `src/main/ipc/handlers-full.ts`
- `src/preload/index.ts`
- `src/shared/types.ts`
- `src/renderer/pages/BooruCharacterPage.tsx`
- `src/renderer/pages/GalleryPage.tsx`
- `src/renderer/pages/BooruFavoritesPage.tsx`

#### 推荐实施顺序
1. 先盘点所有真实协议来源与已证实漂移
2. 再确定唯一来源与迁移规则
3. 先修已证实错误调用与签名不一致
4. 最后全面禁止继续扩散裸字符串通道

#### 验收要点
- 通道名只有一处权威来源
- preload 暴露与声明同源维护
- 已证实漂移问题消失
- `handlers-full.ts` 不再制造结构歧义

---

### 3.2 子问题簇 B：收缩 preload 暴露面

#### 主要问题
- 第 8.1 明确指出 preload 已经是 God API
- 子窗口复用与主窗口相同的高权限 preload

#### 需要解决什么
- preload 只做最小桥接
- 暴露给 renderer 的应该是 renderer-safe 能力，而不是内部实现细节
- 主窗口与子窗口应按能力分级，而不是默认全量继承

#### 当前主要落点文件
- `src/preload/index.ts`
- `src/main/window.ts`

#### 推荐实施顺序
1. 先按 query / command / event 分类当前暴露面
2. 识别哪些能力不应继续直接穿透给 renderer
3. 区分主窗口和子窗口的 bridge 能力集
4. 把与业务编排强耦合的暴露逐步收回 service / facade

#### 验收要点
- preload 暴露面明显收缩
- 子窗口不再默认复用主窗口完整高权限能力
- renderer 拿到的是稳定 DTO 与命令入口，而不是内部原始对象

---

### 3.3 子问题簇 C：纠偏 shared 的职责

#### 主要问题
- 第 8.1 指出 shared types 与 preload / handlers 实际协议漂移
- `src/shared/types.ts` 中旧的 `IPCChannels` 已不能代表真实接口

#### 需要解决什么
- shared 只承载可信、同步维护的共享类型
- 区分协议结构、领域类型、页面消费 DTO
- 让 shared 恢复“可被信任”的角色，而不是历史残影

#### 当前主要落点文件
- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/main/ipc/handlers.ts`

#### 推荐实施顺序
1. 标出哪些 shared 类型仍真实使用，哪些已过时
2. 先停止把过时 `IPCChannels` 当权威总表
3. 再重建共享协议结构与 DTO 体系

#### 验收要点
- shared 中不再保留误导性的伪权威协议定义
- 共享类型边界清楚，页面消费 DTO 与内部领域类型分离

---

### 3.4 子问题簇 D：定义配置 DTO 与页面偏好存储接口

#### 主要问题
- 当前 renderer 通过 `config:get` / `config:save` 直接拿整包配置对象，页面层可以顺手把本应属于页面偏好的状态写回 config
- `App.tsx` 已把 `menuOrder`、`pinnedItems` 直接持久化到配置，而 FavoriteTags / Gallery / BlacklistedTags 这类页面的排序筛选状态又完全没有统一存储接口，导致“有的乱进 config，有的完全不持久化”
- 如果不先定义 DTO 与偏好接口，后续页面状态持久化只会继续扩散协议漂移

#### 需要解决什么
- 把 renderer 可见的应用配置收敛为 `renderer-safe AppConfigDTO`
- 把页面工作上下文抽成独立的 `page preferences` 查询 / 保存接口，而不是继续复用整包 config 读写
- 明确 preload 对外暴露的是“配置 DTO + 页面偏好 API”，不是无边界配置总对象

#### 当前主要落点文件
- `src/preload/index.ts`
- `src/main/ipc/handlers.ts`
- `src/shared/types.ts`
- `src/main/services/config.ts`
- `src/renderer/App.tsx`
- 高频管理页对应的 renderer 页面

#### 推荐实施顺序
1. 先划清哪些字段属于配置 DTO，哪些字段不应再暴露给 renderer
2. 再为页面偏好设计独立 IPC / preload 接口与共享类型
3. 最后把现有菜单排序、固定项与后续页面排序筛选统一迁移到偏好接口

#### 验收要点
- renderer 不再依赖整包 config 直接读写 UI 行为状态
- 配置 DTO 与页面偏好接口边界清晰
- 新增页面持久化需求不再继续扩散 config 暴露面

---

### 3.5 子问题簇 E：收缩 handler 职责并下沉页面业务编排

#### 主要问题
- 第 8.1 指出主进程 handler 承担过多业务编排
- 第 8.2 指出多页面重复实现下载、收藏、服务端喜欢、轮询、防抖、刷新策略
- 第 8.3 明确建议页面层业务编排下沉为 hooks / facade

#### 需要解决什么
- handler 只保留：参数校验、权限控制、边界转换、错误映射
- service / facade / hooks 承接业务流程
- 页面只消费稳定 view-state 与 commands

#### 当前主要落点文件
- `src/main/ipc/handlers.ts`
- `src/renderer/pages/BooruFavoritesPage.tsx`
- `src/renderer/pages/BooruArtistPage.tsx`
- `src/renderer/pages/BooruPopularPage.tsx`
- `src/renderer/pages/BooruPoolsPage.tsx`
- 其他 Booru 主线页面与下载相关页面

#### 推荐实施顺序
1. 先识别哪些 handler 正在做重业务编排
2. 再识别页面层重复流程
3. 逐步引入 facade / hooks 作为中间层
4. 页面逐组迁移，不做一次性大改

#### 验收要点
- handler 逻辑明显收缩
- 多页面重复流程被归并
- 页面层职责更聚焦展示与交互

## 4. 影响模块 / 页面 / 链路

### 关键模块
- `src/main/ipc/channels.ts`
- `src/main/ipc/handlers.ts`
- `src/main/ipc/handlers-full.ts`
- `src/preload/index.ts`
- `src/shared/types.ts`
- `src/main/window.ts`

### 典型受影响页面
- `src/renderer/pages/BooruCharacterPage.tsx`
- `src/renderer/pages/GalleryPage.tsx`
- `src/renderer/pages/BooruFavoritesPage.tsx`
- `src/renderer/pages/BooruArtistPage.tsx`
- `src/renderer/pages/BooruServerFavoritesPage.tsx`

### 关键链路
- renderer 页面调用 -> preload bridge -> main handler -> service
- 配置 / 凭证 / 站点对象 -> DTO -> renderer 消费
- 主窗口 / 子窗口 -> 不同 bridge 能力集

## 5. 推荐实施顺序

### 第一阶段：协议源止血
- 停止继续扩散协议来源
- 修已证实错误调用
- 清理 `handlers-full.ts`

### 第二阶段：preload / shared 纠偏
- preload 按最小桥接重构
- shared 恢复可信共享类型职责

### 第三阶段：handler 瘦身与页面编排下沉
- 明确 handler 边界
- 建立 hooks / facade 过渡层
- 页面逐组迁移

## 6. 前置依赖与并行关系

### 前置依赖
- 若某任务同时涉及敏感配置与安全边界，应同步看 [15](./15-稳定性错误恢复与安全性修正.md)
- 若某任务同时涉及页面交互统一，应同步看 [14](./14-UI交互一致性修正.md)

### 可并行关系
- 协议源盘点 与 页面重复编排盘点可并行
- preload 瘦身 与 shared 纠偏可协同
- 但不要让多个任务同时改同一批协议定义文件

## 7. 风险点

1. 这是跨四层边界的改造，最容易产生“看起来更整洁，但实际更漂移”的假收敛
2. 如果先做 facade / hooks 而不先收协议源，可能只是把漂移包进新壳
3. 若 shared 的边界不重新定义，会继续出现“类型在、协议不在”的误导性维护问题

## 8. 验收要点

至少应确认：
- 协议来源单一或同源维护
- preload 不再是无边界扩张的 God API
- shared 类型不再与真实协议脱节
- handler 职责收缩，页面重复编排减少

## 9. 相关文档

- [01-现状问题与目标架构设计.md](./01-现状问题与目标架构设计.md)
- [03-任务拆分总控.md](./03-任务拆分总控.md)
- [14-UI交互一致性修正.md](./14-UI交互一致性修正.md)
- [15-稳定性错误恢复与安全性修正.md](./15-稳定性错误恢复与安全性修正.md)
- [16-成熟库替代与现代化升级建议.md](./16-成熟库替代与现代化升级建议.md)
