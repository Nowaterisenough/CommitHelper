import * as vscode from 'vscode';
import { IPlatform } from './platform';
import { Issue, RepoInfo } from '../core/types';
import { HttpClient } from '../http/client';
import { Logger } from '../core/logger';
import { Cache } from '../core/cache';

/**
 * GitLab 平台实现
 * 支持 gitlab.com 和本地 GitLab 实例
 */
export class GitLabPlatform implements IPlatform {
    readonly name: string;
    private readonly httpClient: HttpClient;
    private readonly logger: Logger;
    private readonly tokenCache: Cache<string>;

    constructor(httpClient: HttpClient, logger: Logger, isLocal: boolean = false) {
        this.name = isLocal ? 'local-gitlab' : 'gitlab';
        this.httpClient = httpClient;
        this.logger = logger;
        this.tokenCache = new Cache<string>(60);
    }

    async getAccessToken(repoInfo: RepoInfo): Promise<string | undefined> {
        const cacheKey = `token-${this.name}-${repoInfo.hostUrl || 'default'}`;
        const cached = this.tokenCache.get(cacheKey);
        if (cached) {
            this.logger.log('使用缓存Token', { platform: this.name });
            return cached;
        }

        const config = vscode.workspace.getConfiguration('commitHelper');
        let token: string | undefined;

        if (this.name === 'local-gitlab') {
            // 本地 GitLab 的 Token 获取逻辑
            token = config.get<string>('localGitlabToken') || process.env.LOCAL_GITLAB_TOKEN;

            // 如果没有专门的本地 GitLab token，尝试使用通用的 GitLab token
            if (!token) {
                token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
            }

            // 支持基于主机 URL 的特定配置
            if (!token && repoInfo.hostUrl) {
                token = this.getTokenForHost(repoInfo.hostUrl);
            }
        } else {
            // gitlab.com
            token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
        }

        if (token) {
            this.tokenCache.set(cacheKey, token);
        }

        this.logger.log(`${this.name} Token: ${token ? '已配置' : '未配置'}`);
        return token;
    }

    async fetchIssues(repoInfo: RepoInfo, accessToken: string, maxIssues: number): Promise<Issue[]> {
        const allIssues: Issue[] = [];
        let page = 1;
        const perPage = Math.min(maxIssues, 50);
        const cleanRepo = repoInfo.repo.replace(/\.git$/, '');
        const projectPath = encodeURIComponent(`${repoInfo.owner}/${cleanRepo}`);

        while (allIssues.length < maxIssues) {
            const url = `${repoInfo.baseUrl}/projects/${projectPath}/issues?state=opened&page=${page}&per_page=${perPage}`;
            const headers = {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const issues = await this.httpClient.requestWithRetry<any[]>(url, {
                method: 'GET',
                headers
            });

            if (!Array.isArray(issues) || issues.length === 0) {
                break;
            }

            const convertedIssues: Issue[] = issues.map(issue => ({
                id: issue.iid,
                title: issue.title,
                number: issue.iid,
                state: issue.state,
                url: issue.web_url
            }));

            allIssues.push(...convertedIssues);

            if (issues.length < perPage) {
                break;
            }

            page++;
        }

        return allIssues.slice(0, maxIssues);
    }

    /**
     * 获取特定主机的 Token
     */
    private getTokenForHost(hostUrl: string): string | undefined {
        try {
            const hostname = new URL(hostUrl).hostname;
            const configKeys = [
                `gitlabToken.${hostname}`,
                `localGitlabToken.${hostname}`,
                `gitlab.${hostname}.token`,
                `tokens.${hostname}`
            ];

            const fullConfig = vscode.workspace.getConfiguration();
            for (const key of configKeys) {
                const token = fullConfig.get<string>(`commitHelper.${key}`);
                if (token) {
                    return token;
                }
            }
        } catch (error) {
            this.logger.error(`解析hostUrl失败: ${error}`);
        }

        return undefined;
    }

    dispose(): void {
        this.tokenCache.dispose();
    }
}
