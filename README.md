# CommitHelper

一个智能的 VSCode 扩展，帮助你将现有的提交消息格式化为符合约定式提交（Conventional Commits）标准的格式，并支持自动拉取仓库议题进行关联。

## 功能特性

### 智能提交消息格式化
- **一键转换**：将 GitHub Copilot 或手动编写的提交消息转换为约定式提交格式
- **格式检测**：自动识别已有的约定式提交格式，避免重复处理
- **换行保护**：完美保持原有消息的换行格式和文本结构

### 多平台议题集成
- **GitHub** 集成：自动拉取 GitHub 仓库的开放议题
- **GitLab** 集成：支持 GitLab 仓库议题获取
- **Gitee** 集成：支持码云仓库议题管理
- **智能选择**：提供议题搜索、过滤和手动输入选项

### 约定式提交支持
支持所有标准的约定式提交类型：
- `feat`: 新功能
- `fix`: 修复问题
- `docs`: 文档变更
- `style`: 代码格式
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具
- `ci`: CI配置
- `build`: 构建系统
- `revert`: 回滚

### 高级功能
- **作用域支持**：可选的提交作用域（如 `auth`, `api`, `ui`）
- **破坏性变更**：支持 BREAKING CHANGE 标记
- **议题关联**：自动生成 `Closes #123` 格式的议题引用
- **流畅体验**：无需多次确认，点击即开始格式化流程

## 快速开始

### 安装
1. 在 VSCode 扩展商店搜索 "CommitHelper"
2. 点击安装

### 基本使用
1. 在 Git 源代码管理面板中编写或使用 Copilot 生成提交消息
2. 点击源代码管理标题栏的 "Format as Conventional Commit" 按钮（标签图标）
3. 按照引导选择提交类型、作用域等信息
4. 插件会自动格式化并更新你的提交消息

### 配置访问令牌（可选）
为了获取私有仓库的议题，你需要配置相应平台的访问令牌：

#### 方法一：VSCode 设置
1. 打开 VSCode 设置（`Ctrl+,`）
2. 搜索 "commitHelper"
3. 配置相应的令牌：
   - `commitHelper.githubToken`
   - `commitHelper.gitlabToken`
   - `commitHelper.giteeToken`

#### 方法二：设置文件
在 VSCode 设置 JSON 中添加：
```json
{
  "commitHelper.githubToken": "your_github_personal_access_token",
  "commitHelper.gitlabToken": "your_gitlab_personal_access_token",
  "commitHelper.giteeToken": "your_gitee_personal_access_token",
  "commitHelper.localGitlabToken": "your_local_gitlab_personal_access_token"
}
```

#### 方法三：环境变量
设置环境变量：
```bash
export GITHUB_TOKEN="your_github_token"
export GITLAB_TOKEN="your_gitlab_token"
export GITEE_TOKEN="your_gitee_token"
export LOCAL_GITLAB_TOKEN="your_local_gitlab_token"
```

## 访问令牌获取

### GitHub Personal Access Token
1. 访问 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. 点击 "Generate new token (classic)"
3. 选择权限：`repo` (完整仓库权限)
4. 复制生成的令牌

### GitLab Personal Access Token
1. 访问 [GitLab Settings > Access Tokens](https://gitlab.com/-/profile/personal_access_tokens)
2. 创建新令牌
3. 选择权限：`read_api`, `read_repository`
4. 复制生成的令牌

### Gitee Personal Access Token
1. 访问 [Gitee Settings > 私人令牌](https://gitee.com/profile/personal_access_tokens)
2. 创建新令牌
3. 选择权限：`issues`, `pull_requests`
4. 复制生成的令牌

## 使用示例

### 转换前
```
Add user authentication system

- Implemented JWT token validation
- Added login/logout endpoints
- Created user session management
```

### 转换后
```
feat(auth): add user authentication system

- Implemented JWT token validation
- Added login/logout endpoints
- Created user session management

Closes #42
```

## 界面展示

### 格式化流程
1. **类型选择**：从下拉列表选择最适合的提交类型
2. **作用域输入**：可选的功能模块作用域
3. **破坏性变更**：标记是否为破坏性变更
4. **议题选择**：从开放议题列表中选择或手动输入
5. **内容确认**：确认标题和详细描述
6. **自动应用**：格式化后的消息自动填入提交框

### 议题选择界面
```
选择要关联的议题 (共 15 个开放议题)

不关联议题
   此次提交不关联任何议题

#123 Fix login authentication bug
     标签: bug, high-priority

#124 Add dark mode support  
     标签: enhancement, ui

#125 Improve API performance
     标签: performance

手动输入议题号
   手动输入议题号
```

## 开发

### 本地开发
```bash
# 克隆仓库
git clone <repository-url>
cd CommitHelper

# 安装依赖
npm install

# 编译
npm run compile

# 打包
npm run package

# 在 VSCode 中按 F5 启动调试
```

### 项目结构
```
CommitHelper/
├── src/
│   └── extension.ts      # 主要扩展逻辑
├── package.json          # 扩展配置和依赖
├── tsconfig.json         # TypeScript 配置
└── README.md             # 项目文档
```

## 贡献

欢迎提交 Issue 和 Pull Request！

### 贡献指南
1. Fork 项目
2. 创建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送分支 (`git push origin feat/amazing-feature`)
5. 创建 Pull Request

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 相关链接

- [约定式提交规范](https://www.conventionalcommits.org/)
- [GitHub API 文档](https://docs.github.com/en/rest)
- [GitLab API 文档](https://docs.gitlab.com/ee/api/)
- [Gitee API 文档](https://gitee.com/api/v5/swagger)

## 版本历史

### v1.0.0
- 初始版本发布
- 支持约定式提交格式化
- 集成 GitHub/GitLab/Gitee 议题
- 智能格式检测和换行保护

## 常见问题

### Q: 为什么获取不到议题？
A: 请检查：
1. 网络连接是否正常
2. 仓库是否为公开仓库（私有仓库需要配置访问令牌）
3. 访问令牌是否有正确的权限
4. 仓库 URL 格式是否支持（目前支持 GitHub、GitLab、Gitee）

### Q: 如何处理多个 Git remote？
A: 插件会优先使用 `origin` remote，如果不存在则使用第一个可用的 remote。

### Q: 支持自定义提交类型吗？
A: 当前版本使用标准的约定式提交类型，未来版本会考虑支持自定义类型。

### Q: 可以批量处理多个提交吗？
A: 当前版本专注于单个提交消息的格式化，批量处理功能在规划中。
