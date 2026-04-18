# Bug16 — 缓存目录最大大小被硬夹到 5000 MB

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 `BooruSettingsPage` 外观配置中 `maxCacheSizeMB` InputNumber 的 `max={5000}` 硬上限，并把 `min={100}` 转为显式校验，避免 Antd `InputNumber` 静默 clamp。

**Architecture:** 单点修改一个 Form.Item；后端 `config.ts` 本就不限制范围，`imageCacheService` 读取也只用 `|| 500` 兜底，完全信任前端数值。

**Tech Stack:** React、Ant Design、TypeScript、vitest

---

## File Structure

- 修改：`src/renderer/pages/BooruSettingsPage.tsx:1003-1018`

---

### Task 1: 修 InputNumber 上限并改为显式校验

**Files:**
- Modify: `src/renderer/pages/BooruSettingsPage.tsx:1003-1018`

- [ ] **Step 1: 替换整个 Form.Item 区块**

把 `src/renderer/pages/BooruSettingsPage.tsx:1003-1018` 替换为：

```tsx
                  <Form.Item
                    label="缓存目录最大大小"
                    tooltip="原图缓存目录的最大大小（MB），超过此大小会自动清理最旧的一半缓存文件"
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item
                        name="maxCacheSizeMB"
                        noStyle
                        rules={[
                          { type: 'integer', min: 100, message: '缓存上限不能小于 100 MB' },
                        ]}
                      >
                        <InputNumber
                          min={100}
                          step={100}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Button disabled style={{ cursor: 'default' }}>MB</Button>
                    </Space.Compact>
                  </Form.Item>
```

改动要点：
- 删除 `max={5000}`
- 内层 `Form.Item` 加 `rules` 做显式最小值校验（min 100 不变）
- 保留 `Space.Compact` + "外层 label / 内层 noStyle Form.Item" 的既有模式（这本来就是正确写法，和 bug4 要修的反模式不同）

---

### Task 2: 回归验证

**Files:** —

- [ ] **Step 1: 跑设置页测试套件**

Run: `npx vitest run tests/renderer/pages/BooruAppearancePreferences.contract.test.ts tests/renderer/pages/SettingsPage.test.tsx --config vitest.config.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 跑渲染层 TS 编译**

Run: `npx vite build --mode production 2>&1 | tail -20`

若嫌慢可只跑：`npx tsc -p tsconfig.main.json --noEmit` + `npx tsc --noEmit -p tsconfig.json`（如果 renderer 有单独的 tsconfig 请改成对应路径）。

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev` 起应用，进入 Booru → 站点配置 → 外观配置，把 "缓存目录最大大小" 改成 30000，点 "保存外观配置"，观察：
- 保存前输入框仍显示 30000（不再被 clamp）
- 保存后重新打开仍是 30000

若填 50（小于 100），提交时应显示红色校验提示 "缓存上限不能小于 100 MB"。

---

### Task 3: 归档 + 提交

**Files:** —

- [ ] **Step 1: 归档 bug 文档**

```bash
git mv bug16.md doc/done/bug16-cache-size-cap.md
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/pages/BooruSettingsPage.tsx doc/done/bug16-cache-size-cap.md
git commit -m "fix(bug16): 缓存目录最大大小去掉硬上限 5000

$(cat <<'EOF'
原 InputNumber 的 max={5000} 导致用户填 30000 被静默 clamp 成 5000，
无任何反馈。该上限纯属前端随手写的一个数，后端 config 和
imageCacheService 都不做范围限制。

- 删除 max={5000}
- 把最小值校验从隐式 clamp 改为 rules 显式校验，超下限时提示原因
EOF
)"
```

Expected: commit 成功；`git status` 干净。

---

## Self-Review Checklist

- [x] Spec §批 A A2 要求 "去掉 max={5000} + 加 rules" 均在 Task 1 完成。
- [x] 不回退到 "单层 Form.Item 包 Space.Compact" 的反模式（该写法本就符合 bug4 建议的正确模式）。
- [x] 无占位符。
