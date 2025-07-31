import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { Cache } from './cache';

// 输出频道
let outputChannel: vscode.OutputChannel;

// 缓存实例 - 增加缓存时间和大小限制
const issueCache = new Cache<Issue[]>(10, 50); // 10分钟缓存，最多50个项目
const repoInfoCache = new Cache<RepoInfo>(30, 10); // 30分钟缓存，最多10个项目
const tokenCache = new Cache<string>(60); // 60分钟Token缓存
let gitApi: any; // 缓存Git API实例

// HTTP连接池配置
const httpAgents = {
    http: new http.Agent({
        keepAlive: true,
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 10000
    }),
    https: new https.Agent({
        keepAlive: true,
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 10000
    })
};

// 配置
const config = {
    debug: false, // 调试模式开关
    maxIssues: 50, // 减少最大议题数量以提高性能
    requestTimeout: 8000, // 减少超时时间
};

// 定义接口
interface Issue {
    id: number;
    title: string;
    number: number;
    state: string;
    url: string;
}

interface RepoInfo {
    platform: string;
    owner: string;
    repo: string;
    baseUrl: string;
    hostUrl?: string;
}

// 优化的日志函数 - 减少字符串操作和内存分配
function logToOutput(message: string, data?: any): void {
    if (!config.debug && !message.includes('错误')) return; // 非调试模式只输出错误

    const timestamp = new Date().toISOString();
    
    if (data !== undefined) {
        // 延迟JSON序列化，只在需要时执行
        outputChannel.appendLine(`[${timestamp}] ${message}`);
        try {
            outputChannel.appendLine(JSON.stringify(data, null, 2));
        } catch (error) {
            outputChannel.appendLine(`[JSON序列化失败]: ${String(data)}`);
        }
    } else {
        outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
    
    // 减少console.log调用
    if (config.debug) {
        console.log(`[${timestamp}] ${message}`, data);
    }
}

// 优化的 HTTP 请求函数 - 使用连接池
function makeHttpRequest(url: string, options: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'Connection': 'keep-alive',
                ...options.headers
            },
            timeout: options.timeout || config.requestTimeout,
            agent: isHttps ? httpAgents.https : httpAgents.http
        };

        logToOutput(`发起HTTP请求`, {
            url: url.replace(/token=[^&]+/, 'token=***').replace(/Bearer [^,}]+/, 'Bearer ***'),
            method: requestOptions.method,
            hostname: requestOptions.hostname,
            keepAlive: true
        });

        const req = client.request(requestOptions, (res) => {
            const chunks: Buffer[] = [];
            let totalLength = 0;

            res.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                totalLength += chunk.length;
                
                // 防止响应过大
                if (totalLength > 10 * 1024 * 1024) { // 10MB限制
                    req.destroy();
                    reject(new Error('响应数据过大'));
                    return;
                }
            });

            res.on('end', () => {
                logToOutput(`HTTP响应`, {
                    statusCode: res.statusCode,
                    contentLength: totalLength,
                    headers: {
                        'content-type': res.headers['content-type'],
                        'x-ratelimit-remaining': res.headers['x-ratelimit-remaining']
                    }
                });

                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    const data = Buffer.concat(chunks, totalLength).toString('utf8');
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}\n${data.substring(0, 500)}`));
                    return;
                }

                try {
                    const data = Buffer.concat(chunks, totalLength).toString('utf8');
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (error) {
                    const data = Buffer.concat(chunks, totalLength).toString('utf8');
                    logToOutput(`JSON解析失败`, { dataLength: data.length });
                    reject(new Error(`JSON解析失败: ${error}`));
                }
            });
        });

        req.on('error', (error) => {
            logToOutput(`HTTP请求错误`, { error: error.message });
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });

        req.end();
    });
}

// 优化的HTTP请求函数 - 添加重试机制
async function makeHttpRequestWithRetry(url: string, options: any = {}, retries = 2): Promise<any> {
    for (let i = 0; i <= retries; i++) {
        try {
            return await makeHttpRequest(url, options);
        } catch (error) {
            if (i === retries) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 递增延迟
        }
    }
}

// 优化的获取访问令牌函数 - 添加缓存
async function getAccessToken(platform: string, hostUrl?: string): Promise<string | undefined> {
    const cacheKey = `token-${platform}-${hostUrl || 'default'}`;
    
    // 先检查缓存
    const cachedToken = tokenCache.get(cacheKey);
    if (cachedToken) {
        logToOutput(`使用缓存Token`, { platform, hasToken: true });
        return cachedToken;
    }

    const config = vscode.workspace.getConfiguration('commitHelper');

    logToOutput(`获取访问令牌`, { platform, hostUrl });

    let token: string | undefined;

    switch (platform) {
        case 'github':
            token = config.get<string>('githubToken') || process.env.GITHUB_TOKEN;
            break;

        case 'gitlab':
            token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
            break;

        case 'local-gitlab':
            // 对于本地GitLab实例，尝试多种配置方式
            token = config.get<string>('localGitlabToken') || process.env.LOCAL_GITLAB_TOKEN;

            // 如果没有专门的本地GitLab token，尝试使用通用的GitLab token
            if (!token) {
                token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
            }

            // 支持基于主机URL的特定配置
            if (!token && hostUrl) {
                try {
                    const hostname = new URL(hostUrl).hostname;
                    const configKeys = [
                        `gitlabToken.${hostname}`,
                        `localGitlabToken.${hostname}`,
                        `gitlab.${hostname}.token`,
                        `tokens.${hostname}`
                    ];

                    for (const key of configKeys) {
                        const fullConfig = vscode.workspace.getConfiguration();
                        token = fullConfig.get<string>(`commitHelper.${key}`);
                        if (token) break;
                    }
                } catch (error) {
                    logToOutput(`解析hostUrl失败: ${error}`);
                }
            }
            break;

        case 'gitee':
            token = config.get<string>('giteeToken') || process.env.GITEE_TOKEN;
            break;

        default:
            return undefined;
    }

    logToOutput(`${platform} Token: ${token ? '已配置' : '未配置'}`);

    // 缓存有效的token
    if (token) {
        tokenCache.set(cacheKey, token);
    }

    return token;
}

// 预编译正则表达式以提高性能
const GIT_URL_PATTERNS = {
    https: /^(https?:\/\/([^\/]+))\/([^\/]+)\/(.+?)(?:\.git)?$/,
    sshWithPort: /^ssh:\/\/git@([^:\/]+):(\d+)\/([^\/]+)\/(.+?)(?:\.git)?$/,
    sshStandard: /^git@([^:]+):([^\/]+)\/(.+?)(?:\.git)?$/,
    sshNoPort: /^ssh:\/\/git@([^\/]+)\/([^\/]+)\/(.+?)(?:\.git)?$/
};

// 优化的解析Git URL函数
function parseGitUrl(url: string): RepoInfo | null {
    logToOutput('解析Git URL', { url });

    // 1. 匹配HTTPS格式
    let match = url.match(GIT_URL_PATTERNS.https);
    if (match) {
        return parseHttpsMatch(match);
    }

    // 2. 匹配SSH格式（带端口）
    match = url.match(GIT_URL_PATTERNS.sshWithPort);
    if (match) {
        return parseSshWithPortMatch(match);
    }

    // 3. 匹配标准SSH格式
    match = url.match(GIT_URL_PATTERNS.sshStandard);
    if (match) {
        return parseSshStandardMatch(match);
    }

    // 4. 匹配其他SSH格式（无端口）
    match = url.match(GIT_URL_PATTERNS.sshNoPort);
    if (match) {
        return parseSshNoPortMatch(match);
    }

    logToOutput('Git URL解析失败');
    return null;
}

// 辅助函数：解析HTTPS匹配
function parseHttpsMatch(match: RegExpMatchArray): RepoInfo {
    const [, fullHostUrl, hostname, owner, repo] = match;
    logToOutput('HTTPS格式匹配成功', { fullHostUrl, hostname, owner, repo });

    return createRepoInfo(hostname, owner, repo, fullHostUrl);
}

// 辅助函数：解析SSH带端口匹配
function parseSshWithPortMatch(match: RegExpMatchArray): RepoInfo {
    const [, hostname, port, owner, repo] = match;
    logToOutput('SSH格式（带端口）匹配成功', { hostname, port, owner, repo });

    if (isKnownPlatform(hostname)) {
        return createRepoInfo(hostname, owner, repo, `https://${hostname}`);
    }

    // 本地GitLab处理
    const isInternalIP = isInternalAddress(hostname);
    const protocol = isInternalIP ? 'http' : 'https';
    const webPort = port === '2222' ? '' : `:${port}`;
    const hostUrl = `${protocol}://${hostname}${webPort}`;

    return {
        platform: 'local-gitlab',
        owner,
        repo,
        baseUrl: `${hostUrl}/api/v4`,
        hostUrl: hostUrl
    };
}

// 辅助函数：解析标准SSH匹配
function parseSshStandardMatch(match: RegExpMatchArray): RepoInfo {
    const [, hostname, owner, repo] = match;
    logToOutput('SSH格式（标准）匹配成功', { hostname, owner, repo });

    if (isKnownPlatform(hostname)) {
        return createRepoInfo(hostname, owner, repo, `https://${hostname}`);
    }

    // 本地GitLab处理
    const isInternalIP = isInternalAddress(hostname);
    const protocol = isInternalIP ? 'http' : 'https';
    const hostUrl = `${protocol}://${hostname}`;

    return {
        platform: 'local-gitlab',
        owner,
        repo,
        baseUrl: `${hostUrl}/api/v4`,
        hostUrl: hostUrl
    };
}

// 辅助函数：解析SSH无端口匹配
function parseSshNoPortMatch(match: RegExpMatchArray): RepoInfo {
    const [, hostname, owner, repo] = match;
    logToOutput('SSH格式（无端口）匹配成功', { hostname, owner, repo });

    if (isKnownPlatform(hostname)) {
        return createRepoInfo(hostname, owner, repo, `https://${hostname}`);
    }

    // 本地GitLab处理
    const isInternalIP = isInternalAddress(hostname);
    const protocol = isInternalIP ? 'http' : 'https';
    const hostUrl = `${protocol}://${hostname}`;

    return {
        platform: 'local-gitlab',
        owner,
        repo,
        baseUrl: `${hostUrl}/api/v4`,
        hostUrl: hostUrl
    };
}

// 辅助函数：检查是否为已知平台
function isKnownPlatform(hostname: string): boolean {
    return hostname.includes('github.com') || 
           hostname.includes('gitlab.com') || 
           hostname.includes('gitee.com');
}

// 辅助函数：检查是否为内网地址
function isInternalAddress(hostname: string): boolean {
    return !!(hostname.match(/^192\.168\./) || 
              hostname.match(/^10\./) || 
              hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || 
              hostname === 'localhost');
}

// 辅助函数：创建仓库信息
function createRepoInfo(hostname: string, owner: string, repo: string, hostUrl: string): RepoInfo {
    if (hostname.includes('github.com')) {
        return {
            platform: 'github',
            owner,
            repo,
            baseUrl: 'https://api.github.com',
            hostUrl
        };
    } else if (hostname.includes('gitlab.com')) {
        return {
            platform: 'gitlab',
            owner,
            repo,
            baseUrl: 'https://gitlab.com/api/v4',
            hostUrl
        };
    } else if (hostname.includes('gitee.com')) {
        return {
            platform: 'gitee',
            owner,
            repo,
            baseUrl: 'https://gitee.com/api/v5',
            hostUrl
        };
    } else {
        return {
            platform: 'local-gitlab',
            owner,
            repo,
            baseUrl: `${hostUrl}/api/v4`,
            hostUrl
        };
    }
}

// 优化的获取Git API函数
function getGitApi() {
    if (!gitApi) {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (gitExtension) {
            gitApi = gitExtension.getAPI(1);
        }
    }
    return gitApi;
}

// 优化的获取仓库信息函数
async function getRepoInfo(): Promise<RepoInfo | null> {
    // 先检查缓存
    const cacheKey = 'current-repo';
    const cached = repoInfoCache.get(cacheKey);
    if (cached) {
        logToOutput('使用缓存的仓库信息');
        return cached;
    }

    try {
        const git = getGitApi();
        if (!git || git.repositories.length === 0) {
            logToOutput('未找到Git仓库');
            return null;
        }

        const repository = git.repositories[0];
        const remotes = repository.state.remotes;

        if (remotes.length === 0) {
            logToOutput('未找到远程仓库');
            return null;
        }

        const remote = remotes.find((r: any) => r.name === 'origin') || remotes[0];
        const fetchUrl = remote.fetchUrl || remote.pushUrl;

        logToOutput('获取到远程URL', { remoteName: remote.name, fetchUrl });

        const repoInfo = parseGitUrl(fetchUrl);
        if (repoInfo) {
            repoInfoCache.set(cacheKey, repoInfo);
            logToOutput('仓库信息已缓存', repoInfo);
        }
        return repoInfo;
    } catch (error) {
        logToOutput('获取仓库信息失败', { error: String(error) });
        return null;
    }
}

// 预编译清理规则正则表达式
const TITLE_CLEAN_PATTERNS = [
    /^(?:\[[^\]]+\]|【[^】]+】|\([^)]+\)|[A-Z]+[-:])\s*-?\s*/,
    /^\s+|\s+$/g // trim 操作
];

// 优化的清理议题标题函数
function cleanIssueTitle(title: string): string {
    if (!title) return title;
    
    let cleanedTitle = title.replace(TITLE_CLEAN_PATTERNS[0], '').trim();
    return cleanedTitle || title;
}

// 优化的API请求构建逻辑 - 支持分页
function buildApiRequest(repoInfo: RepoInfo, accessToken: string, page: number = 1, perPage: number = 50): { apiUrl: string; headers: any } {
    let apiUrl: string;
    let headers: any = {};

    switch (repoInfo.platform) {
        case 'github':
            apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&page=${page}&per_page=${perPage}`;
            headers = {
                'Authorization': `token ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-CommitHelper'
            };
            break;

        case 'gitlab':
        case 'local-gitlab':
            const cleanRepo = repoInfo.repo.replace(/\.git$/, '');
            const projectPath = encodeURIComponent(`${repoInfo.owner}/${cleanRepo}`);
            apiUrl = `${repoInfo.baseUrl}/projects/${projectPath}/issues?state=opened&page=${page}&per_page=${perPage}`;
            headers = {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };
            break;

        case 'gitee':
            apiUrl = `https://gitee.com/api/v5/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&access_token=${accessToken}&page=${page}&per_page=${perPage}`;
            headers = {
                'Accept': 'application/json',
                'User-Agent': 'VSCode-CommitHelper'
            };
            break;

        default:
            throw new Error(`不支持的平台: ${repoInfo.platform}`);
    }

    return { apiUrl, headers };
}

// 优化的获取议题列表函数 - 添加分页和增量加载
async function fetchIssues(repoInfo: RepoInfo): Promise<Issue[]> {
    const cacheKey = `${repoInfo.platform}-${repoInfo.owner}-${repoInfo.repo}`;

    // 检查缓存
    const cached = issueCache.get(cacheKey);
    if (cached) {
        logToOutput('使用缓存的议题数据', { count: cached.length });
        return cached;
    }

    const accessToken = await getAccessToken(repoInfo.platform, repoInfo.hostUrl);

    if (!accessToken) {
        const errorMsg = `未找到 ${repoInfo.platform} 的访问令牌`;
        logToOutput(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        return [];
    }

    try {
        let allIssues: Issue[] = [];
        let page = 1;
        const perPage = Math.min(config.maxIssues, 50); // 单页最多50个

        while (allIssues.length < config.maxIssues) {
            const { apiUrl, headers } = buildApiRequest(repoInfo, accessToken, page, perPage);

            const issues = await makeHttpRequestWithRetry(apiUrl, {
                method: 'GET',
                headers: headers,
                timeout: config.requestTimeout
            });

            if (!Array.isArray(issues) || issues.length === 0) {
                break; // 没有更多数据了
            }

            // 批量转换议题格式
            const convertedIssues: Issue[] = issues.map((issue: any) => ({
                id: issue.id || issue.iid,
                title: issue.title,
                number: issue.number || issue.iid,
                state: issue.state,
                url: issue.html_url || issue.web_url
            }));

            allIssues.push(...convertedIssues);

            // 如果返回的数据少于请求的数量，说明已经是最后一页
            if (issues.length < perPage) {
                break;
            }

            page++;
        }

        // 限制最大数量
        if (allIssues.length > config.maxIssues) {
            allIssues = allIssues.slice(0, config.maxIssues);
        }

        // 缓存结果
        issueCache.set(cacheKey, allIssues);

        logToOutput(`议题获取成功`, {
            totalCount: allIssues.length,
            pages: page - 1,
            firstFew: allIssues.slice(0, 3).map(issue => ({
                number: issue.number,
                title: issue.title.substring(0, 30) + '...'
            }))
        });

        return allIssues;

    } catch (error: any) {
        const errorMsg = `获取议题失败: ${error.message}`;
        logToOutput(errorMsg, { error: error.toString() });
        vscode.window.showErrorMessage(errorMsg);
        return [];
    }
}

// 优化的主要格式化函数 - 改进并发处理和用户体验
async function formatCommitMessage(): Promise<void> {
    logToOutput('开始格式化提交消息');

    try {
        // 并行获取必要信息
        const [repoInfo, git] = await Promise.all([
            getRepoInfo(),
            Promise.resolve(getGitApi())
        ]);

        if (!repoInfo || !git) {
            vscode.window.showErrorMessage('无法获取仓库信息，请确保在Git仓库中打开项目');
            return;
        }

        logToOutput('仓库信息获取成功', repoInfo);

        const repository = git.repositories[0];
        const currentMessage = repository.inputBox.value || '';
        const hasExistingContent = currentMessage.trim().length > 0;

        logToOutput('当前提交消息状态', { 
            hasContent: hasExistingContent,
            length: currentMessage.length 
        });

        // 异步获取议题，不阻塞UI
        let allIssues: Issue[] = [];
        
        const issuesPromise = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在获取议题列表...",
            cancellable: true
        }, async (progress, token) => {
            try {
                const issues = await fetchIssues(repoInfo);
                if (token.isCancellationRequested) {
                    return [];
                }
                return issues;
            } catch (error) {
                logToOutput('获取议题时出错', { error: String(error) });
                return [];
            }
        });

        // 让用户选择议题或继续不绑定
        allIssues = await issuesPromise;
        
        if (!allIssues) {
            return; // 用户取消了
        }

        let selectedIssues: Issue[] = [];
        let commitTitle = '';

        // 处理议题选择逻辑
        const { selectedIssue, userCancelled } = await handleIssueSelection(allIssues, hasExistingContent, repoInfo);
        
        if (userCancelled) {
            return;
        }

        if (selectedIssue) {
            selectedIssues = [selectedIssue];
        }

        // 确定提交标题
        commitTitle = await determineCommitTitle(currentMessage, selectedIssues, hasExistingContent);
        
        if (!commitTitle) {
            return; // 用户取消了输入
        }

        // 获取提交类型和作用域
        const { commitType, scope, cancelled } = await getCommitTypeAndScope();
        
        if (cancelled) {
            return;
        }

        // 生成最终提交消息
        const finalMessage = generateCommitMessage(commitType, scope, commitTitle, selectedIssues);

        // 更新Git输入框
        repository.inputBox.value = finalMessage;

        logToOutput('提交消息生成完成', {
            hasIssue: selectedIssues.length > 0,
            issueNumber: selectedIssues.length > 0 ? selectedIssues[0].number : null,
            messageLength: finalMessage.length
        });

        vscode.window.showInformationMessage(
            selectedIssues.length > 0
                ? `提交消息已生成并绑定议题 #${selectedIssues[0].number}！`
                : '提交消息已生成！'
        );

    } catch (error: any) {
        const errorMsg = `格式化提交消息失败: ${error.message}`;
        logToOutput(errorMsg, { error: error.toString() });
        vscode.window.showErrorMessage(errorMsg);
    }
}

// 定义选择项类型
interface IssuePickItem {
    label: string;
    description: string;
    detail?: string;
    action: 'refresh' | 'manual' | 'none' | 'info' | 'select';
    issue: Issue | null;
}

// 辅助函数：处理议题选择
async function handleIssueSelection(allIssues: Issue[], hasExistingContent: boolean, repoInfo?: RepoInfo): Promise<{ selectedIssue: Issue | null, userCancelled: boolean }> {
    let currentIssues = allIssues;

    while (true) {
        const issuePickItems = createIssuePickItems(currentIssues);

        const selectedItem = await vscode.window.showQuickPick(issuePickItems, {
            placeHolder: hasExistingContent
                ? '选择要绑定的议题（当前已有提交内容，将保留现有内容）'
                : '选择要绑定的议题或不绑定议题',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selectedItem === undefined) {
            return { selectedIssue: null, userCancelled: true };
        }

        // 处理特殊操作
        if (selectedItem.action === 'refresh') {
            if (!repoInfo) {
                vscode.window.showErrorMessage('无法刷新议题：仓库信息不可用');
                continue;
            }

            // 刷新议题
            const refreshedIssues = await refreshIssues(repoInfo);
            if (refreshedIssues) {
                currentIssues = refreshedIssues;
                vscode.window.showInformationMessage(`议题列表已刷新，共找到 ${currentIssues.length} 个议题`);
            }
            continue;
        }

        if (selectedItem.action === 'manual') {
            // 手动绑定议题
            const manualIssue = await handleManualIssueBinding();
            if (manualIssue) {
                return { selectedIssue: manualIssue, userCancelled: false };
            }
            continue;
        }

        if (selectedItem.action === 'info') {
            // 信息项，继续显示菜单
            continue;
        }

        // 处理正常的议题选择
        if (selectedItem.issue) {
            logToOutput('用户选择绑定议题', {
                issueNumber: selectedItem.issue.number,
                cleanedTitle: selectedItem.issue.title
            });
        } else {
            logToOutput('用户选择不绑定议题');
        }

        return { selectedIssue: selectedItem.issue, userCancelled: false };
    }
}

// 辅助函数：创建议题选择项
function createIssuePickItems(issues: Issue[]): IssuePickItem[] {
    const pickItems: IssuePickItem[] = [
        {
            label: '$(refresh) 刷新议题列表',
            description: '重新获取最新的议题列表',
            action: 'refresh',
            issue: null
        },
        {
            label: '$(edit) 手动绑定议题',
            description: '手动输入议题编号进行绑定',
            action: 'manual',
            issue: null
        },
        {
            label: '$(x) 不绑定议题',
            description: '本次提交不关联任何议题',
            action: 'none',
            issue: null
        }
    ];

    if (issues.length === 0) {
        pickItems.splice(0, 1); // 如果没有议题，移除刷新按钮
        pickItems.unshift({
            label: '$(info) 未找到议题',
            description: '当前仓库没有打开的议题',
            action: 'info',
            issue: null
        });
    } else {
        // 添加议题列表
        const issueItems: IssuePickItem[] = issues.map(issue => {
            const cleanedTitle = cleanIssueTitle(issue.title);
            return {
                label: `$(issue-opened) #${issue.number}`,
                description: cleanedTitle,
                detail: issue.title !== cleanedTitle ? `原标题: ${issue.title}` : undefined,
                action: 'select',
                issue: { ...issue, title: cleanedTitle }
            };
        });

        pickItems.push(...issueItems);
    }

    return pickItems;
}

// 辅助函数：刷新议题
async function refreshIssues(repoInfo: RepoInfo): Promise<Issue[] | null> {
    try {
        // 清除缓存以强制重新获取
        const cacheKey = `${repoInfo.platform}-${repoInfo.owner}-${repoInfo.repo}`;
        issueCache.delete(cacheKey);

        logToOutput('开始刷新议题列表', { platform: repoInfo.platform, repo: `${repoInfo.owner}/${repoInfo.repo}` });

        // 使用进度指示器获取议题
        const issues = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在刷新议题列表...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: "连接到远程仓库..." });
            
            const fetchedIssues = await fetchIssues(repoInfo);
            
            progress.report({ increment: 100, message: "议题获取完成" });
            return fetchedIssues;
        });

        logToOutput('议题刷新完成', { count: issues.length });
        return issues;

    } catch (error: any) {
        const errorMsg = `刷新议题失败: ${error.message}`;
        logToOutput(errorMsg, { error: error.toString() });
        vscode.window.showErrorMessage(errorMsg);
        return null;
    }
}

// 辅助函数：处理手动议题绑定
async function handleManualIssueBinding(): Promise<Issue | null> {
    const issueInput = await vscode.window.showInputBox({
        prompt: '输入议题编号',
        placeHolder: '例如：123 或 #123',
        validateInput: (value) => {
            if (!value) return undefined;
            const cleaned = value.replace('#', '');
            const number = parseInt(cleaned, 10);
            if (isNaN(number) || number <= 0) {
                return '请输入有效的议题编号';
            }
            return undefined;
        }
    });

    if (!issueInput) {
        logToOutput('用户取消了手动议题绑定');
        return null;
    }

    const issueNumber = parseInt(issueInput.replace('#', ''), 10);
    
    // 创建一个虚拟的议题对象
    const manualIssue: Issue = {
        id: issueNumber,
        number: issueNumber,
        title: `手动绑定的议题 #${issueNumber}`,
        state: 'open',
        url: ''
    };

    logToOutput('用户手动绑定议题', { issueNumber });
    vscode.window.showInformationMessage(`已手动绑定议题 #${issueNumber}`);

    return manualIssue;
}

// 辅助函数：确定提交标题
async function determineCommitTitle(currentMessage: string, selectedIssues: Issue[], hasExistingContent: boolean): Promise<string> {
    if (hasExistingContent) {
        // 提取现有标题
        let commitTitle = currentMessage.replace(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+?\))?\s*:\s*/, '').trim();
        if (!commitTitle) {
            commitTitle = currentMessage.trim();
        }
        logToOutput('使用现有提交消息内容', { extractedTitle: commitTitle });
        return commitTitle;
    } else if (selectedIssues.length > 0) {
        // 使用议题标题
        logToOutput('使用议题标题', { title: selectedIssues[0].title });
        return selectedIssues[0].title;
    } else {
        // 需要用户输入
        const inputTitle = await vscode.window.showInputBox({
            prompt: '输入提交描述',
            placeHolder: '简要描述本次提交的内容'
        });

        if (!inputTitle || !inputTitle.trim()) {
            logToOutput('用户未输入提交描述');
            return '';
        }

        const commitTitle = inputTitle.trim();
        logToOutput('用户手动输入的标题', { title: commitTitle });
        return commitTitle;
    }
}

// 辅助函数：获取提交类型和作用域
async function getCommitTypeAndScope(): Promise<{ commitType: string, scope: string, cancelled: boolean }> {
    // 预定义提交类型
    const commitTypes = [
        { label: 'feat', description: '新功能' },
        { label: 'fix', description: '修复bug' },
        { label: 'docs', description: '文档更新' },
        { label: 'style', description: '代码格式（不影响功能）' },
        { label: 'refactor', description: '重构（既不是新功能也不是修复bug）' },
        { label: 'test', description: '添加或修改测试' },
        { label: 'chore', description: '构建过程或辅助工具的变动' },
        { label: 'perf', description: '性能优化' },
        { label: 'ci', description: '持续集成相关' },
        { label: 'build', description: '构建相关' },
        { label: 'revert', description: '回滚提交' }
    ];

    const selectedType = await vscode.window.showQuickPick(commitTypes, {
        placeHolder: '选择提交类型'
    });

    if (!selectedType) {
        logToOutput('用户未选择提交类型');
        return { commitType: '', scope: '', cancelled: true };
    }

    logToOutput('用户选择的提交类型', { type: selectedType.label });

    // 输入作用域（可选）
    const scope = await vscode.window.showInputBox({
        prompt: '输入作用域（可选）',
        placeHolder: '例如：api, ui, auth'
    });

    logToOutput('用户输入的作用域', { scope: scope || '无' });

    return { commitType: selectedType.label, scope: scope || '', cancelled: false };
}

// 辅助函数：生成提交消息
function generateCommitMessage(commitType: string, scope: string, commitTitle: string, selectedIssues: Issue[]): string {
    let commitMessage = commitType;
    if (scope && scope.trim()) {
        commitMessage += `(${scope.trim()})`;
    }
    commitMessage += `: ${commitTitle}`;

    // 添加议题引用（如果选择了议题）
    if (selectedIssues.length > 0) {
        commitMessage += `\n\nCloses #${selectedIssues[0].number}`;
    }

    return commitMessage;
}

// 测试配置
async function testConfig(): Promise<void> {
    logToOutput('=== 开始测试配置 ===');

    try {
        const repoInfo = await getRepoInfo();
        if (!repoInfo) {
            vscode.window.showErrorMessage('无法获取仓库信息');
            return;
        }

        logToOutput('仓库信息', repoInfo);

        const accessToken = await getAccessToken(repoInfo.platform, repoInfo.hostUrl);
        if (!accessToken) {
            vscode.window.showErrorMessage(`未找到 ${repoInfo.platform} 的访问令牌`);
            return;
        }

        logToOutput(`Token获取成功`, {
            platform: repoInfo.platform,
            tokenPrefix: accessToken.substring(0, 8) + '...'
        });

        // 测试API连接
        const issues = await fetchIssues(repoInfo);

        vscode.window.showInformationMessage(
            `配置测试完成！找到 ${issues.length} 个议题。详情请查看输出面板。`
        );

    } catch (error: any) {
        const errorMsg = `配置测试失败: ${error.message}`;
        logToOutput(errorMsg, { error: error.toString() });
        vscode.window.showErrorMessage(errorMsg);
    }
}

// 调试配置
async function debugConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration('commitHelper');
    const fullConfig = vscode.workspace.getConfiguration();

    logToOutput('=== 配置调试信息 ===');
    logToOutput('CommitHelper配置:', {
        localGitlabToken: config.get<string>('localGitlabToken') ? '已配置' : '未配置',
        gitlabToken: config.get<string>('gitlabToken') ? '已配置' : '未配置',
        githubToken: config.get<string>('githubToken') ? '已配置' : '未配置',
        giteeToken: config.get<string>('giteeToken') ? '已配置' : '未配置'
    });

    // 检查特定配置
    const yourSpecificConfig = fullConfig.get<string>('commitHelper.gitlabToken.192.168.110.213');
    logToOutput('IP特定配置:', {
        'commitHelper.gitlabToken.192.168.110.213': yourSpecificConfig ? '已配置' : '未配置',
        value: yourSpecificConfig ? yourSpecificConfig.substring(0, 8) + '...' : 'none'
    });

    // 获取仓库信息
    const repoInfo = await getRepoInfo();
    if (repoInfo) {
        logToOutput('仓库信息:', repoInfo);
        const token = await getAccessToken(repoInfo.platform, repoInfo.hostUrl);
        logToOutput('最终获取的Token:', token ? token.substring(0, 8) + '...' : 'none');
    }

    vscode.window.showInformationMessage('配置调试信息已输出到CommitHelper频道');
}

// 调试仓库信息
async function debugRepo(): Promise<void> {
    try {
        logToOutput('=== Git仓库调试信息 ===');

        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
            logToOutput('Git扩展未找到');
            return;
        }

        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
            logToOutput('未找到Git仓库');
            return;
        }

        const repository = git.repositories[0];
        const remotes = repository.state.remotes;

        logToOutput('所有远程仓库:', remotes.map((r: any) => ({
            name: r.name,
            fetchUrl: r.fetchUrl,
            pushUrl: r.pushUrl
        })));

        const remote = remotes.find((r: any) => r.name === 'origin') || remotes[0];
        const fetchUrl = remote.fetchUrl || remote.pushUrl;

        logToOutput('使用的远程URL:', fetchUrl);

        const repoInfo = parseGitUrl(fetchUrl);
        logToOutput('解析结果:', repoInfo);

        if (repoInfo) {
            const token = await getAccessToken(repoInfo.platform, repoInfo.hostUrl);
            logToOutput('Token获取结果:', {
                platform: repoInfo.platform,
                hasToken: !!token,
                tokenPrefix: token ? token.substring(0, 8) + '...' : 'none'
            });
        }

        vscode.window.showInformationMessage('调试信息已输出到CommitHelper频道');

    } catch (error) {
        logToOutput('调试失败:', error);
    }
}

// 清除缓存命令
async function clearCache(): Promise<void> {
    issueCache.clear();
    repoInfoCache.clear();
    tokenCache.clear();
    logToOutput('所有缓存已清除');
    vscode.window.showInformationMessage('所有缓存已清除');
}

// 切换调试模式命令
async function toggleDebug(): Promise<void> {
    config.debug = !config.debug;
    logToOutput(`调试模式: ${config.debug ? '开启' : '关闭'}`);
    vscode.window.showInformationMessage(`调试模式: ${config.debug ? '开启' : '关闭'}`);
}

// 扩展激活函数
export function activate(context: vscode.ExtensionContext) {
    // 创建输出频道
    outputChannel = vscode.window.createOutputChannel('CommitHelper');
    logToOutput('CommitHelper 插件已激活');

    // 注册命令
    const formatDisposable = vscode.commands.registerCommand('CommitHelper.formatMessage', formatCommitMessage);
    const testDisposable = vscode.commands.registerCommand('CommitHelper.testConfig', testConfig);
    const debugConfigDisposable = vscode.commands.registerCommand('CommitHelper.debugConfig', debugConfig);
    const debugRepoDisposable = vscode.commands.registerCommand('CommitHelper.debugRepo', debugRepo);
    const clearCacheDisposable = vscode.commands.registerCommand('CommitHelper.clearCache', clearCache);
    const toggleDebugDisposable = vscode.commands.registerCommand('CommitHelper.toggleDebug', toggleDebug);

    context.subscriptions.push(
        formatDisposable,
        testDisposable,
        debugConfigDisposable,
        debugRepoDisposable,
        clearCacheDisposable,
        toggleDebugDisposable,
        outputChannel
    );

    // 清理资源的处理
    context.subscriptions.push({
        dispose: () => {
            // 清理HTTP代理
            if (httpAgents.http) {
                httpAgents.http.destroy();
            }
            if (httpAgents.https) {
                httpAgents.https.destroy();
            }
            
            // 清理缓存
            issueCache.dispose();
            repoInfoCache.dispose();
            tokenCache.dispose();
        }
    });
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
    
    // 清理HTTP代理
    if (httpAgents.http) {
        httpAgents.http.destroy();
    }
    if (httpAgents.https) {
        httpAgents.https.destroy();
    }
    
    // 清理缓存
    issueCache.dispose();
    repoInfoCache.dispose();
    tokenCache.dispose();
}