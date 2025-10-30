import * as vscode from 'vscode';
import { RepoInfo } from '../core/types';
import { GitUrlParser } from './parser';
import { Logger } from '../core/logger';
import { Cache } from '../core/cache';

/**
 * Git 仓库管理器
 *
 * 负责获取和缓存仓库信息
 */
export class GitRepoManager {
    private readonly parser: GitUrlParser;
    private readonly logger: Logger;
    private readonly cache: Cache<RepoInfo>;
    private gitApi: any;

    constructor(logger: Logger) {
        this.logger = logger;
        this.parser = new GitUrlParser(logger);
        this.cache = new Cache<RepoInfo>(30, 10); // 30分钟缓存
    }

    /**
     * 获取当前仓库信息
     */
    async getRepoInfo(): Promise<RepoInfo | null> {
        const cacheKey = 'current-repo';

        // 检查缓存
        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.logger.log('使用缓存的仓库信息');
            return cached;
        }

        try {
            const git = this.getGitApi();
            if (!git || git.repositories.length === 0) {
                this.logger.log('未找到Git仓库');
                return null;
            }

            const repository = git.repositories[0];
            const remotes = repository.state.remotes;

            if (remotes.length === 0) {
                this.logger.log('未找到远程仓库');
                return null;
            }

            const remote = remotes.find((r: any) => r.name === 'origin') || remotes[0];
            const fetchUrl = remote.fetchUrl || remote.pushUrl;

            this.logger.log('获取到远程URL', { remoteName: remote.name, fetchUrl });

            const repoInfo = this.parser.parse(fetchUrl);
            if (repoInfo) {
                this.cache.set(cacheKey, repoInfo);
                this.logger.log('仓库信息已缓存', repoInfo);
            }

            return repoInfo;
        } catch (error) {
            this.logger.error('获取仓库信息失败', error);
            return null;
        }
    }

    /**
     * 获取 Git API
     */
    private getGitApi(): any {
        if (!this.gitApi) {
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (gitExtension) {
                this.gitApi = gitExtension.getAPI(1);
            }
        }
        return this.gitApi;
    }

    /**
     * 获取当前仓库的输入框
     */
    getInputBox(): vscode.InputBox | null {
        const git = this.getGitApi();
        if (!git || git.repositories.length === 0) {
            return null;
        }
        return git.repositories[0].inputBox;
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * 销毁管理器
     */
    dispose(): void {
        this.cache.dispose();
    }
}
