# API 服务与 CLI 及 Skill 整体方案设计

## 1. 背景与目标

当前 Yande Gallery Desktop 已具备较完整的本地图库管理、Booru 浏览、收藏、喜欢、标签管理与批量下载能力，且这些能力大多已经沉淀在主进程 service、IPC 与 preload 暴露面中。

本方案的目标是在**不改变当前桌面应用定位**的前提下，为现有能力补充一层**可配置开启的对外 API 服务**，并进一步提供：

1. 一个可在设置页中启停和配置的 API 服务。
2. 一套面向外部稳定的业务 API，而不是简单直出内部 IPC/preload。
3. 一个官方 CLI 工具，用于调用这些 API。
4. 基于 CLI/API 的智能体 skill 封装，便于用户通过智能体完成查询、检索、查看与触发下载等操作。
5. API 调用引起的业务状态变化能够同步反映到现有界面中。
6. 可选的 API 日志记录与展示能力。

## 2. 范围与边界

### 2.1 首版纳入范围

首版设计覆盖以下三个部分：

- **桌面端内置 API 服务**
- **CLI 工具**
- **基于 CLI 的智能体 skill 封装**

但实现上按阶段推进，先落地桌面端 API 服务，再落地 CLI，最后落地 skill。

### 2.2 首版主要能力

首版 API 面向完整业务域开放，但仅限于**受控的业务操作能力**，包括：

- 检索图集
- 检索图片
- 获取图片元数据、缩略图与原图内容访问能力
- 查询 Booru 站点、帖子、喜欢、收藏、标签相关信息
- 查询、增删改收藏标签
- 查询与更新收藏标签下载绑定
- 基于收藏标签启动批量下载任务
- 查询下载队列、批量下载任务、会话与状态
- 订阅下载状态、收藏标签变化、API 日志等事件流

### 2.3 首版明确不纳入范围

首版不开放以下高风险或不必要能力：

- 面向公网开放 API
- 多用户体系
- 多 API Key / 子 Key / Key 过期机制
- 配置总入口改写
- Booru 站点账号与站点配置改写
- 备份导入导出类管理操作
- 删除图库、删除图片等高风险管理操作
- 接口级超细粒度权限开关

## 3. 总体架构

### 3.1 总体分层

整个能力拆分为三层：

#### A. 桌面端 API Server

运行在 Electron 主进程内，负责：

- 启动/停止 HTTP 服务
- 处理 REST 请求
- 处理 SSE 事件流
- Bearer Token 鉴权
- 局域网来源限制
- 模块级权限校验
- 请求日志记录
- 调用现有主进程 service 完成真实业务操作

#### B. CLI

CLI 是 API 的官方客户端，负责：

- 保存 `baseUrl` 与 `apiKey`
- 调用 REST API
- 消费 SSE 事件流
- 将结果以 text/json 输出给用户或脚本
- 为智能体 skill 提供稳定调用入口

#### C. Skill 封装层

智能体 skill 不直接耦合桌面端内部实现，而是优先复用 CLI，从而保证：

- 鉴权逻辑统一
- baseUrl / apiKey 管理统一
- 错误处理统一
- 后续 API 演进时，优先保证 CLI 兼容即可

### 3.2 分阶段落地

#### Phase 1：桌面端 API 基础设施

- 设置页新增 API 服务配置能力
- 主进程新增 API Server、路由、中间件、SSE 与日志子系统
- 开放稳定业务 API v1
- UI 能展示 API 触发后的业务变化
- API 日志可选记录并在界面中查看

#### Phase 2：CLI

- 提供独立可执行文件形式的 CLI
- 支持配置保存、连接测试、查询、写操作与事件订阅
- 输出同时兼顾人读与机器读

#### Phase 3：Skill

- 基于 CLI 封装常见智能体场景
- 至少覆盖：
  - 查询图库
  - 检索图片
  - 查看 favorite tags
  - 启动收藏标签批量下载
  - 查看下载状态

## 4. 安全模型

### 4.1 安全目标

该 API 服务的定位是**局域网内受控访问的桌面伴随服务**，不是公网服务。安全模型目标如下：

- 默认关闭
- 默认最小暴露
- 所有业务接口必须鉴权
- 仅允许本机或局域网来源访问
- 基于模块级权限控制能力范围
- 保留可选的请求审计日志

### 4.2 监听模式

设置页只提供两种监听模式：

1. **仅本机**
   - 绑定 `127.0.0.1`
2. **局域网**
   - 允许局域网内访问
   - 监听层允许绑定局域网地址或 `0.0.0.0`
   - 但服务端仍需做来源地址校验，仅接受本机与私网地址请求

**不提供公网模式。**

### 4.3 外网禁止策略

即便处于“局域网模式”，服务端仍需在请求进入后进行 IP 校验，仅允许：

- `127.0.0.1`
- `192.168.x.x`
- `10.x.x.x`
- `172.16.x.x` 到 `172.31.x.x`

这样即使端口暴露错误，也能在应用层继续拒绝外网来源。

### 4.4 鉴权方式

所有业务接口统一使用：

```http
Authorization: Bearer <key>
```

首版仅维护一个当前生效的 API Key：

- 首次启用服务时自动随机生成
- 支持手动替换
- 支持重新随机生成
- 新 key 生效后旧 key 立即失效

### 4.5 模块级权限模型

权限采用**模块级开关**，而不是接口级开关。建议权限模块如下：

- `galleryRead`
- `imageRead`
- `imageBinary`
- `booruRead`
- `booruWrite`
- `favoriteTagsRead`
- `favoriteTagsWrite`
- `downloadsRead`
- `downloadsControl`
- `eventsSubscribe`
- `apiLogsRead`

请求在鉴权成功后仍需进一步校验对应权限模块，未开放则返回 `403`。

### 4.6 日志与审计

API 日志为**可选功能**：

- 关闭时：不采集、不持久化、不展示 API 审计日志
- 开启时：记录请求摘要、结果、来源、耗时与错误摘要

出于安全考虑：

- 不记录完整 API Key
- 只保留脱敏信息或 key 指纹

## 5. 对外 API 设计

### 5.1 API 风格

对外 API 采用**稳定业务 API** 风格，不直接照搬 preload 或 IPC 命名。目标是让 CLI、脚本与 skill 面向统一、稳定的外部资源模型，而内部仍可继续演进。

### 5.2 API 前缀

建议统一使用：

- REST：`/api/v1/...`
- SSE：`/api/v1/events/...`

### 5.3 顶层资源分组

首版按以下业务域组织：

- `service`
- `galleries`
- `images`
- `booru-sites`
- `booru-posts`
- `favorites`
- `favorite-tags`
- `downloads`
- `api-logs`
- `events`

### 5.4 资源建模原则

1. **面向业务资源而不是内部实现细节**
2. **统一分页、筛选、排序语义**
3. **写接口只开放已允许的业务动作**
4. **图片内容访问走独立资源路径，不把二进制塞进 JSON**
5. **对外 DTO 稳定，内部 service/DB 可继续重构**

### 5.5 示例接口结构

#### service

- `GET /api/v1/service/info`
- `GET /api/v1/service/health`

返回服务版本、应用版本、监听模式、启用权限等。

#### galleries

- `GET /api/v1/galleries`
- `GET /api/v1/galleries/:galleryId`
- `GET /api/v1/galleries/:galleryId/images`

#### images

- `GET /api/v1/images`
- `GET /api/v1/images/:imageId`
- `GET /api/v1/images/:imageId/thumbnail`
- `GET /api/v1/images/:imageId/file`

#### booru-sites

- `GET /api/v1/booru-sites`
- `GET /api/v1/booru-sites/active`

#### booru-posts

- `GET /api/v1/booru-posts/search`
- `GET /api/v1/booru-posts/:siteId/:postId`
- `GET /api/v1/booru-posts/:siteId/:postId/tags`
- `GET /api/v1/booru-posts/:siteId/:postId/favorite-info`

#### favorites

- `GET /api/v1/favorites`
- `POST /api/v1/favorites/:siteId/:postId`
- `DELETE /api/v1/favorites/:siteId/:postId`
- `POST /api/v1/favorites/:siteId/:postId/like`
- `DELETE /api/v1/favorites/:siteId/:postId/like`

#### favorite-tags

- `GET /api/v1/favorite-tags`
- `POST /api/v1/favorite-tags`
- `PATCH /api/v1/favorite-tags/:id`
- `DELETE /api/v1/favorite-tags/:id`
- `GET /api/v1/favorite-tags/:id/binding`
- `PUT /api/v1/favorite-tags/:id/binding`
- `DELETE /api/v1/favorite-tags/:id/binding`
- `POST /api/v1/favorite-tags/:id/bulk-download`

#### downloads

- `GET /api/v1/downloads/queue`
- `GET /api/v1/downloads/tasks`
- `GET /api/v1/downloads/tasks/:taskId`
- `GET /api/v1/downloads/sessions`
- `GET /api/v1/downloads/sessions/:sessionId`
- `POST /api/v1/downloads/sessions/:sessionId/pause`
- `POST /api/v1/downloads/sessions/:sessionId/resume`
- `POST /api/v1/downloads/sessions/:sessionId/cancel`

#### api-logs

- `GET /api/v1/api-logs`

## 6. SSE 事件模型与 UI 同步

### 6.1 技术路线

普通查询与写操作走 REST；实时状态变化与日志流走 SSE。由于当前场景只需要服务端单向推送，不需要客户端与服务端双向实时协商，因此 SSE 比 WebSocket 更简单、可控。

### 6.2 SSE 频道建议

建议按主题拆分频道，而不是所有事件混在同一流中：

- `GET /api/v1/events/downloads`
- `GET /api/v1/events/favorite-tags`
- `GET /api/v1/events/booru`
- `GET /api/v1/events/api-logs`
- `GET /api/v1/events/system`

### 6.3 统一事件格式

建议统一事件结构：

```json
{
  "eventId": "evt_xxx",
  "type": "downloads.session.updated",
  "timestamp": "2026-04-13T22:00:00.000Z",
  "data": {
    "...": "..."
  }
}
```

统一字段包括：

- `eventId`
- `type`
- `timestamp`
- `data`

### 6.4 UI 同步原则

API 写操作不能维护一套与现有桌面 UI 脱节的旁路状态，而应：

1. 直接调用现有主进程业务 service。
2. 正常写入数据库、下载任务、缓存等现有数据源。
3. 由现有页面的刷新逻辑与新增事件桥接机制感知变化。

这意味着：

- API 调用与 GUI 操作应落在同一份业务事实之上。
- UI 不应区分变化是由 GUI 发起还是由 API 发起。
- 只要业务状态发生变化，界面就能同步体现。

### 6.5 API 日志展示

API 日志支持三层能力：

1. **日志采集**：可开关
2. **日志查询**：通过 `GET /api/v1/api-logs` 查询历史
3. **日志实时流**：通过 `GET /api/v1/events/api-logs` 实时订阅

界面上建议提供专门日志视图，且是否显示日志由设置控制。

## 7. 设置页与配置设计

### 7.1 设置页新增控制面

在设置页中新增 API 服务设置分组，至少包含以下内容：

#### 基础区

- 启用 API 服务
- 监听模式（仅本机 / 局域网）
- 端口
- 当前状态
- 当前绑定地址
- 最近启动失败原因

#### 鉴权区

- API Key 显示/隐藏
- 一键复制
- 随机生成
- 手动替换
- 提示 `Authorization: Bearer <key>` 的使用方式

#### 权限区

- 图集读取
- 图片元数据读取
- 图片内容访问
- Booru 只读
- Booru 业务写操作
- 收藏标签只读
- 收藏标签写操作
- 下载只读
- 下载控制
- 事件订阅
- API 日志查看

#### 日志区

- 启用 API 日志
- 在界面显示 API 日志
- 保留策略

### 7.2 配置结构建议

建议在现有配置体系中新增 `apiService` 配置块：

```ts
apiService?: {
  enabled: boolean;
  mode: 'localhost' | 'lan';
  port: number;
  apiKey: string;
  permissions: {
    galleryRead: boolean;
    imageRead: boolean;
    imageBinary: boolean;
    booruRead: boolean;
    booruWrite: boolean;
    favoriteTagsRead: boolean;
    favoriteTagsWrite: boolean;
    downloadsRead: boolean;
    downloadsControl: boolean;
    eventsSubscribe: boolean;
    apiLogsRead: boolean;
  };
  logs: {
    enabled: boolean;
    visibleInUi: boolean;
    retentionDays?: number;
    maxEntries?: number;
  };
}
```

### 7.3 默认值策略

建议首版默认值尽量保守：

- `enabled: false`
- `mode: 'localhost'`
- 固定默认端口
- 首次启用时自动生成 API Key
- 只读权限默认开启或预置为常用安全组合
- `booruWrite`、`favoriteTagsWrite`、`downloadsControl` 默认关闭，由用户主动开启

### 7.4 权限与 endpoint 映射

需要维护一份集中权限映射表，而不是把权限判断散落在各个 handler 中。示例：

- `GET /api/v1/galleries` → `galleryRead`
- `GET /api/v1/images/:imageId/file` → `imageBinary`
- `POST /api/v1/favorite-tags/:id/bulk-download` → `downloadsControl`
- `PATCH /api/v1/favorite-tags/:id` → `favoriteTagsWrite`

这样可以保证：

- 设置页开关与真实能力一致
- 文档易维护
- 403 错误语义明确

## 8. CLI 设计

### 8.1 技术路线

CLI 不使用 C++ 实现。源码层采用 TypeScript/Node，发布层输出独立可执行文件，以兼顾：

- 与当前项目技术栈一致
- 易于复用类型与 DTO 契约
- SSE/HTTP/JSON 能力实现简洁
- 最终用户仍获得“下载即用”的可执行文件体验

### 8.2 平台策略

CLI 首版覆盖：

- Windows
- Linux

并优先关注这两个平台的可用性。

### 8.3 配置持久化

CLI 持久化保存以下配置：

- `baseUrl`
- `apiKey`
- `output`（可选，默认 `text`）

最小配置示例：

```json
{
  "baseUrl": "http://192.168.1.10:38947",
  "apiKey": "xxxxx",
  "output": "text"
}
```

### 8.4 命令分组建议

建议与 API 业务域对齐，但命令名更偏向人类使用：

- `service`
- `galleries`
- `images`
- `booru`
- `favorite-tags`
- `downloads`
- `logs`
- `events`
- `config`

### 8.5 配置命令

建议至少提供：

- `config set-base-url`
- `config set-key`
- `config show`
- `config test`

### 8.6 输出模式

CLI 需同时支持：

- **text**：面向真人
- **json**：面向脚本与 skill

推荐：

- 默认 text
- `--json` 强制输出稳定 JSON
- 错误输出也提供结构化 JSON 形式

### 8.7 图片与二进制输出

CLI 对图片内容访问应支持：

- 下载到指定路径
- 输出元信息

不建议首版默认直接把二进制流输出到终端，优先支持 `--output <path>`。

### 8.8 SSE 消费

CLI 至少支持：

- `logs watch`
- `events watch downloads`
- `events watch favorite-tags`

默认实时文本输出；`--json` 模式下逐行 JSON 输出，便于管道消费。

## 9. Skill 设计定位

后续智能体 skill 不直接拼装 HTTP 请求，而是优先通过 CLI 调用。这意味着：

- CLI 是 skill 的稳定能力层
- baseUrl 与 apiKey 管理由 CLI 统一承担
- API 演进时优先保证 CLI 兼容即可
- 智能体更容易做高层任务编排，而无需重复实现鉴权与连接逻辑

首版 skill 建议覆盖以下场景：

- 检索图集
- 检索图片
- 查看图片元数据
- 查询 favorite tags
- 启动收藏标签批量下载
- 查询下载任务/会话状态
- 查看 API 日志或关键事件

## 10. 仓库实现落点

### 10.1 主进程 API 子系统

建议在主进程中新增独立 API 子系统，而不是把 HTTP 逻辑散落在现有服务中。建议目录：

```text
src/main/api/
  server.ts
  router.ts
  middleware/
    auth.ts
    lanGuard.ts
    permission.ts
    logging.ts
  routes/
    serviceRoutes.ts
    galleryRoutes.ts
    imageRoutes.ts
    booruRoutes.ts
    favoriteTagRoutes.ts
    downloadRoutes.ts
    apiLogRoutes.ts
    eventRoutes.ts
  serializers/
  events/
  types.ts
```

### 10.2 与现有 service 的关系

API 层只负责：

- 参数校验
- 鉴权
- 权限
- DTO 映射
- 日志
- SSE 分发

真正业务仍复用现有主进程 service，包括图库、Booru、批量下载与配置管理能力。

### 10.3 设置页与 preload

设置页继续位于：

- `src/renderer/pages/SettingsPage.tsx`

建议通过 preload 新增 `apiService` 域向渲染层暴露受控能力，例如：

- `apiService.getConfig()`
- `apiService.saveConfig()`
- `apiService.getStatus()`
- `apiService.generateKey()`
- `apiService.getLogs()`
- `apiService.onStatusChanged()`
- `apiService.onLogReceived()`

### 10.4 配置与共享类型

- 配置主定义仍位于 `src/main/services/config.ts`
- 可跨主进程 / preload / renderer / CLI 共用的类型放入 `src/shared/types.ts`
- HTTP 专属内部类型放入 `src/main/api/types.ts`

## 11. 错误处理与日志存储

### 11.1 统一响应结构

建议统一返回结构：

**成功**

```json
{
  "success": true,
  "data": {}
}
```

**失败**

```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "API 权限未开放：downloadsControl"
  }
}
```

### 11.2 错误码建议

首版固定错误码，供 CLI 和 skill 稳定消费：

- `UNAUTHORIZED`
- `FORBIDDEN_IP`
- `PERMISSION_DENIED`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `CONFLICT`
- `SERVICE_UNAVAILABLE`
- `INTERNAL_ERROR`

### 11.3 API 日志存储建议

首版 API 日志优先写入 **SQLite 表**，而不是散文件。原因：

- 项目本身已经以 SQLite 为主存储
- 日志页与 API 查询都需要分页、筛选与排序
- 与现有数据目录体系更一致

建议日志字段至少包括：

- `id`
- `timestamp`
- `sourceIp`
- `method`
- `path`
- `permissionKey`
- `statusCode`
- `success`
- `durationMs`
- `errorCode`
- `errorMessage`
- `requestSummary`

## 12. 测试与验证策略

### 12.1 API 层测试重点

- 未带 Bearer Key → `401`
- Key 错误 → `401`
- 非局域网来源 → `403`
- 权限关闭 → `403`
- 参数不合法 → `422`
- 正常查询 → `200`
- 正常写操作 → `200/201`
- SSE 订阅鉴权与权限校验

### 12.2 业务联动测试重点

- API 启动收藏标签批量下载后，下载中心能看到任务与状态变化
- API 更新收藏标签后，收藏标签页面能看到变化
- API 喜欢/收藏操作后，Booru 页面状态同步

### 12.3 设置页测试重点

- 启停 API 服务
- 修改端口
- 更换或重生 API Key
- 权限切换后立即生效
- 日志开关影响日志采集与展示

### 12.4 CLI 测试重点

- 配置保存/读取
- 常用命令查询结果正确
- `--json` 输出稳定
- SSE watch 正常消费
- 鉴权失败 / 网络失败 / 权限失败时提示清晰

### 12.5 验证优先级

实现阶段应优先验证以下高风险链路：

1. 服务开关、端口、运行状态一致性
2. 局域网限制不能失效
3. API 写操作引起的业务变化能被 UI 感知
4. 权限开关与真实 endpoint 能力一致
5. CLI 使用旧 key 时错误提示足够明确
6. SSE 推送与真实业务状态一致

## 13. 首版交付定义

### 13.1 桌面端

- 设置页可启停 API 服务
- 支持本机/局域网模式
- Bearer API Key 鉴权
- 模块级权限控制
- 稳定业务 API v1
- SSE 事件推送
- API 日志可开关、可查询、可界面展示
- API 调用带来的业务变化能同步体现在现有 UI 中

### 13.2 CLI

- 独立可执行文件
- 保存 `baseUrl` 与 `apiKey`
- 支持核心查询、写操作与 watch
- 支持 text/json 输出

### 13.3 Skill

- 基于 CLI 封装常见智能体能力
- 至少支持图库查询、图片检索、favorite tags 查询、启动批量下载、查看任务状态

## 14. 结论

该方案的核心思路是：

- 在主进程内新增独立 API Server 子系统
- 对外提供稳定业务 API，而不是暴露内部实现
- 通过监听模式、局域网来源限制、Bearer Key 与模块权限形成多层安全控制
- 通过 REST + SSE 组合覆盖查询、写操作与实时状态流
- 通过 CLI 作为官方客户端承接外部调用与智能体封装
- 保证 API 引发的业务变化最终落在当前桌面应用既有的数据源与业务服务上，从而同步反映到现有界面

该方案兼顾了可用性、安全性、后续演进空间与与现有架构的一致性，适合作为后续实现计划与任务拆分的基础设计文档。
