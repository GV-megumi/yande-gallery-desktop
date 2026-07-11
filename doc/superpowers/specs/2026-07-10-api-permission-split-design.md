# API 权限拆分设计：手机 App 面与 Agent 面分离

## 1. 背景与问题

桌面端内置 API 服务的权限模型原本是为 agent/CLI 设计的（见 `doc/skill需求文档/API服务与CLI及Skill整体方案设计.md`）：

- 设计文档 §4.5 定义 **11 个模块级权限键**（galleryRead、imageRead、imageBinary、booruRead、booruWrite、favoriteTagsRead、favoriteTagsWrite、downloadsRead、downloadsControl、eventsSubscribe、apiLogsRead）；
- §2.3 明确首版**不开放**「删除图库、删除图片等高风险管理操作」。

后来安卓 App 的远程调用被塞进了同一套权限系统，造成混用：

1. 权限键膨胀到 13 个——`imageWrite`、`galleryWrite` 是给手机加的，违背 agent 面原始设计意图（agent 面注册了删除相册/图片等高危端点）。
2. 手机接口全部寄生在 agent 权限上：`sync/*` 借 `galleryRead`，删图/改标签借 `imageWrite`，相册增删改借 `galleryWrite`，缩略图/原图借 `imageBinary`，SSE 借 `eventsSubscribe`。手机要正常工作需在设置里开 5 个 agent 权限开关。
3. 设置页的「权限」区语义混乱：用户无法区分哪些开关服务于手机、哪些服务于 agent。

## 2. 已拍板的决策

| 决策点 | 结论 |
| --- | --- |
| 拆分方式 | **路由命名空间拆分**：手机走 `/api/app/v1/*`，agent 走 `/api/v1/*`，同一 HTTP 服务器、同一批 handler 复用 |
| 手机开关与服务生命周期 | **独立**：「允许手机端连接」自己能拉起服务器并强制局域网绑定；「启用 API 服务」语义收窄为「启用 Agent API」 |
| API Key | **共用一把**：身份由命名空间决定，Key 只做鉴权；已配对手机免重新扫码 |

## 3. 接口划分

### 3.1 手机面 `/api/app/v1/*`

整个命名空间只受 `apiService.app.enabled` 单开关控制，**无细化权限**。handler 全部复用现有实现：

| 端点 | 来源 |
| --- | --- |
| `GET service/info`、`GET service/health` | 手机面专版（连接测试/配对验证）：info **不透出** agent 专属的 `mode`/`permissions`——防客户端误据其做门控（曾有安卓误读 `permissions.imageBinary` 报缩略图警告的缺陷） |
| `GET sync/meta\|images\|galleries\|tags\|image-ids` | 从 agent 面**搬走** |
| `POST galleries`、`PATCH/DELETE galleries/:id`、`POST/DELETE galleries/:id/images` | 从 agent 面**搬走** |
| `DELETE images/:id`、`POST images/batch-delete`、`POST/DELETE images/:id/tags` | 从 agent 面**搬走** |
| `GET images/:id/thumbnail\|preview\|file` | 与 agent 面共享（两边都挂） |
| `GET events/system` | 只挂 system 一个频道（最小暴露面）；agent 面保留全频道 |

### 3.2 Agent 面 `/api/v1/*`（收缩回设计文档原型）

- **移除**：`sync/*` 全部、galleries 全部写路由、images 全部写路由。
- **保留**：service、galleries/images 只读、images 二进制、booru-sites/posts/favorites、favorite-tags、downloads、events 全频道、api-logs。
- `ApiServicePermissionKey` 回到 11 键：`imageWrite`、`galleryWrite` 从共享类型、配置归一化、权限映射表、设置页标签中全部删除。

## 4. 请求流水线

IP 私网白名单、Bearer 鉴权保持不变（两面共享，先于分流执行）；随后是**路由匹配**——请求路径未命中
任何已挂载路由时直接 `404`，与两面开关状态无关（match-first）；路由匹配命中后，才按路径前缀分流查
各自的面门：

- `/api/app/v1/*` → 查 `app.enabled`：关 → `403 PERMISSION_DENIED`（message 注明手机端连接未开启；安卓已有该错误码处理路径）；开 → 匹配 app 路由表直达 handler，**不查细化权限**。未挂载路径无论开关状态恒 `404`（路由匹配先于面门）。
- `/api/v1/*` → 查 `enabled`（agent 门，服务器可能因手机开关而运行）：关 → `403 PERMISSION_DENIED`；开且 `mode==='localhost'` → 再查来源是否环回（`isLoopbackAddress`），非环回 → `403 FORBIDDEN_IP`——app.enabled 强制 0.0.0.0 绑定后「仅本机」隔离从绑定层移到请求层兜底；随后走现有 `resolvePermissionForRequest` + 细化权限逻辑不变。

API 日志：手机面请求 `permissionKey` 记 `null`，路径前缀 `/api/app/` 自解释消费者身份，无日志 schema 改动。

## 5. 配置结构与迁移

```yaml
apiService:
  enabled: false      # 语义收窄：启用 Agent API
  mode: localhost     # Agent 面监听模式偏好
  port: 38947         # 共享
  apiKey: ''          # 共享
  app:
    enabled: false    # 允许手机端连接
  permissions: {...}  # agent 11 键
  logs: {...}         # 不变
```

迁移规则（在 `normalizeApiServiceConfig` 内实现）：

1. 旧配置（input 与 current 均）无 `app.enabled` 时，初值取 `旧 enabled && 旧 mode==='lan' && (旧 permissions.imageWrite || 旧 permissions.galleryWrite)`——写权限开着是「手机在用」的信号，但须同时满足服务开启且局域网监听（enabled:false 或 localhost 下手机本就连不上，写权限可能是本机 CLI 的授权，不得把用户明确关掉/仅本机的服务静默拉起并强制绑 0.0.0.0）；只读手机用户升级后需手动重开一次，CHANGELOG 注明。
2. `permissions` 归一化输出不再包含 `imageWrite`/`galleryWrite`，下次保存后旧键自然从 yaml 消失。
3. `RendererSafeApiServiceConfig`、preload 手写 declare global 快照、`SettingsPage` 的 `ApiServicePatch` 类型同步收缩并加 `app` 域。

## 6. 服务生命周期与绑定

- 监听条件：`enabled || app.enabled`（任一消费者开启即运行，两者全关即停）。
- 绑定地址：`app.enabled === true` 时强制 `0.0.0.0`（手机连接就意味着局域网）；否则按 `mode` 旧逻辑（`lan` → `0.0.0.0`，`localhost` → `127.0.0.1`）。应用层私网 IP 白名单恒在兜底。
- `ApiServiceStatus` 新增 `appEnabled: boolean`；`enabled` 字段语义变为「Agent API 已启用」。
- 配对二维码（`ApiPairingInfo`）：`running` 反映服务器真实运行态；弹窗在 `app.enabled === false` 时给出提示并提供快捷开启入口。

## 7. 设置页（API 标签页重排）

| 分组 | 内容 |
| --- | --- |
| API 服务 | 端口、当前绑定地址+运行状态、API Key 管理（显示/复制/重新生成）——共享基础 |
| 手机端连接 | 「允许手机端连接」单开关 + 移动端配对二维码入口（从基础区搬来） |
| Agent API | 「启用 Agent API」（原「启用 API 服务」改名）+ 监听模式 |
| Agent 权限 | 11 个细化开关（删掉「图片写操作」「相册写操作」两行） |
| 日志 | 不变 |

## 8. 安卓端改动

纯路径前缀替换 `api/v1/` → `api/app/v1/`，无逻辑变化：

- `DesktopApi.kt` 全部端点注解；
- `ImageLoaders.kt` thumbnail/preview/file URL 拼接；
- `AppGraph.kt` SSE 订阅 URL（`events/system`）；
- `ApiClientFactory.kt` 的 `BINARY_PATH` 正则；
- 相关注释（`SseClient.kt`、`DownloadWorker.kt`）与 `android/README.md`；
- MockWebServer 测试中的路径断言全量跟改。

## 9. 兼容性

**两端需配套升级**（单用户局域网场景可接受，CHANGELOG/README 注明）：

- 旧 APK + 新桌面：连接测试 `GET /api/v1/service/info` 仍在 agent 面（若 agent 启用会假成功），但 `sync/*` 全部 404 → App 同步报错，提示升级。
- 新 APK + 旧桌面：连接测试 `GET /api/app/v1/service/info` 直接 404 → 明确失败提示。

## 10. 测试与验证

桌面（`tests/main/`，vitest）：

- `permissions.test.ts`：权限键收缩断言（sync/写路由不再出现在 agent 映射表）。
- `endpointCoverage.test.ts`：按两个命名空间分别校验覆盖。
- `server` 系测试：新增分流门矩阵——app 关 → app 面 403；agent 关而 app 开 → agent 面 403 且 app 面可用；两面同开互不干扰。
- `apiServiceManager.test.ts`：监听条件（enabled/app.enabled 四组合）与绑定地址矩阵。
- config 归一化测试：迁移推导（imageWrite/galleryWrite → app.enabled）、旧键剔除。
- `routes.sync.test.ts`、`routes.galleryWrite.test.ts`：改挂 app 面验证。

安卓（`:app:testDebugUnitTest`）：现有 MockWebServer 路径断言更新，无新增逻辑测试。

门禁照旧：桌面 `npm run typecheck` + `vitest tests/main`；安卓 `gw.bat :app:testDebugUnitTest`。

## 11. 明确不做（YAGNI 边界）

- 不拆双 API Key、不做多 Key 体系（设计文档 §2.3 首版排除）。
- 不做双服务器/双端口。
- 不给手机面加细化权限（单开关是需求本身）。
- 不做旧路径的兼容重定向/410 提示（两端配套升级即可）。
- 不改 API 日志表结构（路径前缀已可区分消费者）。
