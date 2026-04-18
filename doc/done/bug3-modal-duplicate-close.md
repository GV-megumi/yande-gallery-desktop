# Bug 3: 批量下载"下载详情"弹窗中关闭按钮与 X 按钮重复

## 现象

在批量下载页面，点击某个会话卡片上的"查看详情"后会弹出下载详情对话框。该对话框**同时存在两个关闭入口**：

- 弹窗右上角 Antd Modal 默认渲染的 **X** 关闭图标。
- 弹窗内容区右上角自绘的 **关闭** 文字按钮。

两个按钮功能一致，视觉和交互上重复。

## 预期行为

对话框只保留一个关闭入口，避免冗余。

## 代码定位

### 弹窗外壳

[src/renderer/components/BulkDownloadSessionCard.tsx](src/renderer/components/BulkDownloadSessionCard.tsx)

- [BulkDownloadSessionCard.tsx:337-354](src/renderer/components/BulkDownloadSessionCard.tsx#L337-L354)：

  ```tsx
  <Modal
    title={null}
    open={detailVisible}
    onCancel={() => setDetailVisible(false)}
    footer={null}
    width="90%"
    style={{ maxWidth: '1200px' }}
    destroyOnHidden
  >
    <BulkDownloadSessionDetail
      session={session}
      onClose={() => setDetailVisible(false)}
      onRefresh={...}
    />
  </Modal>
  ```

  这里 `title={null}` 但**没有**显式传 `closable={false}`——Antd Modal 的 `closable` 默认为 `true`，因此右上角 **X** 图标依然渲染。

### 内容区自绘的"关闭"按钮

[src/renderer/components/BulkDownloadSessionDetail.tsx](src/renderer/components/BulkDownloadSessionDetail.tsx)

- [BulkDownloadSessionDetail.tsx:359-379](src/renderer/components/BulkDownloadSessionDetail.tsx#L359-L379)：顶部工具栏同时放了"刷新"与"关闭"按钮：

  ```tsx
  <Space>
    <Button icon={<ReloadOutlined />} onClick={() => loadRecords(false, true)} ...>
      刷新
    </Button>
    <Button onClick={onClose}>关闭</Button>
  </Space>
  ```

  这个"关闭"按钮直接调用 `onClose` prop，在 Card 侧等价于 `setDetailVisible(false)`，和 Modal 自带的 X 完全同效。

## 建议修复方向

两种思路任选其一，保持最小改动：

1. **去掉自绘的"关闭"按钮**（更贴合 Antd 风格）：移除 [BulkDownloadSessionDetail.tsx:377](src/renderer/components/BulkDownloadSessionDetail.tsx#L377) 的 `<Button onClick={onClose}>关闭</Button>`。`onClose` prop 可保留用于重试成功后等场景的回调，也可以一起清掉。

2. **关掉 Modal 自带的 X**：在 [BulkDownloadSessionCard.tsx:337-345](src/renderer/components/BulkDownloadSessionCard.tsx#L337-L345) 的 `<Modal>` 上加 `closable={false}`，保留内容区自绘的"关闭"按钮。

从一致性角度看，推荐方案 1——仓库内其他 Modal（如 [BooruBulkDownloadPage.tsx:462-475](src/renderer/pages/BooruBulkDownloadPage.tsx#L462-L475) 的"创建/编辑任务"弹窗）都走 Modal 自带的关闭按钮，没有在内容区再放"关闭"按钮。

## 影响

- 纯 UI / UX 问题，不影响功能。
- 两个关闭入口并存会让用户迟疑（"它们是不是做的不是同一件事？"），也与其他弹窗的交互模式不一致。
