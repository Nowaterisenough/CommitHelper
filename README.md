# Conventional Commit Formatter

这是一个VSCode插件，用于将现有的提交消息（如Copilot生成的）格式化为约定式提交规范。

## 功能

- 读取现有的提交消息
- 引导用户选择约定式提交类型
- 支持作用域、破坏性变更和Issue绑定
- 自动格式化为标准的约定式提交格式

## 使用方法

1. 使用Copilot生成提交消息
2. 点击源代码管理视图中的"Format as Conventional Commit"按钮
3. 按照提示选择提交类型和其他选项
4. 确认格式化后的消息

## 安装

1. 从VSCode扩展市场安装
2. 或者下载.vsix文件手动安装

## 开发

```bash
npm install
npm run compile