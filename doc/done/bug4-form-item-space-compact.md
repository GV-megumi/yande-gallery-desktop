# Bug 4: 配置标签下载弹窗中"自动下载目录"输入框不显示路径

## 现象

在"标签管理 → 收藏标签 → 配置标签下载"弹窗中：

- 点击 **选择文件夹** 按钮选中一个目录后，输入框仍然是空的，看不到已选路径。
- 对于之前已经配置过自动下载目录的收藏标签，打开这个配置弹窗时，输入框同样是空的，显示不出已保存的路径。
- 点击"保存"或"保存并下载"时，表单校验里的 `required` 规则能正常通过（说明表单内部其实是有值的），但用户在 UI 上始终看不到当前路径。
- 通过"关联本地图库"下拉框选择图库，应当同步回填自动下载目录——输入框同样不显示。

## 预期行为

- 首次打开弹窗：若当前标签已绑定过自动下载目录（`resolvedDownloadPath` 或 `downloadBinding.downloadPath` 非空），输入框应直接显示该路径。
- 点击"选择文件夹"选中目录后：输入框立即显示所选路径。
- 选择图库后：输入框显示图库的本地路径。

## 代码定位

核心文件：[src/renderer/pages/FavoriteTagsPage.tsx](src/renderer/pages/FavoriteTagsPage.tsx)

### 文案定位

- [zh-CN.ts:229-231](src/renderer/locales/zh-CN.ts#L229-L231)：`favoriteTags.configTitle` = "配置标签下载: {name}"、`downloadPath` = "自动下载目录"、`selectFolder` = "选择文件夹"。

### 配置弹窗与受影响的 Form.Item

- [FavoriteTagsPage.tsx:1139-1150](src/renderer/pages/FavoriteTagsPage.tsx#L1139-L1150)：

  ```tsx
  <Form.Item
    name="downloadPath"
    label={t('favoriteTags.downloadPath')}
    rules={[{ required: true, message: t('favoriteTags.selectPathFirst') }]}
  >
    <Space.Compact style={{ width: '100%' }}>
      <Input readOnly aria-label={t('favoriteTags.downloadPath')} style={{ flex: 1 }} />
      <Button
        aria-label={t('favoriteTags.selectFolder')}
        onClick={handleSelectFavoriteTagDownloadPath}
        disabled={Boolean(downloadForm.getFieldValue('galleryId'))}
      >
        {t('favoriteTags.selectFolder')}
      </Button>
    </Space.Compact>
  </Form.Item>
  ```

### 根因：`Form.Item` 的 value 注入被 `Space.Compact` 截胡

Antd 的 `Form.Item` 只会把 `value` / `onChange` **注入到其直接子组件**。这里直接子组件是 `Space.Compact`（一个布局容器），而不是 `Input`：

- `Space.Compact` 作为布局组件，本身**不接收** `value` / `onChange`，也不会把它们转发给内部的 `Input`。
- 因此 `downloadForm.setFieldsValue({ downloadPath: ... })` 只更新了 Form 内部状态（`getFieldValue('downloadPath')` 能拿到值，`required` 校验通过），但 `Input` 始终被当作完全非受控组件，显示空字符串。

这套路径上调用 `setFieldsValue` 的三个点因此全都看不到效果：

- [FavoriteTagsPage.tsx:529](src/renderer/pages/FavoriteTagsPage.tsx#L529) `openDownloadConfig`：弹窗打开时回填 `resolvedDownloadPath` / `downloadBinding.downloadPath`（对应"已经设置好了也不显示"的场景）。
- [FavoriteTagsPage.tsx:536](src/renderer/pages/FavoriteTagsPage.tsx#L536) `handleGalleryChange`：选择图库后回填 `gallery.folderPath`。
- [FavoriteTagsPage.tsx:546](src/renderer/pages/FavoriteTagsPage.tsx#L546) `handleSelectFavoriteTagDownloadPath`：点"选择文件夹"后回填用户选的目录（对应"选完路径仍然空白"的场景）。

### 初始值字段也能佐证

- [FavoriteTagsPage.tsx:74-78](src/renderer/pages/FavoriteTagsPage.tsx#L74-L78) `buildDownloadBindingFormValues` 明确把 `downloadPath` 放进了初值；
- [FavoriteTagsPage.tsx:651-656](src/renderer/pages/FavoriteTagsPage.tsx#L651-L656) 保存时从 `values.downloadPath` 取值写入后端。

这两处都说明 Form 内部状态是正确的，视觉上的"空白"纯粹是 `Input` 没拿到 value。

## 建议修复方向

让 `Form.Item` 的受控目标重新指向里面的 `Input`。两种常见写法：

1. **外层 `Form.Item` 只做 label / layout，里面再嵌一个 `noStyle` 的 `Form.Item` 包裹 `Input`**（推荐，改动最小、校验样式正常）：

   ```tsx
   <Form.Item label={t('favoriteTags.downloadPath')} required>
     <Space.Compact style={{ width: '100%' }}>
       <Form.Item
         name="downloadPath"
         noStyle
         rules={[{ required: true, message: t('favoriteTags.selectPathFirst') }]}
       >
         <Input readOnly aria-label={t('favoriteTags.downloadPath')} style={{ flex: 1 }} />
       </Form.Item>
       <Button
         aria-label={t('favoriteTags.selectFolder')}
         onClick={handleSelectFavoriteTagDownloadPath}
         disabled={Boolean(downloadForm.getFieldValue('galleryId'))}
       >
         {t('favoriteTags.selectFolder')}
       </Button>
     </Space.Compact>
   </Form.Item>
   ```

2. **去掉 `Space.Compact`**，用 `Input.Group` / flex 布局或把按钮放 `Input` 的 `addonAfter`，让 `Input` 成为 `Form.Item` 的直接子组件；需要注意"输入框 readOnly + 按钮"的视觉一致性。

另外，[FavoriteTagsPage.tsx:1145](src/renderer/pages/FavoriteTagsPage.tsx#L1145) 的 `disabled={Boolean(downloadForm.getFieldValue('galleryId'))}` 只在渲染时调用一次 `getFieldValue`，没有订阅依赖；如果希望"选中图库后按钮立即禁用"，可改成 `<Form.Item shouldUpdate>` 或用 `Form.useWatch('galleryId', downloadForm)` 订阅，避免需要等下一次重渲染才刷新。

## 影响

- 核心交互失灵：用户无法确认自己选中的下载目录，也无法复核已绑定的目录是否正确。
- 伴随误导：由于表单内部值其实已更新，保存按钮不会报"请选择下载目录"，用户可能在不知道具体路径的情况下直接保存，导致下载到意料之外的目录。
