# Yande.re 图片管理与下载工具

## 项目概述

本项目是一个类似 Boorusama 的 yande.re 图片管理与下载工具，提供 Web 界面进行图片浏览、批量下载和本地图库管理功能。

## 功能特性

### 核心功能
- **图片浏览**: 对接 yande.re API，提供流畅的图片浏览体验
- **批量下载**: 支持按标签、作者、评分等条件批量下载图片
- **图库管理**: 本地图片管理，支持标签、分类、搜索
- **智能去重**: 自动检测重复图片，避免重复下载
- **下载队列**: 支持断点续传，下载状态管理

### 高级功能
- **标签管理**: 支持自定义标签，批量标签操作
- **智能推荐**: 基于下载历史推荐相似图片
- **数据同步**: 支持账户登录，同步收藏夹数据
- **多语言支持**: 中英文界面切换
- **主题切换**: 支持明暗主题

## 技术架构

### 前端 (TypeScript/React)
- **框架**: React 18 + TypeScript
- **状态管理**: Zustand / Redux Toolkit
- **UI组件**: Ant Design / Material-UI
- **图片展示**: 虚拟滚动 + 懒加载
- **网络请求**: Axios + React Query
- **打包工具**: Vite

### 后端 (Python)
- **框架**: FastAPI / Flask
- **数据库**: SQLite (轻量级) / PostgreSQL (生产环境)
- **ORM**: SQLAlchemy
- **任务队列**: Celery + Redis
- **图片处理**: Pillow
- **API对接**: aiohttp (异步HTTP客户端)

### 数据存储
- **图片存储**: 本地文件系统 + 压缩优化
- **元数据**: SQLite/PostgreSQL 存储图片信息、标签、下载记录
- **缓存**: Redis 缓存热门数据和API响应
- **配置文件**: JSON/YAML 格式存储用户设置

## 项目结构

```
yande-gallery/
├── frontend/                 # React TypeScript 前端
│   ├── src/
│   │   ├── components/       # UI组件
│   │   ├── pages/           # 页面组件
│   │   ├── hooks/           # 自定义Hooks
│   │   ├── services/        # API服务
│   │   ├── stores/          # 状态管理
│   │   ├── types/           # TypeScript类型定义
│   │   └── utils/           # 工具函数
│   ├── public/              # 静态资源
│   └── package.json
│
├── backend/                  # Python后端
│   ├── app/
│   │   ├── api/             # API路由
│   │   ├── models/          # 数据模型
│   │   ├── services/        # 业务逻辑
│   │   ├── utils/           # 工具函数
│   │   └── core/            # 核心配置
│   ├── migrations/          # 数据库迁移
│   ├── tests/               # 测试文件
│   └── requirements.txt
│
├── shared/                   # 共享类型定义
│   └── types/               # 前后端共享的类型
│
├── downloads/                # 下载图片存储
├── config/                   # 配置文件
└── docs/                     # 项目文档
```

## API设计

### yande.re API 对接
- **基础URL**: https://yande.re/post.json
- **认证方式**: 可选的用户认证
- **请求限制**: 频率控制和错误处理
- **数据格式**: JSON响应解析和处理

### 内部API设计
- **RESTful风格**: 清晰的资源命名和操作
- **分页处理**: 统一的分页参数和响应格式
- **错误处理**: 统一的错误响应格式
- **数据验证**: 请求参数和响应数据的验证

## 核心模块设计

### 图片下载模块
```python
class DownloadManager:
    - 下载队列管理
    - 并发下载控制
    - 断点续传支持
    - 下载速度限制
    - 错误重试机制
```

### 图片去重模块
```python
class DuplicateDetector:
    - 基于文件哈希的去重
    - 基于 perceptual hash 的相似图片检测
    - 基于文件大小的初筛
    - 元数据比对验证
```

### 标签管理模块
```python
class TagManager:
    - 标签分类和层级
    - 标签搜索和推荐
    - 批量标签操作
    - 标签统计和分析
```

## 性能优化

### 前端优化
- **虚拟滚动**: 处理大量图片列表
- **图片懒加载**: 按需加载可视区域图片
- **缓存策略**: 合理的缓存和预加载
- **代码分割**: 按需加载功能模块

### 后端优化
- **异步处理**: 使用async/await提高并发能力
- **连接池**: 数据库连接池管理
- **缓存策略**: Redis缓存热点数据
- **图片压缩**: 下载时进行图片压缩优化

## 安全考虑

### 数据安全
- **输入验证**: 严格的参数验证和过滤
- **SQL注入防护**: 使用ORM和参数化查询
- **XSS防护**: 前端输入输出编码
- **CSRF防护**: 跨站请求伪造防护

### 网络安全
- **API限流**: 防止API被滥用
- **用户认证**: 可选的用户登录和权限管理
- **HTTPS**: 建议使用HTTPS加密通信
- **CORS配置**: 合理的跨域配置

## 部署方案

### 开发环境
- **前端**: Vite开发服务器 + 热更新
- **后端**: Python开发服务器 + 自动重启
- **数据库**: SQLite (轻量级开发)

### 生产环境
- **前端**: Nginx静态文件服务
- **后端**: Gunicorn + Uvicorn (ASGI服务器)
- **数据库**: PostgreSQL
- **反向代理**: Nginx反向代理和负载均衡
- **容器化**: Docker容器化部署支持

## 开发计划

### 第一阶段 (MVP)
- [ ] 基础图片浏览功能
- [ ] 单张图片下载
- [ ] 本地图片列表展示
- [ ] 基础标签显示

### 第二阶段 (核心功能)
- [ ] 批量下载功能
- [ ] 标签管理和搜索
- [ ] 图片去重功能
- [ ] 下载队列管理

### 第三阶段 (高级功能)
- [ ] 用户登录和数据同步
- [ ] 智能推荐系统
- [ ] 高级搜索和过滤
- [ ] 主题和国际化支持

### 第四阶段 (优化和完善)
- [ ] 性能优化
- [ ] 移动端适配
- [ ] 插件系统
- [ ] 数据分析和统计

## 技术选型理由

### 前端技术栈
- **React**: 生态系统成熟，组件化开发
- **TypeScript**: 类型安全，提高代码质量
- **Vite**: 快速的构建工具和开发体验
- **Ant Design**: 丰富的UI组件，快速开发

### 后端技术栈
- **FastAPI**: 现代、快速、基于Python 3.7+的API框架
- **SQLAlchemy**: 强大的ORM，支持多种数据库
- **Celery**: 分布式任务队列，处理异步任务
- **Redis**: 高性能的内存数据库，用于缓存和队列

## 参考项目

- [Boorusama](https://github.com/khoadng/Boorusama) - Flutter实现的booru客户端
- [yande.re](https://yande.re) - 目标网站
- [Hydrus Network](https://github.com/hydrusnetwork/hydrus) - 图片管理工具

## 许可证

MIT License - 允许自由使用、修改和分发

---

*最后更新: 2024年11月16日*
*作者: Claude Code*