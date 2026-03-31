# Google Drive: API 移除 & Webview 迁移方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 Google Drive API 实现，改用 webview 嵌入 drive.google.com（与 Google Photos 页面同方案）；同时清理因 Drive API 移除而变得多余的 Google OAuth 认证体系和 Photos Picker API。

**Architecture:** 当前 Google Drive 通过 OAuth + Drive API v3 实现文件管理（列表/搜索/上传/下载/删除等），涉及主进程服务、IPC 通道、Preload API、渲染页面四层。迁移后 Google Drive 页面将直接嵌入 `drive.google.com` 的 webview，所有文件操作由 Google 官方 Web UI 完成，不再需要自定义 API 调用。由于 Drive 是 Google OAuth 的唯一实质消费者（Photos 已经用 webview，Gemini 也是 webview），OAuth 认证体系也一并清理。

**Tech Stack:** Electron webview, React

---

## 背景分析

### 当前 Google API 依赖链

```
googleAuthService.ts (OAuth 登录/Token 管理)
├── googleDriveService.ts (Drive API v3) ← 本次移除
└── googlePhotosService.ts (Photos Picker API) ← 连带移除
```

### 各 Google 页面现状

| 页面 | 实现方式 | API 移除后 |
|------|---------|-----------|
| Google Drive | API 调用 (540 行自定义 UI) | → webview |
| Google Photos | 已经是 webview | 不变 |
| Gemini | 已经是 webview | 不变 |
| Google Account | OAuth 管理 UI | → 移除（无 API 需管理） |

### 结论

Drive API 移除后，Google OAuth 只剩 Photos Picker 一个消费者。而 Photos 页面本身已经是 webview，Picker 并非核心功能。因此建议一并清理整个 Google API 认证体系，达到彻底干净。

---

## 文件变更总览

### 删除的文件

| 文件 | 原用途 |
|------|--------|
| `src/main/services/googleDriveService.ts` | Drive API v3 客户端 |
| `src/main/services/googleAuthService.ts` | OAuth 登录/Token 管理 |
| `src/main/services/googlePhotosService.ts` | Photos Picker API |
| `src/main/ipc/googleHandlers.ts` | Google 相关 IPC 处理器 |
| `src/renderer/pages/GoogleDrivePage.tsx` | Drive 自定义 UI 页面 |
| `src/renderer/pages/GoogleAccountPage.tsx` | OAuth 账号管理页面 |

### 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/main/ipc/channels.ts` | 删除全部 Google 相关 IPC 通道常量 |
| `src/main/index.ts` | 移除 `setupGoogleIPC()` 和 `initGoogleAuth()` 调用及 import |
| `src/preload/index.ts` | 删除 `google`、`gdrive`、`gphotos` 三个 API 域 + 类型声明 |
| `src/renderer/App.tsx` | 移除 GoogleAccountPage 导入和菜单项；Drive 页面改为 webview 组件 |
| `config.example.yaml` | 移除 `google.clientId`、`google.clientSecret`、`google.drive.*`、`google.photos.*` 配置项 |

### 新建的文件

| 文件 | 用途 |
|------|-----|
| `src/renderer/pages/GoogleDrivePage.tsx` | 新版 webview 嵌入页（覆盖原文件） |

---

## Task 1: 删除 Google Drive API 服务层

**Files:**
- Delete: `src/main/services/googleDriveService.ts`

- [ ] **Step 1: 删除 googleDriveService.ts**

```bash
git rm src/main/services/googleDriveService.ts
```

- [ ] **Step 2: 确认无其他文件 import 此模块**

```bash
# 搜索所有引用
grep -r "googleDriveService" src/
# 预期仅 googleHandlers.ts 有 import（后续步骤处理）
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove googleDriveService.ts (Drive API v3 client)"
```

---

## Task 2: 删除 Google Photos Picker API 服务层

**Files:**
- Delete: `src/main/services/googlePhotosService.ts`

- [ ] **Step 1: 删除 googlePhotosService.ts**

```bash
git rm src/main/services/googlePhotosService.ts
```

- [ ] **Step 2: 确认无其他文件 import 此模块**

```bash
grep -r "googlePhotosService" src/
# 预期仅 googleHandlers.ts 有 import（后续步骤处理）
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove googlePhotosService.ts (Photos Picker API)"
```

---

## Task 3: 删除 Google OAuth 认证服务层

**Files:**
- Delete: `src/main/services/googleAuthService.ts`

- [ ] **Step 1: 删除 googleAuthService.ts**

```bash
git rm src/main/services/googleAuthService.ts
```

- [ ] **Step 2: 确认无其他文件 import 此模块**

```bash
grep -r "googleAuthService\|initGoogleAuth\|googleLogin\|getAccessToken\|getGoogleAuthStatus\|googleLogout" src/
# 预期：main/index.ts 和 googleHandlers.ts（后续步骤处理）
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove googleAuthService.ts (Google OAuth system)"
```

---

## Task 4: 清理 IPC 层 — 删除 Google Handlers 和通道常量

**Files:**
- Delete: `src/main/ipc/googleHandlers.ts`
- Modify: `src/main/ipc/channels.ts:183-202`

- [ ] **Step 1: 删除 googleHandlers.ts**

```bash
git rm src/main/ipc/googleHandlers.ts
```

- [ ] **Step 2: 删除 channels.ts 中的 Google 相关常量**

从 `src/main/ipc/channels.ts` 中删除以下行（约 183-202 行）：

```typescript
// 删除以下全部内容：

  // === Google 认证 ===
  GOOGLE_AUTH_LOGIN: 'google:auth-login',
  GOOGLE_AUTH_LOGOUT: 'google:auth-logout',
  GOOGLE_AUTH_STATUS: 'google:auth-status',

  // === Google Drive ===
  GDRIVE_LIST_FILES: 'gdrive:list-files',
  GDRIVE_SEARCH: 'gdrive:search',
  GDRIVE_GET_FILE: 'gdrive:get-file',
  GDRIVE_DOWNLOAD: 'gdrive:download',
  GDRIVE_UPLOAD: 'gdrive:upload',
  GDRIVE_DELETE: 'gdrive:delete',
  GDRIVE_CREATE_FOLDER: 'gdrive:create-folder',
  GDRIVE_MOVE: 'gdrive:move',
  GDRIVE_GET_STORAGE: 'gdrive:get-storage',
  GDRIVE_GET_THUMBNAIL: 'gdrive:get-thumbnail',

  // === Google Photos Picker API ===
  GPHOTOS_PICKER_OPEN: 'gphotos:picker-open',
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/googleHandlers.ts src/main/ipc/channels.ts
git commit -m "refactor: remove Google IPC handlers and channel constants"
```

---

## Task 5: 清理主进程入口

**Files:**
- Modify: `src/main/index.ts:6-8,69,72`

- [ ] **Step 1: 移除 Google 相关 import 和调用**

从 `src/main/index.ts` 中：

1. 删除第 6 行 import：
```typescript
import { setupGoogleIPC } from './ipc/googleHandlers.js';
```

2. 删除第 8 行 import：
```typescript
import { initGoogleAuth } from './services/googleAuthService.js';
```

3. 删除第 69 行调用：
```typescript
    setupGoogleIPC();
```

4. 删除第 72 行调用：
```typescript
    initGoogleAuth().catch(err => console.warn('[GoogleAuth] 初始化失败（非致命）:', err));
```

- [ ] **Step 2: 确认编译通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor: remove Google auth init and IPC setup from main entry"
```

---

## Task 6: 清理 Preload API

**Files:**
- Modify: `src/preload/index.ts:566-601` (实现) 和 `:774-793` (类型声明)

- [ ] **Step 1: 删除 Preload 中的 google / gdrive / gphotos API 实现**

从 `src/preload/index.ts` 中删除以下三个 API 域（约 566-601 行）：

```typescript
// 删除以下全部：

  // Google 认证
  google: {
    login: () => ipcRenderer.invoke(IPC_CHANNELS.GOOGLE_AUTH_LOGIN),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.GOOGLE_AUTH_LOGOUT),
    getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GOOGLE_AUTH_STATUS),
  },

  // Google Drive
  gdrive: {
    listFiles: (...) => ...,
    search: (...) => ...,
    getFile: (...) => ...,
    download: (...) => ...,
    upload: (...) => ...,
    delete: (...) => ...,
    createFolder: (...) => ...,
    move: (...) => ...,
    getStorage: (...) => ...,
    getThumbnail: (...) => ...,
  },

  // Google Photos Picker API
  gphotos: {
    pickerOpen: () => ...,
  }
```

- [ ] **Step 2: 删除 Preload 中的对应类型声明**

从 `src/preload/index.ts` 中删除约 774-793 行的 `google`、`gdrive`、`gphotos` 类型声明块。

- [ ] **Step 3: 确认编译通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "refactor: remove google/gdrive/gphotos from preload API"
```

---

## Task 7: 重写 Google Drive 页面为 Webview

**Files:**
- Rewrite: `src/renderer/pages/GoogleDrivePage.tsx`
- Reference: `src/renderer/pages/GooglePhotosPage.tsx`（同方案模板）

- [ ] **Step 1: 用 webview 方案重写 GoogleDrivePage.tsx**

用以下内容完整替换 `src/renderer/pages/GoogleDrivePage.tsx`：

```tsx
/**
 * Google Drive 页面
 * 通过嵌入式浏览器（<webview>）直接访问 drive.google.com
 * 账号登录在 webview 内由用户自行完成
 */

import React, { useState, useEffect, useRef } from 'react';
import { Spin } from 'antd';

export const GoogleDrivePage: React.FC = () => {
  const [webviewLoading, setWebviewLoading] = useState(true);
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onStart = () => setWebviewLoading(true);
    const onStop = () => setWebviewLoading(false);

    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onStop);
    webview.addEventListener('did-fail-load', onStop);

    return () => {
      webview.removeEventListener('did-start-loading', onStart);
      webview.removeEventListener('did-stop-loading', onStop);
      webview.removeEventListener('did-fail-load', onStop);
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {webviewLoading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.8)', zIndex: 10,
        }}>
          <Spin size="large" />
        </div>
      )}
      {/* @ts-ignore */}
      <webview
        ref={webviewRef}
        src="https://drive.google.com"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        allowpopups="true"
      />
    </div>
  );
};
```

- [ ] **Step 2: 确认页面在 App.tsx 中已标记为 embed 页面**

检查 `src/renderer/App.tsx` 中 `isEmbedPage` 逻辑是否包含 `'gdrive'`。如果当前只包含 `'gphotos'` 和 `'gemini'`，需要加上 `'gdrive'`：

```typescript
// 找到类似这行：
const isEmbedPage = !activePinnedId && selectedKey === 'google' && (selectedGoogleSubKey === 'gphotos' || selectedGoogleSubKey === 'gemini');

// 改为：
const isEmbedPage = !activePinnedId && selectedKey === 'google' && (selectedGoogleSubKey === 'gdrive' || selectedGoogleSubKey === 'gphotos' || selectedGoogleSubKey === 'gemini');
```

同样检查 App.tsx 中其他 embed 判断逻辑（如 pinned tab 的 embed 判断），确保 `'gdrive'` 也被包含。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/GoogleDrivePage.tsx src/renderer/App.tsx
git commit -m "feat: rewrite GoogleDrivePage as webview embed (drive.google.com)"
```

---

## Task 8: 清理 App.tsx — 移除 Google Account 页面

**Files:**
- Modify: `src/renderer/App.tsx:45,142-149,189+`
- Delete: `src/renderer/pages/GoogleAccountPage.tsx`

- [ ] **Step 1: 删除 GoogleAccountPage.tsx**

```bash
git rm src/renderer/pages/GoogleAccountPage.tsx
```

- [ ] **Step 2: 从 App.tsx 中移除 GoogleAccountPage 相关代码**

1. 删除 lazy import（约第 45 行）：
```typescript
const GoogleAccountPage = React.lazy(() => import('./pages/GoogleAccountPage').then(m => ({ default: m.GoogleAccountPage })));
```

2. 从 Google 子菜单中移除 `gaccount` 项（约第 142-149 行的 google 子菜单数组）：
```typescript
// 删除这一项：
{ key: 'gaccount', icon: ..., label: 'Account' },
```

3. 从页面渲染逻辑中移除 `gaccount` 的 case：
```typescript
// 找到类似：
if (key === 'gaccount') return <GoogleAccountPage />;
// 删除这一行
```

- [ ] **Step 3: 确认编译通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove GoogleAccountPage (OAuth UI no longer needed)"
```

---

## Task 9: 清理配置文件

**Files:**
- Modify: `config.example.yaml:122-137`

- [ ] **Step 1: 移除 Google API 相关配置**

从 `config.example.yaml` 中删除 `google.clientId`、`google.clientSecret` 以及 `google.drive` 和 `google.photos` 中的 API 相关配置项。保留 google 节点（如果有其他非 API 配置需要），或者如果整个 google 节点都是 API 相关的则整块删除。

删除内容：
```yaml
google:
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com'
  clientSecret: 'YOUR_CLIENT_SECRET'
  drive:
    enabled: true
    defaultViewMode: grid
    imageOnly: false
    downloadPath: ''
  photos:
    enabled: true
    downloadPath: ''
    uploadAlbumName: 'Yande Gallery'
    thumbnailSize: 512
```

- [ ] **Step 2: 检查主进程配置读取代码是否引用了这些字段**

```bash
grep -r "config\.google\.\|google\.clientId\|google\.clientSecret\|google\.drive\|google\.photos" src/
# 如果有残留引用，一并清理
```

- [ ] **Step 3: Commit**

```bash
git add config.example.yaml
git commit -m "refactor: remove Google API config (clientId, clientSecret, drive, photos)"
```

---

## Task 10: 全局验证与收尾

**Files:**
- All modified files

- [ ] **Step 1: 全局搜索残留引用**

```bash
# 搜索所有可能的残留
grep -r "gdrive\|googleDrive\|googleAuth\|googlePhotosService\|GDRIVE_\|GOOGLE_AUTH_\|GPHOTOS_\|getAccessToken\|google\.login\|google\.logout\|google\.getAuthStatus\|electronAPI\.google\b\|electronAPI\.gdrive\|electronAPI\.gphotos" src/
```

清理所有找到的残留引用。

- [ ] **Step 2: 编译检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 启动应用验证**

```bash
npm run dev
```

验证：
1. 应用正常启动，无报错
2. 侧边栏 Google 菜单下 Drive 页面能正常加载 webview
3. Google Photos 页面不受影响
4. Gemini 页面不受影响
5. 不再有 Account 子菜单项

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "chore: cleanup residual Google API references"
```

---

## Task 11: 更新文档

**Files:**
- Modify: `doc/Renderer API 文档.md` — 删除 `gdrive`、`gphotos`、`google` API 相关章节
- Modify: `doc/功能总览.md` — 更新 Google Drive 功能说明为 webview 方案
- Modify: `doc/架构总览.md` — 如有 Google 服务描述，更新为 webview
- Modify: `doc/开发与配置指南.md` — 移除 Google OAuth 配置说明

- [ ] **Step 1: 更新 Renderer API 文档**

删除文档中 `window.electronAPI.google`、`window.electronAPI.gdrive`、`window.electronAPI.gphotos` 相关的 API 描述。

- [ ] **Step 2: 更新功能总览**

将 Google Drive 的描述从"通过 API 实现文件管理"改为"通过嵌入浏览器访问 drive.google.com"。

- [ ] **Step 3: 更新配置指南**

移除 `google.clientId`、`google.clientSecret` 等 OAuth 配置说明。

- [ ] **Step 4: Commit**

```bash
git add doc/
git commit -m "docs: update documentation to reflect Google Drive webview migration"
```
