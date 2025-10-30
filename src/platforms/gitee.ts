import * as vscode from 'vscode';
import { IPlatform } from './platform';
import { Issue, RepoInfo } from '../core/types';
import { HttpClient } from '../http/client';
import { Logger } from '../core/logger';
import { Cache } from '../core/cache';

/**
 * Gitee 平台实现
 */
export class GiteePlatform implements IPlatform {
    readonly name = 'gitee';
    private readonly httpClient: HttpClient;
    private readonly logger: Logger;
    private readonly tokenCache: Cache<string>;

    constructor(httpClient: HttpClient, logger: Logger) {
        this.httpClient = httpClient;
        this.logger = logger;
        this.tokenCache = new Cache<string>(60);
    }

    async getAccessToken(repoInfo: RepoInfo): Promise<string | undefined> {
        const cacheKey = `token-${this.name}`;
        const cached = this.tokenCache.get(cacheKey);
        if (cached) {
            this.logger.log('使用缓存Token', { platform: this.name });
            return cached;
        }

        const config = vscode.workspace.getConfiguration('commitHelper');
        const token = config.get<string>('giteeToken') || process.env.GITEE_TOKEN;

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

        while (allIssues.length < maxIssues) {
            const url = `https://gitee.com/api/v5/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&access_token=${accessToken}&page=${page}&per_page=${perPage}`;
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'VSCode-CommitHelper'
            };

            const issues = await this.httpClient.requestWithRetry<any[]>(url, {
                method: 'GET',
                headers
            });

            if (!Array.isArray(issues) || issues.length === 0) {
                break;
            }

            const convertedIssues: Issue[] = issues.map(issue => ({
                id: issue.id,
                title: issue.title,
                number: issue.number,
                state: issue.state,
                url: issue.html_url
            }));

            allIssues.push(...convertedIssues);

            if (issues.length < perPage) {
                break;
            }

            page++;
        }

        return allIssues.slice(0, maxIssues);
    }

    dispose(): void {
        this.tokenCache.dispose();
    }
}
