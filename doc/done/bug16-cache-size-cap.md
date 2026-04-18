# Bug 16: Booru 站点配置 / 外观配置 / 缓存目录最大大小被硬性夹到 5000

## 现象

路径：Booru → 站点配置 → 外观配置 → 缓存目录最大大小。

用户手动把数值从默认 500 改到 **30000**，点击"保存外观配置"：

- 数值会在保存前后被**自动夹成 5000**，然后以 5000 落盘。
- UI 上没有给出任何"超出上限"提示，只看到输入框里数字"自己变了"。

## 根因

[src/renderer/pages/BooruSettingsPage.tsx:1003-1018](src/renderer/pages/BooruSettingsPage.tsx#L1003-L1018) 的 `InputNumber` 写了一个硬上限：

```tsx
<Form.Item
  label="缓存目录最大大小"
  tooltip="原图缓存目录的最大大小（MB），超过此大小会自动清理最旧的一半缓存文件"
>
  <Space.Compact style={{ width: '100%' }}>
    <Form.Item name="maxCacheSizeMB" noStyle>
      <InputNumber
        min={100}
        max={5000}       {/* ← 这里把上限锁死在 5000 */}
        step={100}
        style={{ width: '100%' }}
      />
    </Form.Item>
    <Button disabled style={{ cursor: 'default' }}>MB</Button>
  </Space.Compact>
</Form.Item>
```

Antd `InputNumber` 在失焦 / 表单提交时会用 `max` 静默 clamp 输入值，**没有弹任何错误**——观感上就是"数值自己变了"。

### 后端并没有同样的上限

- [config.ts:204](src/main/services/config.ts#L204) 字段定义是 `maxCacheSizeMB?: number`，没有范围限制。
- [imageCacheService.ts:139](src/main/services/imageCacheService.ts#L139) / [L224](src/main/services/imageCacheService.ts#L224) 读取时只做 `|| 500` 默认值兜底，逻辑上支持任意正数。
- 磁盘本身也不在乎 5000 还是 30000。

换句话说 5000 这个上限**只是前端输入框里随手写的一个数**，既不是产品约束，也不是系统限制，纯属误伤。

### 为什么用户看不到提示

`InputNumber` 的 `max` 策略是"静默 clamp"，不是"校验失败"。想要让用户看到"已超出上限"的反馈，必须用 `Form.Item` 的 `rules` 做显式校验，或者至少监听 `onChange` 自己弹 warning。当前代码什么都没接。

## 修复方向

### 1. 提高上限或直接去掉上限

三种选择，按保守到激进排列：

- **维持上限但放大**：`max={200000}`（200 GB）。对硬盘常规用户够用，也能挡住"误输入 9 位数"这类无意义极端值。
- **去掉 max、保留 min**：`min={100}`，不写 `max`。后端字段本就不限制，UI 也应该信任用户输入。
- **换成字符串 + 校验单位**：`Input` 接 "500MB" / "2GB" 这种带单位的值。视觉更友好但改动更大，不建议临时做。

推荐方案 2：去掉 `max`，让输入框承接后端实际容忍范围；若担心极端值，可在 `rules` 里加一条"不超过 可用磁盘大小 的 50%"的 `validator`——但这一步不是必须，可以先单独做。

### 2. 加一条显式 `rules` 校验，避免"数字自己变"

把 `min={100}` 也转化成校验规则，保证"超出合法范围"时能看到提示，而不是被静默改写：

```tsx
<Form.Item
  name="maxCacheSizeMB"
  noStyle
  rules={[
    { type: 'integer', min: 100, message: '缓存上限不能小于 100 MB' },
  ]}
>
  <InputNumber min={100} step={100} style={{ width: '100%' }} />
</Form.Item>
```

这样用户填过小值会看到原因；填大值会按字面保存，不会神秘变小。

### 3. 顺带对齐下 `Form.Item` + `Space.Compact` 的包法

这段代码已经正确使用了"外层 label Form.Item + 内层 `noStyle` Form.Item 包 Input"的模式（符合 [Antd 表单与弹窗约定](doc/注意事项/Antd 表单与弹窗约定.md)），修复时只改 `max` 和 `rules`，**不要**把它合回"单层 Form.Item 包 Space.Compact"——那是 [bug4.md](bug4.md) 踩过的坑。

### 4. 其它数值输入框体检一遍

在 [BooruSettingsPage.tsx](src/renderer/pages/BooruSettingsPage.tsx) 以及 [SettingsPage.tsx](src/renderer/pages/SettingsPage.tsx) 里再 grep 一次 `InputNumber.*max=`、`Slider.*max=`，确认其它数值上限是有产品依据的（例如缩略图大小 60px 是产品约束），不是随手拍脑袋写的。

## 影响

- **用户痛点**：想把缓存目录开到几十 GB（图库型用户常见诉求）的人，被 5000 MB 的软上限卡死，且改完还看不到原因——反复改反复被改回去。
- **信任破坏**：输入框"自己改数"是最典型的"软件在骗我"观感，比直接报错还让人不安。
- **修复成本极低**：一处 `max={5000}` 去掉即可，不涉及后端 / 配置结构 / 任何其它模块。
