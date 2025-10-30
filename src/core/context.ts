import { Logger } from './logger';
import { Cache } from './cache';
import { HttpClient } from '../http/client';
import { GitRepoManager } from '../git/repo';
import { PlatformFactory } from '../platforms/factory';
import { Issue } from './types';

/**
 * 应用上下文
 *
 * 统一管理所有全局状态和服务
 * 消除原有的全局变量混乱
 */
export class AppContext {
    // 核心服务
    readonly logger: Logger;
    readonly httpClient: HttpClient;
    readonly repoManager: GitRepoManager;
    readonly platformFactory: PlatformFactory;

    // 缓存
    readonly issueCache: Cache<Issue[]>;

    // 配置
    private config = {
        debug: false,
        maxIssues: 50,
        requestTimeout: 8000
    };

    constructor() {
        // 初始化核心服务
        this.logger = new Logger('CommitHelper');
        this.httpClient = new HttpClient(this.logger, this.config.requestTimeout);
        this.repoManager = new GitRepoManager(this.logger);
        this.platformFactory = new PlatformFactory(this.httpClient, this.logger);

        // 初始化缓存
        this.issueCache = new Cache<Issue[]>(10, 50); // 10分钟缓存，最多50个项目

        this.logger.log('AppContext 初始化完成');
    }

    /**
     * 设置调试模式
     */
    setDebugMode(enabled: boolean): void {
        this.config.debug = enabled;
        this.logger.setDebugMode(enabled);
    }

    /**
     * 获取调试模式状态
     */
    isDebugMode(): boolean {
        return this.config.debug;
    }

    /**
     * 获取最大议题数量
     */
    getMaxIssues(): number {
        return this.config.maxIssues;
    }

    /**
     * 获取请求超时时间
     */
    getRequestTimeout(): number {
        return this.config.requestTimeout;
    }

    /**
     * 清除所有缓存
     */
    clearAllCaches(): void {
        this.issueCache.clear();
        this.repoManager.clearCache();
        this.logger.log('所有缓存已清除');
    }

    /**
     * 销毁上下文
     */
    dispose(): void {
        this.logger.log('AppContext 正在销毁');

        this.issueCache.dispose();
        this.repoManager.dispose();
        this.platformFactory.dispose();
        this.httpClient.dispose();
        this.logger.dispose();
    }
}
