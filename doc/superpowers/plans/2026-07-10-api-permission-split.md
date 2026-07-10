# API 权限拆分实施计划（手机面 /api/app/v1 与 Agent 面分离）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机 App 接口迁入独立命名空间 `/api/app/v1/*` 并由「允许手机端连接」单开关控制；Agent 面 `/api/v1/*` 收缩回设计文档的 11 键细化权限。

**Architecture:** 单 HTTP 服务器、单 API Key、同一批 handler 复用；请求按路径前缀分流到两套权限门。服务生命周期改为 `enabled || app.enabled` 并集，手机开关强制局域网绑定。配置迁移在 `normalizeApiServiceConfig` 内完成（旧写权限 → `app.enabled` 推导）。

**Tech Stack:** Electron 主进程（Node http）+ TypeScript + vitest（桌面）；Kotlin + Retrofit/OkHttp + Robolectric/MockWebServer（安卓）。

**Spec:** `doc/superpowers/specs/2026-07-10-api-permission-split-design.md`

---

## 仓库约定速览（执行者必读）

- 桌面门禁：`npm run typecheck` + `npx vitest run tests/main`（**不要**跑全量 vitest，渲染层会假性炸；渲染层单文件可用 `npx vitest run tests/renderer/pages/SettingsPage.test.tsx` 单独验证）。
- 安卓门禁：`"D:/Android/gw.bat" :app:testDebugUnitTest --rerun`（git-bash 直接调；`--rerun` 强制真跑，结果以 `android/app/build/test-results/testDebugUnitTest/*.xml` 数字为准）。
- commit message 用中文（类型前缀保留英文），直接提交 master。
- `src/preload/index.ts` 的 `declare global` 是手写类型快照——本计划所有 preload 引用类型（`ApiServiceConfig`/`ApiPairingInfo`）均从 shared 导入，签名不变，**无需改 preload**；若执行中发现类型报错在 preload，同步该快照。
- 权限键收缩会让所有含 `imageWrite`/`galleryWrite` 的测试 fixture 类型报错——这是预期信号，Task 6 统一清扫。

### 文件结构总览

| 文件 | 职责变化 |
| --- | --- |
| `src/shared/types.ts` | 权限键 13→11；+`ApiServiceAppAccessConfig`；`ApiServiceConfig.app`；`ApiServiceStatus.appEnabled`；`ApiPairingInfo.appEnabled` |
| `src/main/services/config.ts` | 默认值 +`app` 块；归一化迁移（旧写权限→app.enabled）；renderer-safe 透出 app |
| `src/main/api/permissions.ts` | 删 sync/写路由规则（agent 面细化权限表回归 11 键） |
| `src/main/api/appNamespace.ts` | **新建**：`APP_API_PREFIX` + `remapToAppNamespace()` |
| `src/main/api/routes/syncRoutes.ts` | pattern 整体迁到 `/api/app/v1` |
| `src/main/api/routes/galleryWriteRoutes.ts` | pattern 整体迁到 `/api/app/v1` |
| `src/main/api/routes/galleryRoutes.ts` | 拆出 `createImageBinaryRoutes()`（两面共享） |
| `src/main/api/routes/eventRoutes.ts` | +`createAppEventRoutes()`（手机面只挂 system 频道） |
| `src/main/api/routes/serviceRoutes.ts` | `sanitizeStatus` 透出 `appEnabled` |
| `src/main/api/server.ts` | 前缀分流：app 面一门制 / agent 面细化权限 |
| `src/main/api/apiServiceManager.ts` | 双面路由装配；监听条件并集；绑定地址强制；status.appEnabled |
| `src/main/ipc/handlers/configHandlers.ts` | GET_CONFIG 改返回归一化配置；配对信息 +appEnabled |
| `src/renderer/pages/SettingsPage.tsx` | 权限标签 -2；patch 类型 +app；分组重排 |
| `src/renderer/components/ApiPairingQrModal.tsx` | mode 告警替换为 appEnabled 告警 |
| 安卓 `data/api/DesktopApi.kt` 等 4 个主文件 + 8 个测试文件 + README | `api/v1/` → `api/app/v1/` 纯前缀替换 |

---

### Task 1: 共享类型与配置层（含迁移）

**Files:**
- Modify: `src/shared/types.ts:1-56`
- Modify: `src/main/services/config.ts:322-348`（DEFAULT_CONFIG.apiService）、`config.ts:1069-1128`（normalizeApiServiceConfig）、`config.ts:1013-1024`（toRendererSafeConfig）
- Test: `tests/main/services/config.apiService.test.ts`

- [ ] **Step 1.1: 先写失败测试——默认值含 app 块、旧键剔除、迁移推导**

修改 `tests/main/services/config.apiService.test.ts`：

1. fixture `defaultApiServiceConfig`（33-59 行）：删除 `imageWrite: false,` 与 `galleryWrite: false,` 两行；在 `apiKey: '',` 之后插入：

```ts
  app: {
    enabled: false,
  },
```

2. 文件末尾（最后一个 `});` 之前的 describe 内）追加三个迁移用例：

```ts
  it('迁移：旧配置 imageWrite/galleryWrite 开启时推导 app.enabled=true，且输出剔除旧键（spec §5）', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        permissions: { imageWrite: true, galleryRead: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    const apiService = configModule.getConfig().apiService!;
    expect(apiService.app).toEqual({ enabled: true });
    expect(apiService.permissions).not.toHaveProperty('imageWrite');
    expect(apiService.permissions).not.toHaveProperty('galleryWrite');
  });

  it('迁移：旧配置未开写权限时 app.enabled 默认 false', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        permissions: { galleryRead: true, imageWrite: false },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService!.app).toEqual({ enabled: false });
  });

  it('迁移：显式 app.enabled=false 不被旧写权限信号覆盖', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        app: { enabled: false },
        permissions: { imageWrite: true, galleryWrite: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService!.app).toEqual({ enabled: false });
  });
```

- [ ] **Step 1.2: 跑测试确认失败**

Run: `npx vitest run tests/main/services/config.apiService.test.ts`
Expected: FAIL——默认值断言（多出 imageWrite/galleryWrite、缺 app）与三个迁移用例全红。

- [ ] **Step 1.3: 改 `src/shared/types.ts`**

1. `ApiServicePermissionKey`（4-17 行）删除 `| 'imageWrite'` 与 `| 'galleryWrite'` 两行。
2. `ApiServiceConfig`（28-35 行）改为：

```ts
/** 手机 App 面（/api/app/v1）访问配置：一门制，无细化权限（spec §3.1） */
export interface ApiServiceAppAccessConfig {
  enabled: boolean;
}

export interface ApiServiceConfig {
  enabled: boolean;
  mode: ApiServiceMode;
  port: number;
  apiKey: string;
  /** 允许手机端连接（独立于 agent 面 enabled，任一开启即运行服务器） */
  app: ApiServiceAppAccessConfig;
  permissions: ApiServicePermissions;
  logs: ApiServiceLogsConfig;
}
```

3. `ApiServiceStatus`（37-46 行）在 `enabled: boolean;` 后加一行：

```ts
  /** 手机端连接开关状态（spec §6） */
  appEnabled: boolean;
```

4. `ApiPairingInfo`（49-56 行）在 `running: boolean;` 后加一行：

```ts
  /** 「允许手机端连接」是否开启（配对弹窗提示用） */
  appEnabled: boolean;
```

- [ ] **Step 1.4: 改 `src/main/services/config.ts`**

1. `DEFAULT_CONFIG.apiService`（322-348 行）：`apiKey: '',` 后插入 `app: { enabled: false },`；permissions 里删除 `imageWrite: false,` 与 `galleryWrite: false,` 两行。
2. `normalizeApiServiceConfig`（1069-1128 行）：在 `const currentApiKey = ...` 之后插入：

```ts
  // 迁移（spec §5）：旧配置无 app 块时，imageWrite/galleryWrite 曾开启是「手机在用」的最强信号；
  // 旧键不再进入类型系统，经 Record 读取一次性消费，下次保存后自然从 yaml 消失。
  const legacyPermissions = (current?.permissions ?? {}) as Record<string, unknown>;
  const legacyMobileSignal = legacyPermissions.imageWrite === true || legacyPermissions.galleryWrite === true;
  const currentAppEnabled = normalizeBoolean(current?.app?.enabled, legacyMobileSignal || defaults.app.enabled);
```

3. 返回对象中 `apiKey: ...` 行之后插入：

```ts
    app: {
      enabled: normalizeBoolean(input?.app?.enabled, currentAppEnabled),
    },
```

4. permissions 块删除 `imageWrite:` 与 `galleryWrite:` 两行。
5. `toRendererSafeConfig` 的 `safeApiService`（1015-1024 行）：`port` 行后加 `app: source.apiService.app,`。

- [ ] **Step 1.5: 跑测试确认通过**

Run: `npx vitest run tests/main/services/config.apiService.test.ts`
Expected: PASS（此时 `npm run typecheck` 会在 permissions.ts/测试等处报旧键错误——属后续任务，不在本步门禁内）。

- [ ] **Step 1.6: 提交**

```bash
git add src/shared/types.ts src/main/services/config.ts tests/main/services/config.apiService.test.ts
git commit -m "feat(api): 配置层拆分手机面开关——ApiServiceConfig.app + 旧写权限迁移推导，权限键收缩为 11 键"
```

---

### Task 2: Agent 面权限映射表收缩

**Files:**
- Modify: `src/main/api/permissions.ts:16-27,51`
- Test: `tests/main/api/permissions.test.ts`

- [ ] **Step 2.1: 先改测试——移走的路由映射改断 undefined**

修改 `tests/main/api/permissions.test.ts`：

1. 主映射表（it.each 5-61 行）删除以下行：

```ts
    ['POST', '/api/v1/galleries', 'galleryWrite'],
    ['PATCH', '/api/v1/galleries/3', 'galleryWrite'],
    ['DELETE', '/api/v1/galleries/3', 'galleryWrite'],
    ['POST', '/api/v1/galleries/3/images', 'galleryWrite'],
    ['DELETE', '/api/v1/galleries/3/images', 'galleryWrite'],
    ['DELETE', '/api/v1/images/5', 'imageWrite'],
    ['POST', '/api/v1/images/batch-delete', 'imageWrite'],
    ['POST', '/api/v1/images/5/tags', 'imageWrite'],
    ['DELETE', '/api/v1/images/5/tags', 'imageWrite'],
    ['GET', '/api/v1/sync/meta', 'galleryRead'],
    ['GET', '/api/v1/sync/images', 'galleryRead'],
    ['GET', '/api/v1/sync/galleries', 'galleryRead'],
    ['GET', '/api/v1/sync/tags', 'galleryRead'],
    ['GET', '/api/v1/sync/image-ids', 'galleryRead'],
```

2. 「maps non-numeric route parameter」组（65-75 行）无写路由行，不动。
3. 文件末尾 `it('returns undefined for unknown endpoints', ...)` 之前追加：

```ts
  it.each([
    ['POST', '/api/v1/galleries'],
    ['PATCH', '/api/v1/galleries/3'],
    ['DELETE', '/api/v1/galleries/3'],
    ['POST', '/api/v1/galleries/3/images'],
    ['DELETE', '/api/v1/galleries/3/images'],
    ['DELETE', '/api/v1/images/5'],
    ['POST', '/api/v1/images/batch-delete'],
    ['POST', '/api/v1/images/5/tags'],
    ['DELETE', '/api/v1/images/5/tags'],
    ['GET', '/api/v1/sync/meta'],
    ['GET', '/api/v1/sync/images'],
    ['GET', '/api/v1/sync/galleries'],
    ['GET', '/api/v1/sync/tags'],
    ['GET', '/api/v1/sync/image-ids'],
  ] as const)('agent 面不再注册已迁移到手机面的路由 %s %s（spec §3.2）', (method, pathname) => {
    expect(resolvePermissionForRequest(method, pathname)).toBeUndefined();
  });
```

- [ ] **Step 2.2: 跑测试确认失败**

Run: `npx vitest run tests/main/api/permissions.test.ts`
Expected: FAIL——新增的 undefined 断言组全红（映射表还在返回权限键）。

- [ ] **Step 2.3: 改 `src/main/api/permissions.ts`**

删除 `apiPermissionRules` 中以下规则行（保留 galleries/images 只读与二进制规则）：

- 16-20 行：`POST /api/v1/galleries`、`PATCH/DELETE /api/v1/galleries/[^/]+`、`POST/DELETE .../images` 五条 `galleryWrite` 规则
- 23-26 行：`DELETE images`、`batch-delete`、`POST/DELETE tags` 四条 `imageWrite` 规则
- 51 行：`GET /api/v1/sync/...` 一条 `galleryRead` 规则

文件头部注释（若有涉及写权限的说明）同步；`ApiServicePermissionKey` 已在 Task 1 收缩，此文件 import 不变。

- [ ] **Step 2.4: 跑测试确认通过**

Run: `npx vitest run tests/main/api/permissions.test.ts`
Expected: PASS。

- [ ] **Step 2.5: 提交**

```bash
git add src/main/api/permissions.ts tests/main/api/permissions.test.ts
git commit -m "feat(api): agent 面权限映射表收缩——sync 与图集/图片写路由规则移除，回归设计文档 11 键"
```

---

### Task 3: 命名空间与双面路由装配

**Files:**
- Create: `src/main/api/appNamespace.ts`
- Modify: `src/main/api/routes/syncRoutes.ts`、`src/main/api/routes/galleryWriteRoutes.ts`（pattern 前缀）
- Modify: `src/main/api/routes/galleryRoutes.ts`（拆出二进制路由）
- Modify: `src/main/api/routes/eventRoutes.ts`（+手机面 system 路由）
- Modify: `src/main/api/routes/serviceRoutes.ts`（status 透出 appEnabled）
- Modify: `src/main/api/apiServiceManager.ts:47-57`（createRoutes 双面装配）
- Test: `tests/main/api/endpointCoverage.test.ts`、`tests/main/api/routes.sync.test.ts`、`tests/main/api/routes.galleryWrite.test.ts`

- [ ] **Step 3.1: 先改 endpointCoverage 测试——双面清单**

重写 `tests/main/api/endpointCoverage.test.ts` 的清单与装配（保留文件头 vi.mock('electron')）：

1. `documentedEndpoints` 重命名为 `agentEndpoints`，并删除其中的 galleries 写五条（POST/PATCH/DELETE galleries、POST/DELETE galleries/:galleryId/images）、images 写四条（DELETE images/:imageId、batch-delete、POST/DELETE tags）、sync 五条。
2. 紧随其后加手机面清单：

```ts
const appEndpoints = [
  ['GET', '/api/app/v1/service/info'],
  ['GET', '/api/app/v1/service/health'],
  ['GET', '/api/app/v1/sync/meta'],
  ['GET', '/api/app/v1/sync/images'],
  ['GET', '/api/app/v1/sync/galleries'],
  ['GET', '/api/app/v1/sync/tags'],
  ['GET', '/api/app/v1/sync/image-ids'],
  ['DELETE', '/api/app/v1/images/:imageId'],
  ['POST', '/api/app/v1/images/batch-delete'],
  ['POST', '/api/app/v1/images/:imageId/tags'],
  ['DELETE', '/api/app/v1/images/:imageId/tags'],
  ['POST', '/api/app/v1/galleries'],
  ['PATCH', '/api/app/v1/galleries/:galleryId'],
  ['DELETE', '/api/app/v1/galleries/:galleryId'],
  ['POST', '/api/app/v1/galleries/:galleryId/images'],
  ['DELETE', '/api/app/v1/galleries/:galleryId/images'],
  ['GET', '/api/app/v1/images/:imageId/thumbnail'],
  ['GET', '/api/app/v1/images/:imageId/preview'],
  ['GET', '/api/app/v1/images/:imageId/file'],
  ['GET', '/api/app/v1/events/system'],
];
```

3. it 主体改为（镜像 apiServiceManager.createRoutes 的装配方式）：

```ts
  it('双面路由装配完整覆盖文档端点（spec §3）', async () => {
    const { createServiceRoutes } = await import('../../../src/main/api/routes/serviceRoutes.js');
    const { createGalleryRoutes, createImageBinaryRoutes } = await import('../../../src/main/api/routes/galleryRoutes.js');
    const { createGalleryWriteRoutes } = await import('../../../src/main/api/routes/galleryWriteRoutes.js');
    const { createBooruRoutes } = await import('../../../src/main/api/routes/booruRoutes.js');
    const { createApiLogRoutes } = await import('../../../src/main/api/routes/apiLogRoutes.js');
    const { createEventRoutes, createAppEventRoutes } = await import('../../../src/main/api/routes/eventRoutes.js');
    const { createSyncRoutes } = await import('../../../src/main/api/routes/syncRoutes.js');
    const { remapToAppNamespace } = await import('../../../src/main/api/appNamespace.js');

    const serviceRoutes = createServiceRoutes({ getStatus: () => ({}) as any });
    const imageBinaryRoutes = createImageBinaryRoutes();
    const routes = [
      ...serviceRoutes,
      ...createGalleryRoutes(),
      ...imageBinaryRoutes,
      ...createBooruRoutes(),
      ...createApiLogRoutes(),
      ...createEventRoutes({ subscribe: () => undefined } as any),
      ...remapToAppNamespace(serviceRoutes),
      ...remapToAppNamespace(imageBinaryRoutes),
      ...createSyncRoutes(),
      ...createGalleryWriteRoutes(),
      ...createAppEventRoutes({ subscribe: () => undefined } as any),
    ];
    const actual = routes.map((route) => [route.method, route.pattern]);

    expect(actual).toEqual(expect.arrayContaining(agentEndpoints));
    expect(actual).toEqual(expect.arrayContaining(appEndpoints));

    // agent 面不得残留 sync 与写路由（spec §3.2）
    const agentPatterns = actual.filter(([, pattern]) => (pattern as string).startsWith('/api/v1/'));
    expect(agentPatterns.some(([, pattern]) => (pattern as string).startsWith('/api/v1/sync/'))).toBe(false);
    expect(agentPatterns.some(([method, pattern]) => (
      (pattern as string).startsWith('/api/v1/galleries') && method !== 'GET'
    ))).toBe(false);
    expect(agentPatterns.some(([method, pattern]) => (
      (pattern as string).startsWith('/api/v1/images') && method !== 'GET'
    ))).toBe(false);
  });
```

- [ ] **Step 3.2: 跑测试确认失败**

Run: `npx vitest run tests/main/api/endpointCoverage.test.ts`
Expected: FAIL——`createImageBinaryRoutes`/`createAppEventRoutes`/`appNamespace.js` 尚不存在（import 报错）。

- [ ] **Step 3.3: 新建 `src/main/api/appNamespace.ts`**

```ts
import type { ApiRoute } from './types.js';

/** 手机面命名空间前缀（spec §3.1）：身份由前缀决定，整面一门制、无细化权限。 */
export const APP_API_PREFIX = '/api/app/v1';

const AGENT_PREFIX_RE = /^\/api\/v1\//;

/**
 * 克隆共享路由到手机面前缀。service/二进制等两面同 handler 的路由用此复用，
 * 避免各写一份；handler 引用原样共享（无状态，仅 pattern 不同）。
 */
export function remapToAppNamespace(routes: ApiRoute[]): ApiRoute[] {
  return routes.map((route) => ({
    ...route,
    pattern: route.pattern.replace(AGENT_PREFIX_RE, `${APP_API_PREFIX}/`),
  }));
}
```

- [ ] **Step 3.4: syncRoutes / galleryWriteRoutes pattern 迁移**

```bash
sed -i "s|pattern: '/api/v1/|pattern: '/api/app/v1/|g" src/main/api/routes/syncRoutes.ts src/main/api/routes/galleryWriteRoutes.ts
```

并手工更新两文件头部注释：`syncRoutes.ts` 17-21 行注释中「权限均 galleryRead」改为「挂手机面 /api/app/v1，整面受『允许手机端连接』一门制（spec §3.1），无细化权限」；`galleryWriteRoutes.ts` 若头部注释提及 imageWrite/galleryWrite 权限，同样改为手机面一门制说明。

- [ ] **Step 3.5: galleryRoutes 拆出二进制路由**

`src/main/api/routes/galleryRoutes.ts`：把 `createGalleryRoutes()` 数组中 thumbnail/preview/file 三个路由对象（106-142 行）整体剪切到新导出函数（放在 `createGalleryRoutes` 之后，三个路由对象代码原样不动）：

```ts
/** 图片二进制三端点：agent 面（imageBinary 权限）与手机面（remap 共享 handler）都挂（spec §3.1）。 */
export function createImageBinaryRoutes(): ApiRoute[] {
  return [
    // ……原 thumbnail / preview / file 三个路由对象原样搬入……
  ];
}
```

- [ ] **Step 3.6: eventRoutes 增加手机面 system 路由**

`src/main/api/routes/eventRoutes.ts` 文件末尾追加：

```ts
/** 手机面只挂 system 单频道（最小暴露面，spec §3.1）；agent 面保留全频道参数路由。 */
export function createAppEventRoutes(eventHub: Pick<ApiEventHub, 'subscribe'>): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/app/v1/events/system',
      handler: (context) => {
        eventHub.subscribe('system', context.req, context.res);
        return undefined;
      },
    },
  ];
}
```

- [ ] **Step 3.7: serviceRoutes 透出 appEnabled**

`src/main/api/routes/serviceRoutes.ts` 的 `sanitizeStatus`（7-18 行）在 `enabled: status.enabled,` 后加一行 `appEnabled: status.appEnabled,`。

- [ ] **Step 3.8: apiServiceManager.createRoutes 双面装配**

`src/main/api/apiServiceManager.ts` 的 `createRoutes`（47-57 行）改为：

```ts
function createRoutes() {
  const serviceRoutes = createServiceRoutes({ getStatus: getApiServiceStatus });
  const imageBinaryRoutes = createImageBinaryRoutes();

  return [
    // Agent 面 /api/v1/*：设计文档 11 键细化权限（spec §3.2）
    ...serviceRoutes,
    ...createGalleryRoutes(),
    ...imageBinaryRoutes,
    ...createBooruRoutes(),
    ...createApiLogRoutes(),
    ...createEventRoutes(apiEventHub),
    // 手机面 /api/app/v1/*：「允许手机端连接」一门制（spec §3.1）
    ...remapToAppNamespace(serviceRoutes),
    ...remapToAppNamespace(imageBinaryRoutes),
    ...createSyncRoutes(),
    ...createGalleryWriteRoutes(),
    ...createAppEventRoutes(apiEventHub),
  ];
}
```

import 区补：`import { createImageBinaryRoutes } from './routes/galleryRoutes.js';`（并入现有 galleryRoutes import）、`createAppEventRoutes`（并入 eventRoutes import）、`import { remapToAppNamespace } from './appNamespace.js';`。

- [ ] **Step 3.9: 存量 sync/galleryWrite 路由测试跟随 pattern**

```bash
sed -i "s|'/api/v1/|'/api/app/v1/|g" tests/main/api/routes.sync.test.ts tests/main/api/routes.galleryWrite.test.ts
```

（两文件均按 `findRoute(pattern)` 直取 handler，仅字符串跟改，无行为变化。）

- [ ] **Step 3.10: 跑测试确认通过**

Run: `npx vitest run tests/main/api/endpointCoverage.test.ts tests/main/api/routes.sync.test.ts tests/main/api/routes.galleryWrite.test.ts`
Expected: PASS。

- [ ] **Step 3.11: 提交**

```bash
git add src/main/api/appNamespace.ts src/main/api/routes/ src/main/api/apiServiceManager.ts tests/main/api/endpointCoverage.test.ts tests/main/api/routes.sync.test.ts tests/main/api/routes.galleryWrite.test.ts
git commit -m "feat(api): 双面路由装配——sync/写路由迁入 /api/app/v1，二进制与 service 经 remap 两面共享，手机面只挂 system 频道"
```

---

### Task 4: server 请求分流门

**Files:**
- Modify: `src/main/api/server.ts:74-99`
- Test: `tests/main/api/server.test.ts`

- [ ] **Step 4.1: 先改测试——config harness 加 app 块 + 分流门矩阵**

修改 `tests/main/api/server.test.ts`：

1. `defaultPermissions`（31-45 行）删除 `imageWrite: true,` 与 `galleryWrite: true,` 两行。
2. `config()`（47-66 行）在 `permissions: {...}` 块之前插入（`...overrides` 在末尾展开、`ApiServiceAppAccessConfig` 单字段，整体覆盖语义正确）：

```ts
    app: {
      enabled: false,
    },
```

3. 文件末尾追加分流门矩阵 describe：

```ts
describe('namespace gates（spec §4）', () => {
  const appRoute: ApiRoute = {
    method: 'GET',
    pattern: '/api/app/v1/sync/meta',
    handler: () => ({ ok: 'app' }),
  };
  const agentRoute: ApiRoute = {
    method: 'GET',
    pattern: '/api/v1/galleries',
    handler: () => ({ ok: 'agent' }),
  };

  it('app.enabled=false 时手机面 403 PERMISSION_DENIED', async () => {
    const server = createApiHttpServer({ config: config(), routes: [appRoute] });
    const result = await request(server, {
      path: '/api/app/v1/sync/meta',
      authorization: 'Bearer test-api-key',
    });
    expect(result.statusCode).toBe(403);
    expect((result.json as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
    await close(server);
  });

  it('app.enabled=true 时手机面放行且不查细化权限', async () => {
    const allPermissionsOff = Object.fromEntries(
      Object.keys(defaultPermissions).map((key) => [key, false]),
    ) as ApiServiceConfig['permissions'];
    const server = createApiHttpServer({
      config: config({ app: { enabled: true }, permissions: allPermissionsOff }),
      routes: [appRoute],
    });
    const result = await request(server, {
      path: '/api/app/v1/sync/meta',
      authorization: 'Bearer test-api-key',
    });
    expect(result.statusCode).toBe(200);
    expect((result.json as { data: { ok: string } }).data.ok).toBe('app');
    await close(server);
  });

  it('enabled=false（app-only 运行）时 agent 面 403 而手机面可用', async () => {
    const server = createApiHttpServer({
      config: config({ enabled: false, app: { enabled: true } }),
      routes: [appRoute, agentRoute],
    });
    const agentDenied = await request(server, {
      path: '/api/v1/galleries',
      authorization: 'Bearer test-api-key',
    });
    expect(agentDenied.statusCode).toBe(403);
    const appOk = await request(server, {
      path: '/api/app/v1/sync/meta',
      authorization: 'Bearer test-api-key',
    });
    expect(appOk.statusCode).toBe(200);
    await close(server);
  });

  it('手机面未挂载路径仍 404（如非 system 事件频道）', async () => {
    const server = createApiHttpServer({
      config: config({ app: { enabled: true } }),
      routes: [appRoute],
    });
    const result = await request(server, {
      path: '/api/app/v1/events/downloads',
      authorization: 'Bearer test-api-key',
    });
    expect(result.statusCode).toBe(404);
    await close(server);
  });

  it('手机面请求日志 permissionKey 记 null', async () => {
    const server = createApiHttpServer({
      config: config({ app: { enabled: true }, logs: { enabled: true, visibleInUi: true } }),
      routes: [appRoute],
    });
    await request(server, { path: '/api/app/v1/sync/meta', authorization: 'Bearer test-api-key' });
    expect(mockRecordApiLog).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/app/v1/sync/meta',
      permissionKey: null,
      success: true,
    }));
    await close(server);
  });
});
```

- [ ] **Step 4.2: 跑测试确认失败**

Run: `npx vitest run tests/main/api/server.test.ts`
Expected: FAIL——app.enabled=false 时目前返回 500（'API route permission is not configured'）而非 403；agent 门用例返回 200 而非 403。

- [ ] **Step 4.3: 改 `src/main/api/server.ts`**

1. import 区补：`import { APP_API_PREFIX } from './appNamespace.js';`
2. 把 74-88 行（routeMatch 之后到权限校验）改为：

```ts
      const routeMatch = matchRoute(method, url.pathname);
      if (!routeMatch) {
        throw new ApiHttpError(404, 'NOT_FOUND', 'Not found');
      }

      // 命名空间分流（spec §4）：手机面整面一门制，agent 面走细化权限；
      // 服务器可能因任一面开启而运行，故两面各自查门。
      if (url.pathname.startsWith(`${APP_API_PREFIX}/`)) {
        if (options.config.app.enabled !== true) {
          throw new ApiHttpError(403, 'PERMISSION_DENIED', 'Mobile app access is disabled');
        }
        // logState.permissionKey 保持 null：路径前缀已自解释消费者身份（spec §4）
      } else {
        if (options.config.enabled !== true) {
          throw new ApiHttpError(403, 'PERMISSION_DENIED', 'Agent API is disabled');
        }

        const permissionKey = resolvePermissionForRequest(method, url.pathname);
        if (permissionKey === undefined) {
          throw new Error('API route permission is not configured');
        }

        logState.permissionKey = permissionKey;

        if (permissionKey && options.config.permissions[permissionKey] !== true) {
          throw new ApiHttpError(403, 'PERMISSION_DENIED', 'Permission denied');
        }
      }

      const data = await routeMatch.route.handler({
```

3. handler 调用参数中 `permissionKey,` 改为 `permissionKey: logState.permissionKey,`（app 面恒 null，agent 面为解析值——`RequestLogState.permissionKey` 类型已是 `ApiServicePermissionKey | null`）。

- [ ] **Step 4.4: 跑测试确认通过**

Run: `npx vitest run tests/main/api/server.test.ts tests/main/api/server.binary.test.ts tests/main/api/server.gzip.test.ts`
Expected: server.test.ts PASS；binary/gzip 两文件若因 fixture 含旧权限键报类型错，先在各自 config fixture 中删除 `imageWrite`/`galleryWrite` 行并补 `app: { enabled: false },`（与 Step 4.1-2 同款改法）。两文件请求的 `/api/v1/service/info|health` 走 agent 面新启用门，确认其 config fixture `enabled: true`（若为 false 会得 403），改后 PASS。

- [ ] **Step 4.5: 提交**

```bash
git add src/main/api/server.ts tests/main/api/server.test.ts tests/main/api/server.binary.test.ts tests/main/api/server.gzip.test.ts
git commit -m "feat(api): server 按命名空间分流——手机面一门制免细化权限，agent 面补启用门，日志 permissionKey 手机面记 null"
```

---

### Task 5: 服务生命周期——监听并集、绑定强制、status.appEnabled

**Files:**
- Modify: `src/main/api/apiServiceManager.ts:17-27,43-45,59-80,296-357`
- Test: `tests/main/api/apiServiceManager.test.ts`

- [ ] **Step 5.1: 先改测试——mock 配置补 app 块 + 生命周期矩阵**

修改 `tests/main/api/apiServiceManager.test.ts`：

1. `getApiServiceConfig` 顶层 mock（9-16 行）与 `createConfig`（34-44 行）两处，都在 `apiKey: '',` 后加 `app: { enabled: false },`。
2. 文件中现有断言 `toMatchObject({ running: false, enabled: false, ... })`（reports stopped status 用例）不需要动（toMatchObject 允许多余字段）。
3. 在「serializes concurrent sync calls」用例之前追加生命周期矩阵（复用文件既有 `createFakeServer`/`flushPromises` 模式）：

```ts
  it('仅 app.enabled=true 也启动服务器，且绑定 0.0.0.0（spec §6）', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({
      enabled: false,
      app: { enabled: true },
      apiKey: 'test-api-key',
    }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();
    fakeServer.succeedListen();

    await expect(sync).resolves.toMatchObject({
      running: true,
      enabled: false,
      appEnabled: true,
    });
    expect(fakeServer.listen).toHaveBeenCalledWith(38947, '0.0.0.0', expect.any(Function));
  });

  it('enabled 与 app.enabled 均为 false 时不启动', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: false, app: { enabled: false } }));
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    await expect(syncApiServiceFromConfig()).resolves.toMatchObject({
      running: false,
      appEnabled: false,
    });
    expect(createApiHttpServer).not.toHaveBeenCalled();
  });

  it('agent localhost 模式 + app.enabled=true 时仍强制绑定 0.0.0.0（手机连接=局域网）', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({
      enabled: true,
      mode: 'localhost',
      app: { enabled: true },
      apiKey: 'test-api-key',
    }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();
    fakeServer.succeedListen();
    await sync;

    expect(fakeServer.listen).toHaveBeenCalledWith(38947, '0.0.0.0', expect.any(Function));
  });

  it('app 关闭时绑定回归 mode 旧逻辑（localhost → 127.0.0.1）', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({
      enabled: true,
      mode: 'localhost',
      app: { enabled: false },
      apiKey: 'test-api-key',
    }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();
    fakeServer.succeedListen();
    await sync;

    expect(fakeServer.listen).toHaveBeenCalledWith(38947, '127.0.0.1', expect.any(Function));
  });
```

- [ ] **Step 5.2: 跑测试确认失败**

Run: `npx vitest run tests/main/api/apiServiceManager.test.ts`
Expected: FAIL——app-only 用例不启动（syncNow 只看 enabled）、appEnabled 字段缺失、绑定断言 127.0.0.1 ≠ 0.0.0.0。

- [ ] **Step 5.3: 改 `src/main/api/apiServiceManager.ts`**

1. 初始 `status` 字面量（18-27 行）`enabled: false,` 后加 `appEnabled: false,`。
2. `getBindAddress`（43-45 行）改为（含手机强制语义）：

```ts
function getBindAddress(config: Pick<ApiServiceConfig, 'mode' | 'app'>): string {
  // 手机连接即意味着局域网可达（spec §6）：app 面开启时强制 0.0.0.0，
  // mode 仅决定 agent-only 场景的监听面；应用层私网 IP 白名单恒在兜底。
  if (config.app.enabled) {
    return '0.0.0.0';
  }
  return config.mode === 'localhost' ? '127.0.0.1' : '0.0.0.0';
}
```

3. `getApiServiceStatus`（59-74 行）两个 return 分支都补 `appEnabled: config.app.enabled,`。
4. `syncNow`（296-357 行）：
   - 开头 `if (!config.enabled)` 改为 `if (!config.enabled && !config.app.enabled)`（注释：任一消费者开启即运行，spec §6）。
   - Key 生成失败分支的 status 字面量：`enabled: true,` 改为 `enabled: config.enabled,`，并补 `appEnabled: config.app.enabled,`。
   - `const bindAddress = getBindAddress(serverConfig.mode);` 改为 `const bindAddress = getBindAddress(serverConfig);`。
   - 监听成功分支 status 字面量：`enabled: true,` 改为 `enabled: serverConfig.enabled,`，补 `appEnabled: serverConfig.app.enabled,`。
   - 监听失败分支 status 字面量：同样 `enabled: serverConfig.enabled,` + `appEnabled: serverConfig.app.enabled,`。

- [ ] **Step 5.4: 跑测试确认通过**

Run: `npx vitest run tests/main/api/apiServiceManager.test.ts`
Expected: PASS（既有用例 enabled:true 场景行为不变）。

- [ ] **Step 5.5: 提交**

```bash
git add src/main/api/apiServiceManager.ts tests/main/api/apiServiceManager.test.ts
git commit -m "feat(api): 服务生命周期解耦——enabled||app.enabled 并集启动，手机开关强制 0.0.0.0 绑定，status 透出 appEnabled"
```

---

### Task 6: 存量测试清扫 + 桌面门禁全绿

**Files:**
- Modify: `tests/main/api/routes.serviceGallery.test.ts`、`tests/main/services/config.test.ts`、`tests/renderer/pages/SettingsPage.test.tsx`（旧权限键 fixture）
- 以及 Step 4.4 未覆盖到的任何残留

- [ ] **Step 6.1: 枚举全部残留引用**

```bash
grep -rn "imageWrite\|galleryWrite" src/ tests/ --include="*.ts" --include="*.tsx"
```

Expected：只剩测试 fixture（routes.serviceGallery / config.test / SettingsPage.test 等）。逐个处理，规则统一：

- 权限对象 fixture：删除 `imageWrite`/`galleryWrite` 两行；
- 完整 `ApiServiceConfig` fixture：在 `apiKey` 字段后补 `app: { enabled: false },`（若用例本身测手机面则 `true`）；
- 若断言文本包含「图片写操作」「图集写操作」标签（SettingsPage.test.tsx），删除对应断言或改为断言标签不存在。

- [ ] **Step 6.2: typecheck 全绿**

Run: `npm run typecheck`
Expected: PASS——此步是权限键收缩的最终类型闸门；任何报错都指向漏改的 fixture 或实现，逐个修复。

- [ ] **Step 6.3: 桌面主进程门禁全绿**

Run: `npx vitest run tests/main`
Expected: 全部 PASS（文件数 ≥130，用例数 ≥1679 基线，新增用例只增不减）。

- [ ] **Step 6.4: 渲染层涉改文件单独验证**

Run: `npx vitest run tests/renderer/pages/SettingsPage.test.tsx`
Expected: PASS（全量渲染层套件已知假性炸，不作为门禁）。

- [ ] **Step 6.5: 提交**

```bash
git add tests/
git commit -m "test: 清扫 imageWrite/galleryWrite 旧权限键 fixture，主进程门禁与 typecheck 全绿"
```

---

### Task 7: IPC 归一化返回 + 设置页重排 + 配对弹窗提示

**Files:**
- Modify: `src/main/ipc/handlers/configHandlers.ts:125-131,177-195`
- Modify: `src/renderer/pages/SettingsPage.tsx:21-47,379-384,1123-1241`
- Modify: `src/renderer/components/ApiPairingQrModal.tsx:44-55`

- [ ] **Step 7.1: configHandlers——GET_CONFIG 返回归一化配置 + 配对信息带 appEnabled**

1. `API_SERVICE_GET_CONFIG`（125-131 行）：`return { success: true, data: getConfig().apiService };` 改为 `return { success: true, data: getApiServiceConfig() };`（归一化结果恒含 app 块与全部默认值，旧 yaml 缺省时渲染层不再拿到 undefined 字段；`getApiServiceConfig` 已在文件 import 列表中）。
2. `API_SERVICE_GET_PAIRING_INFO`（177-195 行）`data` 字面量中 `running: status.running,` 后加一行：

```ts
        appEnabled: apiService.app.enabled,
```

- [ ] **Step 7.2: SettingsPage——标签收缩 + patch 类型扩展**

1. `API_PERMISSION_LABELS`（21-35 行）删除 `imageWrite: '图片写操作',` 与 `galleryWrite: '图集写操作',` 两行（类型 `Record<ApiServicePermissionKey, string>` 在 Task 1 收缩后会强制此改动）。
2. `ApiServicePatch`（37-40 行）改为：

```ts
type ApiServicePatch = Partial<Omit<ApiServiceConfig, 'permissions' | 'logs' | 'app'>> & {
  permissions?: Partial<ApiServiceConfig['permissions']>;
  logs?: Partial<ApiServiceConfig['logs']>;
  app?: Partial<ApiServiceConfig['app']>;
};
```

3. `mergeApiServicePatch`（42-47 行）在 `logs:` 行后加：

```ts
  app: patch.app ? { ...config.app, ...patch.app } : config.app,
```

4. `saveApiServiceNestedPatch`（379-384 行）签名扩为：

```ts
  const saveApiServiceNestedPatch = async (
    key: 'permissions' | 'logs' | 'app',
    value: Partial<ApiServiceConfig['permissions']> | Partial<ApiServiceConfig['logs']> | Partial<ApiServiceConfig['app']>,
  ) => {
    await saveApiServicePatch({ [key]: value } as ApiServicePatch);
  };
```

- [ ] **Step 7.3: SettingsPage——API 标签页分组重排（spec §7）**

把 1123-1241 行的三个分组（「API 服务」「API Key」「权限」）替换为以下五个分组（「日志」组与 `ApiPairingQrModal` 引用保持原位不动；所有 JSX 复用现有行组件与既有回调，仅重排与改标签）：

```tsx
          {/* 共享基础：端口 / 运行状态 / Key（两面同用一把，spec §7） */}
          <SettingsGroup title="API 服务" footer="端口与 API Key 由手机端与 Agent 共享；重新生成 Key 后所有已接入客户端需更新。">
            <SettingsRow
              label="端口"
              extra={
                <Input
                  type="number"
                  value={apiPortDraft}
                  style={{ width: 120, textAlign: 'right' }}
                  variant="borderless"
                  onChange={event => setApiPortDraft(event.target.value)}
                  onBlur={() => { void commitApiServicePortDraft(); }}
                  onPressEnter={() => { void commitApiServicePortDraft(); }}
                />
              }
            />
            <SettingsRow
              label="运行状态"
              description={apiStatus.running ? `运行中 ${apiStatus.baseUrl || ''}（绑定 ${apiStatus.bindAddress || '-'}）` : (apiStatus.lastError || '未运行')}
            />
            <SettingsRow
              label="API Key"
              description={apiKeyVisible ? (apiConfig.apiKey || '未生成') : (apiConfig.apiKey ? '已生成，当前隐藏' : '未生成')}
              extra={
                <Space size={spacing.sm}>
                  <Button size="small" onClick={() => setApiKeyVisible(v => !v)}>
                    {apiKeyVisible ? '隐藏' : '显示'}
                  </Button>
                  {/* 重新生成是破坏性操作：二次确认 + danger 样式 */}
                  <Popconfirm
                    title="重新生成将使旧 Key 立即失效，已接入的客户端需更新"
                    okText="生成"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void generateApiServiceKey()}
                  >
                    <Button size="small" danger>
                      生成新 Key
                    </Button>
                  </Popconfirm>
                </Space>
              }
            />
            <SettingsRow
              label="当前值"
              description={apiKeyVisible ? apiConfig.apiKey || '未生成' : '已隐藏'}
              isLast
              extra={
                <Tooltip title="复制">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    disabled={!apiConfig.apiKey}
                    onClick={async () => {
                      if (!apiConfig.apiKey) return;
                      try {
                        await navigator.clipboard.writeText(apiConfig.apiKey);
                        message.success('已复制');
                      } catch (err) {
                        console.error('[SettingsPage] 复制 API Key 失败:', err);
                        message.error('复制失败');
                      }
                    }}
                  />
                </Tooltip>
              }
            />
          </SettingsGroup>

          {/* 手机面：一门制（spec §3.1/§7），开关独立拉起服务器并强制局域网绑定 */}
          <SettingsGroup title="手机端连接" footer="开启后服务自动运行并绑定局域网地址，手机 App 的同步、浏览与图库编辑能力整体可用；关闭则手机面全部拒绝。">
            <SettingsRow
              label="允许手机端连接"
              extra={
                <Switch
                  checked={Boolean(apiConfig.app?.enabled)}
                  onChange={enabled => void saveApiServiceNestedPatch('app', { enabled })}
                />
              }
            />
            <SettingsRow
              label="移动端配对"
              description="生成二维码，手机 App 扫码即可连接"
              isLast
              extra={
                <Button size="small" onClick={() => setPairingModalOpen(true)}>
                  显示二维码
                </Button>
              }
            />
          </SettingsGroup>

          {/* Agent 面：细化权限（spec §3.2/§7） */}
          <SettingsGroup title="Agent API" footer="面向 CLI 与智能体的接口；默认仅本机访问，局域网模式仍会拦截非私网来源。">
            <SettingsRow
              label="启用 Agent API"
              extra={<Switch checked={apiConfig.enabled} onChange={enabled => void saveApiServicePatch({ enabled })} />}
            />
            <SettingsRow
              label="监听模式"
              isLast
              extra={
                <Segmented
                  value={apiConfig.mode}
                  onChange={(mode) => void saveApiServicePatch({ mode: mode as ApiServiceConfig['mode'] })}
                  options={[
                    { label: '仅本机', value: 'localhost' },
                    { label: '局域网', value: 'lan' },
                  ]}
                  size="small"
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Agent 权限">
            {Object.entries(API_PERMISSION_LABELS).map(([key, label], index, entries) => {
              const permissionKey = key as ApiServicePermissionKey;
              return (
                <SettingsRow
                  key={permissionKey}
                  label={label}
                  extra={
                    <Switch
                      checked={Boolean(apiConfig.permissions[permissionKey])}
                      onChange={checked => void saveApiServiceNestedPatch('permissions', { [permissionKey]: checked })}
                    />
                  }
                  isLast={index === entries.length - 1}
                />
              );
            })}
          </SettingsGroup>
```

（注意：原「API 服务」组的「启用 API 服务」「监听模式」「当前绑定地址」「移动端配对」四行已分别移入「Agent API」「运行状态」「手机端连接」，不要重复保留。）

- [ ] **Step 7.4: 配对弹窗——mode 告警替换为 appEnabled 告警**

`src/renderer/components/ApiPairingQrModal.tsx`：44-49 行的两个 Alert 改为（`running` 告警措辞跟随新语义，`mode` 告警删除——手机开关开启即强制 0.0.0.0 绑定，mode 不再决定手机可达性）：

```tsx
      {info && !info.appEnabled && (
        <Alert type="warning" message="未开启「允许手机端连接」，请先在设置中打开该开关" showIcon style={{ marginBottom: 12 }} />
      )}
      {info && info.appEnabled && !info.running && (
        <Alert type="warning" message="API 服务未运行（启动失败），请查看设置页错误信息" showIcon style={{ marginBottom: 12 }} />
      )}
```

（apiKey / lanAddresses 两个 Alert 与其余内容不动。）

- [ ] **Step 7.5: 验证**

Run: `npm run typecheck && npx vitest run tests/main tests/renderer/pages/SettingsPage.test.tsx`
Expected: 全部 PASS。如 SettingsPage.test.tsx 有分组标题/行文案断言（如「启用 API 服务」「权限」），按新文案（「启用 Agent API」「Agent 权限」「允许手机端连接」）更新断言。

- [ ] **Step 7.6: 提交**

```bash
git add src/main/ipc/handlers/configHandlers.ts src/renderer/pages/SettingsPage.tsx src/renderer/components/ApiPairingQrModal.tsx tests/renderer/pages/SettingsPage.test.tsx
git commit -m "feat(ui): 设置页 API 标签页重排——手机端连接单开关+配对入口独立分组，Agent API/权限分组改名，配对弹窗按 appEnabled 提示"
```

---

### Task 8: 安卓端前缀迁移

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/api/DesktopApi.kt`（16 个注解）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/api/ApiClientFactory.kt:16`（BINARY_PATH 正则）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/image/ImageLoaders.kt:13,57,60`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt:212,218`（SSE URL 与注释）
- Modify: 注释引用（`domain/sync/SseClient.kt`、`domain/download/DownloadWorker.kt`）
- Test: `android/app/src/test/` 下 8 个含路径断言的文件（WriteApiTest、EndToEndSyncTest、AppGraphTest、SseClientTest、DownloadE2ETest、ImageLoadersTest、WriteReconcileE2ETest、ApiClientTest）

- [ ] **Step 8.1: 机械替换（主代码 + 测试 + 安卓 README 路径）**

`api/app/v1` 不含子串 `api/v1`（`api/` 后跟 `app`），替换幂等安全：

```bash
cd "m:/yande/yande-gallery-desktop"
grep -rl 'api/v1/' android/app/src android/README.md | while read -r f; do
  sed -i 's|api/v1/|api/app/v1/|g' "$f"
done
```

- [ ] **Step 8.2: 验证零残留**

```bash
grep -rn 'api/v1' android/ --include='*.kt' --include='*.md' | grep -v 'api/app/v1'
```

Expected: 无输出（`build/` 产物目录中的残留可忽略，必要时加 `--exclude-dir=build`）。

- [ ] **Step 8.3: 安卓门禁**

Run: `"D:/Android/gw.bat" :app:testDebugUnitTest --rerun`
Expected: BUILD SUCCESSFUL；以 `android/app/build/test-results/testDebugUnitTest/*.xml` 汇总为准——tests ≥386、failures=0、errors=0（基线 71 类 386 例）。

- [ ] **Step 8.4: 提交**

```bash
git add android/app/src android/README.md
git commit -m "feat(android): 桌面 API 调用整体迁至手机面命名空间 /api/app/v1，二进制路径正则与 SSE 订阅地址同步"
```

---

### Task 9: 文档同步 + 双端终检

**Files:**
- Modify: `android/README.md`（eventsSubscribe 语义段落 + 配套升级说明）
- Modify: grep 发现的桌面侧文档（权限键清单 / API 路径描述）

- [ ] **Step 9.1: android/README 语义修正（路径已在 Task 8 机械替换）**

1. 约 102 行处「`eventsSubscribe` 默认也是关闭的。开启后安卓端订阅 `/api/app/v1/events/system`…」一段：手机 SSE 不再依赖 `eventsSubscribe` 权限，改写为如下口径（保留该段落中与心跳/重连相关的技术描述）：

> 手机端全部接口（含 SSE `/api/app/v1/events/system`）走独立命名空间，仅受桌面设置「手机端连接 → 允许手机端连接」单开关控制，不再依赖任何 agent 细化权限开关。

2. 若 README 存在「需开启哪些权限」类清单（galleryRead/imageBinary/imageWrite 等字样），整段替换为上述单开关口径。
3. 在 README 连接/配对相关章节追加一行兼容性说明：

> **配套升级**：v0.7 起手机接口迁至 `/api/app/v1`，App 与桌面端需同时升级——旧 APK 连新桌面同步全部 404，新 APK 连旧桌面连接测试直接失败。

（版本号以实际发布号为准；若本轮不发版，写「本次拆分起」。）

- [ ] **Step 9.2: 桌面侧文档扫描与同步**

```bash
grep -rn "imageWrite\|galleryWrite\|api/v1/sync" doc/ README.md --include='*.md' | grep -v superpowers | grep -v done/
```

对每处命中：

- 权限键清单（如 `doc/注意事项/配置项清单与存储分布.md`、`doc/功能总览.md` 若有 apiService.permissions 描述）：删除 imageWrite/galleryWrite 两键，补 `apiService.app.enabled`（允许手机端连接）条目；
- `/api/v1/sync` 路径描述：改为 `/api/app/v1/sync` 并注明属手机面；
- `doc/skill需求文档/API服务与CLI及Skill整体方案设计.md` **不改**——拆分后该文档的 11 键模型重新与实现一致，是本次拆分的目标状态。

- [ ] **Step 9.3: 双端终检**

```bash
npm run typecheck && npx vitest run tests/main
"D:/Android/gw.bat" :app:testDebugUnitTest --rerun
```

Expected: 桌面 typecheck + tests/main 全绿；安卓 XML 汇总 failures=0、errors=0。

- [ ] **Step 9.4: 提交**

```bash
git add doc/ README.md android/README.md
git commit -m "docs: API 权限拆分文档同步——手机面单开关口径、权限键清单收缩、两端配套升级说明"
```

---

## 验收核对单（对照 spec）

- [ ] spec §3.1：手机面 20 个端点齐全（endpointCoverage appEndpoints）
- [ ] spec §3.2：agent 面无 sync/写路由（permissions.test 的 undefined 组 + endpointCoverage 负断言）
- [ ] spec §4：分流门矩阵（server.test namespace gates 五用例）
- [ ] spec §5：迁移三用例（config.apiService.test）
- [ ] spec §6：生命周期四用例（apiServiceManager.test）+ status.appEnabled
- [ ] spec §7：设置页五分组重排 + 配对弹窗 appEnabled 提示
- [ ] spec §8：安卓零残留 grep + 门禁绿
- [ ] spec §9：README 配套升级说明
- [ ] spec §11：未引入双 Key/双服务器/手机面细化权限/旧路径重定向




