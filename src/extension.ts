import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// 输出频道
let outputChannel: vscode.OutputChannel;

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

// 创建 HTTP 请求函数
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
            headers: options.headers || {},
            timeout: options.timeout || 10000
        };

        logToOutput(`发起HTTP请求`, {
            url: url.replace(/token=[^&]+/, 'token=***').replace(/Bearer [^,}]+/, 'Bearer ***'),
            method: requestOptions.method,
            hostname: requestOptions.hostname,
            port: requestOptions.port
        });

        const req = client.request(requestOptions, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                logToOutput(`HTTP响应`, {
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                    headers: res.headers
                });

                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}\n${data}`));
                    return;
                }
                
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (error) {
                    logToOutput(`JSON解析失败`, { data: data.substring(0, 200) });
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

// 输出日志函数
function logToOutput(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] ${message}`;
    
    if (data !== undefined) {
        logMessage += `\n${JSON.stringify(data, null, 2)}`;
    }
    
    outputChannel.appendLine(logMessage);
    console.log(logMessage);
}

// 获取访问令牌
async function getAccessToken(platform: string, hostUrl?: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('commitHelper');
    
    logToOutput(`获取访问令牌`, { platform, hostUrl });
    
    switch (platform) {
        case 'github':
            const githubToken = config.get<string>('githubToken') || process.env.GITHUB_TOKEN;
            logToOutput(`GitHub Token: ${githubToken ? '已配置' : '未配置'}`);
            return githubToken;
            
        case 'gitlab':
            const gitlabToken = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
            logToOutput(`GitLab Token: ${gitlabToken ? '已配置' : '未配置'}`);
            return gitlabToken;
            
        case 'local-gitlab':
            // 对于本地GitLab实例，尝试多种配置方式
            let token = config.get<string>('localGitlabToken') || process.env.LOCAL_GITLAB_TOKEN;
            
            // 如果没有专门的本地GitLab token，尝试使用通用的GitLab token
            if (!token) {
                token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
            }
            
            // 支持基于主机URL的特定配置
            if (!token && hostUrl) {
                try {
                    const hostname = new URL(hostUrl).hostname;
                    
                    // 尝试多种配置键格式
                    const configKeys = [
                        `gitlabToken.${hostname}`,
                        `localGitlabToken.${hostname}`,
                        `gitlab.${hostname}.token`,
                        `tokens.${hostname}`
                    ];
                    
                    logToOutput(`尝试查找主机特定配置`, { hostname, configKeys });
                    
                    for (const key of configKeys) {
                        const fullConfig = vscode.workspace.getConfiguration();
                        const fullKey = `commitHelper.${key}`;
                        token = fullConfig.get<string>(fullKey);
                        
                        logToOutput(`检查配置键: ${fullKey}`, { found: !!token });
                        
                        if (token) {
                            logToOutput(`使用配置键获取到Token: ${fullKey}`);
                            break;
                        }
                    }
                } catch (error) {
                    logToOutput(`解析hostUrl失败: ${error}`);
                }
            }
            
            logToOutput(`本地GitLab Token: ${token ? '已配置' : '未配置'}`, {
                hasLocalToken: !!(config.get<string>('localGitlabToken') || process.env.LOCAL_GITLAB_TOKEN),
                hasGitlabToken: !!(config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN),
                hostUrl: hostUrl,
                tokenPrefix: token ? token.substring(0, 8) + '...' : 'none'
            });
            
            return token;
            
        case 'gitee':
            const giteeToken = config.get<string>('giteeToken') || process.env.GITEE_TOKEN;
            logToOutput(`Gitee Token: ${giteeToken ? '已配置' : '未配置'}`);
            return giteeToken;
            
        default:
            return undefined;
    }
}

// 解析Git URL（修复版本）
function parseGitUrl(url: string): RepoInfo | null {
    logToOutput('解析Git URL', { url });

    // 1. 匹配HTTPS格式：https://host/owner/repo.git
    let match = url.match(/^(https?:\/\/([^\/]+))\/([^\/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
        const fullHostUrl = match[1];
        const hostname = match[2];
        const owner = match[3];
        const repo = match[4];

        logToOutput('HTTPS格式匹配成功', { fullHostUrl, hostname, owner, repo });

        // 判断平台类型
        if (hostname.includes('github.com')) {
            return {
                platform: 'github',
                owner,
                repo,
                baseUrl: 'https://api.github.com',
                hostUrl: fullHostUrl
            };
        } else if (hostname.includes('gitlab.com')) {
            return {
                platform: 'gitlab',
                owner,
                repo,
                baseUrl: 'https://gitlab.com/api/v4',
                hostUrl: fullHostUrl
            };
        } else if (hostname.includes('gitee.com')) {
            return {
                platform: 'gitee',
                owner,
                repo,
                baseUrl: 'https://gitee.com/api/v5',
                hostUrl: fullHostUrl
            };
        } else {
            // 假设其他都是本地GitLab
            return {
                platform: 'local-gitlab',
                owner,
                repo,
                baseUrl: `${fullHostUrl}/api/v4`,
                hostUrl: fullHostUrl
            };
        }
    }

    // 2. 匹配SSH格式（带端口）：ssh://git@host:port/owner/repo.git
    match = url.match(/^ssh:\/\/git@([^:\/]+):(\d+)\/([^\/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
        const hostname = match[1];
        const port = match[2];
        const owner = match[3];
        const repo = match[4];

        logToOutput('SSH格式（带端口）匹配成功', { hostname, port, owner, repo });

        if (hostname.includes('github.com')) {
            return {
                platform: 'github',
                owner,
                repo,
                baseUrl: 'https://api.github.com',
                hostUrl: `https://${hostname}`
            };
        } else if (hostname.includes('gitlab.com')) {
            return {
                platform: 'gitlab',
                owner,
                repo,
                baseUrl: 'https://gitlab.com/api/v4',
                hostUrl: `https://${hostname}`
            };
        } else if (hostname.includes('gitee.com')) {
            return {
                platform: 'gitee',
                owner,
                repo,
                baseUrl: 'https://gitee.com/api/v5',
                hostUrl: `https://${hostname}`
            };
        } else {
            // 本地GitLab，判断使用HTTP还是HTTPS
            // 对于内网IP，通常使用HTTP；如果是2222端口，可能是HTTP
            const isInternalIP = hostname.match(/^192\.168\./) || hostname.match(/^10\./) || hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || hostname === 'localhost';
            const protocol = isInternalIP ? 'http' : 'https';
            
            // 如果是2222端口，很可能Web界面在80/443端口
            const webPort = port === '2222' ? '' : `:${port}`;
            const hostUrl = `${protocol}://${hostname}${webPort}`;
            
            logToOutput('本地GitLab配置', { protocol, webPort, hostUrl });
            
            return {
                platform: 'local-gitlab',
                owner,
                repo,
                baseUrl: `${hostUrl}/api/v4`,
                hostUrl: hostUrl
            };
        }
    }

    // 3. 匹配标准SSH格式：git@host:owner/repo.git
    match = url.match(/^git@([^:]+):([^\/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
        const hostname = match[1];
        const owner = match[2];
        const repo = match[3];

        logToOutput('SSH格式（标准）匹配成功', { hostname, owner, repo });

        if (hostname.includes('github.com')) {
            return {
                platform: 'github',
                owner,
                repo,
                baseUrl: 'https://api.github.com',
                hostUrl: `https://${hostname}`
            };
        } else if (hostname.includes('gitlab.com')) {
            return {
                platform: 'gitlab',
                owner,
                repo,
                baseUrl: 'https://gitlab.com/api/v4',
                hostUrl: `https://${hostname}`
            };
        } else if (hostname.includes('gitee.com')) {
            return {
                platform: 'gitee',
                owner,
                repo,
                baseUrl: 'https://gitee.com/api/v5',
                hostUrl: `https://${hostname}`
            };
        } else {
            // 本地GitLab
            const isInternalIP = hostname.match(/^192\.168\./) || hostname.match(/^10\./) || hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || hostname === 'localhost';
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
    }

    // 4. 匹配其他SSH格式：ssh://git@host/owner/repo.git（无端口）
    match = url.match(/^ssh:\/\/git@([^\/]+)\/([^\/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
        const hostname = match[1];
        const owner = match[2];
        const repo = match[3];

        logToOutput('SSH格式（无端口）匹配成功', { hostname, owner, repo });

        if (hostname.includes('github.com')) {
            return {
                platform: 'github',
                owner,
                repo,
                baseUrl: 'https://api.github.com',
                hostUrl: `https://${hostname}`
            };
        } else if (hostname.includes('gitlab.com')) {
            return {
                platform: 'gitlab',
                owner,
                repo,
                baseUrl: 'https://gitlab.com/api/v4',
                hostUrl: `https://${hostname}`
            };
        } else if (hostname.includes('gitee.com')) {
            return {
                platform: 'gitee',
                owner,
                repo,
                baseUrl: 'https://gitee.com/api/v5',
                hostUrl: `https://${hostname}`
            };
        } else {
            // 本地GitLab
            const isInternalIP = hostname.match(/^192\.168\./) || hostname.match(/^10\./) || hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || hostname === 'localhost';
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
    }

    logToOutput('Git URL解析失败 - 尝试所有模式', { 
        url,
        patterns: [
            'https://host/owner/repo.git',
            'ssh://git@host:port/owner/repo.git',
            'git@host:owner/repo.git',
            'ssh://git@host/owner/repo.git'
        ]
    });
    
    return null;
}

// 获取仓库信息
async function getRepoInfo(): Promise<RepoInfo | null> {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
            logToOutput('Git扩展未找到');
            return null;
        }

        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
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

        return parseGitUrl(fetchUrl);
    } catch (error) {
        logToOutput('获取仓库信息失败', { error: String(error) });
        return null;
    }
}

// 获取议题列表（修复函数签名）
async function fetchIssues(repoInfo: RepoInfo): Promise<Issue[]> {
    const accessToken = await getAccessToken(repoInfo.platform, repoInfo.hostUrl);
    
    logToOutput(`开始获取议题`, {
        platform: repoInfo.platform,
        baseUrl: repoInfo.baseUrl,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        hasToken: !!accessToken,
        tokenPrefix: accessToken ? accessToken.substring(0, 8) + '...' : 'none'
    });

    if (!accessToken) {
        const errorMsg = `未找到 ${repoInfo.platform} 的访问令牌`;
        logToOutput(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        return [];
    }

    try {
        let apiUrl: string;
        let headers: any = {};

        switch (repoInfo.platform) {
            case 'github':
                apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&per_page=50`;
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
                apiUrl = `${repoInfo.baseUrl}/projects/${projectPath}/issues?state=opened&per_page=50`;
                headers = {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                };
                
                logToOutput(`GitLab API调用详情`, {
                    cleanRepo,
                    projectPath,
                    apiUrl: apiUrl.replace(accessToken, '***'),
                    headers: { ...headers, Authorization: 'Bearer ***' }
                });
                break;

            case 'gitee':
                apiUrl = `https://gitee.com/api/v5/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&access_token=${accessToken}&per_page=50`;
                headers = {
                    'Accept': 'application/json',
                    'User-Agent': 'VSCode-CommitHelper'
                };
                break;

            default:
                throw new Error(`不支持的平台: ${repoInfo.platform}`);
        }

        const issues = await makeHttpRequest(apiUrl, {
            method: 'GET',
            headers: headers,
            timeout: 10000
        });

        logToOutput(`API响应数据`, {
            type: Array.isArray(issues) ? 'array' : typeof issues,
            length: Array.isArray(issues) ? issues.length : 'N/A',
            firstIssue: Array.isArray(issues) && issues.length > 0 ? {
                id: issues[0].id || issues[0].iid,
                title: issues[0].title?.substring(0, 50) + '...',
                state: issues[0].state
            } : 'none'
        });

        if (!Array.isArray(issues)) {
            logToOutput(`API返回数据格式错误`, { actualType: typeof issues, data: issues });
            throw new Error(`API返回的不是数组格式: ${typeof issues}`);
        }

        const convertedIssues: Issue[] = issues.map((issue: any) => ({
            id: issue.id || issue.iid,
            title: issue.title,
            number: issue.number || issue.iid,
            state: issue.state,
            url: issue.html_url || issue.web_url
        }));

        logToOutput(`议题获取成功`, {
            totalCount: convertedIssues.length,
            issues: convertedIssues.slice(0, 3).map(issue => ({
                number: issue.number,
                title: issue.title.substring(0, 30) + '...'
            }))
        });

        return convertedIssues;

    } catch (error: any) {
        const errorMsg = `获取议题失败: ${error.message}`;
        logToOutput(errorMsg, { 
            error: error.toString(),
            stack: error.stack?.substring(0, 500)
        });
        vscode.window.showErrorMessage(errorMsg);
        return [];
    }
}

// 清理议题标题，移除前缀
function cleanIssueTitle(title: string): string {
    // 移除常见的前缀模式：[TYPE]、【TYPE】、(TYPE)、TYPE:、TYPE-
    const cleanedTitle = title
        .replace(/^\[([^\]]+)\]\s*-?\s*/, '') // 移除 [TEST]、[FEATURE] 等
        .replace(/^【([^】]+)】\s*-?\s*/, '') // 移除 【测试】、【功能】 等
        .replace(/^\(([^)]+)\)\s*-?\s*/, '') // 移除 (TEST)、(FEATURE) 等
        .replace(/^([A-Z]+):\s*/, '') // 移除 TEST:、FEATURE: 等
        .replace(/^([A-Z]+)-\s*/, '') // 移除 TEST-、FEATURE- 等
        .trim();
    
    return cleanedTitle || title; // 如果清理后为空，返回原标题
}

// 主要的格式化函数（修复版本）
async function formatCommitMessage(): Promise<void> {
    logToOutput('开始格式化提交消息');

    try {
        const repoInfo = await getRepoInfo();
        if (!repoInfo) {
            vscode.window.showErrorMessage('无法获取仓库信息，请确保在Git仓库中打开项目');
            return;
        }

        logToOutput('仓库信息获取成功', repoInfo);

        // 获取当前提交消息
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        const git = gitExtension.getAPI(1);
        const repository = git.repositories[0];
        const currentMessage = repository.inputBox.value || '';

        logToOutput('当前提交消息', { currentMessage });

        // 检查是否已有内容
        const hasExistingContent = currentMessage.trim().length > 0;
        let commitTitle = '';

        // 无论是否有现有内容，都获取议题列表
        logToOutput('获取议题列表以供绑定选择');
        const allIssues = await fetchIssues(repoInfo);
        logToOutput('获取到的所有议题', { 
            count: allIssues.length, 
            issues: allIssues.map(i => ({ 
                number: i.number, 
                originalTitle: i.title,
                cleanedTitle: cleanIssueTitle(i.title).substring(0, 50) + '...'
            })) 
        });

        // 让用户选择要绑定的议题（无论是否有现有内容）
        let selectedIssues: Issue[] = [];
        
        if (allIssues.length > 0) {
            // 创建议题选择列表
            const issuePickItems = [
                {
                    label: '$(x) 不绑定议题',
                    description: '本次提交不关联任何议题',
                    issue: null
                },
                ...allIssues.map(issue => {
                    const cleanedTitle = cleanIssueTitle(issue.title);
                    return {
                        label: `$(issue-opened) #${issue.number}`,
                        description: cleanedTitle,
                        detail: `原标题: ${issue.title}`,
                        issue: { ...issue, title: cleanedTitle } // 保存清理后的标题
                    };
                })
            ];

            const selectedItem = await vscode.window.showQuickPick(issuePickItems, {
                placeHolder: hasExistingContent 
                    ? '选择要绑定的议题（当前已有提交内容，将保留现有内容）'
                    : '选择要绑定的议题或不绑定议题',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selectedItem === undefined) {
                logToOutput('用户取消了议题选择');
                return;
            }

            if (selectedItem.issue) {
                selectedIssues = [selectedItem.issue];
                logToOutput('用户选择绑定议题', { 
                    issueNumber: selectedItem.issue.number,
                    originalTitle: allIssues.find(i => i.number === selectedItem.issue!.number)?.title,
                    cleanedTitle: selectedItem.issue.title
                });
            } else {
                logToOutput('用户选择不绑定议题');
            }
        } else {
            logToOutput('没有找到可用的议题');
        }

        // 确定提交标题的逻辑
        if (hasExistingContent) {
            // 如果已有内容，提取并使用现有标题
            commitTitle = currentMessage.replace(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+?\))?\s*:\s*/, '').trim();

            if (!commitTitle) {
                commitTitle = currentMessage.trim();
            }
            
            logToOutput('使用现有提交消息内容', { extractedTitle: commitTitle });
        } else {
            // 如果没有现有内容
            if (selectedIssues.length > 0) {
                // 使用选择的议题标题（已清理）
                commitTitle = selectedIssues[0].title;
                logToOutput('使用议题标题', { title: commitTitle });
            } else {
                // 没有选择议题，需要用户输入
                const inputTitle = await vscode.window.showInputBox({
                    prompt: '输入提交描述',
                    placeHolder: '简要描述本次提交的内容'
                });
                
                if (!inputTitle || !inputTitle.trim()) {
                    logToOutput('用户未输入提交描述');
                    return;
                }
                
                commitTitle = inputTitle.trim();
                logToOutput('用户手动输入的标题', { title: commitTitle });
            }
        }

        // 选择提交类型
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
            return;
        }

        logToOutput('用户选择的提交类型', { type: selectedType.label });

        // 输入作用域（可选）
        const scope = await vscode.window.showInputBox({
            prompt: '输入作用域（可选）',
            placeHolder: '例如：api, ui, auth'
        });

        logToOutput('用户输入的作用域', { scope: scope || '无' });

        // 生成提交消息
        let commitMessage = selectedType.label;
        if (scope && scope.trim()) {
            commitMessage += `(${scope.trim()})`;
        }
        commitMessage += `: ${commitTitle}`;

        // 添加议题引用（如果选择了议题）
        if (selectedIssues.length > 0) {
            commitMessage += `\n\nCloses #${selectedIssues[0].number}`;
        }

        // 更新Git输入框
        repository.inputBox.value = commitMessage;

        logToOutput('提交消息生成完成', { 
            commitMessage,
            hadExistingContent: hasExistingContent,
            usedExistingTitle: hasExistingContent,
            boundIssue: selectedIssues.length > 0 ? selectedIssues[0].number : null
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

    context.subscriptions.push(formatDisposable, testDisposable, debugConfigDisposable, debugRepoDisposable, outputChannel);
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
}