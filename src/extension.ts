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
    platform: 'github' | 'gitlab' | 'gitee' | 'local-gitlab' | 'unknown';
    owner: string;
    repo: string;
    baseUrl: string;
    hostUrl?: string; // 用于存储完整的主机URL
}

// 添加 IssueQuickPickItem 接口
interface IssueQuickPickItem extends vscode.QuickPickItem {
    issue: Issue | null;
}

// 添加 ParsedMessage 接口
interface ParsedMessage {
    type: string;
    scope: string;
    title: string;
    body: string;
    isBreakingChange: boolean;
}

// 添加缓存机制
const issueCache = new Map<string, { issues: Issue[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

export function activate(context: vscode.ExtensionContext) {
    console.log('CommitHelper is now active!');
    
    // 等待 Git 扩展加载
    const waitForGit = async () => {
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension && gitExtension.isActive) {
                const git = gitExtension.exports.getAPI(1);
                if (git.repositories.length > 0) {
                    console.log('Git extension is ready');
                    break;
                }
            }
            
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    };
    
    // 异步等待 Git 扩展
    waitForGit();
    
    let disposable = vscode.commands.registerCommand('CommitHelper.formatMessage', async () => {
        try {
            await formatExistingCommitMessage();
        } catch (error) {
            vscode.window.showErrorMessage(`格式化提交消息失败: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
    
    // 监听工作区变化，确保在 Git 仓库打开时扩展可用
    const onDidChangeWorkspaceFolders = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        console.log('Workspace folders changed, checking for Git repositories...');
    });
    
    context.subscriptions.push(onDidChangeWorkspaceFolders);
}

// 检查消息是否已经是约定式提交格式
function isConventionalCommit(message: string): boolean {
    const firstLine = message.split('\n')[0];
    const conventionalPattern = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\([^)]+\))?!?:\s+.+/;
    return conventionalPattern.test(firstLine);
}

// 从约定式提交中提取信息
function parseConventionalCommit(message: string): ParsedMessage {
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

// 检查是否为IP地址
function isIPAddress(hostname: string): boolean {
    // IPv4 正则表达式
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 正则表达式（简化版）
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::/;
    
    return ipv4Regex.test(hostname) || ipv6Regex.test(hostname);
}

// 检查是否为局域网地址
function isLocalNetwork(hostname: string): boolean {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return true;
    }
    
    // 检查常见的局域网IP段
    const localNetworkPatterns = [
        /^192\.168\.\d{1,3}\.\d{1,3}$/, // 192.168.x.x
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 10.x.x.x
        /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16-31.x.x
        /^169\.254\.\d{1,3}\.\d{1,3}$/ // 169.254.x.x (链路本地地址)
    ];
    
    return localNetworkPatterns.some(pattern => pattern.test(hostname));
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
    
    // GitLab.com (公共)
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
    
    // 本地或自建GitLab实例（支持HTTP和HTTPS）
    // 匹配格式：https://gitlab.example.com/user/repo 或 http://192.168.1.100:8080/user/repo
    match = url.match(/^(https?:\/\/([^\/]+))\/([^\/]+)\/(.+)$/);
    if (match) {
        const fullHostUrl = match[1]; // 包含协议的完整主机URL
        const hostname = match[2].split(':')[0]; // 提取主机名（去掉端口）
        const owner = match[3];
        const repo = match[4];
        
        // 检查是否为本地GitLab实例
        const isLocal = isLocalNetwork(hostname) || 
                       isIPAddress(hostname) || 
                       hostname.includes('gitlab') ||
                       hostname.endsWith('.local') ||
                       hostname.endsWith('.lan');
        
        if (isLocal) {
            return {
                platform: 'local-gitlab',
                owner: owner,
                repo: repo,
                baseUrl: `${fullHostUrl}/api/v4`,
                hostUrl: fullHostUrl
            };
        }
    }
    
    // SSH格式的本地GitLab：git@gitlab.example.com:user/repo.git
    match = url.match(/^git@([^:]+):([^\/]+)\/(.+)$/);
    if (match) {
        const hostname = match[1];
        const owner = match[2];
        const repo = match[3];
        
        // 检查是否为本地GitLab实例
        const isLocal = isLocalNetwork(hostname) || 
                       isIPAddress(hostname) || 
                       hostname.includes('gitlab') ||
                       hostname.endsWith('.local') ||
                       hostname.endsWith('.lan');
        
        if (isLocal) {
            // 对于SSH格式，默认使用HTTPS协议构建API URL
            const protocol = isLocalNetwork(hostname) ? 'http' : 'https';
            const hostUrl = `${protocol}://${hostname}`;
            
            return {
                platform: 'local-gitlab',
                owner: owner,
                repo: repo,
                baseUrl: `${hostUrl}/api/v4`,
                hostUrl: hostUrl
            };
        }
    }
    
    return null;
}

// 基于 Copilot 生成提交消息
async function generateCommitMessageFromChanges(): Promise<string | null> {
    try {
        // 首先检查 Copilot 是否可用
        const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
        if (!copilotExtension || !copilotExtension.isActive) {
            console.log('Copilot 扩展未找到或未激活');
            return null;
        }

        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
            console.log('Git 扩展未找到');
            return null;
        }
        
        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
            console.log('未找到 Git 仓库');
            return null;
        }
        
        const repository = git.repositories[0];
        const changes = repository.state.workingTreeChanges;
        
        if (changes.length === 0) {
            console.log('没有检测到代码变更');
            return null;
        }

        console.log(`检测到 ${changes.length} 个文件变更`);

        // 调用 Git 提交框的 Copilot 功能
        const copilotMessage = await tryGitCommitCompletion();
        
        return copilotMessage;
        
    } catch (error) {
        console.error('Copilot 生成提交消息失败:', error);
        return null;
    }
}

// 尝试调用 Git 提交框中的 Copilot 生成按钮
async function tryGitCommitCompletion(): Promise<string | null> {
    try {
        // 获取 Git 仓库
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
            console.log('Git 扩展未找到');
            return null;
        }
        
        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
            console.log('未找到 Git 仓库');
            return null;
        }
        
        const repository = git.repositories[0];
        const originalMessage = repository.inputBox.value;
        
        // 方法1: 尝试带参数的调用
        try {
            console.log('尝试方法1: 带参数调用 Copilot');
            await vscode.commands.executeCommand('github.copilot.git.generateCommitMessage', repository);
            
            // 等待生成完成
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const newMessage = repository.inputBox.value;
            if (newMessage && newMessage !== originalMessage && newMessage.trim()) {
                console.log('方法1成功:', newMessage);
                return newMessage;
            }
        } catch (error) {
            console.log('方法1失败:', error);
        }

        // 方法2: 尝试先聚焦到 Git 提交框
        try {
            console.log('尝试方法2: 先聚焦再调用');
            
            // 先聚焦到 SCM 视图
            await vscode.commands.executeCommand('workbench.view.scm');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // 聚焦到提交消息输入框
            await vscode.commands.executeCommand('scm.viewNextCommit');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 再调用 Copilot
            await vscode.commands.executeCommand('github.copilot.git.generateCommitMessage');
            
            // 等待生成完成
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const newMessage = repository.inputBox.value;
            if (newMessage && newMessage !== originalMessage && newMessage.trim()) {
                console.log('方法2成功:', newMessage);
                return newMessage;
            }
        } catch (error) {
            console.log('方法2失败:', error);
        }

        // 方法4: 尝试通过 URI 调用
        try {
            console.log('尝试方法4: URI 调用');
            const uri = vscode.Uri.parse('command:github.copilot.git.generateCommitMessage');
            await vscode.commands.executeCommand('vscode.open', uri);
            
            // 等待生成完成
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const newMessage = repository.inputBox.value;
            if (newMessage && newMessage !== originalMessage && newMessage.trim()) {
                console.log('方法4成功:', newMessage);
                return newMessage;
            }
        } catch (error) {
            console.log('方法4失败:', error);
        }

        // 方法5: 尝试模拟用户操作
        try {
            console.log('尝试方法5: 模拟用户操作');
            
            // 确保有一些文件变更
            const changes = repository.state.workingTreeChanges;
            if (changes.length === 0) {
                console.log('没有文件变更，无法生成提交消息');
                return null;
            }

            // 打开 Git 视图
            await vscode.commands.executeCommand('workbench.view.scm');
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 尝试触发提交消息生成的快捷键（如果存在）
            // 这些是一些可能的快捷键组合
            const possibleShortcuts = [
                'workbench.action.terminal.sendSequence',
                'editor.action.triggerSuggest',
                'github.copilot.generate'
            ];

            for (const shortcut of possibleShortcuts) {
                try {
                    await vscode.commands.executeCommand(shortcut);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const newMessage = repository.inputBox.value;
                    if (newMessage && newMessage !== originalMessage && newMessage.trim()) {
                        console.log(`方法5成功 (${shortcut}):`, newMessage);
                        return newMessage;
                    }
                } catch (error) {
                    console.log(`快捷键 ${shortcut} 失败:`, error);
                }
            }
        } catch (error) {
            console.log('方法5失败:', error);
        }

        console.log('所有调用 Copilot 的方法都失败了');
        return null;
        
    } catch (error) {
        console.error('Git 提交补全失败:', error);
        return null;
    }
}

// 手动输入提交消息
async function manualInputCommitMessage(): Promise<string | null> {
    const message = await vscode.window.showInputBox({
        prompt: '请输入提交消息',
        placeHolder: '例如: 添加用户登录功能',
        validateInput: (value) => {
            if (!value.trim()) {
                return '提交消息不能为空';
            }
            return null;
        }
    });
    
    return message || null;
}

// 获取开放议题
async function fetchIssues(repoInfo: RepoInfo): Promise<Issue[]> {
    const cacheKey = `${repoInfo.platform}-${repoInfo.owner}-${repoInfo.repo}`;
    const cached = issueCache.get(cacheKey);
    
    // 检查缓存
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('使用缓存的议题数据');
        return cached.issues;
    }
    
    const token = await getAccessToken(repoInfo.platform, repoInfo.hostUrl);
    
    try {
        let issues: Issue[] = [];
        
        switch (repoInfo.platform) {
            case 'github':
                issues = await fetchGitHubIssues(repoInfo, token);
                break;
            case 'gitlab':
            case 'local-gitlab':
                issues = await fetchGitLabIssues(repoInfo, token);
                break;
            case 'gitee':
                issues = await fetchGiteeIssues(repoInfo, token);
                break;
            default:
                return [];
        }
        
        // 缓存结果
        issueCache.set(cacheKey, { 
            issues, 
            timestamp: Date.now() 
        });
        
        return issues;
    } catch (error) {
        console.error('获取议题失败:', error);
        
        // 如果是频率限制错误，提供更友好的错误信息
        if (error instanceof Error) {
            if (error.message.includes('rate limit') || error.message.includes('403')) {
                throw new Error(`GitHub API 访问频率超限。请配置 GitHub Token 以获得更高的访问限制。\n当前限制：未认证 60次/小时，已认证 5000次/小时`);
            }
        }
        
        throw new Error(`获取议题失败: ${error}`);
    }
}

// 获取访问令牌
async function getAccessToken(platform: string, hostUrl?: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('commitHelper');
    
    switch (platform) {
        case 'github':
            return config.get<string>('githubToken') || process.env.GITHUB_TOKEN;
        case 'gitlab':
            return config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
        case 'local-gitlab':
            // 对于本地GitLab实例，尝试多种配置方式
            let token = config.get<string>('localGitlabToken') || process.env.LOCAL_GITLAB_TOKEN;
            
            // 如果没有专门的本地GitLab token，尝试使用通用的GitLab token
            if (!token) {
                token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
            }
            
            // 支持基于主机URL的特定配置
            if (!token && hostUrl) {
                const hostname = new URL(hostUrl).hostname;
                const hostConfigKey = `gitlabToken.${hostname}`;
                token = config.get<string>(hostConfigKey);
            }
            
            return token;
        case 'gitee':
            return config.get<string>('giteeToken') || process.env.GITEE_TOKEN;
        default:
            return undefined;
    }
}

// 获取 GitHub 议题
async function fetchGitHubIssues(repoInfo: RepoInfo, token?: string): Promise<Issue[]> {
    // 减少请求的议题数量
    const url = `${repoInfo.baseUrl}/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&per_page=20&sort=updated`;
    const headers: any = {
        'User-Agent': 'CommitHelper-VSCode-Extension',
        'Accept': 'application/vnd.github.v3+json'
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;  // 使用 Bearer 而不是 token
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

// 获取 GitLab 议题（包括本地GitLab实例）
async function fetchGitLabIssues(repoInfo: RepoInfo, token?: string): Promise<Issue[]> {
    const projectPath = encodeURIComponent(`${repoInfo.owner}/${repoInfo.repo}`);
    const url = `${repoInfo.baseUrl}/projects/${projectPath}/issues?state=opened&per_page=50`;
    const headers: any = {
        'User-Agent': 'CommitHelper-VSCode-Extension'
    };
    
    if (token) {
        headers['PRIVATE-TOKEN'] = token;
    }
    
    // 对于本地GitLab实例，可能需要处理自签名证书
    const requestOptions: any = { headers };
    
    if (repoInfo.platform === 'local-gitlab' && repoInfo.hostUrl?.startsWith('https:')) {
        // 对于HTTPS的本地GitLab实例，可能需要忽略证书错误
        // 注意：这仅用于开发环境，生产环境应使用有效证书
        requestOptions.rejectUnauthorized = false;
    }
    
    const data = await httpRequest(url, requestOptions);
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
        
        // 处理自签名证书问题（仅用于开发环境）
        if (isHttps && options.rejectUnauthorized === false) {
            process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
        }
        
        const req = client.request(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                // 恢复证书验证设置
                if (isHttps && options.rejectUnauthorized === false) {
                    delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
                }
                
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    // 记录频率限制信息（仅用于调试）
                    if (url.includes('github.com')) {
                        const remaining = res.headers['x-ratelimit-remaining'];
                        const reset = res.headers['x-ratelimit-reset'];
                        console.log(`GitHub API 剩余请求次数: ${remaining}`);
                        if (reset) {
                            const resetTime = new Date(parseInt(reset as string) * 1000);
                            console.log(`限制重置时间: ${resetTime.toLocaleString()}`);
                        }
                    }
                    
                    resolve(data);
                } else if (res.statusCode === 403) {
                    // 特殊处理 403 错误
                    const rateLimitRemaining = res.headers['x-ratelimit-remaining'];
                    if (rateLimitRemaining === '0') {
                        reject(new Error('rate limit exceeded'));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });
        
        req.on('error', (error) => {
            // 恢复证书验证设置
            if (isHttps && options.rejectUnauthorized === false) {
                delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
            }
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
    let currentMessage = await getCurrentCommitMessage();
    
    // 如果提交消息为空，提供生成选项
    if (!currentMessage.trim()) {
        // 检查 Copilot 是否可用
        const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
        const copilotAvailable = copilotExtension?.isActive || false;
        
        let generateOptions;
        
        if (copilotAvailable) {
            generateOptions = [
                { label: '$(copilot) 使用 Copilot 智能生成', value: 'copilot-generate' },
                { label: '$(edit) 手动输入', value: 'manual' },
                { label: '$(x) 取消', value: 'cancel' }
            ];
        } else {
            generateOptions = [
                { label: '$(edit) 手动输入', value: 'manual' },
                { label: '$(x) 取消', value: 'cancel' }
            ];
        }
        
        const generateChoice = await vscode.window.showQuickPick(generateOptions, {
            placeHolder: copilotAvailable ? 
                '提交消息为空，推荐使用 Copilot 智能生成' : 
                '提交消息为空，请手动输入'
        });
        
        if (!generateChoice || generateChoice.value === 'cancel') {
            return;
        }
        
        switch (generateChoice.value) {
            case 'copilot-generate':
                // 显示进度提示
                const progressOptions = {
                    location: vscode.ProgressLocation.Notification,
                    title: "正在使用 Copilot 生成提交消息...",
                    cancellable: false
                };
                
                currentMessage = await vscode.window.withProgress(progressOptions, async (progress) => {
                    progress.report({ increment: 30, message: "分析代码变更..." });
                    
                    const result = await generateCommitMessageFromChanges();
                    
                    progress.report({ increment: 70, message: "生成提交消息..." });
                    
                    return result || '';
                });
                
                if (!currentMessage) {
                    const retryChoice = await vscode.window.showWarningMessage(
                        'Copilot 无法生成提交消息，可能是因为：\n1. 没有检测到代码变更\n2. Copilot 服务暂时不可用\n3. 网络连接问题',
                        '手动输入',
                        '取消'
                    );
                    
                    if (retryChoice === '手动输入') {
                        currentMessage = await manualInputCommitMessage() || '';
                    } else {
                        return;
                    }
                } else {
                    vscode.window.showInformationMessage(`✨ Copilot 已生成提交消息: "${currentMessage}"`);
                }
                break;
            case 'manual':
                currentMessage = await manualInputCommitMessage() || '';
                break;
        }
        
        if (!currentMessage.trim()) {
            vscode.window.showWarningMessage('未生成有效的提交消息');
            return;
        }
        
        // 将生成的消息设置到提交框中
        await setCommitMessage(currentMessage);
    }

    // 明确指定 parsedMessage 的类型
    let parsedMessage: ParsedMessage;
    
    // 如果已经是约定式提交格式，直接解析，不再询问
    if (isConventionalCommit(currentMessage)) {
        parsedMessage = parseConventionalCommit(currentMessage);
    } else {
        const basicParsed = parseCommitMessage(currentMessage);
        parsedMessage = {
            type: 'feat',
            scope: '',
            title: basicParsed.title,
            body: basicParsed.body,
            isBreakingChange: false
        };
    }

    // 选择提交类型（预选智能推测的类型）
    const commitTypeItems = COMMIT_TYPES.map(type => ({
        ...type,
        picked: type.label === parsedMessage.type // 现在 parsedMessage 有明确的类型
    }));
    
    const commitType = await vscode.window.showQuickPick(commitTypeItems, {
        placeHolder: `选择最适合的提交类型 (推荐: ${parsedMessage.type})`,
        matchOnDescription: true
    });

    if (!commitType) {
        return;
    }

    // 输入作用域（预填智能推测的作用域）
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
            const platformName = repoInfo.platform === 'local-gitlab' ? 
                `本地GitLab (${repoInfo.hostUrl})` : 
                repoInfo.platform;
            
            vscode.window.showInformationMessage(`正在从 ${platformName} 获取开放议题...`);
            const issues = await fetchIssues(repoInfo);
            
            if (issues.length > 0) {
                const issueItems: IssueQuickPickItem[] = issues.map(issue => ({
                    label: `#${issue.number}`,
                    description: issue.title,
                    detail: issue.labels?.length ? `标签: ${issue.labels.join(', ')}` : '',
                    issue: issue
                }));
                
                // 添加"不关联议题"选项
                issueItems.unshift({
                    label: '$(x) 不关联议题',
                    description: '此次提交不关联任何议题',
                    detail: '',
                    issue: null
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
                vscode.window.showInformationMessage(`未在 ${platformName} 找到开放议题`);
            }
        }
    } catch (error) {
        console.error('获取议题失败:', error);
        
        let errorMessage = `获取议题失败: ${error}`;
        
        // 如果是 GitHub 频率限制错误，提供配置建议
        if (error instanceof Error && error.message.includes('rate limit')) {
            errorMessage += '\n\n💡 建议：配置 GitHub Token 以获得更高的 API 访问限制';
            
            // 提供快速配置选项
            const configureToken = await vscode.window.showErrorMessage(
                errorMessage,
                '配置 GitHub Token',
                '稍后配置'
            );
            
            if (configureToken === '配置 GitHub Token') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'commitHelper.githubToken');
            }
        } else {
            vscode.window.showWarningMessage(`${errorMessage}，将使用手动输入`);
        }
        
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

    // 确认标题 - 去除已有的类型前缀避免重复
    let cleanTitle = parsedMessage.title;
    // 如果标题以类型开头，移除它
    const typePattern = new RegExp(`^${parsedMessage.type}(\\([^)]*\\))?!?:\\s*`, 'i');
    cleanTitle = cleanTitle.replace(typePattern, '');
    
    const finalTitle = await vscode.window.showInputBox({
        prompt: '确认提交标题',
        placeHolder: '简短描述这次提交的内容',
        value: cleanTitle,
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