# 安卓图片镜像层与高质量图档位 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `doc/superpowers/specs/2026-07-13-android-image-mirror-design.md`——桌面端新增 HQ 高质量图端点；安卓端建图片镜像层（私有目录 + Room 登记 + 自动增量同步），下载/分享/缩略图全部改为本地优先，下线 1600px 预览档与 MediaStore 下载链路。

**Architecture:** 桌面端在 thumbnailService 里镜像 preview 档机制新增 `generateHq`（同格式压缩、png→jpg 白底、gif 直通、体积保护），挂 `/api/v1/images/:id/hq` 并经 remap 进手机面。安卓端新建 `data/mirror/ImageMirrorStore`（唯一写入口：part 原子落盘、per-key 互斥、档位规则），`MirrorSyncWorker` 挂现有元数据同步总线做增量批量下载；Coil 拦截器让缩略图本地镜像优先；分享走 FileProvider 四级档位规则。

**Tech Stack:** 桌面 Electron/TS/sharp/vitest；安卓 Kotlin/Compose/Room/WorkManager/Coil3/OkHttp/Robolectric/MockWebServer。

## Global Constraints

- HQ 档参数（spec §2.1/§2.2）：`resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })`；jpg→mozjpeg q85、webp→webp q85 effort 3、png→jpeg q85 且 `flatten({ background: '#ffffff' })`、gif 直通回源、其他罕见格式→jpeg q85；体积保护：产物字节数 ≥ 源文件 → 回源文件路径。桌面端**不加设置 UI**。
- 桌面 config 默认段：`thumbnails.hq = { cachePath: 'hq', maxWidth: 2560, maxHeight: 2560, quality: 85, effort: 3 }`（无 format 字段——输出格式按源动态定）。
- 安卓镜像目录（spec §3.1）：`(getExternalFilesDir(null) ?: filesDir)/mirror/s{serverId}/i{imageId}/{文件名}`；ORIGINAL 档文件名 = Room `images.filename` 原文（清洗非法字符 `\ / : * ? " < > |` → `_`）；HQ 档 = 原主文件名 + 响应 Content-Type 实际扩展名。
- Room：**分两步迁移**（计划期决策，偏离 spec 的单步 v5→v6——为让每个任务点可编译可测）：v5→v6 新建 `image_files`；v6→v7 DROP `downloads`（收尾任务）。最终链 1→…→7。
- 命名偏离（计划期决策）：镜像层类名 **`ImageMirrorStore`**（spec 写 MirrorStore，但 `domain.sync.MirrorStore` 已被元数据镜像接口占用）。
- 同步参数（spec §3.4）：有限并发 3 路；磁盘阈值 500MB（`500L * 1024 * 1024`）；HQ 全 404 判旧桌面阈值 5；约束默认 `UNMETERED`、允许移动网络时 `CONNECTED`。
- 缩略图盘缓存「不设限」= `1L shl 40`（1 TiB 形式上限）。
- 偏好键（spec §5.3）：`image_save_mode`（MirrorTier.name，非法收敛 HQ）、`mirror_sync_cellular`（默认 false）。
- 测试命令：桌面 `npm run test:unit -- tests/<file>`；安卓 `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "<pattern>"`（全量不带 --tests）。
- commit message 中文、类型前缀英文（仓库规范）。
- 安卓版本号（收尾任务）：versionCode 8 / versionName "0.7.0"。

## 文件结构总览

**桌面（修改）**：`src/main/services/config.ts`（hq 配置段 + getHqPath + 目录确保 + updateConfig 重建）、`src/main/services/thumbnailService.ts`（generateHq/getHqIfExists/deleteHq + getTierCachePath 扩 'hq' + cancelPending 扩 hq: 键）、`src/main/api/routes/galleryRoutes.ts`（/hq 路由）、`src/main/api/permissions.ts`（正则加 hq）、`src/main/services/imageService.ts`/`galleryService.ts`/`invalidImageService.ts`（deleteHq 级联）。

**安卓（新建）**：`data/mirror/MirrorModels.kt`（MirrorTier/LocalImage/MirrorStats/文件名工具）、`data/mirror/ImageMirrorStore.kt`、`data/db/ImageFileDao.kt`、`domain/mirror/MirrorSyncWorker.kt`、`domain/mirror/MirrorSyncManager.kt`、`domain/mirror/MirrorSyncMonitor.kt`、`ui/settings/SettingsViewModel.kt`。

**安卓（修改）**：`Entities.kt`/`AppDatabase.kt`（v6/v7）、`PrefsStore.kt`、`ImageLoaders.kt`（ThumbnailSpec/MirrorFirstInterceptor/不设限、预览档删除）、`ApiClientFactory.kt`（BINARY_PATH 加 hq）、`AppGraph.kt`、`AppWorkerFactory.kt`、`DownloadWorker.kt`/`DownloadManager.kt`/`DownloadNotifier.kt`、`ShareCoordinator.kt`、`SelectionActions.kt`、`ViewerViewModel.kt`/`ViewerScreen.kt`、`PhotosScreen.kt`/`AlbumDetailScreen.kt`（分享/级联删改）、`SettingsScreen.kt`、`CacheScreen.kt`/`CacheViewModel.kt`、`MiuiWidgets.kt`（MiuiSwitchItem）、`MainActivity.kt`、`AndroidManifest.xml`、`res/xml/file_paths.xml`。

**安卓（删除，收尾任务）**：`DownloadDao.kt`、`DownloadEntity`/`DownloadWithMeta`、`data/media/MediaStoreGateway.kt`、`data/media/AndroidMediaStoreGateway.kt`、legacy 存储门卫（`rememberLegacyStorageGate` 所在文件）、相关旧测试。

---

### Task 1: 桌面端 HQ 档生成服务（config + generateHq）

**Files:**
- Modify: `src/main/services/config.ts`（4 处：接口 ~L152、DEFAULT_CONFIG ~L282、`getPreviewsPath` 后 ~L1441、`ensureDataDirectories` ~L556、updateConfig 重建 ~L1175）
- Modify: `src/main/services/thumbnailService.ts`
- Modify: `src/main/services/imageService.ts` / `src/main/services/galleryService.ts` / `src/main/services/invalidImageService.ts`（deleteHq 级联一行）
- Test: `tests/main/services/thumbnailService.hq.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `generatePreviewInternal` 结构、`thumbnailQueue.enqueue({key,imagePath,run,priority,notify})`、`thumbnailExists`（size>0）、`normalizeThumbnailEffort`、`isMissingSourceError`。
- Produces: `generateHq(imagePath: string, force?: boolean): Promise<ThumbnailResult>`、`getHqIfExists(imagePath): Promise<string|null>`、`deleteHq(imagePath): Promise<{success, error?}>`、`getHqPath(): string`（Task 2 路由消费 generateHq）。

- [ ] **Step 1: 写失败测试**

新建 `tests/main/services/thumbnailService.hq.test.ts`，仿 `thumbnailService.preview.test.ts` 的 hoisted-mock 结构（sharp 链式 mock 增加 `flatten`）：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HQ 高质量图档生成管线（spec §2.1）：
 * - jpg→mozjpeg q85 / webp→webp q85 同格式；png→jpeg q85 + flatten 白底（扩展名变 .jpg）；
 * - GIF 直通回源；体积保护：产物 ≥ 源文件 → 回源路径；
 * - 缓存命中短路；源缺失 missing:true；不发 thumbnail:generated。
 */

const mocks = vi.hoisted(() => {
  const toFile = vi.fn(async () => undefined);
  const webp = vi.fn(() => ({ toFile }));
  const jpeg = vi.fn(() => ({ toFile }));
  const flatten = vi.fn(() => ({ jpeg }));
  const resize = vi.fn(() => ({ webp, jpeg, flatten }));
  const sharpFactory = vi.fn(() => ({ resize }));
  return {
    fs: {
      access: vi.fn(),
      stat: vi.fn(),
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
    config: {
      getConfig: vi.fn(() => ({
        thumbnails: {
          cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3,
          preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
          hq: { cachePath: 'hq', maxWidth: 2560, maxHeight: 2560, quality: 85, effort: 3 },
        },
      })),
      getThumbnailsPath: vi.fn(() => 'D:/thumbs'),
      getPreviewsPath: vi.fn(() => 'D:/previews'),
      getHqPath: vi.fn(() => 'D:/hq'),
    },
    emitBuiltRendererAppEvent: vi.fn(),
    toFile, resize, webp, jpeg, flatten, sharpFactory,
  };
});

vi.mock('fs/promises', () => ({ default: mocks.fs }));
vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: mocks.config.getConfig,
  getThumbnailsPath: mocks.config.getThumbnailsPath,
  getPreviewsPath: mocks.config.getPreviewsPath,
  getHqPath: mocks.config.getHqPath,
}));
vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: mocks.emitBuiltRendererAppEvent,
}));
vi.mock('sharp', () => ({ default: mocks.sharpFactory }));

const JPG = 'D:/lib/a.jpg';
const PNG = 'D:/lib/b.png';
const WEBP = 'D:/lib/c.webp';

/** stat 分派：源文件给大尺寸、HQ 产物给小尺寸（体积保护默认通过）；缓存路径默认 ENOENT（未命中）。 */
function statSourceBigHqSmall(hqHit: boolean) {
  mocks.fs.stat.mockImplementation(async (p: string) => {
    if (p.startsWith('D:/hq')) {
      if (!hqHit) throw new Error('ENOENT');
      return { isFile: () => true, size: 100_000 };
    }
    return { isFile: () => true, size: 5_000_000 };   // 源文件
  });
}

describe('generateHq 高质量图档生成', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.fs.access.mockResolvedValue(undefined);
    statSourceBigHqSmall(false);
  });

  it('jpg 源：2560 边界 + mozjpeg q85 同格式生成 .jpg 到 hq 目录', async () => {
    // 生成完成后体积保护要 stat 产物：toFile 后产物存在
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^D:[\\/]hq[\\/][0-9a-f]{32}\.jpg$/);
    expect(mocks.resize).toHaveBeenCalledWith(2560, 2560, { fit: 'inside', withoutEnlargement: true });
    expect(mocks.jpeg).toHaveBeenCalledWith(expect.objectContaining({ quality: 85, mozjpeg: true }));
  });

  it('webp 源：同格式 .webp（webp q85）', async () => {
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(WEBP);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/\.webp$/);
    expect(mocks.webp).toHaveBeenCalledWith(expect.objectContaining({ quality: 85, effort: 3 }));
  });

  it('png 源：flatten 白底转 .jpg（D2 透明铺白）', async () => {
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(PNG);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/\.jpg$/);
    expect(mocks.flatten).toHaveBeenCalledWith({ background: '#ffffff' });
    expect(mocks.jpeg).toHaveBeenCalledWith(expect.objectContaining({ quality: 85, mozjpeg: true }));
  });

  it('GIF 直通回源且不调 sharp', async () => {
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq('D:/lib/d.gif');
    expect(result).toEqual({ success: true, data: 'D:/lib/d.gif' });
    expect(mocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('体积保护：产物 ≥ 源文件 → 回源文件路径', async () => {
    mocks.toFile.mockImplementation(async () => {
      mocks.fs.stat.mockImplementation(async (p: string) => (
        p.startsWith('D:/hq')
          ? { isFile: () => true, size: 6_000_000 }   // 产物比源还大
          : { isFile: () => true, size: 5_000_000 }
      ));
    });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result).toEqual({ success: true, data: JPG });
  });

  it('缓存命中：不调 sharp，返回缓存路径（体积保护仍生效）', async () => {
    statSourceBigHqSmall(true);
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^D:[\\/]hq[\\/]/);
    expect(mocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('源缺失 → missing:true（路由映射 404）', async () => {
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result.success).toBe(false);
    expect(result.missing).toBe(true);
  });

  it('HQ 生成不发 thumbnail:generated 事件', async () => {
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    await generateHq(JPG);
    expect(mocks.emitBuiltRendererAppEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit -- tests/main/services/thumbnailService.hq.test.ts`
Expected: FAIL——`getHqPath` 导出不存在 / `generateHq` 不存在。

- [ ] **Step 3: 实现 config 四处修改**

`src/main/services/config.ts`：

① 接口（`preview` 块（~L152-159）之后、`thumbnails` 闭括号前）加：

```ts
    hq: {
      cachePath: string;
      maxWidth: number;
      maxHeight: number;
      quality: number;
      effort: number;
    };
```

② `DEFAULT_CONFIG.thumbnails.preview` 段（~L282-289）之后同层加：

```ts
    hq: {
      cachePath: 'hq',
      maxWidth: 2560,
      maxHeight: 2560,
      quality: 85,
      effort: 3
    }
```

（注意给 preview 段补尾逗号。）

③ `getPreviewsPath`（~L1438-1441）之后加：

```ts
/**
 * 获取 HQ 高质量图档缓存目录（移动端镜像同步用，spec §2.1）
 */
export function getHqPath(): string {
  const cfg = getConfig();
  return resolveDataPath(cfg.thumbnails.hq.cachePath);
}
```

④ `ensureDataDirectories` 的 dirs 数组（~L552-558）里 `getPreviewsPath(),` 后加一行：

```ts
    getHqPath(),                // HQ 高质量图档目录
```

⑤ updateConfig 的 thumbnails 重建（~L1168-1175，preview 块之后）加：

```ts
      hq: {
        cachePath: input.thumbnails?.hq?.cachePath ?? currentConfig.thumbnails.hq.cachePath,
        maxWidth: input.thumbnails?.hq?.maxWidth ?? currentConfig.thumbnails.hq.maxWidth,
        maxHeight: input.thumbnails?.hq?.maxHeight ?? currentConfig.thumbnails.hq.maxHeight,
        quality: input.thumbnails?.hq?.quality ?? currentConfig.thumbnails.hq.quality,
        effort: input.thumbnails?.hq?.effort ?? currentConfig.thumbnails.hq.effort,
      },
```

（旧 config.yaml 缺 hq 段由既有 `deepMergeWithDefaults` 自动填默认，无需额外迁移。）

- [ ] **Step 4: 实现 thumbnailService**

`src/main/services/thumbnailService.ts`：

① import 行（L18）改为：

```ts
import { getConfig, getThumbnailsPath, getPreviewsPath, getHqPath } from './config.js';
```

② `cancelPending`（L93）的两档 targets 扩为三档：

```ts
    const targets = new Set(imagePaths.flatMap((p) => [`thumbnail:${p}`, `preview:${p}`, `hq:${p}`]));
```

③ `type ImageTier = 'thumbnail' | 'preview';`（L337）改为并扩 `getTierCachePath`（替换 L337-354）：

```ts
type ImageTier = 'thumbnail' | 'preview' | 'hq';

type HqFormat = 'jpeg' | 'webp';

/** HQ 档输出格式判定（spec §2.1/D2）：webp 同格式；jpg/jpeg 同格式（jpeg 编码器）；png 与罕见格式转 jpeg。GIF 不进 HQ 管线。 */
function hqTargetFormat(ext: string): HqFormat {
  return ext === '.webp' ? 'webp' : 'jpeg';
}

function hqCacheExt(format: HqFormat): string {
  return format === 'webp' ? '.webp' : '.jpg';
}

/**
 * 计算某档位（缩略图 / 1600px 预览档 / HQ 高质量档）的缓存文件路径。
 * 三档同用 md5(源绝对路径) 命名，各落各目录；thumbnail/preview 扩展名取配置 format（GIF 恒 .gif），
 * hq 扩展名按源格式动态定（同格式压缩，png→.jpg）。
 */
async function getTierCachePath(tier: ImageTier, imagePath: string): Promise<string> {
  const config = getConfig();
  const dir = tier === 'hq' ? getHqPath() : tier === 'preview' ? getPreviewsPath() : getThumbnailsPath();

  await fs.mkdir(dir, { recursive: true });

  const hash = crypto.createHash('md5').update(imagePath).digest('hex');
  const ext = path.extname(imagePath).toLowerCase();
  const cacheExt = tier === 'hq'
    ? hqCacheExt(hqTargetFormat(ext))
    : ext === '.gif'
      ? '.gif'
      : `.${(tier === 'preview' ? config.thumbnails.preview : config.thumbnails).format}`;
  return path.join(dir, `${hash}${cacheExt}`);
}
```

④ 在 `generatePreviewInternal`（L294-335）之后加内部实现：

```ts
/**
 * 生成 HQ 高质量档内部实现（结构镜像 generatePreviewInternal，spec §2.1）：
 * - 同格式压缩：webp→webp q85、jpg/png/罕见格式→jpeg q85（png 转 jpeg 前 flatten 白底，D2）；
 * - GIF 在 generateHq 层直通回源、不进此函数；
 * - 不 emit thumbnail:generated（HQ 档不参与渲染层缩略图缓存）。
 */
async function generateHqInternal(imagePath: string, force: boolean): Promise<ThumbnailResult> {
  try {
    try {
      await fs.access(imagePath);
    } catch {
      return { success: false, error: `原图不存在: ${imagePath}`, missing: true };
    }

    const config = getConfig();
    const hqPath = await getTierCachePath('hq', imagePath);

    if (!force && await thumbnailExists(hqPath)) {
      return { success: true, data: hqPath };
    }

    const { maxWidth, maxHeight, quality } = config.thumbnails.hq;
    const effort = normalizeThumbnailEffort(config.thumbnails.hq.effort);
    const sharpLib = await getSharp();
    const targetFormat = hqTargetFormat(path.extname(imagePath).toLowerCase());

    const sharpInstance = sharpLib(imagePath)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

    if (targetFormat === 'webp') {
      await sharpInstance.webp({ quality, effort }).toFile(hqPath);
    } else {
      // jpeg 无透明通道：png 等带 alpha 的源先 flatten 白底（spec §2.1/D2）；jpg 源 flatten 无副作用
      await sharpInstance.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toFile(hqPath);
    }

    return { success: true, data: hqPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`生成 HQ 档失败 ${imagePath}:`, errorMessage);
    return { success: false, error: errorMessage, missing: isMissingSourceError(errorMessage) };
  }
}
```

⑤ 在 `getPreviewIfExists`/`deletePreview` 之后加导出（结构镜像 generatePreview）：

```ts
/**
 * 生成 HQ 高质量档（手机端镜像同步用，spec §2）。GIF 不转码直通回源。
 * 体积保护（spec §2.1）：每次服务（含缓存命中路径）比较产物与源文件字节数，
 * 产物 ≥ 源文件 → 回源文件路径——「HQ 档体积恒 ≤ 原图」。
 */
export async function generateHq(imagePath: string, force: boolean = false): Promise<ThumbnailResult> {
  if (path.extname(imagePath).toLowerCase() === '.gif') {
    return { success: true, data: imagePath };
  }

  let result: ThumbnailResult;
  if (force) {
    result = await generateHqInternal(imagePath, true);
  } else {
    const cached = await getHqIfExists(imagePath);
    if (cached) {
      result = { success: true, data: cached };
    } else {
      result = await thumbnailQueue.enqueue({
        key: `hq:${imagePath}`,
        imagePath,
        run: () => generateHqInternal(imagePath, false),
        priority: 'foreground',   // HTTP 请求阻塞等待
        notify: false,            // 不发 thumbnail:generated
      });
    }
  }

  if (!result.success || !result.data || result.data === imagePath) {
    return result;
  }
  try {
    const [hqStat, srcStat] = await Promise.all([fs.stat(result.data), fs.stat(imagePath)]);
    if (hqStat.size >= srcStat.size) {
      return { success: true, data: imagePath };
    }
  } catch {
    // stat 失败不阻断：按产物返回（serveBinaryFile 对缺文件自会 404）
  }
  return result;
}

/** 返回已存在的 HQ 档路径；不存在返回 null。GIF 直接回源路径（无 HQ 产物）。 */
export async function getHqIfExists(imagePath: string): Promise<string | null> {
  if (path.extname(imagePath).toLowerCase() === '.gif') {
    return imagePath;
  }
  try {
    const hqPath = await getTierCachePath('hq', imagePath);
    return (await thumbnailExists(hqPath)) ? hqPath : null;
  } catch {
    return null;
  }
}

/** 删除某图片的 HQ 档文件（ENOENT 容忍）。结构镜像 deletePreview。 */
export async function deleteHq(imagePath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const hqPath = await getTierCachePath('hq', imagePath);
    await fs.unlink(hqPath);
    return { success: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
```

- [ ] **Step 5: deleteHq 级联接线（三个服务文件）**

在每处 `deletePreview(...)` 级联调用后追加同形 `deleteHq` 调用，并在各文件 import 里补 `deleteHq`：

- `src/main/services/imageService.ts`（L6 import 补 `deleteHq`；~L348 `await deletePreview(row.filepath).catch(...)` 后加）：

```ts
      await deleteHq(row.filepath).catch(() => undefined);
```

- `src/main/services/galleryService.ts`（~L440 动态 import 解构补 `deleteHq`；~L445 后加）：

```ts
      await deleteHq(orphan.filepath).catch(() => undefined);
```

- `src/main/services/invalidImageService.ts`（L2 import 补 `deleteHq`；~L428 与 ~L464 两处后各加）：

```ts
        await deleteHq(row.filepath).catch(() => undefined);
```

- [ ] **Step 6: 运行测试通过 + 全量回归**

Run: `npm run test:unit -- tests/main/services/thumbnailService.hq.test.ts`
Expected: PASS（8 例全绿）。

Run: `npm run test:unit -- tests/main/services/`
Expected: PASS。注意 `thumbnailService.cancel.test.ts` 若断言 cancelPending 只打 thumbnail/preview 两档 key，按新三档（含 `hq:`）更新断言。

- [ ] **Step 7: typecheck + 提交**

Run: `npm run typecheck` → 无错误。

```bash
git add src/main/services/config.ts src/main/services/thumbnailService.ts src/main/services/imageService.ts src/main/services/galleryService.ts src/main/services/invalidImageService.ts tests/main/services/thumbnailService.hq.test.ts tests/main/services/thumbnailService.cancel.test.ts
git commit -m "feat(thumbnail): 新增 HQ 高质量图档生成——同格式压缩、png 转 jpg 白底、gif 直通、体积保护"
```

---

### Task 2: 桌面端 /hq 路由 + 权限正则 + 覆盖测试

**Files:**
- Modify: `src/main/api/routes/galleryRoutes.ts`（import + createImageBinaryRoutes 第四条路由，插在 /preview 与 /file 之间）
- Modify: `src/main/api/permissions.ts:17`
- Modify: `tests/main/api/routes.serviceGallery.test.ts`（thumbnailService mock 补 generateHq + 新用例）
- Modify: `tests/main/api/permissions.test.ts`、`tests/main/api/endpointCoverage.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `generateHq(imagePath): Promise<ThumbnailResult>`；现有 `serveBinaryFile(context, filePath, msg)`（Content-Type 由 `contentTypeForFile` 按扩展名推断——HQ 产物 .jpg/.webp、体积保护回源时源扩展名，均在 MIME_BY_EXT 表内，天然正确）。
- Produces: `GET /api/v1/images/:imageId/hq` 与（经既有 remapToAppNamespace 自动克隆）`GET /api/app/v1/images/:imageId/hq`（Task 5+ 安卓消费）。

- [ ] **Step 1: 写失败测试**

`tests/main/api/routes.serviceGallery.test.ts`：

① 顶部 import（L9）补 `generateHq`；thumbnailService 的 vi.mock 工厂（~L34-39）补 `generateHq: vi.fn(),`；mocked 常量区（~L62 附近）加 `const mockGenerateHq = vi.mocked(generateHq);`。

② preview 用例区（~L394-416）之后新增两例：

```ts
  it('streams hq image when generation succeeds', async () => {
    mockGetImageById.mockResolvedValue({ success: true, data: image() });
    mockGenerateHq.mockResolvedValue({ success: true, data: 'M:/hq/source.jpg' });
    mockPipeline.mockResolvedValue(undefined);

    const route = findRoute(createImageBinaryRoutes(), '/api/v1/images/:imageId/hq');
    const result = await route.handler(context({ params: { imageId: '34' } }));

    expect(result).toBeUndefined();
    expect(mockGenerateHq).toHaveBeenCalledWith('M:/gallery/cats/cat.jpg');
    expect(mockCreateReadStream).toHaveBeenCalledWith('M:/hq/source.jpg');
  });

  it('maps hq generation missing-source to 404', async () => {
    mockGetImageById.mockResolvedValue({ success: true, data: image() });
    mockGenerateHq.mockResolvedValue({ success: false, error: '原图不存在: x', missing: true });

    const route = findRoute(createImageBinaryRoutes(), '/api/v1/images/:imageId/hq');
    await expect(route.handler(context({ params: { imageId: '34' } })))
      .rejects.toMatchObject({ status: 404 });
  });
```

③ `tests/main/api/permissions.test.ts` 的 imageBinary 用例表（~L11-13）加一行：

```ts
    ['GET', '/api/v1/images/5/hq', 'imageBinary'],
```

④ `tests/main/api/endpointCoverage.test.ts` 两处清单各加（agent 面 ~L18 preview 行后、手机面 ~L69 preview 行后）：

```ts
  ['GET', '/api/v1/images/:imageId/hq'],
```

```ts
  ['GET', '/api/app/v1/images/:imageId/hq'],
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit -- tests/main/api/routes.serviceGallery.test.ts tests/main/api/permissions.test.ts tests/main/api/endpointCoverage.test.ts`
Expected: FAIL——`Missing route: /api/v1/images/:imageId/hq`；permissions 新行 undefined ≠ 'imageBinary'。

- [ ] **Step 3: 实现路由与权限**

`src/main/api/routes/galleryRoutes.ts`：

① L8 import 改为：

```ts
import { generateHq, generatePreview, generateThumbnail } from '../../services/thumbnailService.js';
```

② `createImageBinaryRoutes` 里 preview 路由（L131-144）与 file 路由之间插入：

```ts
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/hq',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const image = unwrapServiceResult(await getImageById(imageId), 'Failed to load image');
        const hqPath = unwrapServiceResult(
          await generateHq(image.filepath),
          'Failed to generate hq image',
        );

        return serveBinaryFile(context, hqPath, 'Failed to stream hq image');
      },
    },
```

`src/main/api/permissions.ts:17` 改为：

```ts
  { method: 'GET', path: /^\/api\/v1\/images\/[^/]+\/(?:thumbnail|preview|hq|file)\/?$/, permissionKey: 'imageBinary' },
```

- [ ] **Step 4: 运行测试通过**

Run: `npm run test:unit -- tests/main/api/`
Expected: PASS（endpointCoverage 同时校验了手机面 remap 克隆）。

- [ ] **Step 5: typecheck + 提交**

Run: `npm run typecheck` → 无错误。

```bash
git add src/main/api/routes/galleryRoutes.ts src/main/api/permissions.ts tests/main/api/routes.serviceGallery.test.ts tests/main/api/permissions.test.ts tests/main/api/endpointCoverage.test.ts
git commit -m "feat(api): 图片二进制新增 /hq 高质量档端点——agent 面与手机面同挂、imageBinary 权限域"
```

---

### Task 3: 安卓 Room v6——image_files 表 + ImageFileDao

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/Entities.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/ImageFileDao.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/AppDatabase.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/db/ImageFileDaoTest.kt`（新建）、同目录 `MigrationTest.kt`（追加用例 + 既有用例迁移链补 5→6）

**Interfaces:**
- Consumes: 现有 AppDatabase（version=5、迁移链 1→5、`build`/`inMemory`）、`ImageEntity`。
- Produces:
  - `ImageFileEntity(serverId: Long, imageId: Long, tier: String, relPath: String, bytes: Long, createdAt: Long)`，表 `image_files`，复合主键 (serverId, imageId)。
  - `ImageFileDao` 方法：`byImageId`、`upsert`、`delete`、`deleteByImageIds`、`byImageIds`、`clearAll`、`allFor`、`observeFor: Flow<List<ImageFileEntity>>`、`missingImageIds(serverId, needOriginal): List<Long>`、`statsFor(serverId): List<TierStat>`、`missingOriginalBytes(serverId): Long?`、`countFor(serverId): Long`。
  - `TierStat(tier: String, count: Long, bytes: Long)`。
  - `AppDatabase.MIGRATION_5_6`、`db.imageFileDao()`。
  - tier 取值约定：`"HQ"` / `"ORIGINAL"`（即 Task 4 `MirrorTier` 的 enum name）。

- [ ] **Step 1: 写失败测试**

新建 `ImageFileDaoTest.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.db

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** image_files 登记表（镜像 spec §3.2）：档位互斥单行、缺失集合查询、统计、serverId 域隔离。 */
@RunWith(RobolectricTestRunner::class)
class ImageFileDaoTest {
    private lateinit var db: AppDatabase
    private lateinit var dao: ImageFileDao

    private fun img(id: Long, size: Long = 1000L) = ImageEntity(
        id = id, filename = "a$id.jpg", width = 10, height = 10,
        fileSize = size, format = "jpg",
        createdAt = "2026-07-0${(id % 9) + 1}T00:00:00.000Z", updatedAt = "2026-07-01T00:00:00.000Z",
    )

    private fun row(serverId: Long, imageId: Long, tier: String, bytes: Long = 100L) =
        ImageFileEntity(serverId, imageId, tier, "s$serverId/i$imageId/a$imageId.jpg", bytes, 1720000000000L)

    @Before
    fun setup() {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = AppDatabase.inMemory(context)
        dao = db.imageFileDao()
    }

    @After
    fun teardown() = db.close()

    @Test
    fun `upsert 同键覆盖——HQ 升 ORIGINAL 为同行 UPDATE`() = runTest {
        dao.upsert(row(1, 1, "HQ"))
        dao.upsert(row(1, 1, "ORIGINAL", bytes = 999L))
        val got = dao.byImageId(1, 1)
        assertEquals("ORIGINAL", got?.tier)
        assertEquals(999L, got?.bytes)
        assertEquals(1L, dao.countFor(1))
    }

    @Test
    fun `missingImageIds needOriginal=false 只报无行的图`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(2), img(3)))
        dao.upsert(row(1, 1, "HQ"))
        dao.upsert(row(1, 2, "ORIGINAL"))
        assertEquals(listOf(3L), dao.missingImageIds(1, needOriginal = false))
    }

    @Test
    fun `missingImageIds needOriginal=true 报无行与 HQ 行的图`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(2), img(3)))
        dao.upsert(row(1, 1, "HQ"))
        dao.upsert(row(1, 2, "ORIGINAL"))
        assertEquals(listOf(1L, 3L), dao.missingImageIds(1, needOriginal = true).sorted())
    }

    @Test
    fun `missingImageIds 按 createdAt 降序——新图优先`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(5)))   // img(5) createdAt 更晚
        assertEquals(listOf(5L, 1L), dao.missingImageIds(1, needOriginal = false))
    }

    @Test
    fun `statsFor 按档位分组统计张数与字节`() = runTest {
        dao.upsert(row(1, 1, "HQ", 100))
        dao.upsert(row(1, 2, "HQ", 200))
        dao.upsert(row(1, 3, "ORIGINAL", 5000))
        val stats = dao.statsFor(1).associateBy { it.tier }
        assertEquals(2L, stats["HQ"]?.count)
        assertEquals(300L, stats["HQ"]?.bytes)
        assertEquals(5000L, stats["ORIGINAL"]?.bytes)
    }

    @Test
    fun `missingOriginalBytes 汇总缺原图的 images fileSize`() = runTest {
        db.imageDao().upsertAll(listOf(img(1, 1000), img(2, 2000), img(3, 4000)))
        dao.upsert(row(1, 2, "ORIGINAL"))   // 2 已有原图；1 无行、3 无行 → 1000+4000
        assertEquals(5000L, dao.missingOriginalBytes(1))
    }

    @Test
    fun `serverId 域隔离——他服行不可见不受删`() = runTest {
        dao.upsert(row(1, 7, "HQ"))
        dao.upsert(row(2, 7, "ORIGINAL"))
        dao.deleteByImageIds(1, listOf(7))
        assertNull(dao.byImageId(1, 7))
        assertEquals("ORIGINAL", dao.byImageId(2, 7)?.tier)
    }
}
```

`MigrationTest.kt` 追加用例（helper 之前），并把**既有用例**的 `.addMigrations(...)` 全部补上 `AppDatabase.MIGRATION_5_6`（否则库版本落后于 schema 版本、打开即抛）：

```kotlin
    @Test
    fun `v5 迁移到 v6 建 image_files 且 downloads 保留`() = runTest {
        createRealV1Database()   // 借 v1 起点走全链 1→6

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(
                AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4,
                AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6,
            )
            .allowMainThreadQueries()
            .build()
        try {
            db.imageFileDao().upsert(ImageFileEntity(1L, 1L, "HQ", "s1/i1/a.jpg", 10L, 0L))
            assertEquals("HQ", db.imageFileDao().byImageId(1L, 1L)?.tier)
            // downloads 表 v6 仍在（v7 收尾任务才删）
            db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'", null)
                .use { assertTrue(it.moveToFirst()) }
        } finally {
            db.close()
        }
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——`ImageFileEntity` / `imageFileDao` 未定义（编译失败即本步「失败」）。

- [ ] **Step 3: 实现 Entity + DAO + 迁移**

`Entities.kt` 尾部（AlbumPrefsEntity 之后）加：

```kotlin
/**
 * 图片镜像登记表（镜像 spec §3.2）：每图一行、档位互斥（tier=HQ|ORIGINAL，MirrorTier.name）；
 * HQ→原图升级 = 同行 UPDATE。不建外键（同 album_prefs 理由：images 全量对账可能整表重写，
 * FK CASCADE 会误清登记；孤儿由对账后清理收口）。relPath 相对 mirror 根（如 "s1/i42/foo.jpg"）。
 */
@Entity(tableName = "image_files", primaryKeys = ["serverId", "imageId"])
data class ImageFileEntity(
    val serverId: Long,
    val imageId: Long,
    val tier: String,
    val relPath: String,
    val bytes: Long,
    val createdAt: Long,   // epoch ms
)
```

新建 `ImageFileDao.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** 镜像登记 DAO（spec §3.2）：全部查询带 serverId 域（多服务器同号 imageId 互不污染，对齐 DownloadDao 惯例）。 */
@Dao
interface ImageFileDao {
    @Query("SELECT * FROM image_files WHERE serverId = :serverId AND imageId = :imageId")
    suspend fun byImageId(serverId: Long, imageId: Long): ImageFileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ImageFileEntity)

    @Query("DELETE FROM image_files WHERE serverId = :serverId AND imageId = :imageId")
    suspend fun delete(serverId: Long, imageId: Long)

    /** 对账删除级联：serverId 域内清行（调用方负责删对应镜像目录）。 */
    @Query("DELETE FROM image_files WHERE serverId = :serverId AND imageId IN (:imageIds)")
    suspend fun deleteByImageIds(serverId: Long, imageIds: List<Long>)

    @Query("SELECT * FROM image_files WHERE serverId = :serverId AND imageId IN (:imageIds)")
    suspend fun byImageIds(serverId: Long, imageIds: List<Long>): List<ImageFileEntity>

    /** clearMirror 用：镜像身份失效即全清（对齐 DownloadDao.clearAll 语义）。 */
    @Query("DELETE FROM image_files")
    suspend fun clearAll()

    /** 启动孤儿清扫用：本服全量行（登记 vs 磁盘互查）。 */
    @Query("SELECT * FROM image_files WHERE serverId = :serverId")
    suspend fun allFor(serverId: Long): List<ImageFileEntity>

    /** 大图页/分享同步判断用：本服全量行 Flow（收集成 map，对齐 downloads observeDownloaded 用法）。 */
    @Query("SELECT * FROM image_files WHERE serverId = :serverId")
    fun observeFor(serverId: Long): Flow<List<ImageFileEntity>>

    /**
     * 同步缺失集合（spec §3.4-2）：无登记行的图恒缺；needOriginal=true 时 HQ 行也算缺
     * （原图模式要补原图）。按 createdAt 降序——新图优先，用户先看得到。
     */
    @Query("""SELECT i.id FROM images i
              LEFT JOIN image_files f ON f.serverId = :serverId AND f.imageId = i.id
              WHERE f.imageId IS NULL OR (:needOriginal AND f.tier = 'HQ')
              ORDER BY i.createdAt DESC, i.id DESC""")
    suspend fun missingImageIds(serverId: Long, needOriginal: Boolean): List<Long>

    /** 存储页统计（spec §5.2）：按档位分组张数/字节。 */
    @Query("""SELECT tier AS tier, COUNT(*) AS count, SUM(bytes) AS bytes
              FROM image_files WHERE serverId = :serverId GROUP BY tier""")
    suspend fun statsFor(serverId: Long): List<TierStat>

    /** 切原图模式预估补量（spec §4.5）：缺原图的 images.fileSize 总和（空集 SUM 为 NULL）。 */
    @Query("""SELECT SUM(i.fileSize) FROM images i
              LEFT JOIN image_files f ON f.serverId = :serverId AND f.imageId = i.id
              WHERE f.imageId IS NULL OR f.tier = 'HQ'""")
    suspend fun missingOriginalBytes(serverId: Long): Long?

    @Query("SELECT COUNT(*) FROM image_files WHERE serverId = :serverId")
    suspend fun countFor(serverId: Long): Long
}

/** [ImageFileDao.statsFor] 投影：档位聚合（存储页「高质量 n 张 xx MB / 原图 n 张 xx GB」）。 */
data class TierStat(val tier: String, val count: Long, val bytes: Long)
```

`AppDatabase.kt`：entities 数组加 `ImageFileEntity::class`；version 5→6；抽象方法区加 `abstract fun imageFileDao(): ImageFileDao`；companion 里 MIGRATION_4_5 之后加：

```kotlin
        // v5→6（镜像层 spec §3.2）：新建 image_files 登记表。downloads 表暂保留——计划期两步走，
        // 下载/分享链路逐任务切换期间新旧表并存可编译可测；v7（收尾任务）再 DROP。
        val MIGRATION_5_6 = object : androidx.room.migration.Migration(5, 6) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `image_files` (`serverId` INTEGER NOT NULL, " +
                        "`imageId` INTEGER NOT NULL, `tier` TEXT NOT NULL, `relPath` TEXT NOT NULL, " +
                        "`bytes` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`serverId`, `imageId`))"
                )
            }
        }
```

`build` 的迁移链改为：

```kotlin
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
```

- [ ] **Step 4: 运行测试通过**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "com.bluskysoftware.yandegallery.data.db.ImageFileDaoTest" --tests "com.bluskysoftware.yandegallery.data.db.MigrationTest"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/ android/app/src/test/java/com/bluskysoftware/yandegallery/data/db/
git commit -m "feat(android): Room v6 新增 image_files 镜像登记表与 ImageFileDao"
```

---

### Task 4: 安卓镜像层核心——MirrorModels + ImageMirrorStore + downloadHq

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/mirror/MirrorModels.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/mirror/ImageMirrorStore.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/api/DesktopApi.kt`（downloadHq）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/api/ApiClientFactory.kt:16`（BINARY_PATH 加 hq）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/mirror/MirrorModelsTest.kt`、`ImageMirrorStoreTest.kt`（新建）；`data/api/ApiClientTest.kt`（追加 hq 路径用例）

**Interfaces:**
- Consumes: Task 3 的 `ImageFileDao`/`ImageFileEntity`；现有 `DesktopApi.downloadOriginal`、`ApiClientFactory.okHttp`（错误映射拦截器：非 2xx 抛 `ApiException(httpStatus)`、空体二进制抛错）、`ImageDao.byId`。
- Produces:
  - `enum class MirrorTier { HQ, ORIGINAL }`、`data class LocalImage(val tier: MirrorTier, val file: File)`、`data class MirrorStats(hqCount, hqBytes, originalCount, originalBytes: Long)`。
  - `fun sanitizeFilename(name: String): String`、`fun hqFilename(originalFilename: String, contentType: String?): String`、`fun mirrorTierOf(name: String?): MirrorTier`（非法收敛 HQ）。
  - `class ImageMirrorStore(rootDir: File, imageFileDao, imageDao, apiProvider: suspend () -> DesktopApi?, activeServerId: suspend () -> Long?, nowMs: () -> Long = ..., freeBytes: () -> Long = ...)`：
    - `suspend fun ensure(serverId, imageId, tier: MirrorTier): Result<File>`
    - `suspend fun localFile(serverId, imageId): LocalImage?`
    - `fun fileOf(row: ImageFileEntity): File`
    - `suspend fun stats(serverId): MirrorStats`
    - `suspend fun deleteDirs(serverId, imageIds: List<Long>)`（纯文件系统，目录名由 id 可导出，不查行）
    - `fun clearAllFiles()`（删 mirror 根下所有内容；行清理归 RoomMirrorStore）
    - `suspend fun sweepOrphans(serverId)`（无行目录删除；有行无文件的行删除）
    - `class DiskFullException : Exception`；`companion { const val MIN_FREE_BYTES = 500L * 1024 * 1024 }`
  - `DesktopApi.downloadHq(imageId): Response<ResponseBody>`（@Streaming GET .../hq）。

- [ ] **Step 1: 写失败测试（模型层，纯 JVM）**

新建 `MirrorModelsTest.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.mirror

import org.junit.Assert.assertEquals
import org.junit.Test

/** 镜像文件名规则（spec §3.1）：非法字符清洗、HQ 扩展名按 Content-Type、tier 解析收敛。 */
class MirrorModelsTest {
    @Test
    fun `sanitizeFilename 清洗安卓非法字符为下划线`() {
        assertEquals("a_b_c_d_e_f_g_h_i_.jpg", sanitizeFilename("""a\b/c:d*e?f"g<h>i|.jpg"""))
    }

    @Test
    fun `hqFilename png 源 jpeg 响应 → 主名不变扩展名 jpg`() {
        assertEquals("foo.jpg", hqFilename("foo.png", "image/jpeg"))
    }

    @Test
    fun `hqFilename webp 响应保持 webp；gif 直通保持 gif`() {
        assertEquals("bar.webp", hqFilename("bar.webp", "image/webp"))
        assertEquals("anim.gif", hqFilename("anim.gif", "image/gif"))
    }

    @Test
    fun `hqFilename 体积保护回退原图 → Content-Type 即原格式，拼回原名`() {
        assertEquals("tiny.png", hqFilename("tiny.png", "image/png"))
    }

    @Test
    fun `hqFilename 未知 Content-Type 回退原扩展名；无扩展名回退 bin`() {
        assertEquals("x.png", hqFilename("x.png", null))
        assertEquals("noext.bin", hqFilename("noext", "application/octet-stream"))
    }

    @Test
    fun `mirrorTierOf 非法与 null 收敛 HQ`() {
        assertEquals(MirrorTier.HQ, mirrorTierOf(null))
        assertEquals(MirrorTier.HQ, mirrorTierOf("bogus"))
        assertEquals(MirrorTier.ORIGINAL, mirrorTierOf("ORIGINAL"))
    }
}
```

新建 `ImageMirrorStoreTest.kt`（对齐 DownloadWorkerTest 惯例：Robolectric + in-memory Room + MockWebServer + **真实 ApiClientFactory 客户端**——404 必须经错误映射拦截器变 ApiException，fake 直返 404 Response 测的是死代码）：

```kotlin
package com.bluskysoftware.yandegallery.data.mirror

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class ImageMirrorStoreTest {
    private lateinit var db: AppDatabase
    private lateinit var server: MockWebServer
    private lateinit var api: DesktopApi
    private lateinit var root: File
    private var activeId: Long = 1L
    private var free: Long = Long.MAX_VALUE

    private fun store() = ImageMirrorStore(
        rootDir = root,
        imageFileDao = db.imageFileDao(),
        imageDao = db.imageDao(),
        apiProvider = { api },
        activeServerId = { activeId },
        nowMs = { 1720000000000L },
        freeBytes = { free },
    )

    @Before
    fun setup() = runTest {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = AppDatabase.inMemory(context)
        db.imageDao().upsertAll(listOf(
            ImageEntity(42, "foo.png", 10, 10, 1000, "png", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
        ))
        server = MockWebServer().apply { start() }
        api = ApiClientFactory.desktopApi(server.url("/").toString(), ApiClientFactory.okHttp({ "k" }))
        root = File(context.cacheDir, "mirror-test-${System.nanoTime()}").apply { mkdirs() }
        activeId = 1L
        free = Long.MAX_VALUE
    }

    @After
    fun teardown() {
        db.close(); server.shutdown(); root.deleteRecursively()
    }

    private fun okBody(bytes: ByteArray, type: String) = MockResponse()
        .setHeader("Content-Type", type)
        .setBody(okio.Buffer().write(bytes))

    @Test
    fun `ensure HQ 成功——png 源 jpeg 产物落 foo_jpg 并登记 HQ 行`() = runTest {
        val payload = ByteArray(64) { it.toByte() }
        server.enqueue(okBody(payload, "image/jpeg"))
        val result = store().ensure(1, 42, MirrorTier.HQ)
        val file = result.getOrThrow()
        assertEquals("foo.jpg", file.name)
        assertTrue(file.readBytes().contentEquals(payload))
        val row = db.imageFileDao().byImageId(1, 42)!!
        assertEquals("HQ", row.tier)
        assertEquals("s1/i42/foo.jpg", row.relPath)
        assertEquals(64L, row.bytes)
        assertEquals("/api/app/v1/images/42/hq", server.takeRequest().path)
    }

    @Test
    fun `ensure ORIGINAL 覆盖 HQ——旧 HQ 文件删除 行升 ORIGINAL`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        store().ensure(1, 42, MirrorTier.HQ)
        server.enqueue(okBody(ByteArray(16), "image/png"))
        val file = store().ensure(1, 42, MirrorTier.ORIGINAL).getOrThrow()
        assertEquals("foo.png", file.name)
        assertFalse(File(file.parentFile, "foo.jpg").exists())   // 同目录旧 HQ 已清
        assertEquals("ORIGINAL", db.imageFileDao().byImageId(1, 42)?.tier)
        assertEquals(2, server.requestCount)
        assertEquals("/api/app/v1/images/42/hq", server.takeRequest().path)
        assertEquals("/api/app/v1/images/42/file", server.takeRequest().path)
    }

    @Test
    fun `已有 ORIGINAL 请求 HQ——零网络直接返回原图（D7）`() = runTest {
        server.enqueue(okBody(ByteArray(16), "image/png"))
        store().ensure(1, 42, MirrorTier.ORIGINAL)
        val file = store().ensure(1, 42, MirrorTier.HQ).getOrThrow()
        assertEquals("foo.png", file.name)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `Content-Length 不符——失败且无 part 残留无行`() = runTest {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "image/jpeg")
                .setBody(okio.Buffer().write(ByteArray(8)))
                .setHeader("Content-Length", "999")
                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AT_END),
        )
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertTrue(result.isFailure)
        assertNull(db.imageFileDao().byImageId(1, 42))
        assertTrue(File(root, "s1/i42").listFiles().orEmpty().isEmpty())
    }

    @Test
    fun `404——失败携带 ApiException httpStatus 404（同步 worker 计数依据）`() = runTest {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"success":false}"""))
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertEquals(404, (result.exceptionOrNull() as? ApiException)?.httpStatus)
        assertNull(db.imageFileDao().byImageId(1, 42))
    }

    @Test
    fun `跨切服拦截——落行前 activeServerId 变化即丢弃产物`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        activeId = 2L   // 下载完成时已切服
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertTrue(result.isFailure)
        assertNull(db.imageFileDao().byImageId(1, 42))
        assertTrue(File(root, "s1/i42").listFiles().orEmpty().isEmpty())
    }

    @Test
    fun `磁盘不足——DiskFullException 不发网络请求`() = runTest {
        free = 0L
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertTrue(result.exceptionOrNull() is ImageMirrorStore.DiskFullException)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `并发同图 ensure——Mutex 收敛为单次下载`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        val s = store()
        coroutineScope {
            val a = async { s.ensure(1, 42, MirrorTier.HQ) }
            val b = async { s.ensure(1, 42, MirrorTier.HQ) }
            assertTrue(a.await().isSuccess)
            assertTrue(b.await().isSuccess)
        }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `localFile 行在文件亡返回 null；stats 分档聚合；sweepOrphans 双向清理`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        val s = store()
        s.ensure(1, 42, MirrorTier.HQ)
        assertEquals(MirrorTier.HQ, s.localFile(1, 42)?.tier)
        val stats = s.stats(1)
        assertEquals(1L, stats.hqCount)
        assertEquals(8L, stats.hqBytes)
        // 孤儿目录（无行）+ 行在文件亡
        File(root, "s1/i999").apply { mkdirs(); File(this, "x.jpg").writeBytes(ByteArray(1)) }
        File(root, "s1/i42/foo.jpg").delete()
        s.sweepOrphans(1)
        assertFalse(File(root, "s1/i999").exists())
        assertNull(db.imageFileDao().byImageId(1, 42))
        assertNull(s.localFile(1, 42))
    }
}
```

`ApiClientTest.kt` 追加（对齐既有二进制路径用例写法——若该文件用 MockWebServer 驱动拦截器，仿照 thumbnail/file 的 404-nudge 用例）：

```kotlin
    @Test
    fun `hq 路径 404 触发 onBinaryNotFound 对账 nudge`() = runTest {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"success":false}"""))
        var nudged = false
        val api = ApiClientFactory.desktopApi(
            server.url("/").toString(),
            ApiClientFactory.okHttp({ "k" }, onBinaryNotFound = { nudged = true }),
        )
        runCatching { api.downloadHq(1) }
        assertTrue(nudged)
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——`MirrorTier`/`ImageMirrorStore`/`downloadHq` 未定义。

- [ ] **Step 3: 实现 DesktopApi + BINARY_PATH**

`DesktopApi.kt` 的 `downloadOriginal`（L81-86）之后加：

```kotlin
    // HQ 高质量图流式下载（镜像 spec §2.3/§3.3）：@Streaming 同 downloadOriginal；
    // Content-Type 决定落盘扩展名（png→jpg / 体积保护回退原格式）。
    @Streaming
    @GET("$APP_API_PATH/images/{imageId}/hq")
    suspend fun downloadHq(@Path("imageId") imageId: Long): Response<ResponseBody>
```

`ApiClientFactory.kt:16` 改为：

```kotlin
    private val BINARY_PATH = Regex("""/$APP_API_PATH/images/\d+/(thumbnail|preview|hq|file)/?$""")
```

- [ ] **Step 4: 实现 MirrorModels.kt**

```kotlin
package com.bluskysoftware.yandegallery.data.mirror

import java.io.File

/** 镜像档位（spec §3.2）：HQ 高质量图 / ORIGINAL 原图；Room image_files.tier 存 enum name。 */
enum class MirrorTier { HQ, ORIGINAL }

/** tier 字符串解析（DataStore/DB 读侧共用）：非法/null 收敛 HQ（对齐仓内 enum name 存法惯例）。 */
fun mirrorTierOf(name: String?): MirrorTier =
    runCatching { MirrorTier.valueOf(name ?: "") }.getOrDefault(MirrorTier.HQ)

/** 本地镜像查询结果：档位 + 落盘文件（存在性已由查询方校验）。 */
data class LocalImage(val tier: MirrorTier, val file: File)

/** 存储页统计（spec §5.2）：高质量/原图分列张数与字节。 */
data class MirrorStats(
    val hqCount: Long = 0,
    val hqBytes: Long = 0,
    val originalCount: Long = 0,
    val originalBytes: Long = 0,
)

/** 安卓文件名非法字符清洗（spec §3.1）：`\ / : * ? " < > |` → `_`。 */
fun sanitizeFilename(name: String): String = name.replace(Regex("""[\\/:*?"<>|]"""), "_")

/** Content-Type → 扩展名；未知/缺失回退 fallbackExt（体积保护回退原图时 Content-Type 即原格式）。 */
private fun extensionForContentType(contentType: String?, fallbackExt: String): String = when {
    contentType == null -> fallbackExt
    contentType.startsWith("image/jpeg") -> "jpg"
    contentType.startsWith("image/webp") -> "webp"
    contentType.startsWith("image/png") -> "png"
    contentType.startsWith("image/gif") -> "gif"
    contentType.startsWith("image/bmp") -> "bmp"
    contentType.startsWith("image/avif") -> "avif"
    else -> fallbackExt
}

/**
 * HQ 档落盘文件名（spec §3.1）：原主文件名 + 实际格式扩展名（foo.png + image/jpeg → foo.jpg）。
 * 无扩展名的原名回退 "bin" 再由 Content-Type 覆盖。
 */
fun hqFilename(originalFilename: String, contentType: String?): String {
    val main = originalFilename.substringBeforeLast('.', originalFilename)
    val fallbackExt = originalFilename.substringAfterLast('.', "bin")
    return sanitizeFilename("$main.${extensionForContentType(contentType, fallbackExt)}")
}
```

- [ ] **Step 5: 实现 ImageMirrorStore.kt**

```kotlin
package com.bluskysoftware.yandegallery.data.mirror

import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.ImageDao
import com.bluskysoftware.yandegallery.data.db.ImageFileDao
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * 图片镜像层唯一写入口（spec §3.3；类名带 Image 前缀区分 domain.sync.MirrorStore 元数据镜像接口）。
 * - [ensure] 幂等：per-key Mutex 防同图并发双下；`*.part` 临时写 + Content-Length 校验 + 原子
 *   rename（镜像目录永无可见半截文件，spec §6）；落定后清同目录其余文件（HQ→原图替换由此实现）；
 *   落行前校验 serverId 仍为激活服务器（跨切服拦截，沿用旧 DownloadWorker 先例）。
 * - 已有 ORIGINAL 时请求 HQ 直接返回现有文件（D7 原图始终保留）。
 * - 404/断网等异常包进 Result.failure 原样保留（同步 worker 按 ApiException.httpStatus 分流）。
 */
class ImageMirrorStore(
    private val rootDir: File,
    private val imageFileDao: ImageFileDao,
    private val imageDao: ImageDao,
    private val apiProvider: suspend () -> DesktopApi?,
    private val activeServerId: suspend () -> Long?,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val freeBytes: () -> Long = { rootDir.usableSpace },
) {
    private val locks = ConcurrentHashMap<String, Mutex>()

    class DiskFullException : Exception("存储空间不足")

    suspend fun ensure(serverId: Long, imageId: Long, tier: MirrorTier): Result<File> =
        locks.getOrPut("s$serverId:i$imageId") { Mutex() }.withLock {
            withContext(Dispatchers.IO) { ensureLocked(serverId, imageId, tier) }
        }

    private suspend fun ensureLocked(serverId: Long, imageId: Long, tier: MirrorTier): Result<File> {
        // 命中判定：ORIGINAL 行满足任何请求；HQ 行满足 HQ 请求；行在文件亡视为未命中（重下自愈）
        val row = imageFileDao.byImageId(serverId, imageId)
        if (row != null) {
            val existing = fileOf(row)
            if (existing.isFile && existing.length() > 0 &&
                (row.tier == MirrorTier.ORIGINAL.name || tier == MirrorTier.HQ)
            ) return Result.success(existing)
        }

        if (freeBytes() < MIN_FREE_BYTES) return Result.failure(DiskFullException())
        val api = apiProvider() ?: return Result.failure(IllegalStateException("无激活服务器"))
        val entity = imageDao.byId(imageId)
            ?: return Result.failure(IllegalStateException("图片元数据不存在: $imageId"))

        // 错误映射拦截器对非 2xx 先抛 ApiException（404 永远拿不到 Response）——异常原样进 failure
        val response = try {
            if (tier == MirrorTier.ORIGINAL) api.downloadOriginal(imageId) else api.downloadHq(imageId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return Result.failure(e)
        }
        val body = response.body() ?: return Result.failure(IOException("空响应体"))

        return body.use {
            val contentType = body.contentType()?.toString()
            val filename = if (tier == MirrorTier.ORIGINAL) sanitizeFilename(entity.filename)
            else hqFilename(entity.filename, contentType)
            val dir = File(rootDir, "s$serverId/i$imageId").apply { mkdirs() }
            val target = File(dir, filename)
            val part = File(dir, "$filename.part")
            val expected = body.contentLength()
            var written = 0L
            try {
                part.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            out.write(buf, 0, n); written += n
                        }
                    }
                }
            } catch (e: CancellationException) {
                part.delete(); throw e   // 取消不吞：清半成品再重抛
            } catch (e: Exception) {
                part.delete(); return Result.failure(e)
            }
            if (expected >= 0 && written != expected) {
                part.delete(); return Result.failure(IOException("尺寸不符: 期望 $expected 实收 $written"))
            }
            if (written == 0L) {
                part.delete(); return Result.failure(IOException("空的图片响应"))
            }
            // 跨切服拦截（spec §6）：下载期间切服 → 本产物属旧服域，丢弃不落行
            if (activeServerId() != serverId) {
                part.delete(); return Result.failure(IllegalStateException("服务器已切换，丢弃产物"))
            }
            if (!part.renameTo(target)) {
                part.delete(); return Result.failure(IOException("落盘改名失败"))
            }
            // 清同目录其余文件：HQ→原图替换（含 png 异名 foo.jpg→foo.png）、历史残骸
            dir.listFiles()?.forEach { if (it != target) it.delete() }
            imageFileDao.upsert(
                ImageFileEntity(serverId, imageId, tier.name, "s$serverId/i$imageId/$filename", written, nowMs()),
            )
            Result.success(target)
        }
    }

    /** 本地现状（分享/大图/缩略图回退判断用）：行在文件亡返回 null（下轮同步自愈）。 */
    suspend fun localFile(serverId: Long, imageId: Long): LocalImage? {
        val row = imageFileDao.byImageId(serverId, imageId) ?: return null
        val file = fileOf(row)
        if (!file.isFile || file.length() == 0L) return null
        return LocalImage(mirrorTierOf(row.tier), file)
    }

    fun fileOf(row: ImageFileEntity): File = File(rootDir, row.relPath)

    suspend fun stats(serverId: Long): MirrorStats {
        var s = MirrorStats()
        for (t in imageFileDao.statsFor(serverId)) {
            s = when (t.tier) {
                MirrorTier.HQ.name -> s.copy(hqCount = t.count, hqBytes = t.bytes)
                MirrorTier.ORIGINAL.name -> s.copy(originalCount = t.count, originalBytes = t.bytes)
                else -> s
            }
        }
        return s
    }

    /** 对账删除级联（RoomMirrorStore.deleteImages 事务外调用）：目录名由 id 可导出，不查行。 */
    suspend fun deleteDirs(serverId: Long, imageIds: List<Long>) = withContext(Dispatchers.IO) {
        imageIds.forEach { File(rootDir, "s$serverId/i$it").deleteRecursively() }
    }

    /** 镜像身份失效（clearMirror 事务外调用）：整棵 mirror/ 内容删除；行清理归 RoomMirrorStore。 */
    fun clearAllFiles() {
        rootDir.listFiles()?.forEach { it.deleteRecursively() }
    }

    /** 启动孤儿清扫（spec §3.4）：无行目录删除；有行无文件的行删除（下轮同步自动补）。 */
    suspend fun sweepOrphans(serverId: Long) = withContext(Dispatchers.IO) {
        val rows = imageFileDao.allFor(serverId).associateBy { it.imageId }
        File(rootDir, "s$serverId").listFiles()?.forEach { dir ->
            val id = dir.name.removePrefix("i").toLongOrNull()
            if (id == null || rows[id] == null) dir.deleteRecursively()
        }
        for ((id, row) in rows) {
            if (!fileOf(row).isFile || fileOf(row).length() == 0L) imageFileDao.delete(serverId, id)
        }
    }

    companion object {
        /** 磁盘可用空间阈值（spec §3.4-5/§6）。 */
        const val MIN_FREE_BYTES = 500L * 1024 * 1024
    }
}
```

- [ ] **Step 6: 运行测试通过**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "com.bluskysoftware.yandegallery.data.mirror.*" --tests "com.bluskysoftware.yandegallery.data.api.ApiClientTest"`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/mirror/ android/app/src/main/java/com/bluskysoftware/yandegallery/data/api/ android/app/src/test/java/com/bluskysoftware/yandegallery/data/mirror/ android/app/src/test/java/com/bluskysoftware/yandegallery/data/api/
git commit -m "feat(android): 图片镜像层核心 ImageMirrorStore——part 原子落盘、档位规则、跨切服拦截、downloadHq 接口"
```

---

### Task 5: 镜像同步——Worker/Manager/Monitor + 同步总线接线 + 对账级联

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/mirror/MirrorSyncMonitor.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/mirror/MirrorSyncManager.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/mirror/MirrorSyncWorker.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/DownloadNotifier.kt`（追加 MirrorSyncNotifier）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/prefs/PrefsStore.kt`（两新键）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/sync/SyncScheduler.kt`（onSyncSuccess 钩子）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/repo/RoomMirrorStore.kt`（image_files 级联）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`、`domain/download/AppWorkerFactory.kt`、`YandeGalleryApp.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/mirror/MirrorSyncWorkerTest.kt`（新建）；`domain/sync/SyncSchedulerTest.kt`、`data/repo/RoomMirrorStoreTest.kt`、`data/prefs/PrefsStoreTest.kt`（追加用例）

**Interfaces:**
- Consumes: Task 3 `ImageFileDao.missingImageIds`；Task 4 `ImageMirrorStore.ensure/deleteDirs/clearAllFiles/sweepOrphans`、`MirrorTier`、`mirrorTierOf`、`DiskFullException`；现有 `ApiException.httpStatus`、`SyncScheduler`、`AppWorkerFactory`、`shouldUpdateNotification`。
- Produces:
  - `MirrorSyncMonitor`：`enum MirrorSyncError { SERVER_TOO_OLD, DISK_FULL, NETWORK }`；`data class MirrorSyncState(running: Boolean, done: Long, total: Long, error: MirrorSyncError?)`；`val state: StateFlow<MirrorSyncState>`；`fun start(total)`/`progress(done, total)`/`finish(error: MirrorSyncError? = null)`。
  - `MirrorSyncManager(context)`：`fun requestSync(serverId, allowCellular: Boolean, replace: Boolean = false)`、`fun cancel(serverId)`（唯一工作名 `mirror-sync-{serverId}`）。
  - `MirrorSyncWorker`：构造 `(context, params, ensure: suspend (Long, Long, MirrorTier) -> Result<File>, imageFileDao, saveMode: suspend () -> MirrorTier, activeServerId: suspend () -> Long?, monitor, notifier: MirrorSyncNotifier, timeMs: () -> Long = ...)`；`KEY_SERVER_ID = "serverId"`；常量 `PROBE_COUNT = 5`、`CONCURRENCY = 3`。
  - `MirrorSyncNotifier`：`fun ensureChannel()`、`fun foregroundInfo(done: Long, total: Long): ForegroundInfo`；实现 `AndroidMirrorSyncNotifier`（CHANNEL_ID `"mirror_sync"`，通知 id `0x4D53`）。
  - `PrefsStore`：`imageSaveModeName: Flow<String?>`/`setImageSaveModeName(name)`（键 `image_save_mode`）、`mirrorSyncCellular: Flow<Boolean>`/`setMirrorSyncCellular(Boolean)`（键 `mirror_sync_cellular` 默认 false）。
  - `SyncScheduler` 构造新增 `onSyncSuccess: (() -> Unit)? = null`（成功一轮后调用）。
  - `AppGraph`：`imageMirrorStore`、`mirrorSyncMonitor`、`mirrorSyncManager` 单例 + `fun requestMirrorSync(replace: Boolean = false)`（读偏好后入队，Task 10 设置页复用）。

- [ ] **Step 1: 写失败测试**

新建 `MirrorSyncWorkerTest.kt`：

```kotlin
package com.bluskysoftware.yandegallery.domain.mirror

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class MirrorSyncWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private val monitor = MirrorSyncMonitor()

    /** no-op 通知 fake：worker 通知路径 runCatching 包裹，测试不触真通知服务。 */
    private val noopNotifier = object : MirrorSyncNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(done: Long, total: Long) = throw IllegalStateException("测试不升前台")
    }

    @Before
    fun setup() = runTest {
        db = AppDatabase.inMemory(context)
        db.imageDao().upsertAll((1L..8L).map {
            ImageEntity(it, "a$it.jpg", 1, 1, 100, "jpg", "2026-07-01T00:00:0$it.000Z", "")
        })
    }

    @After
    fun teardown() = db.close()

    private fun worker(
        ensure: suspend (Long, Long, MirrorTier) -> Result<File>,
        mode: MirrorTier = MirrorTier.HQ,
        activeId: Long? = 1L,
    ): MirrorSyncWorker =
        TestListenableWorkerBuilder<MirrorSyncWorker>(context)
            .setInputData(workDataOf(MirrorSyncWorker.KEY_SERVER_ID to 1L))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    MirrorSyncWorker(
                        c, p,
                        ensure = ensure,
                        imageFileDao = db.imageFileDao(),
                        saveMode = { mode },
                        activeServerId = { activeId },
                        monitor = monitor,
                        notifier = noopNotifier,
                    )
            })
            .build() as MirrorSyncWorker

    @Test
    fun `全部成功 → success，monitor 走到 done==total`() = runTest {
        val w = worker(ensure = { _, _, _ -> Result.success(File("x")) })
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(8L, monitor.state.value.done)
        assertEquals(false, monitor.state.value.running)
    }

    @Test
    fun `HQ 模式前 5 张全 404 → 中止置 SERVER_TOO_OLD（spec §3_4-4）`() = runTest {
        val w = worker(ensure = { _, _, _ ->
            Result.failure(ApiException("NOT_FOUND", "x", 404))
        })
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
        assertEquals(MirrorSyncMonitor.MirrorSyncError.SERVER_TOO_OLD, monitor.state.value.error)
    }

    @Test
    fun `ORIGINAL 模式全 404 → 只按单图跳过，success 不误判旧桌面`() = runTest {
        val w = worker(
            ensure = { _, _, _ -> Result.failure(ApiException("NOT_FOUND", "x", 404)) },
            mode = MirrorTier.ORIGINAL,
        )
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(null, monitor.state.value.error)
    }

    @Test
    fun `网络错误 → retry（退避重试）`() = runTest {
        var calls = 0
        val w = worker(ensure = { _, _, _ ->
            calls++
            if (calls <= 2) Result.failure(java.io.IOException("网络中断")) else Result.success(File("x"))
        })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
    }

    @Test
    fun `磁盘不足 → retry 且置 DISK_FULL`() = runTest {
        val w = worker(ensure = { _, _, _ -> Result.failure(ImageMirrorStore.DiskFullException()) })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals(MirrorSyncMonitor.MirrorSyncError.DISK_FULL, monitor.state.value.error)
    }

    @Test
    fun `陈旧任务（serverId 非激活）→ 直接 success 不跑`() = runTest {
        var called = false
        val w = worker(ensure = { _, _, _ -> called = true; Result.success(File("x")) }, activeId = 2L)
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(false, called)
    }

    @Test
    fun `缺失集合为空 → 立即 success`() = runTest {
        db.imageFileDao().let { dao ->
            (1L..8L).forEach {
                dao.upsert(com.bluskysoftware.yandegallery.data.db.ImageFileEntity(1, it, "HQ", "s1/i$it/a.jpg", 1, 0))
            }
        }
        var called = false
        val w = worker(ensure = { _, _, _ -> called = true; Result.success(File("x")) })
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(false, called)
    }
}
```

`SyncSchedulerTest.kt` 追加用例（构造参数尾部传 `onSyncSuccess`，仿既有 fake 写法）：

```kotlin
    @Test
    fun `同步成功触发 onSyncSuccess，失败不触发`() = runTest {
        var hooked = 0
        // 成功一轮
        val ok = SyncScheduler(
            syncRun = { SyncOutcome(fullRebuild = false, upserted = 0, deleted = 0) },
            monitor = monitor, scope = backgroundScope, hadMirrorBefore = { true },
            onSyncSuccess = { hooked++ },
        )
        ok.requestSync("test")
        testScheduler.advanceUntilIdle()
        assertEquals(1, hooked)
        // 失败一轮
        val bad = SyncScheduler(
            syncRun = { throw RuntimeException("boom") },
            monitor = monitor, scope = backgroundScope, hadMirrorBefore = { true },
            onSyncSuccess = { hooked++ },
        )
        bad.requestSync("test")
        testScheduler.advanceUntilIdle()
        assertEquals(1, hooked)
    }
```

（`monitor`/`backgroundScope` 沿用该测试文件既有夹具；若夹具命名不同按现文件对齐。）

`RoomMirrorStoreTest.kt` 追加两用例：

```kotlin
    @Test
    fun `clearMirror 清空 image_files 并回调 clearMirrorFiles`() = runTest {
        var cleared = false
        val store = RoomMirrorStore(db, clearMirrorFiles = { cleared = true })
        db.imageFileDao().upsert(ImageFileEntity(1, 1, "HQ", "s1/i1/a.jpg", 1, 0))
        store.clearMirror()
        assertEquals(0L, db.imageFileDao().countFor(1))
        assertTrue(cleared)
    }

    @Test
    fun `deleteImages 级联清 image_files 行并回调 removeMirrorFiles`() = runTest {
        val removed = mutableListOf<Long>()
        val store = RoomMirrorStore(
            db,
            activeServerId = { 1L },
            removeMirrorFiles = { _, ids -> removed += ids },
        )
        db.imageDao().upsertAll(listOf(imageEntity(1), imageEntity(2)))   // 沿用该文件既有实体构造 helper
        db.imageFileDao().upsert(ImageFileEntity(1, 1, "HQ", "s1/i1/a.jpg", 1, 0))
        db.imageFileDao().upsert(ImageFileEntity(1, 2, "ORIGINAL", "s1/i2/b.jpg", 1, 0))
        store.deleteImages(listOf(1L, 2L))
        assertEquals(0L, db.imageFileDao().countFor(1))
        assertEquals(listOf(1L, 2L), removed.sorted())   // ORIGINAL 档同样跟随删除（spec §3.4）
    }
```

`PrefsStoreTest.kt` 追加：

```kotlin
    @Test
    fun `图片保存方式与移动网络同步键——默认值与写读`() = runTest {
        assertNull(prefs.imageSaveModeName.first())
        assertFalse(prefs.mirrorSyncCellular.first())
        prefs.setImageSaveModeName("ORIGINAL")
        prefs.setMirrorSyncCellular(true)
        assertEquals("ORIGINAL", prefs.imageSaveModeName.first())
        assertTrue(prefs.mirrorSyncCellular.first())
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——`MirrorSyncWorker`/`MirrorSyncMonitor`/`onSyncSuccess`/`clearMirrorFiles` 未定义。

- [ ] **Step 3: 实现 Monitor/Manager/Notifier/PrefsStore/SyncScheduler**

`MirrorSyncMonitor.kt`：

```kotlin
package com.bluskysoftware.yandegallery.domain.mirror

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** 镜像同步可视状态（存储页/设置行消费，spec §3.4/§5.2）；worker 经 AppWorkerFactory 注入更新。 */
class MirrorSyncMonitor {
    enum class MirrorSyncError { SERVER_TOO_OLD, DISK_FULL, NETWORK }

    data class MirrorSyncState(
        val running: Boolean = false,
        val done: Long = 0,
        val total: Long = 0,
        val error: MirrorSyncError? = null,
    )

    private val _state = MutableStateFlow(MirrorSyncState())
    val state: StateFlow<MirrorSyncState> = _state

    fun start(total: Long) { _state.value = MirrorSyncState(running = true, total = total) }
    fun progress(done: Long, total: Long) { _state.update { it.copy(done = done, total = total) } }
    fun finish(error: MirrorSyncError? = null) { _state.update { it.copy(running = false, error = error) } }
}
```

`MirrorSyncManager.kt`：

```kotlin
package com.bluskysoftware.yandegallery.domain.mirror

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * 镜像同步入队（spec §3.4）：唯一工作名 `mirror-sync-{serverId}` KEEP 合并（设置切换 REPLACE）；
 * 约束默认仅 WiFi（UNMETERED），「允许移动网络同步」开启降为 CONNECTED；指数退避 30s 起。
 */
class MirrorSyncManager(private val context: Context) {

    fun requestSync(serverId: Long, allowCellular: Boolean, replace: Boolean = false) {
        val req = OneTimeWorkRequestBuilder<MirrorSyncWorker>()
            .setInputData(workDataOf(MirrorSyncWorker.KEY_SERVER_ID to serverId))
            .setConstraints(
                Constraints(requiredNetworkType = if (allowCellular) NetworkType.CONNECTED else NetworkType.UNMETERED),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "mirror-sync-$serverId",
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
            req,
        )
    }

    /** 切服时取消旧服工作（spec §6 跨切服拦截的调度侧）。 */
    fun cancel(serverId: Long) {
        WorkManager.getInstance(context).cancelUniqueWork("mirror-sync-$serverId")
    }
}
```

`DownloadNotifier.kt` 尾部追加：

```kotlin
/** 镜像同步聚合进度通知（spec §3.4）：单通知「正在同步图片 x/y」；抽象注入同 DownloadNotifier 理由。 */
interface MirrorSyncNotifier {
    fun ensureChannel()
    fun foregroundInfo(done: Long, total: Long): ForegroundInfo
}

class AndroidMirrorSyncNotifier(private val context: Context) : MirrorSyncNotifier {

    override fun ensureChannel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "图片同步", NotificationManager.IMPORTANCE_LOW),
        )
    }

    override fun foregroundInfo(done: Long, total: Long): ForegroundInfo {
        val pct = if (total > 0) ((done * 100) / total).toInt() else -1
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在同步图片")
            .setContentText("$done / $total")
            .setOngoing(true)
            .apply { if (pct >= 0) setProgress(100, pct, false) else setProgress(0, 0, true) }
            .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val CHANNEL_ID = "mirror_sync"
        const val NOTIFICATION_ID = 0x4D53   // 'MS'：与逐图下载通知（imageId hash）错开
    }
}
```

`PrefsStore.kt`：`albumDetailColumns` 访问器之后加，companion 加键：

```kotlin
    /** 图片保存方式（MirrorTier.name）；未设置为 null，映射与默认档（HQ）收敛在读取方 mirrorTierOf。 */
    val imageSaveModeName: Flow<String?> = safeData.map { it[KEY_IMAGE_SAVE_MODE] }

    suspend fun setImageSaveModeName(name: String) {
        dataStore.edit { it[KEY_IMAGE_SAVE_MODE] = name }
    }

    /** 允许移动网络同步镜像（spec §5.1/D4），默认 false（仅 WiFi）。 */
    val mirrorSyncCellular: Flow<Boolean> = safeData.map { it[KEY_MIRROR_CELLULAR] ?: false }

    suspend fun setMirrorSyncCellular(allow: Boolean) {
        dataStore.edit { it[KEY_MIRROR_CELLULAR] = allow }
    }
```

```kotlin
        private val KEY_IMAGE_SAVE_MODE = stringPreferencesKey("image_save_mode")
        private val KEY_MIRROR_CELLULAR = booleanPreferencesKey("mirror_sync_cellular")
```

（import 补 `androidx.datastore.preferences.core.booleanPreferencesKey`。）

`SyncScheduler.kt`：构造尾部加 `private val onSyncSuccess: (() -> Unit)? = null,`；`runOnce` 的 `.onSuccess` 块尾加：

```kotlin
                onSyncSuccess?.invoke()
```

- [ ] **Step 4: 实现 MirrorSyncWorker.kt**

```kotlin
package com.bluskysoftware.yandegallery.domain.mirror

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.db.ImageFileDao
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.domain.download.shouldUpdateNotification
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * 镜像增量同步 worker（spec §3.4）：每轮重算缺失集合（断点天然可续）→ 前 5 张串行探测
 * （HQ 模式全 404 且元数据在库 → 判桌面端过旧，中止本轮；下轮自动重试可自愈）→ 其余 3 路并发。
 * ensure 以函数注入（生产接 ImageMirrorStore::ensure）——测试不触网络/文件系统。
 * 404 跳过（对账会删该图行）；磁盘不足暂停（DISK_FULL + retry）；网络/IO 失败退避重试。
 */
class MirrorSyncWorker(
    context: Context,
    params: WorkerParameters,
    private val ensure: suspend (serverId: Long, imageId: Long, tier: MirrorTier) -> Result<File>,
    private val imageFileDao: ImageFileDao,
    private val saveMode: suspend () -> MirrorTier,
    private val activeServerId: suspend () -> Long?,
    private val monitor: MirrorSyncMonitor,
    private val notifier: MirrorSyncNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        // 陈旧任务（切服后残留队列）直接完结，不触碰新服数据
        if (serverId <= 0 || activeServerId() != serverId) return Result.success()

        val tier = saveMode()
        val missing = imageFileDao.missingImageIds(serverId, needOriginal = tier == MirrorTier.ORIGINAL)
        if (missing.isEmpty()) { monitor.finish(); return Result.success() }
        val total = missing.size.toLong()
        monitor.start(total)
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.foregroundInfo(0, total))
        }.onFailure { if (it is CancellationException) throw it }   // 33+ 未授权降级纯后台

        val done = AtomicLong(0)
        val retryable = AtomicInteger(0)
        val diskFull = AtomicBoolean(false)
        var lastNotifyMs = 0L

        suspend fun step(imageId: Long): Result? {   // 非 null = 需要立刻中止的终态
            if (diskFull.get()) return null
            val r = ensure(serverId, imageId, tier)
            when {
                r.isSuccess -> done.incrementAndGet()
                r.isDiskFull() -> diskFull.set(true)
                r.is404() -> Unit   // 跳过：元数据对账会删行，下轮不再出现
                else -> retryable.incrementAndGet()
            }
            val d = done.get()
            monitor.progress(d, total)
            if (shouldUpdateNotification(lastNotifyMs, timeMs(), -1, if (total > 0) ((d * 100) / total).toInt() else -1)) {
                lastNotifyMs = timeMs()
                setProgress(workDataOf(KEY_DONE to d, KEY_TOTAL to total))
                runCatching { setForeground(notifier.foregroundInfo(d, total)) }
                    .onFailure { if (it is CancellationException) throw it }
            }
            return null
        }

        // 前 5 张串行探测（spec §3.4-4）：仅 HQ 模式判旧桌面——/file 旧桌面也有，原图模式不误伤
        val probe = missing.take(PROBE_COUNT)
        var probe404 = 0
        for (id in probe) {
            val r = ensure(serverId, id, tier)
            when {
                r.isSuccess -> done.incrementAndGet()
                r.isDiskFull() -> diskFull.set(true)
                r.is404() -> probe404++
                else -> retryable.incrementAndGet()
            }
            monitor.progress(done.get(), total)
            if (diskFull.get()) break
        }
        if (tier == MirrorTier.HQ && probe.size >= PROBE_COUNT && probe404 >= PROBE_COUNT) {
            monitor.finish(MirrorSyncMonitor.MirrorSyncError.SERVER_TOO_OLD)
            return Result.failure()
        }

        if (!diskFull.get()) {
            val semaphore = Semaphore(CONCURRENCY)
            coroutineScope {
                missing.drop(PROBE_COUNT).map { id ->
                    async { semaphore.withPermit { step(id) } }
                }.awaitAll()
            }
        }

        return when {
            diskFull.get() -> { monitor.finish(MirrorSyncMonitor.MirrorSyncError.DISK_FULL); Result.retry() }
            retryable.get() > 0 -> { monitor.finish(MirrorSyncMonitor.MirrorSyncError.NETWORK); Result.retry() }
            else -> { monitor.finish(); Result.success() }
        }
    }

    private fun Result<File>.is404() = (exceptionOrNull() as? ApiException)?.httpStatus == 404
    private fun Result<File>.isDiskFull() = exceptionOrNull() is ImageMirrorStore.DiskFullException

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"
        const val PROBE_COUNT = 5
        const val CONCURRENCY = 3
    }
}
```

- [ ] **Step 5: 实现 RoomMirrorStore 级联 + AppGraph/工厂/启动接线**

`RoomMirrorStore.kt`：构造尾部加两参：

```kotlin
    private val removeMirrorFiles: suspend (serverId: Long, imageIds: List<Long>) -> Unit = { _, _ -> },
    private val clearMirrorFiles: suspend () -> Unit = {},
```

`clearMirror` 改为（表达式体转块体，事务外回调）：

```kotlin
    override suspend fun clearMirror() {
        db.withTransaction {
            db.imageDao().clearAll() // CASCADE 连带清 image_tags/gallery_images
            db.galleryDao().clearAll()
            db.tagDao().clearAll()
            db.downloadDao().clearAll()
            db.albumPrefsDao().clearAll()
            // 镜像身份失效 → 图片镜像登记同域作废（spec §3.4 对账清理）；文件删除在事务外回调
            db.imageFileDao().clearAll()
            db.syncStateDao().clear()
        }
        clearMirrorFiles()
    }
```

（原 clearMirror 注释块原样保留在对应行上。）`deleteImages` 三处扩展：

```kotlin
        // ①' 镜像登记行同批预取不需要——目录名由 id 可导出（deleteDirs 不查行）
        // ② 事务内追加 image_files 行删除
        db.withTransaction {
            ids.chunked(DELETE_CHUNK).forEach { chunk ->
                db.imageDao().deleteByIds(chunk)
                if (serverId != null) {
                    db.downloadDao().deleteByImageIds(serverId, chunk)
                    db.imageFileDao().deleteByImageIds(serverId, chunk)
                }
            }
        }
        // ③' 事务外 IO 级联追加：镜像目录删除（ORIGINAL 档同样跟随删除，spec §3.4）
        if (serverId != null) {
            removeMirrorFiles(serverId, ids)
        }
```

`AppGraph.kt`：

```kotlin
    /** 图片镜像层（spec §3）：外部私有目录 + image_files 登记；无外部存储回退内部 filesDir。 */
    val imageMirrorStore by lazy {
        ImageMirrorStore(
            rootDir = java.io.File(appContext.getExternalFilesDir(null) ?: appContext.filesDir, "mirror"),
            imageFileDao = db.imageFileDao(),
            imageDao = db.imageDao(),
            apiProvider = { api() },
            activeServerId = { serverRepository.activeServer()?.id },
        )
    }
    val mirrorSyncMonitor by lazy { MirrorSyncMonitor() }
    val mirrorSyncManager by lazy { MirrorSyncManager(appContext) }

    /** 镜像同步入队（读保存方式无关——worker 自读；此处只解偏好约束与激活服务器）。 */
    fun requestMirrorSync(replace: Boolean = false) {
        scope.launch {
            val serverId = serverRepository.activeServer()?.id ?: return@launch
            val cellular = prefsStore.mirrorSyncCellular.first()
            mirrorSyncManager.requestSync(serverId, cellular, replace)
        }
    }
```

`mirrorStore`（RoomMirrorStore）装配追加两参：

```kotlin
            removeMirrorFiles = { serverId, ids -> imageMirrorStore.deleteDirs(serverId, ids) },
            clearMirrorFiles = { imageMirrorStore.clearAllFiles() },
```

`syncScheduler` 装配追加：

```kotlin
            onSyncSuccess = { requestMirrorSync() },
```

`init` 的激活变化 collector：切服分支（`idChanged` 为 true 且旧 id 非 null）追加取消旧服镜像同步——在 `if ((idChanged || endpointChanged) && autoSyncOnActiveChange)` 块内、`sseClient.restart()` 前加：

```kotlin
                    lastActive?.id?.takeIf { idChanged && it != active?.id }
                        ?.let { mirrorSyncManager.cancel(it) }
```

（注意该行须放在 `lastActive = active` 赋值**之前**读取旧值——按现有代码顺序，把取消逻辑上移到 `val idChanged` 判定后、`lastActive = active` 前，用局部变量暂存旧 id。）

`AppWorkerFactory.kt`：`createWorker` 加分支：

```kotlin
        } else if (workerClassName == MirrorSyncWorker::class.java.name) {
            MirrorSyncWorker(
                appContext,
                workerParameters,
                ensure = { serverId, imageId, tier -> graph.imageMirrorStore.ensure(serverId, imageId, tier) },
                imageFileDao = graph.db.imageFileDao(),
                saveMode = { mirrorTierOf(graph.prefsStore.imageSaveModeName.first()) },
                activeServerId = { graph.serverRepository.activeServer()?.id },
                monitor = graph.mirrorSyncMonitor,
                notifier = AndroidMirrorSyncNotifier(appContext),
            )
        } else {
```

`YandeGalleryApp.kt` `onCreate` 尾部加启动孤儿清扫：

```kotlin
        // 启动孤儿清扫（镜像 spec §3.4）：无行目录删、有行无文件的行删（下轮同步自动补）
        graph.scopeLaunchSweep()
```

对应 AppGraph 加：

```kotlin
    /** 启动期镜像孤儿清扫入口（YandeGalleryApp 调）；无激活服务器时空跑。 */
    fun scopeLaunchSweep() {
        scope.launch {
            serverRepository.activeServer()?.id?.let { imageMirrorStore.sweepOrphans(it) }
        }
    }
```

- [ ] **Step 6: 运行测试通过**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "com.bluskysoftware.yandegallery.domain.mirror.*" --tests "com.bluskysoftware.yandegallery.domain.sync.SyncSchedulerTest" --tests "com.bluskysoftware.yandegallery.data.repo.RoomMirrorStoreTest" --tests "com.bluskysoftware.yandegallery.data.prefs.PrefsStoreTest"`
Expected: PASS。

- [ ] **Step 7: 全量安卓测试 + 提交**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest`
Expected: PASS（AppGraphTest 等装配测试若因新 lazy 依赖失败，按报错补 fake/断言）。

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ android/app/src/test/java/com/bluskysoftware/yandegallery/
git commit -m "feat(android): 镜像同步链路——MirrorSyncWorker 增量批量下载、同步总线钩子、对账级联清理"
```

---

### Task 6: 网格缩略图本地化——镜像优先 Fetcher + 缩略图不设限 + 预览档下线

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/image/ImageLoaders.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`（thumbnailLoader 重装配、previewLoader 删除、启动清旧 previews 目录）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/image/ImageLoadersTest.kt`（改）、`ImageLoadersRobolectricTest.kt`（改/追加）

**Interfaces:**
- Consumes: Task 4 `ImageMirrorStore.localFile(serverId, imageId): LocalImage?`；现有 `thumbnailRequest`/`thumbnailCacheKey`、Coil3 `Fetcher/Fetcher.Factory/SourceFetchResult/ImageSource`、`buildTierImageLoader`。
- Produces:
  - `data class ThumbnailSpec(val serverId: Long, val imageId: Long, val url: String)` —— 网格缩略图新请求模型（替代裸 URL data）。
  - `class MirrorFirstFetcherFactory(localFile: suspend (Long, Long) -> File?, okHttp: OkHttpClient) : Fetcher.Factory<ThumbnailSpec>`：本地镜像命中 → 文件 Source（零网络）；未命中 → 委托网络拉 `spec.url`（写盘缓存，键不变）。
  - `thumbnailRequest(context, baseUrl, serverId, imageId)` 签名不变，data 改为 `ThumbnailSpec`（四处网格调用点零改动）。
  - `buildThumbnailImageLoader(context, okHttp, localFile)`：不设限（`1L shl 40`）+ 注册 MirrorFirstFetcherFactory。
  - `previewUrl`/`previewCacheKey`/`previewRequest`/`buildPreviewImageLoader` **删除**（Task 8/9 同步移除消费点前先保留到本任务末——见 Step 6 顺序说明）。

**顺序说明**：`previewLoader` 的消费点在 ViewerViewModel/ViewerScreen（Task 8 改）。为保持每任务可编译，本任务只做：缩略图侧改造 + 不设限；预览档符号**保留**，由 Task 8 一并删除。AppGraph 启动清理旧 previews 目录在 Task 8 加。

- [ ] **Step 1: 写失败测试**

`ImageLoadersTest.kt`（纯 JVM 部分）追加/调整：

```kotlin
    @Test
    fun `thumbnailRequest data 为 ThumbnailSpec——缓存键不变`() {
        // Robolectric 环境下构造（本文件若为纯 JVM，移到 ImageLoadersRobolectricTest）
        val req = thumbnailRequest(context, "http://h:1/", 3, 7)
        val spec = req.data as ThumbnailSpec
        assertEquals(3L, spec.serverId)
        assertEquals(7L, spec.imageId)
        assertEquals("http://h:1/api/app/v1/images/7/thumbnail", spec.url)
        assertEquals("s3:t7", req.diskCacheKey)
    }
```

`ImageLoadersRobolectricTest.kt` 追加（Coil Fetcher 在 Robolectric 下可直测 fetch 分派）：

```kotlin
    @Test
    fun `MirrorFirstFetcher 本地命中——返回文件 Source 零网络`() = runTest {
        val file = File.createTempFile("mirror", ".jpg").apply { writeBytes(ByteArray(8)) }
        val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> file }, okHttp = OkHttpClient())
        val fetcher = factory.create(
            ThumbnailSpec(1, 42, "http://127.0.0.1:9/api/app/v1/images/42/thumbnail"),   // 不可达端口：走网络必炸
            coil3.request.Options(context),
            coil3.ImageLoader(context),
        )!!
        val result = fetcher.fetch() as coil3.fetch.SourceFetchResult
        assertNotNull(result.source)   // 未抛 = 未走网络
    }

    @Test
    fun `MirrorFirstFetcher 本地缺失——回退网络路径`() = runTest {
        val server = MockWebServer().apply {
            enqueue(MockResponse().setHeader("Content-Type", "image/jpeg").setBody(okio.Buffer().write(ByteArray(8))))
            start()
        }
        try {
            val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> null }, okHttp = OkHttpClient())
            val fetcher = factory.create(
                ThumbnailSpec(1, 42, server.url("/api/app/v1/images/42/thumbnail").toString()),
                coil3.request.Options(context),
                coil3.ImageLoader(context),
            )!!
            val result = fetcher.fetch() as coil3.fetch.SourceFetchResult
            assertNotNull(result.source)
            assertEquals(1, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `buildThumbnailImageLoader 不设限——maxSize 为 1 TiB 形式上限`() {
        val loader = buildThumbnailImageLoader(context, OkHttpClient(), localFile = { _, _ -> null })
        assertEquals(1L shl 40, loader.diskCache?.maxSize)
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——`ThumbnailSpec`/`MirrorFirstFetcherFactory` 未定义。

- [ ] **Step 3: 实现 ImageLoaders.kt 缩略图侧**

替换 `thumbnailRequest` 与 `buildThumbnailImageLoader`，新增模型与 Fetcher（文件顶部 import 补 `coil3.Extras`、`coil3.fetch.Fetcher`、`coil3.fetch.SourceFetchResult`、`coil3.ImageLoader`、`coil3.request.Options`、`coil3.decode.ImageSource`、`okio.buffer`、`okio.source`、`java.io.File` 等按编译提示）：

```kotlin
/** 网格缩略图请求模型（镜像 spec §4.1）：携带定位三元组，Fetcher 据此先查本地镜像再回退网络。 */
data class ThumbnailSpec(val serverId: Long, val imageId: Long, val url: String)

/**
 * 镜像优先 Fetcher（spec §4.1/D11）：本地有镜像文件（HQ/原图）→ 直接文件 Source（手机自产降采样、
 * 零网络零盘缓存写入）；未镜像 → OkHttp 拉桌面端 /thumbnail（Coil 盘缓存仍按 diskCacheKey 生效，
 * 覆盖「刚入库未同步」窗口）。localFile 注入挂 ImageMirrorStore::localFile（返回存在性已校验的 File）。
 */
class MirrorFirstFetcherFactory(
    private val localFile: suspend (serverId: Long, imageId: Long) -> File?,
    private val okHttp: OkHttpClient,
) : Fetcher.Factory<ThumbnailSpec> {

    override fun create(data: ThumbnailSpec, options: Options, imageLoader: ImageLoader): Fetcher =
        Fetcher {
            val file = localFile(data.serverId, data.imageId)
            if (file != null) {
                SourceFetchResult(
                    source = ImageSource(file = file.toOkioPath(), fileSystem = okio.FileSystem.SYSTEM),
                    mimeType = null,
                    dataSource = coil3.decode.DataSource.DISK,
                )
            } else {
                fetchRemote(data.url)
            }
        }

    /** 网络回退：直接 OkHttp 执行（带 Bearer 拦截器的注入客户端），成功体转 ImageSource。 */
    private suspend fun fetchRemote(url: String): SourceFetchResult {
        val request = okhttp3.Request.Builder().url(url).build()
        val response = okHttp.newCall(request).executeAsync()
        val body = response.body
        return SourceFetchResult(
            source = ImageSource(source = body.source().buffer, fileSystem = okio.FileSystem.SYSTEM),
            mimeType = response.header("Content-Type"),
            dataSource = coil3.decode.DataSource.NETWORK,
        )
    }
}
```

**实现注意**（执行者按 Coil 3.5 实际 API 微调，测试为准）：
- Coil3 的 `Fetcher` 是 `fun interface`，`ImageSource` 的文件/流两个工厂签名以 `coil3.decode.ImageSource` 实际定义为准（3.5 为 `ImageSource(file: Path, fileSystem: FileSystem)` 与 `ImageSource(source: BufferedSource, fileSystem: FileSystem)`）。
- `executeAsync` 来自 `okhttp3.coroutines`（OkHttp 5.x 自带）；若工程未引入该 artifact，用 `suspendCancellableCoroutine` 包 `enqueue` 或直接 `withContext(Dispatchers.IO) { call.execute() }`。
- **本地命中路径不写 Coil 盘缓存**（直接文件 Source），网络回退路径希望保留盘缓存——若自管 OkHttp 绕过了 Coil 网络层缓存写入，改为组合方案：Factory 在 `create` 里对未命中返回 `null`，让请求落到后注册的 `OkHttpNetworkFetcherFactory`（`ImageRequest.data` 需在 mapper 阶段把 ThumbnailSpec 映射为 url 字符串）。**推荐实现**：注册 `Mapper<ThumbnailSpec, String>` + 自定义 Factory 只拦截本地命中：

```kotlin
/** 组合注册（推荐，保留 Coil 网络盘缓存）：命中本地出文件 Source；未命中 create 返回 null，
 *  经 ThumbnailSpecMapper 落到 OkHttpNetworkFetcherFactory 走原网络+盘缓存路径。 */
class ThumbnailSpecMapper : coil3.map.Mapper<ThumbnailSpec, String> {
    override fun map(data: ThumbnailSpec, options: Options): String = data.url
}
```

此方案下 `MirrorFirstFetcherFactory.create` 对 `localFile == null` 返回 `null`（判定须同步——在 create 内无法 suspend，改为构造期注入 `localFileSync: (Long, Long) -> File?`，由 AppGraph 用 `runBlocking` 包 DAO 或维护内存 map；**更简单且推荐**：Fetcher 内 suspend 查询后自行网络回退，即上文第一方案，盘缓存损失仅影响「未同步窗口」的重复拉取，可接受）。两方案择一，以测试通过为准；计划按第一方案（自行回退）写。

`buildThumbnailImageLoader` 替换为：

```kotlin
/** 缩略图档（spec §4.1/D9）：不设上限（1 TiB 形式值，实质仅受磁盘约束）+ 镜像优先 Fetcher。 */
fun buildThumbnailImageLoader(
    context: Context,
    okHttp: OkHttpClient,
    localFile: suspend (serverId: Long, imageId: Long) -> File?,
): ImageLoader =
    ImageLoader.Builder(context)
        .components {
            add(MirrorFirstFetcherFactory(localFile, okHttp))
            add(OkHttpNetworkFetcherFactory(callFactory = { okHttp }))
        }
        .diskCache(
            DiskCache.Builder()
                .directory(context.cacheDir.resolve("thumbnails").toOkioPath())
                .maxSizeBytes(1L shl 40)
                .build()
        )
        .build()
```

`thumbnailRequest` 的 data 改为：

```kotlin
fun thumbnailRequest(context: Context, baseUrl: String, serverId: Long, imageId: Long): ImageRequest =
    ImageRequest.Builder(context)
        .data(ThumbnailSpec(serverId, imageId, thumbnailUrl(baseUrl, imageId)))
        .diskCacheKey(thumbnailCacheKey(serverId, imageId))
        .memoryCacheKey(thumbnailCacheKey(serverId, imageId))
        .build()
```

`buildTierImageLoader` 保留（previewLoader 仍在用，Task 8 删）。

- [ ] **Step 4: AppGraph 重装配 thumbnailLoader**

```kotlin
    /** 缩略图 loader（spec §4.1/D9）：不设上限 + 镜像优先（本地文件直出，未同步图回退网络）。 */
    val thumbnailLoader by lazy {
        buildThumbnailImageLoader(
            appContext, okHttp,
            localFile = { serverId, imageId -> imageMirrorStore.localFile(serverId, imageId)?.file },
        )
    }
```

（`prefsStore.thumbnailCacheMaxBytes` 的 runBlocking 读取删除；`mirrorStore` 装配里 `removeCachedImage` 的 preview 行保留到 Task 8。）

- [ ] **Step 5: 运行测试通过**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "com.bluskysoftware.yandegallery.data.image.*"`
Expected: PASS。既有断言 `data == url字符串` 或上限档位的用例按新形态更新。

- [ ] **Step 6: 全量回归 + 提交**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest`
Expected: PASS（消费 thumbnailRequest 的网格测试不受影响——签名未变）。

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/image/ android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt android/app/src/test/java/com/bluskysoftware/yandegallery/data/image/
git commit -m "feat(android): 网格缩略图镜像优先——本地文件直出零网络、远程缩略图缓存不设上限"
```

---

### Task 7: 「下载原图」改写镜像层——DownloadWorker/Manager 重写

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/DownloadWorker.kt`（重写）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/DownloadManager.kt`（enqueue 签名简化）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/AppWorkerFactory.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SelectionActions.kt`（downloadAll 的 enqueue 回调签名）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/viewer/ViewerViewModel.kt`（enqueueDownload）、`ui/photos/PhotosViewModel.kt`、`ui/albums/AlbumDetailViewModel.kt`（actions 装配处）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/download/DownloadWorkerTest.kt`（重写）

**Interfaces:**
- Consumes: Task 4 `ImageMirrorStore.ensure(serverId, imageId, MirrorTier.ORIGINAL): Result<File>`（内部已含：Content-Length 校验、part 原子落盘、跨切服拦截、原图落定删 HQ、image_files 升 ORIGINAL——worker 不再自持这些逻辑）；现有 `DownloadNotifier`、`ApiException`。
- Produces:
  - `DownloadWorker(context, params, ensureOriginal: suspend (serverId: Long, imageId: Long) -> Result<File>, notifier: DownloadNotifier)`；input keys 只剩 `KEY_SERVER_ID`/`KEY_IMAGE_ID`/`KEY_FILENAME`（通知文案用）。
  - `DownloadManager.enqueue(serverId, imageId, filename)`（mime 参数删除）；`observeState` 不变。
  - 语义：成功 = 原图已入镜像 + 同图 HQ 已删（ensure 内完成）；404 → `Result.failure()`；磁盘不足/网络 → `Result.retry()`。

- [ ] **Step 1: 重写失败测试**

`DownloadWorkerTest.kt` 整文件重写（旧 MediaStore/四路径用例作废——worker 不再触 MediaStore；镜像细节已在 ImageMirrorStoreTest 覆盖，这里只测 worker 的结果分流与通知降级）：

```kotlin
package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * DownloadWorker（镜像版）：worker 只做「ensure ORIGINAL + 结果分流 + 前台通知」，
 * 落盘/校验/删 HQ/跨切服全在 ImageMirrorStore.ensure 内（ImageMirrorStoreTest 覆盖）。
 */
@RunWith(RobolectricTestRunner::class)
class DownloadWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private val noopNotifier = object : DownloadNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(imageId: Long, filename: String, written: Long, total: Long) =
            throw IllegalStateException("测试不升前台")   // runCatching 降级路径
    }

    private fun worker(ensure: suspend (Long, Long) -> Result<File>): DownloadWorker =
        TestListenableWorkerBuilder<DownloadWorker>(context)
            .setInputData(workDataOf(
                DownloadWorker.KEY_SERVER_ID to 1L,
                DownloadWorker.KEY_IMAGE_ID to 42L,
                DownloadWorker.KEY_FILENAME to "foo.png",
            ))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DownloadWorker(c, p, ensureOriginal = ensure, notifier = noopNotifier)
            })
            .build() as DownloadWorker

    @Test
    fun `ensure 成功 → success（通知升级失败不影响结果）`() = runTest {
        val w = worker { _, _ -> Result.success(File("x")) }
        assertEquals(ListenableWorker.Result.success(), w.doWork())
    }

    @Test
    fun `404 → failure（原图已删，不重试；对账 nudge 由拦截器统一触发）`() = runTest {
        val w = worker { _, _ -> Result.failure(ApiException("NOT_FOUND", "x", 404)) }
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
    }

    @Test
    fun `磁盘不足 → retry`() = runTest {
        val w = worker { _, _ -> Result.failure(ImageMirrorStore.DiskFullException()) }
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
    }

    @Test
    fun `网络等其他错误 → retry`() = runTest {
        val w = worker { _, _ -> Result.failure(java.io.IOException("断了")) }
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
    }

    @Test
    fun `无效入参（serverId 缺失）→ failure`() = runTest {
        val w = TestListenableWorkerBuilder<DownloadWorker>(context)
            .setInputData(workDataOf(DownloadWorker.KEY_IMAGE_ID to 42L))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DownloadWorker(c, p, ensureOriginal = { _, _ -> Result.success(File("x")) }, notifier = noopNotifier)
            })
            .build() as DownloadWorker
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——DownloadWorker 构造签名不匹配。

- [ ] **Step 3: 重写 DownloadWorker.kt**

```kotlin
package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import kotlinx.coroutines.CancellationException

/**
 * 原图下载 worker（镜像版，spec §4.3）：语义从「写系统相册」改为「获取原图到本机镜像」。
 * 全部落盘细节（流式下载、Content-Length 校验、part 原子改名、同目录删 HQ、跨切服拦截、
 * image_files 升 ORIGINAL）收敛在 [ImageMirrorStore.ensure]——worker 只保留 WorkManager 外壳
 * （可靠性/退避/前台通知）与结果分流。MediaStore 链路整体退役（需求 5：原图不再进相册）。
 */
class DownloadWorker(
    context: Context,
    params: WorkerParameters,
    private val ensureOriginal: suspend (serverId: Long, imageId: Long) -> Result<java.io.File>,
    private val notifier: DownloadNotifier,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        val imageId = inputData.getLong(KEY_IMAGE_ID, -1L)
        val filename = inputData.getString(KEY_FILENAME) ?: "$imageId"
        if (serverId <= 0 || imageId <= 0) return Result.failure()

        // 前台通知（大文件下载可视化）：33+ 未授权/31+ 后台 FGS 限制 runCatching 降级纯后台，
        // 唯 CancellationException 重抛（不吞取消，对齐仓内惯例）。镜像层无逐字节进度回调，
        // 通知为 indeterminate（total=-1）——逐图体感时长短，聚合进度由 MirrorSyncNotifier 承担。
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.foregroundInfo(imageId, filename, 0, -1))
        }.onFailure { if (it is CancellationException) throw it }

        val result = ensureOriginal(serverId, imageId)
        return when {
            result.isSuccess -> Result.success()
            (result.exceptionOrNull() as? ApiException)?.httpStatus == 404 -> Result.failure()
            result.exceptionOrNull() is ImageMirrorStore.DiskFullException -> Result.retry()
            else -> Result.retry()
        }
    }

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_IMAGE_ID = "imageId"
        const val KEY_FILENAME = "filename"
    }
}
```

- [ ] **Step 4: 调整 Manager/Factory/调用点**

`DownloadManager.enqueue` 签名与 workData（KEY_MIME 移除）：

```kotlin
    fun enqueue(serverId: Long, imageId: Long, filename: String) {
        val req = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(
                workDataOf(
                    DownloadWorker.KEY_SERVER_ID to serverId,
                    DownloadWorker.KEY_IMAGE_ID to imageId,
                    DownloadWorker.KEY_FILENAME to filename,
                ),
            )
            .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("download-$serverId-$imageId", ExistingWorkPolicy.KEEP, req)
    }
```

`AppWorkerFactory` 的 DownloadWorker 分支改为：

```kotlin
        if (workerClassName == DownloadWorker::class.java.name) {
            DownloadWorker(
                appContext,
                workerParameters,
                ensureOriginal = { serverId, imageId ->
                    graph.imageMirrorStore.ensure(serverId, imageId, MirrorTier.ORIGINAL)
                },
                notifier = AndroidDownloadNotifier(appContext),
            )
        } else if (...)   // MirrorSyncWorker 分支保持
```

调用点（编译器驱动，删 mime 实参）：
- `ViewerViewModel.enqueueDownload`：`graph.downloadManager.enqueue(serverId, image.id, image.filename)`；
- `SelectionActions` 构造参数 `enqueueDownload: (Long, ImageEntity) -> Unit` 不变，`PhotosViewModel`/`AlbumDetailViewModel` 装配处 lambda 改 `graph.downloadManager.enqueue(serverId, img.id, img.filename)`；`ViewerViewModel.ensureDownloadedThenUri` 里的 enqueue 同改（该函数 Task 8 还会重写，此处先保编译）。
- `ui/common/UiText.kt` 的 `mimeOf` 保留（分享 Intent 仍用）。

- [ ] **Step 5: 运行测试通过 + 提交**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "com.bluskysoftware.yandegallery.domain.download.DownloadWorkerTest"`
Expected: PASS。随后全量：`./gradlew.bat :app:testDebugUnitTest`——消费旧 worker 四路径断言的测试（若有）按新语义更新；`ShareCoordinatorTest`/`SelectionActions` 相关测试此时仍走 downloads 表逻辑，应仍绿（Task 8 才动）。

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ android/app/src/test/java/com/bluskysoftware/yandegallery/domain/download/
git commit -m "feat(android): 下载原图改写镜像层——worker 收敛为 ensure ORIGINAL 外壳，原图落定即删同图高质量图"
```

---

### Task 8: 分享四级规则 + 大图页读镜像 + 预览档下线

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/ShareCoordinator.kt`（重写）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SelectionActions.kt`（ensureShareUris 改走镜像）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/viewer/ViewerViewModel.kt`、`ViewerScreen.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/photos/PhotosScreen.kt`、`ui/albums/AlbumDetailScreen.kt`（分享 Intent 的 MIME 与 uri 来源）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/image/ImageLoaders.kt`（删 previewUrl/previewCacheKey/previewRequest/buildPreviewImageLoader/buildTierImageLoader）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`（删 previewLoader、mirrorStore 的 removeCachedImage 收窄、启动删旧 previews 目录）
- Modify: `android/app/src/main/res/xml/file_paths.xml`、`AndroidManifest.xml`（注释更新）
- Test: `domain/download/ShareCoordinatorTest.kt`（重写）、`ui/viewer/ViewerViewModelTest.kt`（若存在则更新 modelFor 断言）

**Interfaces:**
- Consumes: Task 4 `ImageMirrorStore.localFile/ensure`、`MirrorTier`、`mirrorTierOf`；Task 6 `thumbnailRequest`；`androidx.core.content.FileProvider.getUriForFile(context, "${applicationId}.fileprovider", file)`。
- Produces:
  - `ShareCoordinator(localFile: suspend (imageId: Long) -> File?, ensure: suspend (imageId: Long, tier: MirrorTier) -> Result<File>, saveMode: suspend () -> MirrorTier, online: () -> Boolean)`；`data class ShareOutcome(val files: List<File>, val failedIds: List<Long>)`；`suspend fun shareFiles(images: List<ImageEntity>): ShareOutcome`。
  - `ViewerViewModel`：`localImages: StateFlow<Map<Long, LocalImage>>`（替代 downloadedUris）、`downloadedIds`（tier==ORIGINAL 的 id 集，按钮态用）、`modelFor` 三态（本地文件 / ThumbnailSpec 占位）、`ensureViewable(image)` 在线插队、`shareFileFor(image): Result<File>`。
  - `shareUriFor(context, file): Uri` —— FileProvider 包装（`ui/common/UiText.kt` 或新 helper）。
  - AppGraph 不再暴露 `previewLoader`；`ViewerViewModel.previewLoader` 改名 `imageLoader`（取 thumbnailLoader——大图本地文件直出走 Fetcher 本地分支，占位/未同步走缩略图键）。

**行为基线（写测试前先对齐）**：
- 分享单张：本地 ORIGINAL → 原图文件；本地 HQ → HQ 文件；无本地且在线 → `ensure(当前保存方式)` 入镜像再取；无本地且离线 → failedIds。
- 大图显示：`localImages[id]` 有 → `File` 直出；无 → 显示缩略图请求（ThumbnailSpec，命中缩略图缓存），同时 `ensureViewable` 在线插队拉当前保存方式档位，完成后 localImages 流更新自动切清晰版；离线 → 缩略图 + 「未同步」提示。
- FileProvider：`file_paths.xml` 增 `<external-files-path name="mirror" path="mirror/" />` 与 `<files-path name="mirror_fallback" path="mirror/" />`（内部回退）。

- [ ] **Step 1: 重写 ShareCoordinator 失败测试**

`ShareCoordinatorTest.kt` 整文件重写：

```kotlin
package com.bluskysoftware.yandegallery.domain.download

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 分享四级规则（spec §4.4/需求 4）：原图 > HQ > 在线临时拉取 > 离线失败。纯逻辑注入，无 Android 依赖。 */
class ShareCoordinatorTest {

    private fun img(id: Long) = ImageEntity(id, "a$id.jpg", 1, 1, 100, "jpg", "", "")

    @Test
    fun `本地有文件直接用——不触发 ensure`() = runTest {
        var ensured = 0
        val c = ShareCoordinator(
            localFile = { File("local-$it.jpg") },
            ensure = { _, _ -> ensured++; Result.failure(IllegalStateException("不该调")) },
            saveMode = { MirrorTier.HQ },
            online = { true },
        )
        val out = c.shareFiles(listOf(img(1), img(2)))
        assertEquals(listOf("local-1.jpg", "local-2.jpg"), out.files.map { it.name })
        assertEquals(0, ensured)
        assertTrue(out.failedIds.isEmpty())
    }

    @Test
    fun `本地缺失且在线——按当前保存方式 ensure 后分享（D10）`() = runTest {
        var ensuredTier: MirrorTier? = null
        val c = ShareCoordinator(
            localFile = { null },
            ensure = { id, tier -> ensuredTier = tier; Result.success(File("pulled-$id.jpg")) },
            saveMode = { MirrorTier.ORIGINAL },
            online = { true },
        )
        val out = c.shareFiles(listOf(img(7)))
        assertEquals(listOf("pulled-7.jpg"), out.files.map { it.name })
        assertEquals(MirrorTier.ORIGINAL, ensuredTier)
    }

    @Test
    fun `本地缺失且离线——计入 failedIds 不 ensure`() = runTest {
        var ensured = 0
        val c = ShareCoordinator(
            localFile = { null },
            ensure = { _, _ -> ensured++; Result.success(File("x")) },
            saveMode = { MirrorTier.HQ },
            online = { false },
        )
        val out = c.shareFiles(listOf(img(7)))
        assertEquals(listOf(7L), out.failedIds)
        assertEquals(0, ensured)
    }

    @Test
    fun `多张混合——在线拉取失败的计入 failedIds，其余照常`() = runTest {
        val c = ShareCoordinator(
            localFile = { id -> if (id == 1L) File("local-1.jpg") else null },
            ensure = { id, _ ->
                if (id == 2L) Result.success(File("pulled-2.jpg"))
                else Result.failure(java.io.IOException("断了"))
            },
            saveMode = { MirrorTier.HQ },
            online = { true },
        )
        val out = c.shareFiles(listOf(img(1), img(2), img(3)))
        assertEquals(listOf("local-1.jpg", "pulled-2.jpg"), out.files.map { it.name })
        assertEquals(listOf(3L), out.failedIds)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——ShareCoordinator 构造签名不匹配。

- [ ] **Step 3: 重写 ShareCoordinator.kt**

```kotlin
package com.bluskysoftware.yandegallery.domain.download

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import java.io.File

/**
 * 分享协调器（镜像版，spec §4.4/需求 4）：不再强制先下原图。
 * 四级规则：本地原图 > 本地 HQ（localFile 已按行档位返回，天然覆盖前两级）>
 * 在线按当前保存方式临时拉一张入镜像（顺带补齐该图同步，D10）> 离线且无文件 → failedIds。
 * 纯逻辑注入（生产挂 ImageMirrorStore/ConnectionMonitor），无 WorkManager/Android 依赖。
 */
class ShareCoordinator(
    private val localFile: suspend (imageId: Long) -> File?,
    private val ensure: suspend (imageId: Long, tier: MirrorTier) -> Result<File>,
    private val saveMode: suspend () -> MirrorTier,
    private val online: () -> Boolean,
) {
    data class ShareOutcome(val files: List<File>, val failedIds: List<Long>)

    suspend fun shareFiles(images: List<ImageEntity>): ShareOutcome {
        val ready = mutableMapOf<Long, File>()
        val failed = mutableListOf<Long>()
        val tier = saveMode()
        for (image in images) {
            val local = localFile(image.id)
            when {
                local != null -> ready[image.id] = local
                online() -> ensure(image.id, tier)
                    .onSuccess { ready[image.id] = it }
                    .onFailure { failed += image.id }
                else -> failed += image.id
            }
        }
        return ShareOutcome(files = images.mapNotNull { ready[it.id] }, failedIds = failed)
    }
}
```

- [ ] **Step 4: SelectionActions.ensureShareUris 改走镜像**

`SelectionActions`：构造参数替换——删 `enqueueDownload`/`observeDownloadState`/`gatewayExists`，增：

```kotlin
    private val localFile: suspend (imageId: Long) -> File?,          // ImageMirrorStore.localFile(...)?.file
    private val ensureTier: suspend (imageId: Long, tier: MirrorTier) -> Result<File>,
    private val saveMode: suspend () -> MirrorTier,
    private val online: () -> Boolean,
    private val enqueueOriginal: (Long, ImageEntity) -> Unit,         // downloadAll 用（原图批量下载仍走 WorkManager）
```

`downloadAll` 的 enqueue 引用改 `enqueueOriginal`；`ensureShareUris` 改名 `ensureShareFiles` 并重写：

```kotlin
    /** 批量分享（spec §4.4）：镜像四级规则；镜像行已被同步删除的 id 直接计失败。 */
    suspend fun ensureShareFiles(ids: List<Long>): ShareCoordinator.ShareOutcome {
        val imageDao = db.imageDao()
        val existing = filterExisting(ids)
        val missing = ids - existing.toSet()
        val entities = existing.mapNotNull { imageDao.byId(it) }
        val coordinator = ShareCoordinator(localFile, ensureTier, saveMode, online)
        val outcome = withContext(Dispatchers.IO) { coordinator.shareFiles(entities) }
        return if (missing.isEmpty()) outcome
        else outcome.copy(failedIds = outcome.failedIds + missing)
    }
```

`anyDownloaded`/`downloadedUrisFor`/`batchDelete` 的 downloads 依赖：`anyDownloaded` 改查 `db.imageFileDao().byImageId(serverId, it)?.tier == MirrorTier.ORIGINAL.name`（语义变为「有本机原图」）；`downloadedUrisFor` 删除（镜像文件随对账自动级联，Screen 不再手动删副本）；`batchDelete` 删除 downloads 清行段（RoomMirrorStore.deleteImages 已级联 image_files）。

两个 VM 装配处（`PhotosViewModel`/`AlbumDetailViewModel`）同步改：

```kotlin
    private val actions = SelectionActions(
        db = graph.db,
        writeRepository = writeRepository,
        activeServerId = { graph.serverRepository.activeServer()?.id },
        localFile = { id ->
            graph.serverRepository.activeServer()?.id
                ?.let { sid -> graph.imageMirrorStore.localFile(sid, id)?.file }
        },
        ensureTier = { id, tier ->
            graph.serverRepository.activeServer()?.id
                ?.let { sid -> graph.imageMirrorStore.ensure(sid, id, tier) }
                ?: Result.failure(IllegalStateException("无激活服务器"))
        },
        saveMode = { mirrorTierOf(graph.prefsStore.imageSaveModeName.first()) },
        online = { graph.connectionMonitor.state.value.online },
        enqueueOriginal = { serverId, img -> graph.downloadManager.enqueue(serverId, img.id, img.filename) },
    )
```

- [ ] **Step 5: ViewerViewModel/Screen 改造 + 预览档删除**

`ViewerViewModel`：
- `previewLoader` 属性改：`val imageLoader: ImageLoader get() = graph.thumbnailLoader`。
- `downloadedUris` 替换为：

```kotlin
    /** 本地镜像映射（spec §4.2）：行 Flow 收集 + 文件存在性 IO 预校验；modelFor 同步读零 IO。 */
    @OptIn(ExperimentalCoroutinesApi::class)
    val localImages: StateFlow<Map<Long, LocalImage>> =
        graph.serverRepository.observeActive()
            .flatMapLatest { server ->
                if (server == null) flowOf(emptyMap())
                else graph.db.imageFileDao().observeFor(server.id).map { rows ->
                    val valid = mutableMapOf<Long, LocalImage>()
                    for (row in rows) {
                        val file = graph.imageMirrorStore.fileOf(row)
                        if (file.isFile && file.length() > 0) {
                            valid[row.imageId] = LocalImage(mirrorTierOf(row.tier), file)
                        }
                    }
                    valid
                }
            }
            .flowOn(Dispatchers.IO)
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    /** 已有本机原图的 id 集（「查看原图」按钮态：已有→打勾禁用）。 */
    val downloadedIds: StateFlow<Set<Long>> =
        localImages
            .map { m -> m.filterValues { it.tier == MirrorTier.ORIGINAL }.keys }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())
```

- `modelFor` 重写：

```kotlin
    /**
     * 大图模型（同步零 IO，spec §4.2）：本地镜像命中 → File 直出（Coil 按视图降采样）；
     * 未镜像 → 缩略图请求占位（ThumbnailSpec 命中缩略图缓存），清晰版由 [ensureViewable]
     * 在线插队补齐后经 localImages 流自动切换。无激活服务器退化裸缩略图 URL（不伪造缓存键）。
     */
    fun modelFor(image: ImageEntity, baseUrl: String): Any {
        val local = localImages.value[image.id]
        if (local != null) return local.file
        val server = activeServer.value
            ?: return ImageRequest.Builder(graph.appContext).data(thumbnailUrl(baseUrl, image.id)).build()
        return thumbnailRequest(graph.appContext, baseUrl, server.id, image.id)
    }

    /** 在线插队补当前图（spec §4.2）：不排 Worker 队列，独立协程 ensure；离线/失败静默（占位已示意）。 */
    fun ensureViewable(image: ImageEntity) {
        val serverId = activeServer.value?.id ?: return
        if (localImages.value[image.id] != null || !graph.connectionMonitor.state.value.online) return
        viewModelScope.launch(Dispatchers.IO) {
            val tier = mirrorTierOf(graph.prefsStore.imageSaveModeName.first())
            graph.imageMirrorStore.ensure(serverId, image.id, tier)
        }
    }

    /** 分享文件（spec §4.4）：四级规则单张版。 */
    suspend fun shareFileFor(image: ImageEntity): Result<java.io.File> {
        val serverId = activeServer.value?.id ?: return Result.failure(IllegalStateException("无激活服务器"))
        val coordinator = ShareCoordinator(
            localFile = { graph.imageMirrorStore.localFile(serverId, it)?.file },
            ensure = { id, tier -> graph.imageMirrorStore.ensure(serverId, id, tier) },
            saveMode = { mirrorTierOf(graph.prefsStore.imageSaveModeName.first()) },
            online = { graph.connectionMonitor.state.value.online },
        )
        val outcome = coordinator.shareFiles(listOf(image))
        return outcome.files.firstOrNull()?.let { Result.success(it) }
            ?: Result.failure(IllegalStateException(if (graph.connectionMonitor.state.value.online) "拉取失败" else "未同步且离线"))
    }
```

- `ensureDownloadedThenUri`/`buildDeleteRequest`/`deleteLocalCopy`/`clearDownloadRow`/`gateway` 参数删除（消费点同步改）；`enqueueDownload` 保留（Task 7 已改签名）。

`ViewerScreen.kt`：
- `share(image)` 重写——离线预判改用 `viewModel.localImages.value`，成功分支 `FileProvider` URI：

```kotlin
    fun share(image: ImageEntity) {
        if (shareJob?.isActive == true) return
        if (!connState.online && viewModel.localImages.value[image.id] == null) {
            scope.launch { snackbar.showSnackbar("该图未同步且当前离线，无法分享") }
            return
        }
        shareJob = scope.launch {
            if (viewModel.localImages.value[image.id] == null) {
                launch { snackbar.showSnackbar("正在获取图片，完成后自动分享…") }
            }
            viewModel.shareFileFor(image)
                .onSuccess { file ->
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mimeOf(file.extension)
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    context.startActivity(Intent.createChooser(send, "分享图片"))
                }
                .onFailure { snackbar.showSnackbar("分享取消：${it.message}") }
        }
    }
```

（`mimeOf` 入参从 `image.format` 改为实际文件扩展名——HQ 的 png 源是 .jpg。）
- `modelFor` 的 remember key 改 `localImages[image.id]`；`onPrefetch` 改为 `viewModel.ensureViewable(image)` 的相邻预取（enqueue previewLoader 删除）；`actionBar` 的 `isDownloaded = downloadedIds.contains(image.id)`（downloadedUris map 引用全改）；storageGate 包装移除（镜像写私有目录不需要 WRITE 权限——门卫调用点删，`rememberLegacyStorageGate` 本体 Task 11 删）；「未同步」角标：`localImages[image.id] == null && !connState.online` 时叠加提示条。
- 删除确认（onDelete 的 hasLocal 快照）改 `localImages[image.id] != null`；删除成功后的本机副本级联段整体删除（镜像文件由对账级联自动清）。

`PhotosScreen.shareSelected()`/`AlbumDetailScreen` 同构改：`viewModel.ensureShareUris(ids)` → `viewModel.ensureShareFiles(ids)`，返回 files 转 FileProvider URI 列表，`ACTION_SEND_MULTIPLE` + `type = "image/*"`；批删后的 MediaStore 级联调用（`buildBatchDeleteRequest`/`deleteLocalCopies`/`downloadedUrisFor`）删除。`ui/common/UiText.kt` 的 `mimeOf` 改为按扩展名（`"jpg","jpeg"→image/jpeg` 等，入参语义不变）。

预览档删除：
- `ImageLoaders.kt`：删 `previewUrl`/`previewCacheKey`/`previewRequest`/`buildPreviewImageLoader`/`buildTierImageLoader`。
- `AppGraph.kt`：删 `previewLoader`；`mirrorStore` 装配的 `removeCachedImage` 只清缩略图键；`init` 加启动清理：

```kotlin
        // 预览档下线（spec §7）：一次性删除旧 cacheDir/previews 目录（v0.6 遗留盘占用）
        scope.launch(Dispatchers.IO) {
            runCatching { appContext.cacheDir.resolve("previews").deleteRecursively() }
        }
```

- `file_paths.xml` 改为：

```xml
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <!-- 镜像层分享（spec §4.4）：外部私有 mirror/ 为主，内部 filesDir 回退同名段 -->
    <external-files-path name="mirror" path="mirror/" />
    <files-path name="mirror_fallback" path="mirror/" />
    <cache-path name="shared" path="shared/" />
</paths>
```

- `AndroidManifest.xml` FileProvider 注释改为「镜像层文件分享主通道（spec §4.4）」。

- [ ] **Step 6: 运行测试通过**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest`
Expected: PASS。受影响既有测试的处理原则：Viewer/Photos/AlbumDetail 的 UI 测试里 mock downloads 表/gateway 的夹具改 mock `image_files` 行 + 镜像文件（临时目录真实文件）；分享断言从 MediaStore uri 改 FileProvider uri（`content://<pkg>.fileprovider/mirror/...`）。

- [ ] **Step 7: 提交**

```bash
git add android/app/src/main/ android/app/src/test/
git commit -m "feat(android): 分享改镜像四级规则走 FileProvider、大图页本地直出、1600px 预览档下线"
```

---

### Task 9: 设置页「图片同步」分组 + 存储页改版

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/settings/SettingsViewModel.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/settings/SettingsScreen.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/settings/CacheScreen.kt`（改版为存储页）、`CacheViewModel.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/MiuiWidgets.kt`（MiuiSwitchItem）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt`（SettingsScreen 传 VM）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/prefs/PrefsStore.kt`（删两档上限访问器）
- Test: `ui/settings/SettingsScreenTest.kt`（追加）、`ui/settings/CacheViewModelTest.kt`（重写）

**Interfaces:**
- Consumes: Task 3 `ImageFileDao.missingOriginalBytes/countFor`；Task 4 `ImageMirrorStore.stats/clearAllFiles`、`MirrorStats`、`MirrorTier`、`mirrorTierOf`；Task 5 `MirrorSyncMonitor.state`、`AppGraph.requestMirrorSync(replace)`、PrefsStore 新键；现有 `MiuiCardGroup/MiuiListItem/MiuiDialog`、`formatBytes`。
- Produces:
  - `SettingsViewModel(graph)`：`saveMode: StateFlow<MirrorTier>`、`cellular: StateFlow<Boolean>`、`syncState: StateFlow<MirrorSyncState>`、`syncedCount/totalCount: StateFlow<Long>`、`suspend fun estimateOriginalBytes(): Pair<Long, Long>`（补量, 可用空间）、`fun confirmSaveMode(mode: MirrorTier)`（写偏好 + REPLACE 入队）、`fun setCellular(Boolean)`；`companion factory(graph)`。
  - `MiuiSwitchItem(headline, checked, onCheckedChange, modifier, supporting)` 复用组件。
  - `SettingsScreen` 新签名：`SettingsScreen(vm: SettingsViewModel, onBack, onOpenServers, versionName, onOpenCache)`。
  - `CacheViewModel`：`mirrorStats: StateFlow<MirrorStats?>`、`thumbBytes: StateFlow<Long?>`、`syncState`、`fun clearThumbnails()`、`fun clearMirror()`（清文件+行+重新入队）、`fun requestSyncNow()`；两档上限/downloads 相关全删。

- [ ] **Step 1: 写失败测试**

`CacheViewModelTest.kt` 重写（仿既有夹具：in-memory db + AppGraph 构造注入或直接构造 VM 依赖——按现文件夹具形态对齐；若现文件直构 CacheViewModel(graph)，沿用）：

```kotlin
    @Test
    fun `refresh 统计镜像分档与缩略图占用`() = runTest {
        db.imageFileDao().upsert(ImageFileEntity(1, 1, "HQ", "s1/i1/a.jpg", 100, 0))
        db.imageFileDao().upsert(ImageFileEntity(1, 2, "ORIGINAL", "s1/i2/b.jpg", 5000, 0))
        vm.refresh()
        advanceUntilIdle()
        assertEquals(100L, vm.mirrorStats.value?.hqBytes)
        assertEquals(5000L, vm.mirrorStats.value?.originalBytes)
    }

    @Test
    fun `clearMirror 清行清文件并重新入队同步`() = runTest {
        db.imageFileDao().upsert(ImageFileEntity(1, 1, "HQ", "s1/i1/a.jpg", 100, 0))
        vm.clearMirror()
        advanceUntilIdle()
        assertEquals(0L, db.imageFileDao().countFor(1))
        assertTrue(clearedFiles)      // fake 回调
        assertTrue(resyncRequested)   // fake 回调
    }
```

`SettingsScreenTest.kt` 追加（compose-ui-test + Robolectric，仿既有用例）：

```kotlin
    @Test
    fun `图片同步分组——保存方式默认高质量、切原图弹确认框展示预估`() {
        composeRule.setContent {
            SettingsScreen(vm = fakeVm, onBack = {}, onOpenServers = {}, versionName = "t", onOpenCache = {})
        }
        composeRule.onNodeWithTag("settings_save_mode").assertExists()
        composeRule.onNodeWithText("高质量").assertExists()
        composeRule.onNodeWithTag("settings_save_mode_original").performClick()
        composeRule.onNodeWithTag("save_mode_confirm_dialog").assertExists()   // 预估占用确认框
    }

    @Test
    fun `切原图确认后写偏好并 REPLACE 入队；取消还原选项`() { /* fakeVm 记录 confirmSaveMode 调用 */ }

    @Test
    fun `允许移动网络同步开关默认关`() {
        composeRule.onNodeWithTag("settings_cellular_switch").assertIsOff()
    }
```

（fakeVm 形态按既有 SettingsScreenTest 的夹具惯例——若现文件直连真 VM + in-memory graph，则同构。）

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——SettingsViewModel/新签名不存在。

- [ ] **Step 3: 实现 MiuiSwitchItem + SettingsViewModel**

`MiuiWidgets.kt`（MiuiListItem 后）加：

```kotlin
/** 卡片组内开关行：标题/副文 + 右侧 Switch（设置页图片同步分组用）。 */
@Composable
fun MiuiSwitchItem(
    headline: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(headline, style = MaterialTheme.typography.bodyLarge)
            if (supporting != null) {
                Text(
                    supporting,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
```

新建 `SettingsViewModel.kt`：

```kotlin
package com.bluskysoftware.yandegallery.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.data.mirror.mirrorTierOf
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncMonitor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 设置页 VM（spec §5.1/§4.5）：图片保存方式（切原图走预估确认）、移动网络同步开关、同步状态行。
 */
class SettingsViewModel(private val graph: AppGraph) : ViewModel() {

    val saveMode: StateFlow<MirrorTier> =
        graph.prefsStore.imageSaveModeName.map { mirrorTierOf(it) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, MirrorTier.HQ)

    val cellular: StateFlow<Boolean> =
        graph.prefsStore.mirrorSyncCellular
            .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val syncState: StateFlow<MirrorSyncMonitor.MirrorSyncState> = graph.mirrorSyncMonitor.state

    /** 切原图预估（spec §4.5）：缺原图补量字节数 + 当前镜像分区可用空间。 */
    suspend fun estimateOriginalBytes(): Pair<Long, Long> = withContext(Dispatchers.IO) {
        val serverId = graph.serverRepository.activeServer()?.id ?: return@withContext 0L to 0L
        val need = graph.db.imageFileDao().missingOriginalBytes(serverId) ?: 0L
        need to graph.imageMirrorStore.rootFreeBytes()
    }

    /** 确认切换（含原图确认框「确定」与切回高质量直接生效）：写偏好 + REPLACE 入队重算缺失集合。 */
    fun confirmSaveMode(mode: MirrorTier) {
        viewModelScope.launch {
            graph.prefsStore.setImageSaveModeName(mode.name)
            graph.requestMirrorSync(replace = true)
        }
    }

    fun setCellular(allow: Boolean) {
        viewModelScope.launch {
            graph.prefsStore.setMirrorSyncCellular(allow)
            graph.requestMirrorSync(replace = true)   // 约束变化须 REPLACE 重建任务
        }
    }

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { SettingsViewModel(graph) }
        }
    }
}
```

（`ImageMirrorStore` 补一个 `fun rootFreeBytes(): Long = freeBytes()` 公开访问器。）

- [ ] **Step 4: SettingsScreen 图片同步分组**

`SettingsScreen` 签名加 `vm: SettingsViewModel`；服务器/缓存卡片组后插入：

```kotlin
            val saveMode by vm.saveMode.collectAsStateWithLifecycle()
            val cellular by vm.cellular.collectAsStateWithLifecycle()
            val sync by vm.syncState.collectAsStateWithLifecycle()
            var confirmOriginal by rememberSaveable { mutableStateOf(false) }
            var estimate by remember { mutableStateOf<Pair<Long, Long>?>(null) }
            val scope = rememberCoroutineScope()

            MiuiCardGroup(title = "图片同步") {
                MiuiListItem(
                    "图片保存方式",
                    supporting = "高质量约几百 KB/张；原图完整体积",
                    value = if (saveMode == MirrorTier.ORIGINAL) "原图" else "高质量",
                    modifier = Modifier.testTag("settings_save_mode"),
                )
                // 两档单选行（testTag settings_save_mode_hq / settings_save_mode_original）：
                // 点「原图」→ scope.launch { estimate = vm.estimateOriginalBytes(); confirmOriginal = true }
                // 点「高质量」→ vm.confirmSaveMode(MirrorTier.HQ)（已有原图保留，spec §4.5）
                MiuiSwitchItem(
                    "允许移动网络同步",
                    checked = cellular,
                    onCheckedChange = vm::setCellular,
                    supporting = "默认仅 WiFi 同步图片",
                    modifier = Modifier.testTag("settings_cellular_switch"),
                )
                MiuiListItem(
                    "同步状态",
                    supporting = when {
                        sync.running -> "同步中 ${sync.done}/${sync.total}"
                        sync.error == MirrorSyncMonitor.MirrorSyncError.SERVER_TOO_OLD -> "桌面端版本过旧，不支持高质量图档"
                        sync.error == MirrorSyncMonitor.MirrorSyncError.DISK_FULL -> "存储空间不足，同步已暂停"
                        sync.error == MirrorSyncMonitor.MirrorSyncError.NETWORK -> "网络中断，将自动重试"
                        else -> "空闲"
                    },
                    chevron = true,
                    onClick = onOpenCache,
                    modifier = Modifier.testTag("settings_sync_state"),
                )
            }
            if (confirmOriginal) {
                MiuiDialog(
                    title = "切换为保存原图？",
                    text = "预计需补充下载 ${formatBytes(estimate?.first ?: 0)}（可用空间 ${formatBytes(estimate?.second ?: 0)}）。" +
                        "切换后新图与已有高质量图将逐步替换为原图，替换完成即删除对应高质量图。",
                    onDismiss = { confirmOriginal = false },
                    dismissText = "取消",
                    confirmText = "确定",
                    onConfirm = {
                        confirmOriginal = false
                        vm.confirmSaveMode(MirrorTier.ORIGINAL)
                    },
                    modifier = Modifier.testTag("save_mode_confirm_dialog"),
                )
            }
```

（两档单选行按仓内 MiuiChoiceRow 或 FilterChip 惯例实现，testTag 如注释；MiuiDialog 若无 modifier 参数则包一层 Box testTag 或给 title 加 tag——按现组件签名微调，测试断言随之。）「缓存管理」入口行文案改「存储管理」，supporting 改「镜像占用、缩略图缓存、同步进度」。`MainActivity.kt` 装配 `SettingsViewModel` 并传入。

- [ ] **Step 5: CacheScreen/CacheViewModel 改版**

`CacheViewModel` 重写为：

```kotlin
/**
 * 存储管理（spec §5.2）：镜像分档占用 + 缩略图缓存占用 + 同步状态；清理缩略图/清空镜像（重同步）。
 * 两档上限设置与已下载记录随预览档/downloads 表一并退役（D9/D6）。
 */
class CacheViewModel(private val graph: AppGraph) : ViewModel() {

    private val _mirrorStats = MutableStateFlow<MirrorStats?>(null)
    val mirrorStats: StateFlow<MirrorStats?> = _mirrorStats

    private val _thumbBytes = MutableStateFlow<Long?>(null)
    val thumbBytes: StateFlow<Long?> = _thumbBytes

    val syncState: StateFlow<MirrorSyncMonitor.MirrorSyncState> = graph.mirrorSyncMonitor.state

    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            val serverId = graph.serverRepository.activeServer()?.id
            _mirrorStats.value = if (serverId != null) graph.imageMirrorStore.stats(serverId) else MirrorStats()
            _thumbBytes.value = graph.thumbnailLoader.diskCache?.size ?: 0L
        }
    }

    fun clearThumbnails() {
        viewModelScope.launch(Dispatchers.IO) {
            graph.thumbnailLoader.diskCache?.clear()
            graph.thumbnailLoader.memoryCache?.clear()
            refresh()
        }
    }

    /** 清空镜像（spec §5.2，二次确认在 UI）：清行 + 删文件 + 自动重新入队同步。 */
    fun clearMirror() {
        viewModelScope.launch(Dispatchers.IO) {
            graph.db.imageFileDao().clearAll()
            graph.imageMirrorStore.clearAllFiles()
            graph.requestMirrorSync(replace = true)
            refresh()
        }
    }

    fun requestSyncNow() = graph.requestMirrorSync()

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { CacheViewModel(graph) }
        }
    }
}
```

（`formatBytes` 顶层函数原样保留。）`CacheScreen` 改版：标题「存储管理」；区块=①图片镜像（高质量 n 张 xx MB / 原图 n 张 xx GB、「立即同步」`storage_sync_now`、「清空图片镜像」`storage_clear_mirror` 带 MiuiDialog 二次确认「清空后将自动重新同步」）②缩略图缓存（占用 + 「清理」`cache_clear_thumb` 保留）③同步状态（复用设置行文案逻辑）。两档 FilterChip 区、预览区、下载记录区、页脚「下次启动生效」全删。

- [ ] **Step 6: PrefsStore 删两档上限访问器**

删 `thumbnailCacheMaxBytes`/`previewCacheMaxBytes`/`setThumbnailCacheMaxBytes`/`setPreviewCacheMaxBytes`、`KEY_THUMB_MAX`/`KEY_PREVIEW_MAX`、`DEFAULT_THUMB_MAX_BYTES`/`DEFAULT_PREVIEW_MAX_BYTES`（DataStore 陈旧键无害不清理，spec §5.3）；`PrefsStoreTest` 对应用例删除。类 KDoc 的「两档盘缓存上限」措辞更新。

- [ ] **Step 7: 运行测试通过 + 提交**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest --tests "com.bluskysoftware.yandegallery.ui.settings.*" --tests "com.bluskysoftware.yandegallery.data.prefs.PrefsStoreTest"`，再全量。
Expected: PASS。

```bash
git add android/app/src/main/ android/app/src/test/
git commit -m "feat(android): 设置新增图片保存方式与移动网络开关、缓存页改版存储管理——移除两档上限"
```

---

### Task 10: 收尾退役——Room v7 删 downloads、MediaStore 链路删除、权限清理、版本号与文档

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/AppDatabase.kt`（v7）、`Entities.kt`（删 DownloadEntity）
- Delete: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/DownloadDao.kt`、`data/media/MediaStoreGateway.kt`、`data/media/AndroidMediaStoreGateway.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`（删 mediaStoreGateway）、`data/repo/RoomMirrorStore.kt`（删 gateway/downloads 引用）
- Delete/Modify: legacy 存储门卫 `rememberLegacyStorageGate`（定位：`grep -rn "rememberLegacyStorageGate" android/app/src/main`——所在文件删除或仅删该函数与 `LEGACY_STORAGE_DENIED_TEXT`，视同文件内是否有他用而定）
- Modify: `android/app/src/main/AndroidManifest.xml`（删 WRITE_EXTERNAL_STORAGE 与其注释）
- Modify: `android/app/build.gradle.kts`（versionCode 8 / versionName "0.7.0"）
- Modify: `android/README.md`（端点表加 /hq、存储与离线章节按镜像层改写）
- Delete: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/media/AndroidMediaStoreGatewayTest.kt` 及其余仅覆盖已删符号的测试
- Test: `data/db/MigrationTest.kt`（追加 v7 用例）

**Interfaces:**
- Consumes: Task 3-9 已把所有 downloads/MediaStore 消费点切走（本任务前置校验：`grep -rn "downloadDao\|DownloadEntity\|mediaStoreGateway\|MediaStoreGateway" android/app/src/main` 仅剩 AppDatabase/Entities/RoomMirrorStore/AppGraph 装配残留——若还有 UI 消费点说明前序任务有漏，先回补）。
- Produces: `AppDatabase.MIGRATION_6_7`；最终迁移链 1→7；仓内不再有 MediaStore 写入路径（需求 5 完成态）。

- [ ] **Step 1: 写失败测试**

`MigrationTest.kt` 追加：

```kotlin
    @Test
    fun `v6 迁移到 v7 downloads 表删除 image_files 保留`() = runTest {
        createRealV1Database()

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(
                AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4,
                AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6, AppDatabase.MIGRATION_6_7,
            )
            .allowMainThreadQueries()
            .build()
        try {
            db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'", null)
                .use { assertFalse(it.moveToFirst()) }
            db.imageFileDao().upsert(ImageFileEntity(1L, 1L, "HQ", "s1/i1/a.jpg", 10L, 0L))
            assertEquals(1L, db.imageFileDao().countFor(1L))
        } finally {
            db.close()
        }
    }
```

（既有用例的迁移链再补 `MIGRATION_6_7`；Task 3 加的 v6 用例中「downloads 表 v6 仍在」断言删除——v7 后打开库走全链，该中间态不再可观察，改为只断言 image_files 可用。）

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew.bat :app:compileDebugUnitTestKotlin`
Expected: FAIL——MIGRATION_6_7 未定义。

- [ ] **Step 3: 实现 v7 与删除链**

`AppDatabase.kt`：version 7；entities 删 `DownloadEntity::class`；删 `abstract fun downloadDao()`；companion 加：

```kotlin
        // v6→7（镜像 spec §7/D6）：MediaStore 下载链路退役，DROP downloads。旧下载记录作废
        // （历史相册文件保留不动）；新语义由 image_files 承载。
        val MIGRATION_6_7 = object : androidx.room.migration.Migration(6, 7) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("DROP TABLE IF EXISTS `downloads`")
            }
        }
```

链尾加 `MIGRATION_6_7`。随后编译器驱动删除：
- `Entities.kt`：删 `DownloadEntity` 与其注释块。
- 删 `DownloadDao.kt`（含 `DownloadWithMeta`）、`MediaStoreGateway.kt`、`AndroidMediaStoreGateway.kt`。
- `RoomMirrorStore.kt`：构造删 `gateway` 参数；`clearMirror` 删 `db.downloadDao().clearAll()` 行；`deleteImages` 删 downloadRows 预取段、`db.downloadDao().deleteByImageIds` 行、`gateway?.discard` 循环；类 KDoc 的 M4-T9 gateway 措辞更新为镜像级联口径。
- `AppGraph.kt`：删 `mediaStoreGateway`；`mirrorStore` 装配删 `gateway = ...` 行。
- `ViewerViewModel.kt`：构造删 `gateway` 参数残留（Task 8 已删消费，本步删形参）。
- legacy 门卫：删 `rememberLegacyStorageGate`/`LEGACY_STORAGE_DENIED_TEXT` 及全部调用点（Task 8 已解除 Viewer 的包装；Photos/AlbumDetail 若仍有 `storageGate { ... }` 包装一并解开为直调）。
- `AndroidManifest.xml`：删 `WRITE_EXTERNAL_STORAGE` uses-permission 与「原图下载写系统相册」注释块。
- 删 `AndroidMediaStoreGatewayTest.kt`；`grep -rln "MediaStoreGateway\|downloadDao\|DownloadEntity\|DownloadWithMeta" android/app/src/test` 命中的其余测试文件逐个处理（删文件或删用例）。

- [ ] **Step 4: 版本号与文档**

`android/app/build.gradle.kts`：`versionCode = 8`、`versionName = "0.7.0"`。

`android/README.md`：端点清单补 `GET /api/app/v1/images/{id}/hq`（高质量档，长边 2560 同格式压缩/png→jpg）；「下载」「分享」「离线」章节按镜像层语义改写（原图入 app 私有镜像不进相册、分享 FileProvider 四级规则、连接后自动增量同步图片、默认仅 WiFi）；缓存章节删两档上限描述。以实际实现为准核对措辞（CLAUDE.md 文档规范：先验证行为再写文档）。

- [ ] **Step 5: 全量测试 + 提交**

Run: `cd android && ./gradlew.bat :app:testDebugUnitTest` 与 `npm run test`（桌面全量含 typecheck）。
Expected: 双端 PASS。

```bash
git add android/ doc/
git commit -m "chore(android): 收尾退役 MediaStore 下载链路——Room v7 删 downloads、清 legacy 存储权限、版本升 0.7.0"
```

---

## 任务依赖图

```
Task 1 (桌面 generateHq) ──► Task 2 (桌面 /hq 路由)
                                    │
Task 3 (Room v6 image_files) ──► Task 4 (ImageMirrorStore + downloadHq) ──► Task 5 (镜像同步链路)
                                    │                                          │
                                    ├──► Task 6 (缩略图镜像优先)                │
                                    ├──► Task 7 (下载原图改镜像) ◄─────────────┘（Task 5 的 AppGraph 装配先行）
                                    └──► Task 8 (分享/大图/预览档下线)（依赖 5/6/7 全部）
                                              │
                                              ▼
                                    Task 9 (设置/存储页) ──► Task 10 (收尾退役)
```

桌面（1-2）与安卓（3-4）可并行开工；Task 4 的联调（真机拉 /hq）依赖 Task 2 完成。

## 计划自审记录

1. **Spec 覆盖对照**：§2 桌面 HQ→Task 1/2；§3.1-3.3 镜像层→Task 3/4；§3.4 同步与对账→Task 5；§4.1 缩略图→Task 6；§4.3 下载→Task 7；§4.2/§4.4 大图与分享→Task 8；§4.5/§5 设置存储→Task 9；§7 兼容迁移（v7、旧 previews 清理、README）→Task 8/10；§6 错误处理分散在 4/5/7 的实现与测试。无缺口。
2. **占位符扫描**：Task 8 Step 5 与 Task 9 Step 4 的 UI 组装留有「按现组件签名微调」字样——这是对 Compose 组件参数形态的实测适配指引（MiuiDialog 是否有 modifier 等），核心行为代码均已给出，不属 TBD。Task 6 对 Coil Fetcher 给了两个实现方案并指定默认（自行回退），执行者按测试通过收敛。
3. **类型一致性**：`ImageMirrorStore.ensure(serverId, imageId, tier): Result<File>` 在 Task 5/7/8/9 的消费签名一致；`MirrorTier`/`mirrorTierOf`/`LocalImage` 引用路径统一 `data.mirror`；`ShareCoordinator.shareFiles` 与 `SelectionActions.ensureShareFiles` 返回 `ShareOutcome(files, failedIds)` 一致；`MirrorSyncMonitor.MirrorSyncState` 字段在 Task 9 消费处一致；PrefsStore 新键名与 Global Constraints 一致。
4. **顺序风险**：Task 3 的 MigrationTest「downloads 保留」断言在 Task 10 改写——已在 Task 10 Step 1 显式交代；Task 6 保留预览档符号、Task 8 删除——两处都写明了顺序说明。
