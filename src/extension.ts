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
    { label: 'build', description: '构建系统 (Changes that affect the build system or external dependencies)' },
    { label: 'ci', description: 'CI配置 (Changes to our CI configuration files and scripts)' },
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
    issue: Issue;
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

// 添加输出频道变量
let outputChannel: vscode.OutputChannel;

// 在现有的常量定义后添加日志函数
function logToOutput(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    // 输出到频道
    if (outputChannel) {
        outputChannel.appendLine(logMessage);
        if (data) {
            outputChannel.appendLine(JSON.stringify(data, null, 2));
        }
    }
    
    // 同时输出到控制台
    console.log(message, data);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CommitHelper is now active!');
    
    // 创建输出频道
    outputChannel = vscode.window.createOutputChannel('CommitHelper');
    context.subscriptions.push(outputChannel);
    
    logToOutput('CommitHelper 插件已激活');

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

// 获取开放议题
async function fetchIssues(repoInfo: RepoInfo, forceRefresh: boolean = false): Promise<Issue[]> {
    const cacheKey = `${repoInfo.platform}-${repoInfo.owner}-${repoInfo.repo}`;
    const cached = issueCache.get(cacheKey);
    
    // 如果不强制刷新，检查缓存
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
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
    // 步骤1：选择提交类型，同时异步获取议题（强制刷新缓存）
    const currentMessage = await getCurrentCommitMessage();
    let parsedMessage: ParsedMessage;
    
    // 如果已经是约定式提交格式，直接解析
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

    // 开始异步获取议题列表（强制刷新缓存）
    const issuesPromise = getIssuesAsyncWithRefresh();

    // 创建提交类型选择项（单选）
    const commitTypeItems = COMMIT_TYPES.map(type => ({
        label: type.label,
        description: type.description,
        picked: type.label === parsedMessage.type
    }));

    const selectedCommitType = await vscode.window.showQuickPick(commitTypeItems, {
        placeHolder: `选择提交类型 (推荐: ${parsedMessage.type})`,
        matchOnDescription: true,
        ignoreFocusOut: true
    });

    if (!selectedCommitType) {
        return;
    }

    const commitType = selectedCommitType.label;

    // 询问是否为破坏性变更
    const isBreakingChange = await vscode.window.showQuickPick([
        { label: '否', description: '这不是破坏性变更', value: false },
        { label: '是', description: '这是破坏性变更 (BREAKING CHANGE)', value: true }
    ], {
        placeHolder: '这是破坏性变更吗？',
        ignoreFocusOut: true
    });

    if (!isBreakingChange) {
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

    // 步骤2：等待议题获取完成并显示议题选择界面
    const selectedIssues = await selectIssuesWithRefresh(issuesPromise);
    if (selectedIssues === undefined) {
        return; // 用户取消
    }

    logToOutput(`收到的议题选择结果:`, selectedIssues.map(i => `#${i.number} ${i.title}`));

    // 步骤3：标题填写 - 修复后的逻辑
    let defaultTitle = '';
    
    // 清理当前标题，去除类型前缀
    let cleanCurrentTitle = parsedMessage.title;
    if (cleanCurrentTitle) {
        const typePattern = new RegExp(`^${parsedMessage.type}(\\([^)]*\\))?!?:\\s*`, 'i');
        cleanCurrentTitle = cleanCurrentTitle.replace(typePattern, '').trim();
    }
    
    // 判断是否有有效的当前标题
    const hasCurrentTitle = cleanCurrentTitle.length > 0;
    
    logToOutput(`标题处理状态: hasCurrentTitle=${hasCurrentTitle}, cleanCurrentTitle="${cleanCurrentTitle}", selectedIssues.length=${selectedIssues.length}`);
    
    if (selectedIssues.length > 0) {
        if (!hasCurrentTitle) {
            // 如果没有当前标题且有选中的议题，直接使用议题标题
            defaultTitle = selectedIssues[0].title;
            logToOutput(`原标题为空，使用议题标题: ${defaultTitle}`);
        } else {
            // 如果有当前标题且有选中的议题，询问用户选择
            const useIssueTitle = await vscode.window.showQuickPick([
                { label: '使用议题标题', description: selectedIssues[0].title, value: 'issue' },
                { label: '使用当前标题', description: cleanCurrentTitle, value: 'current' }
            ], {
                placeHolder: '检测到已有标题，选择要使用的标题',
                ignoreFocusOut: true
            });
            
            if (!useIssueTitle) {
                return;
            }
            
            defaultTitle = useIssueTitle.value === 'issue' ? selectedIssues[0].title : cleanCurrentTitle;
            logToOutput(`用户选择使用${useIssueTitle.value === 'issue' ? '议题' : '当前'}标题: ${defaultTitle}`);
        }
    } else {
        // 没有选中议题，使用当前标题
        defaultTitle = cleanCurrentTitle;
        logToOutput(`无议题选择，使用当前标题: ${defaultTitle}`);
    }

    const finalTitle = await vscode.window.showInputBox({
        prompt: '输入提交标题',
        placeHolder: '简短描述这次提交的内容',
        value: defaultTitle,
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

    // 步骤4：内容填写
    const finalBody = await vscode.window.showInputBox({
        prompt: '输入详细描述 (可选)',
        placeHolder: '详细描述这次变更的内容和原因',
        value: parsedMessage.body
    });

    if (finalBody === undefined) {
        return;
    }

    // 构建约定式提交消息
    const formattedMessage = buildConventionalCommitMessage(
        commitType,
        scope,
        finalTitle,
        finalBody,
        isBreakingChange.value,
        selectedIssues
    );

    await setCommitMessage(formattedMessage);
    vscode.window.showInformationMessage('✅ 约定式提交消息已更新');
}

// 异步获取议题列表并强制刷新缓存
async function getIssuesAsyncWithRefresh(): Promise<Issue[]> {
    try {
        const repoInfo = await getRepoInfo();
        if (!repoInfo) {
            return [];
        }
        
        // 强制刷新缓存
        const issues = await fetchIssues(repoInfo, true);
        return issues;
    } catch (error) {
        console.error('获取议题失败:', error);
        return [];
    }
}

// 选择议题，支持刷新功能 - 修复事件处理逻辑
async function selectIssuesWithRefresh(initialIssuesPromise: Promise<Issue[]>): Promise<Issue[]> {
    let issues = await initialIssuesPromise;
    
    // 如果没有议题，直接返回空数组，跳过议题选择
    if (issues.length === 0) {
        vscode.window.showInformationMessage('未找到开放议题，跳过议题关联');
        return [];
    }
    
    while (true) {
        const issueItems: IssueQuickPickItem[] = [];
        
        // 只显示议题列表
        issues.forEach(issue => {
            issueItems.push({
                label: `#${issue.number}`,
                description: issue.title,
                detail: issue.labels?.length ? `标签: ${issue.labels.join(', ')}` : '',
                issue: issue
            });
        });
        
        // 创建快捷选择器
        const quickPick = vscode.window.createQuickPick<IssueQuickPickItem>();
        quickPick.items = issueItems;
        quickPick.placeholder = `选择要关联的议题 (支持多选，共 ${issues.length} 个) - 输入 /refresh 刷新议题列表`;
        quickPick.canSelectMany = true;
        quickPick.ignoreFocusOut = true;
        
        return new Promise<Issue[]>((resolve) => {
            let isResolved = false; // 添加标志防止重复resolve
            let refreshRequested = false;

            quickPick.onDidAccept(() => {
                if (isResolved) return; // 防止重复处理
                
                const selectedItems = quickPick.selectedItems;
                const selectedIssues = selectedItems.map(item => item.issue);
                
                logToOutput(`用户在QuickPick中选择了 ${selectedIssues.length} 个议题:`, selectedIssues.map(i => `#${i.number} ${i.title}`));
                
                isResolved = true;
                quickPick.dispose();
                resolve(selectedIssues);
            });
            
            // 监听按键事件来支持刷新
            quickPick.onDidChangeValue((value) => {
                if (isResolved) return; // 防止重复处理
                
                // 当用户输入特殊命令时触发刷新
                if (value === '/refresh' || value === 'refresh') {
                    refreshRequested = true;
                    isResolved = true;
                    quickPick.hide();
                }
            });
            
            quickPick.onDidHide(() => {
                if (isResolved) return; // 防止重复处理
                
                isResolved = true;
                quickPick.dispose();
                
                if (refreshRequested) {
                    refreshRequested = false;
                    vscode.window.showInformationMessage('正在刷新议题列表...');
                    
                    // 重新获取议题
                    getIssuesAsyncWithRefresh().then(newIssues => {
                        issues = newIssues;
                        if (issues.length === 0) {
                            vscode.window.showInformationMessage('刷新完成，未找到开放议题');
                            resolve([]);
                        } else {
                            vscode.window.showInformationMessage(`已刷新，找到 ${issues.length} 个议题`);
                            // 递归调用继续选择
                            selectIssuesWithRefresh(Promise.resolve(issues)).then(resolve);
                        }
                    }).catch(error => {
                        vscode.window.showErrorMessage(`刷新失败: ${error}`);
                        selectIssuesWithRefresh(Promise.resolve(issues)).then(resolve);
                    });
                } else {
                    logToOutput('用户取消议题选择');
                    resolve([]); // 用户取消，返回空数组
                }
            });
            
            quickPick.show();
        });
    }
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
    issues: Issue[]
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
    
    // 处理多个议题
    if (issues.length > 0) {
        const issueRefs = issues.map(issue => `#${issue.number}`);
        
        if (issues.length === 1) {
            message += `\n\nCloses ${issueRefs[0]}`;
        } else {
            // 多个议题的情况
            message += `\n\nCloses ${issueRefs.join(', ')}`;
        }
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