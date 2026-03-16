# Moebooru 开发规范

## 核心原则

开发 Moebooru 相关功能前，优先参考 `Boorusama-master-official/` 中的实现，而不是直接凭印象写。

## 推荐流程

1. 先看 Boorusama 的对应模块和 API 调用方式。
2. 确认端点、参数、认证方式、返回结构。
3. 再映射到本项目的 TypeScript 类型和主进程 service。

## 为什么这样做

- Moebooru 各站点的行为细节容易和 Danbooru/Gelbooru 混淆。
- 参考成熟客户端可以减少 API 猜测和字段理解错误。

## 重点注意

- Moebooru、Danbooru、Gelbooru 的能力不对齐，不能默认都支持同一功能。
- 认证、标签关系、举报、Wiki、论坛等能力必须按站点判断。

## 参考位置

- `Boorusama-master-official/`
- `src/main/services/moebooruClient.ts`
- `src/main/services/booruClientInterface.ts`
