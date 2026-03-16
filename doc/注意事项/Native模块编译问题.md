# Native 模块编译问题

## 涉及模块

- `sqlite3`
- `sharp`

## 常见现象

- `npm install` 成功但 Electron 启动时报 ABI 不匹配。
- 升级 Electron 后原生模块无法加载。
- Windows 下因缺少 C++ 构建环境导致安装失败。

## 处理方式

```bash
npm run rebuild
npm run rebuild:sharp
```

## Windows 额外要求

- 安装 Visual Studio Build Tools，至少包含 C++ 构建工具和 Windows SDK。

## 为什么需要重建

原生模块和 Electron 的 Node ABI 绑定，Electron 版本变更后常常需要重新编译。

## 相关文档

- `README.md`
- `doc/开发与配置指南.md`
