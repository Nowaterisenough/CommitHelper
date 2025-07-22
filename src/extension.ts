import * as vscode from 'vscode';

// 约定式提交类型
const COMMIT_TYPES = [
    { label: 'feat', description: '新功能 (A new feature)' },
    { label: 'fix', description: '修复问题 (A bug fix)' },
    { label: 'docs', description: '文档变更 (Documentation only changes)' },
    { label: 'style', description: '代码格式 (Changes that do not affect the meaning of the code)' },
    { label: 'refactor', description: '重构 (A code change that neither fixes a bug nor adds a feature)' },
    { label: 'perf', description: '性能优化 (A code change that improves performance)' },
    { label: 'test', description: '测试相关 (Adding missing tests or correcting existing tests)' },
    { label: 'chore', description: '构建过程或辅助工具的变动 (Changes to the build process or auxiliary tools)' },
    { label: 'ci', description: 'CI配置 (Changes to our CI configuration files and scripts)' },
    { label: 'build', description: '构建系统 (Changes that affect the build system or external dependencies)' },
    { label: 'revert', description: '回滚 (Reverts a previous commit)' }
];

export function activate(context: vscode.ExtensionContext) {
    console.log('CommitHelper is now active!');
    
    let disposable = vscode.commands.registerCommand('CommitHelper.formatMessage', async () => {
        try {
            await formatExistingCommitMessage();
        } catch (error) {
            vscode.window.showErrorMessage(`格式化提交消息失败: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
}

// 检查消息是否已经是约定式提交格式
function isConventionalCommit(message: string): boolean {
    const firstLine = message.split('\n')[0];
    // 匹配约定式提交格式: type(scope): description 或 type: description
    const conventionalPattern = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\([^)]+\))?!?:\s+.+/;
    return conventionalPattern.test(firstLine);
}

// 从约定式提交中提取信息
function parseConventionalCommit(message: string): {
    type: string;
    scope: string;
    title: string;
    body: string;
    isBreakingChange: boolean;
} {
    const lines = message.split('\n');
    const firstLine = lines[0];
    
    // 解析第一行: type(scope)!: title
    const match = firstLine.match(/^([^(:!]+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
    
    if (!match) {
        // 如果解析失败，返回默认值
        const parsed = parseCommitMessage(message);
        return {
            type: 'feat',
            scope: '',
            title: parsed.title,
            body: parsed.body,
            isBreakingChange: false
        };
    }
    
    const type = match[1];
    const scope = match[3] || '';
    const isBreakingChange = !!match[4];
    const title = match[5];
    
    // 获取 body（跳过空行）
    let bodyStart = 1;
    while (bodyStart < lines.length && !lines[bodyStart].trim()) {
        bodyStart++;
    }
    const body = lines.slice(bodyStart).join('\n').trim();
    
    return { type, scope, title, body, isBreakingChange };
}

async function formatExistingCommitMessage() {
    // 获取当前的提交消息
    const currentMessage = await getCurrentCommitMessage();
    
    if (!currentMessage.trim()) {
        vscode.window.showWarningMessage('提交消息为空，请先使用Copilot生成提交消息或手动输入');
        return;
    }

    // 检查是否已经是约定式提交格式
    let parsedMessage;
    let isAlreadyConventional = false;
    
    if (isConventionalCommit(currentMessage)) {
        const shouldReformat = await vscode.window.showInformationMessage(
            '检测到已经是约定式提交格式，是否需要重新格式化？',
            '重新格式化',
            '取消'
        );
        
        if (shouldReformat !== '重新格式化') {
            return;
        }
        
        parsedMessage = parseConventionalCommit(currentMessage);
        isAlreadyConventional = true;
    } else {
        // 解析普通提交消息
        parsedMessage = parseCommitMessage(currentMessage);
        parsedMessage = {
            type: 'feat', // 默认类型
            scope: '',
            title: parsedMessage.title,
            body: parsedMessage.body,
            isBreakingChange: false
        };
    }

    // 步骤1: 选择提交类型
    const commitType = await vscode.window.showQuickPick(COMMIT_TYPES, {
        placeHolder: '选择最适合的提交类型',
        matchOnDescription: true
    });

    if (!commitType) {
        return;
    }

    // 步骤2: 输入作用域 (可选)
    const scope = await vscode.window.showInputBox({
        prompt: '输入作用域 (可选)',
        placeHolder: '例如: auth, api, ui, components',
        value: parsedMessage.scope || ''
    });

    if (scope === undefined) {
        return;
    }

    // 步骤3: 选择是否为破坏性变更
    const isBreakingChange = await vscode.window.showQuickPick([
        { label: '否', description: '这不是破坏性变更', value: false },
        { label: '是', description: '这是破坏性变更 (BREAKING CHANGE)', value: true }
    ], {
        placeHolder: '这是破坏性变更吗？'
    });

    if (!isBreakingChange) {
        return;
    }

    // 步骤4: 输入Issue号 (可选)
    const issueNumber = await vscode.window.showInputBox({
        prompt: '输入相关的Issue号 (可选)',
        placeHolder: '例如: 123 (不需要#号)',
        value: ''
    });

    if (issueNumber === undefined) {
        return;
    }

    // 步骤5: 确认或修改标题
    const finalTitle = await vscode.window.showInputBox({
        prompt: '确认提交标题',
        placeHolder: '简短描述这次提交的内容',
        value: parsedMessage.title,
        validateInput: (value) => {
            if (!value.trim()) {
                return '提交标题不能为空';
            }
            if (value.length > 72) {
                return '提交标题建议不超过72个字符';
            }
            return null;
        }
    });

    if (!finalTitle) {
        return;
    }

    // 步骤6: 确认或修改详细描述（支持多行输入）
    let finalBody = '';
    if (parsedMessage.body) {
        const bodyResult = await vscode.window.showInputBox({
            prompt: '确认详细描述 (可选，支持多行)',
            placeHolder: '详细描述这次变更的内容和原因',
            value: parsedMessage.body
        });
        
        if (bodyResult === undefined) {
            return;
        }
        finalBody = bodyResult;
    }

    // 构建新的约定式提交消息
    const formattedMessage = buildConventionalCommitMessage(
        commitType.label,
        scope,
        finalTitle,
        finalBody,
        isBreakingChange.value,
        issueNumber
    );

    // 直接设置消息，不再显示预览确认
    await setCommitMessage(formattedMessage);
    vscode.window.showInformationMessage('✅ 约定式提交消息已更新');
}

function parseCommitMessage(message: string): { title: string; body: string } {
    const lines = message.split(/\r?\n/); // 支持不同的换行符
    const title = lines[0] || '';
    
    // 找到第一个非空行作为body的开始
    let bodyStart = 1;
    while (bodyStart < lines.length && !lines[bodyStart].trim()) {
        bodyStart++;
    }
    
    const body = lines.slice(bodyStart).join('\n').trim();
    
    return { title, body };
}

function buildConventionalCommitMessage(
    type: string, 
    scope: string, 
    title: string, 
    body: string, 
    isBreakingChange: boolean, 
    issueNumber: string
): string {
    // 构建类型和作用域部分
    let typeScope = type;
    if (scope.trim()) {
        typeScope += `(${scope.trim()})`;
    }
    
    // 添加破坏性变更标记
    if (isBreakingChange) {
        typeScope += '!';
    }
    
    // 构建主要消息，确保首字母小写（约定式提交规范）
    const normalizedTitle = title.charAt(0).toLowerCase() + title.slice(1);
    let message = `${typeScope}: ${normalizedTitle}`;
    
    // 添加详细描述，保持原有的换行格式
    if (body.trim()) {
        message += `\n\n${body}`;
    }
    
    // 添加破坏性变更说明
    if (isBreakingChange) {
        message += `\n\nBREAKING CHANGE: ${normalizedTitle}`;
    }
    
    // 添加Issue引用
    if (issueNumber.trim()) {
        const issue = issueNumber.trim().replace(/^#/, ''); // 移除可能的#号
        message += `\n\nCloses #${issue}`;
    }
    
    return message;
}

async function getCurrentCommitMessage(): Promise<string> {
    // 获取Git扩展
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        throw new Error('Git扩展未找到');
    }
    
    const git = gitExtension.getAPI(1);
    if (git.repositories.length === 0) {
        throw new Error('未找到Git仓库');
    }
    
    // 获取当前仓库的提交消息
    const repository = git.repositories[0];
    return repository.inputBox.value || '';
}

async function setCommitMessage(message: string) {
    // 获取Git扩展
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        throw new Error('Git扩展未找到');
    }
    
    const git = gitExtension.getAPI(1);
    if (git.repositories.length === 0) {
        throw new Error('未找到Git仓库');
    }
    
    // 设置提交消息到第一个仓库
    const repository = git.repositories[0];
    repository.inputBox.value = message;
}

export function deactivate() {}