import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';

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

interface Issue {
    number: number;
    title: string;
    url: string;
    labels?: string[];
}

interface RepoInfo {
    platform: 'github' | 'gitlab' | 'gitee' | 'unknown';
    owner: string;
    repo: string;
    baseUrl: string;
}

// 添加 IssueQuickPickItem 接口
interface IssueQuickPickItem extends vscode.QuickPickItem {
    issue: Issue | null;
}

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
    
    const match = firstLine.match(/^([^(:!]+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
    
    if (!match) {
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
    
    let bodyStart = 1;
    while (bodyStart < lines.length && !lines[bodyStart].trim()) {
        bodyStart++;
    }
    const body = lines.slice(bodyStart).join('\n').trim();
    
    return { type, scope, title, body, isBreakingChange };
}

// 获取仓库信息
async function getRepoInfo(): Promise<RepoInfo | null> {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
            return null;
        }
        
        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
            return null;
        }
        
        const repository = git.repositories[0];
        const remotes = repository.state.remotes;
        
        if (remotes.length === 0) {
            return null;
        }
        
        // 修复类型错误：明确指定参数类型
        const remote = remotes.find((r: any) => r.name === 'origin') || remotes[0];
        const fetchUrl = remote.fetchUrl || remote.pushUrl;
        
        if (!fetchUrl) {
            return null;
        }
        
        return parseGitUrl(fetchUrl);
    } catch (error) {
        console.error('获取仓库信息失败:', error);
        return null;
    }
}

// 解析 Git URL
function parseGitUrl(url: string): RepoInfo | null {
    // 移除 .git 后缀
    url = url.replace(/\.git$/, '');
    
    // GitHub
    let match = url.match(/(?:https?:\/\/github\.com\/|git@github\.com:)([^\/]+)\/(.+)/);
    if (match) {
        return {
            platform: 'github',
            owner: match[1],
            repo: match[2],
            baseUrl: 'https://api.github.com'
        };
    }
    
    // GitLab
    match = url.match(/(?:https?:\/\/gitlab\.com\/|git@gitlab\.com:)([^\/]+)\/(.+)/);
    if (match) {
        return {
            platform: 'gitlab',
            owner: match[1],
            repo: match[2],
            baseUrl: 'https://gitlab.com/api/v4'
        };
    }
    
    // Gitee
    match = url.match(/(?:https?:\/\/gitee\.com\/|git@gitee\.com:)([^\/]+)\/(.+)/);
    if (match) {
        return {
            platform: 'gitee',
            owner: match[1],
            repo: match[2],
            baseUrl: 'https://gitee.com/api/v5'
        };
    }
    
    return null;
}

// 获取开放议题
async function fetchIssues(repoInfo: RepoInfo): Promise<Issue[]> {
    const token = await getAccessToken(repoInfo.platform);
    
    try {
        switch (repoInfo.platform) {
            case 'github':
                return await fetchGitHubIssues(repoInfo, token);
            case 'gitlab':
                return await fetchGitLabIssues(repoInfo, token);
            case 'gitee':
                return await fetchGiteeIssues(repoInfo, token);
            default:
                return [];
        }
    } catch (error) {
        console.error('获取议题失败:', error);
        throw new Error(`获取议题失败: ${error}`);
    }
}

// 获取访问令牌
async function getAccessToken(platform: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('commitHelper');
    
    switch (platform) {
        case 'github':
            return config.get('githubToken') || process.env.GITHUB_TOKEN;
        case 'gitlab':
            return config.get('gitlabToken') || process.env.GITLAB_TOKEN;
        case 'gitee':
            return config.get('giteeToken') || process.env.GITEE_TOKEN;
        default:
            return undefined;
    }
}

// 获取 GitHub 议题
async function fetchGitHubIssues(repoInfo: RepoInfo, token?: string): Promise<Issue[]> {
    const url = `${repoInfo.baseUrl}/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&per_page=50`;
    const headers: any = {
        'User-Agent': 'CommitHelper-VSCode-Extension',
        'Accept': 'application/vnd.github.v3+json'
    };
    
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    
    const data = await httpRequest(url, { headers });
    const issues = JSON.parse(data);
    
    return issues
        .filter((issue: any) => !issue.pull_request) // 过滤掉 PR
        .map((issue: any) => ({
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            labels: issue.labels?.map((label: any) => label.name) || []
        }));
}

// 获取 GitLab 议题
async function fetchGitLabIssues(repoInfo: RepoInfo, token?: string): Promise<Issue[]> {
    const projectPath = encodeURIComponent(`${repoInfo.owner}/${repoInfo.repo}`);
    const url = `${repoInfo.baseUrl}/projects/${projectPath}/issues?state=opened&per_page=50`;
    const headers: any = {
        'User-Agent': 'CommitHelper-VSCode-Extension'
    };
    
    if (token) {
        headers['PRIVATE-TOKEN'] = token;
    }
    
    const data = await httpRequest(url, { headers });
    const issues = JSON.parse(data);
    
    return issues.map((issue: any) => ({
        number: issue.iid,
        title: issue.title,
        url: issue.web_url,
        labels: issue.labels || []
    }));
}

// 获取 Gitee 议题
async function fetchGiteeIssues(repoInfo: RepoInfo, token?: string): Promise<Issue[]> {
    let url = `${repoInfo.baseUrl}/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&per_page=50`;
    if (token) {
        url += `&access_token=${token}`;
    }
    
    const headers = {
        'User-Agent': 'CommitHelper-VSCode-Extension'
    };
    
    const data = await httpRequest(url, { headers });
    const issues = JSON.parse(data);
    
    return issues.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        labels: issue.labels?.map((label: any) => label.name) || []
    }));
}

// HTTP 请求封装
function httpRequest(url: string, options: any = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const client = isHttps ? https : http;
        
        const req = client.request(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        
        req.end();
    });
}

async function formatExistingCommitMessage() {
    const currentMessage = await getCurrentCommitMessage();
    
    if (!currentMessage.trim()) {
        vscode.window.showWarningMessage('提交消息为空，请先使用Copilot生成提交消息或手动输入');
        return;
    }

    let parsedMessage;
    
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
    } else {
        parsedMessage = parseCommitMessage(currentMessage);
        parsedMessage = {
            type: 'feat',
            scope: '',
            title: parsedMessage.title,
            body: parsedMessage.body,
            isBreakingChange: false
        };
    }

    // 选择提交类型
    const commitType = await vscode.window.showQuickPick(COMMIT_TYPES, {
        placeHolder: '选择最适合的提交类型',
        matchOnDescription: true
    });

    if (!commitType) {
        return;
    }

    // 输入作用域
    const scope = await vscode.window.showInputBox({
        prompt: '输入作用域 (可选)',
        placeHolder: '例如: auth, api, ui, components',
        value: parsedMessage.scope || ''
    });

    if (scope === undefined) {
        return;
    }

    // 选择是否为破坏性变更
    const isBreakingChange = await vscode.window.showQuickPick([
        { label: '否', description: '这不是破坏性变更', value: false },
        { label: '是', description: '这是破坏性变更 (BREAKING CHANGE)', value: true }
    ], {
        placeHolder: '这是破坏性变更吗？'
    });

    if (!isBreakingChange) {
        return;
    }

    // 获取议题信息
    let selectedIssue: Issue | null = null;
    
    try {
        const repoInfo = await getRepoInfo();
        if (repoInfo) {
            vscode.window.showInformationMessage('正在获取开放议题...');
            const issues = await fetchIssues(repoInfo);
            
            if (issues.length > 0) {
                const issueItems: IssueQuickPickItem[] = issues.map(issue => ({
                    label: `#${issue.number}`,
                    description: issue.title,
                    detail: issue.labels?.length ? `标签: ${issue.labels.join(', ')}` : '',
                    issue: issue
                }));
                
                // 添加"不关联议题"选项 - 修复类型错误
                issueItems.unshift({
                    label: '$(x) 不关联议题',
                    description: '此次提交不关联任何议题',
                    detail: '',
                    issue: null  // 现在类型是正确的
                });
                
                // 添加"手动输入"选项
                issueItems.push({
                    label: '$(edit) 手动输入议题号',
                    description: '手动输入议题号',
                    detail: '',
                    issue: { number: -1, title: '', url: '' } // 特殊标记
                });
                
                const selectedItem = await vscode.window.showQuickPick(issueItems, {
                    placeHolder: `选择要关联的议题 (共 ${issues.length} 个开放议题)`,
                    matchOnDescription: true
                });
                
                if (selectedItem === undefined) {
                    return;
                }
                
                if (selectedItem.issue && selectedItem.issue.number === -1) {
                    // 手动输入
                    const manualIssue = await vscode.window.showInputBox({
                        prompt: '输入议题号',
                        placeHolder: '例如: 123 (不需要#号)',
                        validateInput: (value) => {
                            if (value && !/^\d+$/.test(value)) {
                                return '请输入有效的数字';
                            }
                            return null;
                        }
                    });
                    
                    if (manualIssue === undefined) {
                        return;
                    }
                    
                    if (manualIssue) {
                        selectedIssue = {
                            number: parseInt(manualIssue),
                            title: '',
                            url: ''
                        };
                    }
                } else {
                    selectedIssue = selectedItem.issue;
                }
            } else {
                vscode.window.showInformationMessage('未找到开放议题');
            }
        }
    } catch (error) {
        console.error('获取议题失败:', error);
        vscode.window.showWarningMessage(`获取议题失败: ${error}，将使用手动输入`);
        
        // 回退到手动输入
        const issueNumber = await vscode.window.showInputBox({
            prompt: '输入相关的Issue号 (可选)',
            placeHolder: '例如: 123 (不需要#号)',
            value: ''
        });

        if (issueNumber === undefined) {
            return;
        }
        
        if (issueNumber) {
            selectedIssue = {
                number: parseInt(issueNumber),
                title: '',
                url: ''
            };
        }
    }

    // 确认标题
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

    // 确认详细描述
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

    // 构建约定式提交消息
    const formattedMessage = buildConventionalCommitMessage(
        commitType.label,
        scope,
        finalTitle,
        finalBody,
        isBreakingChange.value,
        selectedIssue?.number.toString() || ''
    );

    await setCommitMessage(formattedMessage);
    vscode.window.showInformationMessage('✅ 约定式提交消息已更新');
}

function parseCommitMessage(message: string): { title: string; body: string } {
    const lines = message.split(/\r?\n/);
    const title = lines[0] || '';
    
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
    let typeScope = type;
    if (scope.trim()) {
        typeScope += `(${scope.trim()})`;
    }
    
    if (isBreakingChange) {
        typeScope += '!';
    }
    
    const normalizedTitle = title.charAt(0).toLowerCase() + title.slice(1);
    let message = `${typeScope}: ${normalizedTitle}`;
    
    if (body.trim()) {
        message += `\n\n${body}`;
    }
    
    if (isBreakingChange) {
        message += `\n\nBREAKING CHANGE: ${normalizedTitle}`;
    }
    
    if (issueNumber.trim()) {
        const issue = issueNumber.trim().replace(/^#/, '');
        message += `\n\nCloses #${issue}`;
    }
    
    return message;
}

async function getCurrentCommitMessage(): Promise<string> {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        throw new Error('Git扩展未找到');
    }
    
    const git = gitExtension.getAPI(1);
    if (git.repositories.length === 0) {
        throw new Error('未找到Git仓库');
    }
    
    const repository = git.repositories[0];
    return repository.inputBox.value || '';
}

async function setCommitMessage(message: string) {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        throw new Error('Git扩展未找到');
    }
    
    const git = gitExtension.getAPI(1);
    if (git.repositories.length === 0) {
        throw new Error('未找到Git仓库');
    }
    
    const repository = git.repositories[0];
    repository.inputBox.value = message;
}

export function deactivate() {}