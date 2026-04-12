# TODO 模块化总实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性完成当前 [TODO.md](TODO.md) 中所有图库、下载、标签管理、导航、更新检查与通用交互优化需求。

**Architecture:** 以“统一规则、统一入口、局部重构”为原则推进：下载相关问题统一收敛到批量任务服务层去重；Booru 左侧导航只保留一级+二级菜单，标签管理与下载通过右侧页内子导航承载原“三级”；图库页把“刷新当前展示”和“同步文件夹”拆成两个明确动作，并补齐图集编辑入口与统一 tooltip / 关闭交互规范。

**Tech Stack:** Electron 39、React 18、TypeScript、Ant Design 5、SQLite、Vitest、现有 preload IPC + main services 架构。

---

## 文件结构与职责映射

### 需要新增的文件
- `src/renderer/pages/BooruTagManagementPage.tsx` — 合并“收藏标签 / 黑名单”的右侧页内容，内部提供“喜欢 / 黑名单”页内切换。
- `src/renderer/pages/BooruDownloadHubPage.tsx` — 合并“下载管理 / 批量下载”的右侧页内容，内部提供“下载 / 批量下载”页内切换。
- `src/renderer/components/IconOnlyButton.tsx` — 统一纯图标按钮 tooltip 包装，减少散落 Tooltip 重复代码。
- `tests/renderer/pages/BooruTagManagementPage.test.tsx` — 标签管理合并页的默认页签、切换与透传行为。
- `tests/renderer/pages/BooruDownloadHubPage.test.tsx` — 下载合并页的默认页签与切换行为。
- `tests/main/services/gallerySync.test.ts` 或追加到 `tests/main/services/galleryService.test.ts` — 当前图集目录同步逻辑测试。

### 需要重点修改的文件
- `src/renderer/App.tsx` — 一级 / 二级菜单结构、点击行为、固定菜单迁移、右侧页面路由。
- `src/renderer/SubWindowApp.tsx` — 扩展子窗口路由，支持通用二级菜单页面。
- `src/preload/index.ts` — 暴露新的通用子窗口入口、图库同步入口。
- `src/main/window.ts` — 新增通用二级菜单子窗口路由创建逻辑。
- `src/renderer/pages/FavoriteTagsPage.tsx` — 下载按钮反馈、排序、placeholder、默认每页数量、合并后的被嵌入模式兼容。
- `src/renderer/pages/BlacklistedTagsPage.tsx` — 合并页嵌入兼容。
- `src/renderer/pages/BooruDownloadPage.tsx` — 合并页嵌入兼容。
- `src/renderer/pages/BooruBulkDownloadPage.tsx` — 合并页嵌入兼容、默认参数 200。
- `src/main/services/bulkDownloadService.ts` — 任务层去重、唯一键计算、重复任务返回码。
- `src/main/ipc/handlers.ts` — 下载入口统一、图库同步 IPC、更新检查错误统一返回。
- `src/main/services/galleryService.ts` — 当前图集目录同步、图集统计更新复用。
- `src/main/services/imageService.ts` — 复用目录扫描导入，不重写底层扫描。
- `src/renderer/pages/GalleryPage.tsx` — 同步按钮、刷新按钮 tooltip、图集右键编辑、编辑弹窗、详情布局调整。
- `src/renderer/pages/SettingsPage.tsx` — 检查更新错误态展示核对。
- `src/shared/types.ts` — 若需要为批量任务去重结果 / 子窗口路由参数扩展类型。
- `tests/main/services/bulkDownloadService.test.ts` — 去重规则测试。
- `tests/main/ipc/handlers.favoriteTagDownload.test.ts` — 收藏标签页重复点击下载行为测试。
- `tests/renderer/pages/FavoriteTagsPage.test.tsx` / `logic.test.ts` / `render.test.tsx` — UI 提示、排序、默认值、tooltip 行为。
- `tests/main/services/updateService.test.ts` — 更新检查链路与错误归一化。

### 复用现有能力
- `galleryService.updateGallery(...)` 已支持图集名称修改，可直接复用到编辑弹窗保存。
- `imageService.scanAndImportFolder(...)` 可复用为“当前图集目录同步”的底层实现。
- `galleryService.updateGalleryStats(...)` 可复用更新图片数量与 `lastScannedAt`。
- `SubWindowApp.tsx` 现有 tag-search / artist / character 子窗口体系可扩展为通用二级页路由，不必重造。

---

## Task 1: 重构 Booru 导航模型与固定菜单迁移

**Files:**
- Modify: `src/renderer/App.tsx:86-167`
- Modify: `src/renderer/App.tsx:177-301`
- Modify: `src/renderer/App.tsx:393-477`
- Modify: `src/renderer/App.tsx:520-760`（二级内容渲染区域，实际行号以实现时为准）
- Test: `tests/renderer/pages/BooruTagManagementPage.test.tsx`
- Test: `tests/renderer/pages/BooruDownloadHubPage.test.tsx`

- [ ] **Step 1: 写出失败测试，固定导航目标与默认子页**

```tsx
// tests/renderer/pages/BooruTagManagementPage.test.tsx
it('defaults to favorite tab inside tag management page', () => {
  render(<BooruTagManagementPage />)
  expect(screen.getByRole('tab', { name: '喜欢' })).toHaveAttribute('aria-selected', 'true')
})

// tests/renderer/pages/BooruDownloadHubPage.test.tsx
it('defaults to download tab inside download hub page', () => {
  render(<BooruDownloadHubPage />)
  expect(screen.getByRole('tab', { name: '下载' })).toHaveAttribute('aria-selected', 'true')
})
```

- [ ] **Step 2: 运行测试，确认页面尚不存在或默认行为不满足**

Run: `npm run test -- tests/renderer/pages/BooruTagManagementPage.test.tsx tests/renderer/pages/BooruDownloadHubPage.test.tsx`
Expected: FAIL，提示页面文件不存在或默认 tab 断言失败。

- [ ] **Step 3: 在 `App.tsx` 中合并二级菜单定义，并把“三级”改为右侧页内切换**

```ts
function buildBooruSubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'posts', icon: <DotIcon color={iconColors.posts} icon={<CloudOutlined />} />, label: t('menu.posts') },
    { key: 'popular', icon: <DotIcon color={iconColors.popular} icon={<FireOutlined />} />, label: t('menu.popular') },
    { key: 'pools', icon: <DotIcon color={iconColors.pools} icon={<DatabaseOutlined />} />, label: t('menu.pools') },
    { key: 'forums', icon: <DotIcon color="#0EA5E9" icon={<MessageOutlined />} />, label: t('menu.forums') },
    { key: 'user-profile', icon: <DotIcon color={iconColors.favorites} icon={<UserOutlined />} />, label: t('menu.userProfile') },
    { key: 'favorites', icon: <DotIcon color={iconColors.favorites} icon={<BookOutlined />} />, label: t('menu.favorites') },
    { key: 'server-favorites', icon: <DotIcon color={iconColors.serverFavorites} icon={<HeartOutlined />} />, label: t('menu.serverFavorites') },
    { key: 'tag-management', icon: <DotIcon color={iconColors.favoriteTags} icon={<StarOutlined />} />, label: '标签管理' },
    { key: 'download', icon: <DotIcon color={iconColors.downloads} icon={<CloudDownloadOutlined />} />, label: '下载' },
    { key: 'saved-searches', icon: <DotIcon color="#6366F1" icon={<SearchOutlined />} />, label: t('menu.savedSearches') },
    { key: 'booru-settings', icon: <DotIcon color={iconColors.booruSettings} icon={<CloudOutlined />} />, label: t('menu.siteConfig') },
  ]
}
```

- [ ] **Step 4: 调整一级菜单点击行为，只切换左侧二级菜单，不强制改右侧内容**

```ts
const handleMainMenuClick = (key: string) => {
  setSelectedKey(key)
  setNavigationStack([])
  setHeaderExtra(null)
  if (key === 'gallery' && !selectedSubKey) setSelectedSubKey('recent')
  if (key === 'booru' && !selectedBooruSubKey) setSelectedBooruSubKey('posts')
  if (key === 'google' && !selectedGoogleSubKey) setSelectedGoogleSubKey('gdrive')
  // 不在这里直接切换右侧具体页面，保留当前 sub key / page 内部状态。
}
```

- [ ] **Step 5: 加入旧 pinned / 旧路由迁移映射**

```ts
const migratePinnedKey = (section: PinnedItem['section'], key: string) => {
  if (section !== 'booru') return { section, key, tab: undefined as string | undefined }
  if (key === 'favorite-tags') return { section, key: 'tag-management', tab: 'favorite' }
  if (key === 'blacklisted-tags') return { section, key: 'tag-management', tab: 'blacklist' }
  if (key === 'downloads') return { section, key: 'download', tab: 'downloads' }
  if (key === 'bulk-download') return { section, key: 'download', tab: 'bulk' }
  return { section, key, tab: undefined }
}
```

- [ ] **Step 6: 新增合并页容器，承载页内子导航**

```tsx
// src/renderer/pages/BooruTagManagementPage.tsx
export const BooruTagManagementPage: React.FC<{ defaultTab?: 'favorite' | 'blacklist' }> = ({ defaultTab = 'favorite' }) => {
  const [activeTab, setActiveTab] = useState<'favorite' | 'blacklist'>(defaultTab)
  return (
    <div>
      <Segmented
        value={activeTab}
        onChange={(value) => setActiveTab(value as 'favorite' | 'blacklist')}
        options={[
          { label: '喜欢', value: 'favorite' },
          { label: '黑名单', value: 'blacklist' },
        ]}
      />
      {activeTab === 'favorite' ? <FavoriteTagsPage /> : <BlacklistedTagsPage />}
    </div>
  )
}
```

- [ ] **Step 7: 跑测试，验证默认页与切换逻辑**

Run: `npm run test -- tests/renderer/pages/BooruTagManagementPage.test.tsx tests/renderer/pages/BooruDownloadHubPage.test.tsx tests/renderer/pages/FavoriteTagsPage.test.tsx`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add TODO.md src/renderer/App.tsx src/renderer/pages/BooruTagManagementPage.tsx src/renderer/pages/BooruDownloadHubPage.tsx tests/renderer/pages/BooruTagManagementPage.test.tsx tests/renderer/pages/BooruDownloadHubPage.test.tsx tests/renderer/pages/FavoriteTagsPage.test.tsx
git commit -m "feat: 合并 booru 二级菜单并新增页内子导航"
```

---

## Task 2: 扩展二级菜单“单独窗口打开”能力

**Files:**
- Modify: `src/renderer/SubWindowApp.tsx:14-145`
- Modify: `src/preload/index.ts:536-541`
- Modify: `src/main/window.ts:117-220`
- Modify: `src/renderer/App.tsx`（二级菜单右键菜单区域）
- Test: `tests/main/ipc/handlers.test.ts`

- [ ] **Step 1: 写失败测试，定义通用二级菜单子窗口路由**

```ts
it('opens booru tag management sub window with favorite tab', async () => {
  const result = await windowApi.openSecondaryMenu('booru', 'tag-management', 'favorite')
  expect(result.success).toBe(true)
})
```

- [ ] **Step 2: 运行测试，确认当前没有通用二级菜单窗口 API**

Run: `npm run test -- tests/main/ipc/handlers.test.ts`
Expected: FAIL，缺少 `openSecondaryMenu` 或对应 IPC。

- [ ] **Step 3: 在 preload 暴露通用入口**

```ts
window: {
  openTagSearch: (tag: string, siteId?: number | null) => ipcRenderer.invoke('window:open-tag-search', tag, siteId),
  openArtist: (name: string, siteId?: number | null) => ipcRenderer.invoke('window:open-artist', name, siteId),
  openCharacter: (name: string, siteId?: number | null) => ipcRenderer.invoke('window:open-character', name, siteId),
  openSecondaryMenu: (section: string, key: string, tab?: string) =>
    ipcRenderer.invoke('window:open-secondary-menu', section, key, tab),
},
```

- [ ] **Step 4: 在主进程统一创建子窗口 hash 路由**

```ts
ipcMain.handle('window:open-secondary-menu', async (_event, section: string, key: string, tab?: string) => {
  const search = new URLSearchParams({ section, key })
  if (tab) search.set('tab', tab)
  createSubWindow(`#secondary-menu?${search.toString()}`)
  return { success: true }
})
```

- [ ] **Step 5: 在 `SubWindowApp.tsx` 中支持 secondary-menu 路由**

```tsx
interface SubWindowRoute {
  type: 'tag-search' | 'artist' | 'character' | 'secondary-menu' | 'unknown'
  params: URLSearchParams
}

if (type === 'secondary-menu') {
  const section = params.get('section')
  const key = params.get('key')
  const tab = params.get('tab')
  return { type: 'secondary-menu', params }
}
```

- [ ] **Step 6: 为左侧二级菜单加右键菜单入口**

```tsx
const secondaryMenuContextItems = [
  {
    key: 'open-sub-window',
    label: '单独窗口打开',
    onClick: () => window.electronAPI.window.openSecondaryMenu('booru', item.key, item.key === 'tag-management' ? 'favorite' : item.key === 'download' ? 'downloads' : undefined),
  },
]
```

- [ ] **Step 7: 运行测试，验证 IPC 路由和 hash 生成**

Run: `npm run test -- tests/main/ipc/handlers.test.ts tests/main/ipc/setupIPC.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add TODO.md src/renderer/SubWindowApp.tsx src/preload/index.ts src/main/window.ts src/renderer/App.tsx tests/main/ipc/handlers.test.ts tests/main/ipc/setupIPC.test.ts
git commit -m "feat: 为二级菜单新增单独窗口打开能力"
```

---

## Task 3: 在批量下载服务层实现统一去重

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts:35-85`
- Modify: `src/main/services/bulkDownloadService.ts`（新增查重辅助函数）
- Modify: `src/shared/types.ts`
- Test: `tests/main/services/bulkDownloadService.test.ts`
- Test: `tests/main/ipc/handlers.favoriteTagDownload.test.ts`

- [ ] **Step 1: 写失败测试，按“下载路径 + 标签合集”判重**

```ts
it('deduplicates bulk download tasks by path and normalized tags', async () => {
  const first = await createBulkDownloadTask({ siteId: 1, path: '/tmp/a', tags: ['a', 'b'], perPage: 200, concurrency: 3 })
  const second = await createBulkDownloadTask({ siteId: 1, path: '/tmp/a', tags: ['b', 'a'], perPage: 200, concurrency: 3 })
  expect(first.success).toBe(true)
  expect(second.success).toBe(true)
  expect(second.data?.id).toBe(first.data?.id)
  expect(second.data?.deduplicated).toBe(true)
})
```

- [ ] **Step 2: 跑测试，确认当前重复任务会被创建两次**

Run: `npm run test -- tests/main/services/bulkDownloadService.test.ts tests/main/ipc/handlers.favoriteTagDownload.test.ts`
Expected: FAIL，第二次创建得到新任务 ID。

- [ ] **Step 3: 统一标准化标签合集**

```ts
function normalizeTagSet(tags: string[]): string {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].sort().join(' ')
}
```

- [ ] **Step 4: 在创建任务前按“路径 + 标准化标签”查重**

```ts
const normalizedTags = normalizeTagSet(options.tags)
const existing = await get<any>(db, `
  SELECT * FROM bulk_download_tasks
  WHERE path = ? AND tags = ?
  ORDER BY createdAt DESC
  LIMIT 1
`, [options.path, normalizedTags])

if (existing) {
  return {
    success: true,
    data: {
      id: existing.id,
      siteId: existing.siteId,
      path: existing.path,
      tags: existing.tags,
      blacklistedTags: existing.blacklistedTags,
      notifications: Boolean(existing.notifications),
      skipIfExists: Boolean(existing.skipIfExists),
      quality: existing.quality,
      perPage: existing.perPage,
      concurrency: existing.concurrency,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      deduplicated: true,
    } as BulkDownloadTask,
  }
}
```

- [ ] **Step 5: 把默认 `perPage` 统一改为 200**

```ts
perPage: options.perPage ?? 200,
```

- [ ] **Step 6: 在共享类型中声明去重结果字段**

```ts
export interface BulkDownloadTask {
  id: string
  siteId: number
  path: string
  tags: string
  blacklistedTags?: string | null
  notifications: boolean
  skipIfExists: boolean
  quality?: string | null
  perPage: number
  concurrency: number
  createdAt: string
  updatedAt: string
  deduplicated?: boolean
}
```

- [ ] **Step 7: 跑测试，验证重复创建返回同一任务**

Run: `npm run test -- tests/main/services/bulkDownloadService.test.ts tests/main/ipc/handlers.favoriteTagDownload.test.ts`
Expected: PASS，重复任务被服务层吞并并标记 `deduplicated: true`。

- [ ] **Step 8: Commit**

```bash
git add TODO.md src/main/services/bulkDownloadService.ts src/shared/types.ts tests/main/services/bulkDownloadService.test.ts tests/main/ipc/handlers.favoriteTagDownload.test.ts
git commit -m "fix: 统一批量下载任务去重规则"
```

---

## Task 4: 收藏标签页接入统一下载入口并完善提示、排序与默认值

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx:93-255`
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`（下载按钮、排序、placeholder、每页默认值）
- Test: `tests/renderer/pages/FavoriteTagsPage.test.tsx`
- Test: `tests/renderer/pages/FavoriteTagsPage.logic.test.ts`
- Test: `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

- [ ] **Step 1: 写失败测试，验证重复点击只提示“已存在/进行中”**

```tsx
it('shows existing-task message on repeated download click', async () => {
  render(<FavoriteTagsPage />)
  await user.click(screen.getByRole('button', { name: /下载/i }))
  await user.click(screen.getByRole('button', { name: /下载/i }))
  expect(message.success).toHaveBeenCalledWith(expect.stringMatching(/任务创建成功|任务已存在|任务进行中/))
})
```

- [ ] **Step 2: 运行测试，确认当前行为会连续发起多次任务**

Run: `npm run test -- tests/renderer/pages/FavoriteTagsPage.test.tsx tests/renderer/pages/FavoriteTagsPage.logic.test.ts tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
Expected: FAIL，重复点击未走统一提示。

- [ ] **Step 3: 收藏标签下载按钮接入统一返回结果**

```ts
const handleStartDownload = async (tag: FavoriteTagWithDownloadState) => {
  setActionLoading(tag.id)
  try {
    const result = await window.electronAPI.bulkDownload.createTask({
      siteId: tag.siteId,
      path: tag.downloadBinding?.downloadPath,
      tags: [tag.tagName],
      perPage: tag.downloadBinding?.perPage ?? 200,
      concurrency: tag.downloadBinding?.concurrency ?? 3,
      skipIfExists: tag.downloadBinding?.skipIfExists ?? true,
      notifications: tag.downloadBinding?.notifications ?? true,
      blacklistedTags: tag.downloadBinding?.blacklistedTags?.split(' ').filter(Boolean) ?? [],
    })

    if (result.success && result.data?.deduplicated) {
      message.info('任务已存在')
      return
    }

    if (result.success) {
      message.success('任务创建成功')
      return
    }

    message.error(result.error || '创建任务失败')
  } finally {
    setActionLoading(null)
  }
}
```

- [ ] **Step 4: 实现排序器与动态 placeholder**

```ts
type FavoriteSortKey = 'tagName' | 'galleryName' | 'lastDownloadedAt'
type FavoriteSortOrder = 'asc' | 'desc'

const favoritePlaceholder = activeTab === 'favorite' ? '搜索喜欢标签' : '搜索黑名单标签'
```

- [ ] **Step 5: 把默认每页数量改为 200，并从统一来源读写**

```ts
perPage: number;
// 默认表单值
perPage: tag.downloadBinding?.perPage ?? 200,
```

- [ ] **Step 6: 为纯图标按钮补 tooltip**

```tsx
<Tooltip title="下载">
  <Button type="text" icon={<DownloadOutlined />} onClick={() => handleStartDownload(record)} />
</Tooltip>
```

- [ ] **Step 7: 跑测试，验证排序、placeholder、提示与默认值**

Run: `npm run test -- tests/renderer/pages/FavoriteTagsPage.test.tsx tests/renderer/pages/FavoriteTagsPage.logic.test.ts tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add TODO.md src/renderer/pages/FavoriteTagsPage.tsx tests/renderer/pages/FavoriteTagsPage.test.tsx tests/renderer/pages/FavoriteTagsPage.logic.test.ts tests/renderer/pages/FavoriteTagsPage.render.test.tsx
git commit -m "feat: 完善收藏标签下载提示与排序交互"
```

---

## Task 5: 为图库补齐“同步文件夹”能力并复用现有扫描逻辑

**Files:**
- Modify: `src/main/services/imageService.ts:520-594`
- Modify: `src/main/services/galleryService.ts:282-478`
- Modify: `src/main/ipc/handlers.ts:403-449`
- Modify: `src/preload/index.ts`
- Test: `tests/main/services/galleryService.test.ts`
- Test: `tests/main/ipc/handlers.test.ts`

- [ ] **Step 1: 写失败测试，定义当前图集目录同步行为**

```ts
it('syncs gallery folder by importing new images and updating stats', async () => {
  const result = await syncGalleryFolder(galleryId)
  expect(result.success).toBe(true)
  expect(result.data?.imported).toBeGreaterThanOrEqual(0)
  expect(result.data?.lastScannedAt).toBeTruthy()
})
```

- [ ] **Step 2: 运行测试，确认当前没有“图集级同步”服务**

Run: `npm run test -- tests/main/services/galleryService.test.ts tests/main/ipc/handlers.test.ts`
Expected: FAIL，缺少 `syncGalleryFolder` 或返回值不匹配。

- [ ] **Step 3: 在 gallery service 中补一个轻量同步封装，复用现有扫描逻辑**

```ts
export async function syncGalleryFolder(id: number): Promise<{ success: boolean; data?: { imported: number; skipped: number; imageCount: number; lastScannedAt: string }; error?: string }> {
  const galleryResult = await getGallery(id)
  if (!galleryResult.success || !galleryResult.data) {
    return { success: false, error: galleryResult.error || 'Gallery not found' }
  }

  const gallery = galleryResult.data
  const importResult = await scanAndImportFolder(gallery.folderPath, gallery.extensions, gallery.recursive)
  if (!importResult.success || !importResult.data) {
    return { success: false, error: importResult.error || 'Sync failed' }
  }

  const countResult = await getImagesByFolder(gallery.folderPath, 1, 100000)
  const imageCount = countResult.success && countResult.data ? countResult.data.length : gallery.imageCount
  const lastScannedAt = new Date().toISOString()

  await updateGalleryStats(id, imageCount, lastScannedAt)
  return { success: true, data: { imported: importResult.data.imported, skipped: importResult.data.skipped, imageCount, lastScannedAt } }
}
```

- [ ] **Step 4: 增加 IPC 与 preload 暴露**

```ts
ipcMain.handle('gallery:sync-gallery-folder', async (_event, id: number) => {
  try {
    return await syncGalleryFolder(id)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})
```

- [ ] **Step 5: 跑测试，确认复用路径正确**

Run: `npm run test -- tests/main/services/galleryService.test.ts tests/main/ipc/handlers.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add TODO.md src/main/services/galleryService.ts src/main/services/imageService.ts src/main/ipc/handlers.ts src/preload/index.ts tests/main/services/galleryService.test.ts tests/main/ipc/handlers.test.ts
git commit -m "feat: 新增图集级同步文件夹能力"
```

---

## Task 6: 图库页增加同步按钮、右键编辑与图集改名

**Files:**
- Modify: `src/renderer/pages/GalleryPage.tsx:42-97`
- Modify: `src/renderer/pages/GalleryPage.tsx:385-417`
- Modify: `src/renderer/pages/GalleryPage.tsx:786-930`
- Modify: `src/renderer/pages/GalleryPage.tsx:944-980`（图集卡片区域）
- Test: `tests/renderer/pages/GalleryPage.test.tsx`（若不存在则追加到相关 renderer page 测试）

- [ ] **Step 1: 写失败测试，定义“刷新”和“同步文件夹”两个动作分离**

```tsx
it('shows separate refresh and sync actions for selected gallery', async () => {
  render(<GalleryPage subTab="galleries" />)
  expect(screen.getByRole('button', { name: /刷新当前图集/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /同步文件夹/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试，确认当前只有一个刷新图标按钮**

Run: `npm run test -- tests/renderer/pages/GalleryPage.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 为图集详情区增加同步按钮并补 tooltip**

```tsx
<Tooltip title="刷新当前图集">
  <Button type="text" icon={<ReloadOutlined />} onClick={() => loadGalleryImages(selectedGallery.id)} />
</Tooltip>
<Tooltip title="同步文件夹">
  <Button type="text" icon={<SyncOutlined />} onClick={() => handleSyncGalleryFolder(selectedGallery.id)} />
</Tooltip>
```

- [ ] **Step 4: 为图集卡片增加右键菜单与编辑弹窗**

```tsx
const [editingGallery, setEditingGallery] = useState<any | null>(null)
const [editModalOpen, setEditModalOpen] = useState(false)

const handleSaveGalleryEdit = async (values: { name: string }) => {
  if (!editingGallery) return
  const result = await window.electronAPI.gallery.updateGallery(editingGallery.id, { name: values.name.trim() })
  if (result.success) {
    message.success('图集已更新')
    setEditModalOpen(false)
    await loadGalleries()
  } else {
    message.error(result.error || '图集更新失败')
  }
}
```

- [ ] **Step 5: 将图集卡片的更多操作入口放入右键菜单**

```tsx
const galleryMenuItems = [
  { key: 'edit', label: '编辑', onClick: () => openEditGallery(gallery) },
]
```

- [ ] **Step 6: 跑测试，验证刷新 / 同步 / 编辑入口**

Run: `npm run test -- tests/renderer/pages/GalleryPage.test.tsx`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add TODO.md src/renderer/pages/GalleryPage.tsx tests/renderer/pages/GalleryPage.test.tsx
git commit -m "feat: 图库图集页新增同步文件夹与编辑入口"
```

---

## Task 7: 统一纯图标按钮 tooltip，并清理 X/关闭共存

**Files:**
- Create: `src/renderer/components/IconOnlyButton.tsx`
- Modify: `src/renderer/pages/GalleryPage.tsx`
- Modify: `src/renderer/components/BulkDownloadSessionDetail.tsx`
- Modify: `src/renderer/components/ImportTagsDialog.tsx`
- Modify: `src/renderer/components/ImageGrid.tsx`
- Modify: `src/renderer/pages/BooruPostDetailsPage.tsx`
- Modify: 其他本轮涉及的带纯图标按钮页面
- Test: `tests/renderer/components/IconOnlyButton.test.tsx`（或追加到相关组件测试）

- [ ] **Step 1: 写失败测试，定义纯图标按钮统一 tooltip 包装**

```tsx
it('renders tooltip for icon-only actions', async () => {
  render(<IconOnlyButton title="同步文件夹" icon={<ReloadOutlined />} onClick={() => {}} />)
  await user.hover(screen.getByRole('button'))
  expect(await screen.findByText('同步文件夹')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试，确认当前不存在统一组件**

Run: `npm run test -- tests/renderer/components/IconOnlyButton.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 新建统一组件，收口所有纯图标按钮行为**

```tsx
export const IconOnlyButton: React.FC<{ title: string; icon: React.ReactNode; onClick?: () => void; loading?: boolean; danger?: boolean }> = ({ title, icon, onClick, loading, danger }) => (
  <Tooltip title={title}>
    <Button type="text" icon={icon} onClick={onClick} loading={loading} danger={danger} aria-label={title} />
  </Tooltip>
)
```

- [ ] **Step 4: 清理本轮涉及页面的 X / 关闭共存**

```tsx
<Modal
  open={open}
  title="编辑图集"
  closable={false}
  onCancel={() => setOpen(false)}
  footer={[
    <Button key="close" onClick={() => setOpen(false)}>关闭</Button>,
    <Button key="save" type="primary" onClick={submit}>保存</Button>,
  ]}
/>
```

- [ ] **Step 5: 图片详情页“关闭”与“ID”位置互换**

```tsx
<div className="detail-header-actions">
  <Button onClick={handleClose}>关闭</Button>
  <span>ID: {post.id}</span>
</div>
```

- [ ] **Step 6: 跑测试，验证 tooltip 和 closable 规范**

Run: `npm run test -- tests/renderer/components/IconOnlyButton.test.tsx tests/renderer/components/ImportTagsDialog.test.tsx tests/renderer/components/NotesOverlay.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add TODO.md src/renderer/components/IconOnlyButton.tsx src/renderer/pages/GalleryPage.tsx src/renderer/components/BulkDownloadSessionDetail.tsx src/renderer/components/ImportTagsDialog.tsx src/renderer/components/ImageGrid.tsx src/renderer/pages/BooruPostDetailsPage.tsx tests/renderer/components/IconOnlyButton.test.tsx tests/renderer/components/ImportTagsDialog.test.tsx tests/renderer/components/NotesOverlay.test.ts
git commit -m "refactor: 统一纯图标按钮提示与关闭交互"
```

---

## Task 8: 修复检查更新报错链路

**Files:**
- Modify: `src/main/services/updateService.ts:42-122`
- Modify: `src/main/ipc/handlers.ts`（若需要补 channel 适配）
- Modify: `src/renderer/pages/SettingsPage.tsx:213-235`
- Test: `tests/main/services/updateService.test.ts`

- [ ] **Step 1: 写失败测试，覆盖成功 / 失败 / 超时返回结构**

```ts
it('returns normalized update result when github request fails', async () => {
  const result = await checkForUpdate()
  expect(result).toEqual(expect.objectContaining({
    currentVersion: expect.any(String),
    latestVersion: null,
    hasUpdate: false,
    releaseUrl: null,
    releaseName: null,
    publishedAt: null,
    error: expect.anything(),
    checkedAt: expect.any(String),
  }))
})
```

- [ ] **Step 2: 运行测试，确认当前报错链路存在不稳定点**

Run: `npm run test -- tests/main/services/updateService.test.ts`
Expected: 若当前已有失败用例，则先观察具体失败信息；若无则补齐失败用例并确认当前实现缺少期望行为。

- [ ] **Step 3: 固化主进程返回结构，前端只按统一结果渲染**

```ts
const result: UpdateCheckResult = {
  currentVersion,
  latestVersion: null,
  hasUpdate: false,
  releaseUrl: null,
  releaseName: null,
  publishedAt: null,
  error: errorMsg,
  checkedAt,
}
```

- [ ] **Step 4: 在设置页明确展示错误态**

```ts
if (res.success && res.data) {
  setUpdateResult(res.data)
} else {
  setUpdateResult({
    currentVersion: '-',
    latestVersion: null,
    hasUpdate: false,
    releaseUrl: null,
    releaseName: null,
    publishedAt: null,
    error: res.error || '检查失败',
    checkedAt: new Date().toISOString(),
  })
}
```

- [ ] **Step 5: 跑测试，确认失败与成功都能落到统一结构**

Run: `npm run test -- tests/main/services/updateService.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add TODO.md src/main/services/updateService.ts src/renderer/pages/SettingsPage.tsx tests/main/services/updateService.test.ts
git commit -m "fix: 统一检查更新返回与错误展示"
```

---

## Task 9: 统一验证与收尾

**Files:**
- Modify: `TODO.md`
- Test: `tests/main/services/bulkDownloadService.test.ts`
- Test: `tests/main/services/galleryService.test.ts`
- Test: `tests/main/services/updateService.test.ts`
- Test: `tests/renderer/pages/FavoriteTagsPage.test.tsx`
- Test: `tests/renderer/pages/BooruTagManagementPage.test.tsx`
- Test: `tests/renderer/pages/BooruDownloadHubPage.test.tsx`

- [ ] **Step 1: 跑后端服务测试集**

Run: `npm run test -- tests/main/services/bulkDownloadService.test.ts tests/main/services/galleryService.test.ts tests/main/services/updateService.test.ts tests/main/ipc/handlers.test.ts tests/main/ipc/handlers.favoriteTagDownload.test.ts`
Expected: PASS。

- [ ] **Step 2: 跑前端关键页面测试集**

Run: `npm run test -- tests/renderer/pages/FavoriteTagsPage.test.tsx tests/renderer/pages/BooruTagManagementPage.test.tsx tests/renderer/pages/BooruDownloadHubPage.test.tsx tests/renderer/components/IconOnlyButton.test.tsx`
Expected: PASS。

- [ ] **Step 3: 跑完整构建，确保三端编译通过**

Run: `npm run build`
Expected: main / preload / renderer 均构建成功，无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add TODO.md
git commit -m "chore: 完成 TODO 模块化方案的验证与收尾"
```

---

## 自检结论

### Spec coverage
- 下载防重复、任务中提示、保存任务去重、每页 200：已由 Task 3-4 覆盖。
- 检查更新报错：Task 8 覆盖。
- 图集改名、同步文件夹、刷新职责拆分：Task 5-6 覆盖。
- 收藏标签排序与搜索提示：Task 4 覆盖。
- 菜单合并、页内子导航、二级菜单单独窗口、一级菜单点击行为：Task 1-2 覆盖。
- X / 关闭共存、详情页布局调整、纯图标 tooltip：Task 7 覆盖。

### Placeholder scan
- 已避免使用 TBD / TODO / implement later 等占位词。
- 每个任务都写明了文件、测试、命令和示例代码。

### Type consistency
- 合并后的菜单 key 统一为 `tag-management` 与 `download`。
- 页内 tab 统一使用：
  - 标签管理：`favorite` / `blacklist`
  - 下载：`downloads` / `bulk`
- 批量任务统一使用 `deduplicated?: boolean` 作为重复返回标记。

---

Plan complete and saved to [TODO.md](TODO.md). Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**