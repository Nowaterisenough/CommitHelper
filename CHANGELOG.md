# Changelog

## Version 1.1.4: October 30, 2025

### Bug Fixes
- 修复 CHANGELOG.md 未打包到 VSIX 的问题

## Version 1.1.3: October 30, 2025

### Documentation
- 转换 CHANGELOG 格式以符合 VSCode 市场规范

## Version 1.1.2: October 30, 2025

### Bug Fixes
- 修复CHANGELOG生成脚本以支持merge工作流

### Documentation
- 补充 v1.1.1 版本更新日志

## Version 1.1.1: October 30, 2025

### Refactoring
- 将 1394 行单文件重构为 16 个模块化文件，提升代码可维护性
- 引入 AppContext 统一管理全局状态，消除 8 个全局变量
- 使用策略模式重构平台适配逻辑（GitHub/GitLab/Gitee）
- 封装 HttpClient 统一管理 HTTP 连接池和请求重试
- 分离 UI 交互逻辑到独立的 IssuePicker 模块

### Bug Fixes
- 修复 Cache LRU 实现缺陷，get() 方法现在正确更新访问顺序
- 改进错误提示：缺少访问令牌时抛出明确异常而非返回空数组

### Technical Improvements
- extension.ts 从 1394 行精简到 230 行（减少 83%）
- 新增分层架构：core/ http/ git/ platforms/ ui/ utils/
- 每个模块职责单一，符合 SOLID 原则
- 完全向后兼容，无破坏性变更
- 新增平台支持只需实现 IPlatform 接口

## Version 1.0.24: July 31, 2025

### Enhancements
- 优化议题列表显示，支持两行显示标题和编号

## Version 1.0.23: July 31, 2025

### Enhancements
- 优化议题列表显示，简化提交类型选择逻辑

## Version 1.0.22: July 31, 2025

### Enhancements
- 优化议题标题清理规则，增强识别能力并保持原始标题
- 添加议题标题清理和类型识别功能，增强识别能力

### Refactoring
- 移除预编译清理规则正则表达式，优化议题标题清理函数

## Version 1.0.21: July 31, 2025

### Maintenance
- 移除版本历史部分，简化文档内容

## Version 1.0.20: July 31, 2025

### Enhancements
- 优化提交类型选择界面，调整选项标签格式

## Version 1.0.19: July 31, 2025

### Enhancements
- 优化提交类型选择界面，调整选项标签格式和状态切换逻辑

## Version 1.0.18: July 31, 2025

### Enhancements
- 优化提交类型选择界面，调整复选框状态显示方式

## Version 1.0.17: July 31, 2025

### Enhancements
- 优化提交选项，添加分隔线支持，改进提交消息生成逻辑

### Documentation
- 更新 README.md，优化徽章展示和功能描述格式

## Version 1.0.16: July 31, 2025

### Enhancements
- 优化提交标题提取和类型选择逻辑，支持动态切换 Breaking Change 选项

## Version 1.0.15: July 31, 2025

### Enhancements
- 添加VSIX文件清理和数量检查，避免版本冲突

## Version 1.0.14: July 31, 2025

### Enhancements
- 从.vscodeignore中移除LICENSE文件
- 优化更新日志生成和VSIX文件验证流程，添加版本号检查
- 更新 CHANGELOG.md 和 README.md，优化文档结构和内容
- 添加对提交类型的支持，区分破坏性变更并更新提交消息生成逻辑

## Version 1.0.13: July 31, 2025

### Enhancements
- 优化VSIX文件下载和验证流程，移除旧的构建文件清理步骤
- 更新.vscodeignore文件，添加对大文件和临时文件的排除规则

## Version 1.0.12: July 31, 2025

### Bug Fixes
- 修复 GitHub Actions 弃用警告，更新为现代化的 softprops/action-gh-release
- 修复发布 Assets 中 VSIX 文件缺失问题
- 优化发布工作流，确保版本号与文件名一致

### Documentation
- 美化 README.md，去除所有 emoji，提升专业性
- 优化项目文档结构和可读性

## Version 1.0.11: July 31, 2025

### Enhancements
- 新增手动绑定议题和刷新议题按钮
- 支持议题双行显示：第一行显示议题号和类型，第二行显示标题
- 智能议题类型识别，支持 16+ 种类型检测（feat、fix、docs、perf 等）
- 议题类型显示优化，使用文本标签替代 emoji 图标

### Performance
- 引入 HTTP 连接池，减少 API 请求开销
- 新增缓存系统，支持 TTL 和自动清理
- 预编译正则表达式，提升匹配性能
- 优化内存管理，增加缓存大小限制

## Version 1.0.10: July 31, 2025

### Enhancements
- 添加议题刷新功能，支持实时更新议题列表

### Bug Fixes
- 修正 CHANGELOG.md 链接中的大小写错误

## Version 1.0.9: July 31, 2025

### Documentation
- 更新 CHANGELOG.md 结构，优化版本记录格式

## Version 1.0.8: July 31, 2025

### Enhancements
- 添加应用图标文件并更新配置

### Refactoring
- 优化构建和发布流程
- 改进标签获取和更新日志生成逻辑
- 移除不必要的构建步骤

## Version 1.0.7: July 31, 2025

### Maintenance
- 版本维护更新

## Version 1.0.6: July 31, 2025

### Enhancements
- 更新 VS Code 扩展支持的命令和版本要求
- 添加包配置和缓存机制

## Version 1.0.5: July 31, 2025

### Bug Fixes
- 更新上传 VSIX 步骤中的 actions/upload-artifact 版本至 v4

## Version 1.0.4: July 31, 2025

### Enhancements
- 更新 VS Code 扩展版本并修正发布命令

## Version 1.0.1: July 31, 2025

### Enhancements
- 支持本地 GitLab 议题拉取

## Version 1.0.0: July 31, 2025

### Initial Release
- 支持约定式提交格式化
- 集成 GitHub/GitLab/Gitee 议题
- 智能格式检测和换行保护
- 一键转换提交消息为规范格式
- 支持议题关联和自动引用生成