# Bug4 — `Form.Item` + `Space.Compact` 导致 Input 不显示 value

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 `FavoriteTagsPage` 配置下载弹窗 "自动下载目录" 的 `Form.Item` 结构，让 `Input` 能正确显示由 `setFieldsValue` 注入的路径值。

**Architecture:** Antd `Form.Item` 只把 value/onChange 注入直接子组件。当前直接子是 `Space.Compact`（布局容器，不转发），所以 `Input` 永远显示空。改为 "外层 Form.Item 做 label + 校验框架；内层 `noStyle` Form.Item 包 Input" 的模式，让 Input 重新成为受控目标。

**Tech Stack:** React、Ant Design、TypeScript、vitest

---

## File Structure

- 修改：`src/renderer/pages/FavoriteTagsPage.tsx:1139-1150`

---

### Task 1: 重写 downloadPath 的 Form.Item 结构

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx:1139-1150`

- [ ] **Step 1: 替换整段**

把 `src/renderer/pages/FavoriteTagsPage.tsx:1139-1150` 替换为：

```tsx
          <Form.Item
            label={t('favoriteTags.downloadPath')}
            required
            style={{ marginBottom: 0 }}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="downloadPath"
                noStyle
                rules={[{ required: true, message: t('favoriteTags.selectPathFirst') }]}
              >
                <Input readOnly aria-label={t('favoriteTags.downloadPath')} style={{ flex: 1 }} />
              </Form.Item>
              <Form.Item shouldUpdate={(prev, curr) => prev.galleryId !== curr.galleryId} noStyle>
                {({ getFieldValue }) => (
                  <Button
                    aria-label={t('favoriteTags.selectFolder')}
                    onClick={handleSelectFavoriteTagDownloadPath}
                    disabled={Boolean(getFieldValue('galleryId'))}
                  >
                    {t('favoriteTags.selectFolder')}
                  </Button>
                )}
              </Form.Item>
            </Space.Compact>
          </Form.Item>
```

改动要点：
- 外层 `Form.Item` 不再带 `name`，只负责 label / 必填星号 / 间距
- 内层 `noStyle` 的 `Form.Item` 包 `Input`，使 value/onChange 正确注入
- 同一套 rules 挪到内层（校验提示会显示在外层下方）
- "选择文件夹" 按钮用 `shouldUpdate` 订阅 `galleryId` 变化，而不是调用时只读一次 `getFieldValue`（顺手修复 bug4 文档 §建议修复方向结尾提到的小问题）

---

### Task 2: 回归验证

**Files:** —

- [ ] **Step 1: 跑相关测试**

Run: `npx vitest run tests/renderer/pages/FavoriteTagsPage.test.tsx tests/renderer/pages/FavoriteTagsPage.render.test.tsx tests/renderer/pages/FavoriteTagsPage.component.contract.test.ts --config vitest.config.ts`

Expected: 全部 PASS。若某断言依赖 `<Space.Compact>` 是 Form.Item 的直接子（概率低），根据实际情况更新断言。

- [ ] **Step 2: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`（或当前仓库 renderer 对应的 tsconfig）

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev` → 标签管理 → 收藏标签 → 任选一条点 "配置标签下载"：

情景 A（首次打开已绑定过的）：输入框直接显示旧路径。
情景 B：点 "选择文件夹" 选一个目录 → 输入框立刻显示该路径；点击保存成功。
情景 C：不选路径直接点保存 → 看到 "请先选择下载目录" 校验提示。
情景 D：先选 "关联本地图库"（任一项）→ 输入框回填图库路径，且 "选择文件夹" 按钮立即变为 disabled。

---

### Task 3: 归档 + 提交

**Files:** —

- [ ] **Step 1: 归档**

```bash
git mv bug4.md doc/done/bug4-form-item-space-compact.md
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/pages/FavoriteTagsPage.tsx doc/done/bug4-form-item-space-compact.md
git commit -m "fix(bug4): 修配置下载弹窗自动下载目录输入框不显示路径

$(cat <<'EOF'
Antd Form.Item 只把 value/onChange 注入直接子组件，而原写法里
直接子是 Space.Compact（布局容器，不转发），导致 Input 变成非受控、
setFieldsValue 写入后 UI 永远是空。

改为"外层 label Form.Item + 内层 noStyle Form.Item 包 Input"的
标准模式（符合 doc/注意事项/Antd 表单与弹窗约定.md）：
- 输入框正确显示初始值、手选路径、图库回填值三种场景
- rules 挪到内层，校验提示显示位置不变
- 顺带把"选择文件夹按钮 disabled"改为 shouldUpdate 订阅
  galleryId，选中图库立即 disable，而不是等下次重渲染
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 A A4 "改为 外层 label / 内层 noStyle Form.Item" 完成。
- [x] bug4 文档提到的 "disabled 不实时" 的边缘问题一并修复。
- [x] 保留 `Space.Compact` 做视觉布局；Input readOnly + 按钮并排视觉不变。
- [x] 无占位符。
