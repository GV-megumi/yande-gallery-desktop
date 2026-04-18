# Antd 表单与弹窗约定

## 文档定位

列出 Antd `Form` / `Modal` / `Dropdown` 在本项目中反复踩过的坑，给 UI 改动提供可以直接对照的规则。

## Form.Item 与输入组件

### 1. Form.Item 只向直接子组件注入 value / onChange

Antd `Form.Item` 会把 `value` / `onChange` 传给它的**第一个直接子组件**。如果直接子组件是布局容器（`Space.Compact`、`Input.Group`、普通 `div` 等），它既不接收也不转发这两个 prop，`setFieldsValue` 的结果就完全无法显示到 `Input`。

**错误写法**：

```tsx
<Form.Item name="downloadPath" label="下载目录">
  <Space.Compact style={{ width: '100%' }}>
    <Input readOnly />              {/* ← 永远看不到 form 值 */}
    <Button>选择</Button>
  </Space.Compact>
</Form.Item>
```

**正确写法**（外层只做 label / layout，内层 `noStyle` Form.Item 包输入组件）：

```tsx
<Form.Item label="下载目录" required>
  <Space.Compact style={{ width: '100%' }}>
    <Form.Item name="downloadPath" noStyle rules={[{ required: true }]}>
      <Input readOnly />
    </Form.Item>
    <Button>选择</Button>
  </Space.Compact>
</Form.Item>
```

### 2. `disabled` / 条件渲染要订阅表单值，别一次性读

`form.getFieldValue(...)` 在 render 里直接调用只会返回"当前一刻"的值，后续表单值变化不会触发重渲染。需要跟随表单变化的条件分支，用 `Form.useWatch('xxx', form)` 或 `<Form.Item shouldUpdate>`。

### 3. `InputNumber` 的 `max` 是静默 clamp，不是校验失败

`<InputNumber max={N}>` 在失焦 / 提交时会**直接把超出值改成 max**，UI 上不弹任何错误。用户会看到"数值自己变了"这种很难信任的行为。

因此：

- `max` 写的是产品真实允许的上限，不能拍脑袋。否则就该删掉。
- 要给"超出上限"反馈时，改用 `Form.Item rules=[{ type: 'integer', max: N, message: '...' }]` 做显式校验，让用户看到 **为什么** 被改写。
- `min` 同理。

## Modal 关闭入口

### 4. 不要让默认 X 和自绘"关闭"按钮同时存在

Antd `<Modal>` 的 `closable` **默认值是 `true`**，即使你传了 `title={null}` 和 `footer={null}`，右上角仍会渲染一个 X 图标。

一个弹窗只保留一个关闭入口：

- **依赖默认 X**（推荐）：不要在内容区再画"关闭"按钮，点 X 或 ESC / 点击遮罩触发 `onCancel`。
- **内容区自画按钮**：必须显式 `closable={false}`，同时自己处理 `onCancel`。

### 5. `title={null}` 不等于 `closable={false}`

常见错觉是"标题都没了自然没关闭按钮"。实际上它们由不同的 prop 控制：

- `title`：标题内容。
- `closable`：是否渲染右上角 X（独立于 title）。
- `footer`：底部按钮区（`null` 就不渲染默认的"确定 / 取消"）。
- `onCancel`：X / ESC / 点击遮罩都走这一回调。

### 6. `destroyOnHidden` 与表单水合

对创建/编辑共用的 Modal，务必加 `destroyOnHidden`（或给 Modal 配 `key`），否则上一次编辑的表单状态会残留到下一次打开。这条在本仓库现有 Modal 多数已经做对，新增 Modal 时沿用。

## Dropdown / 菜单文案

### 7. 不同入口的关闭/返回语义要一致

- "返回"按钮：导航栈 pop 或清内部状态。
- "关闭"按钮：`window.close()`（子窗口）或 `setVisible(false)`（Modal/Drawer）。
- "删除"/"取消"按钮：用 `Popconfirm` 包裹，`okText` / `cancelText` 用中文。
- 右键菜单新增项时，位置建议：主要动作放顶部、分隔线、编辑、`danger: true` 的删除放底部；关闭/取消不出现在右键菜单里。

## 实施自查清单

- [ ] `Form.Item name="..."` 的直接子组件是真正的受控输入，而不是 `Space.Compact` / `div` / `Input.Group` 这类布局容器。
- [ ] Modal 没有同时存在默认 X 与自绘"关闭"按钮。
- [ ] 共用 Modal 已加 `destroyOnHidden` 或 `key`，切换对象不会串味。
- [ ] 条件 `disabled` / 显隐依赖的是 `Form.useWatch` / `shouldUpdate`，不是一次性的 `getFieldValue`。
- [ ] `InputNumber` / `Slider` 的 `max` / `min` 对得上产品真实边界；超界要弹提示，不要静默 clamp。
- [ ] 删除类按钮有 `Popconfirm` 二次确认，`danger` 风格统一。

## 相关文档

- `doc/注意事项/组件抽象与复用原则.md`
- `doc/注意事项/代码修改规范.md`
