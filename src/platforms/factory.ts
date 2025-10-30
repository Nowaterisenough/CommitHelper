import { IPlatform } from './platform';
import { GitHubPlatform } from './github';
import { GitLabPlatform } from './gitlab';
import { GiteePlatform } from './gitee';
import { HttpClient } from '../http/client';
import { Logger } from '../core/logger';

/**
 * 平台工厂
 *
 * 根据平台名称创建相应的平台实例
 * 策略模式的工厂实现，消除 switch/case
 */
export class PlatformFactory {
    private readonly platforms: Map<string, IPlatform>;

    constructor(httpClient: HttpClient, logger: Logger) {
        this.platforms = new Map();

        // 注册所有平台
        this.platforms.set('github', new GitHubPlatform(httpClient, logger));
        this.platforms.set('gitlab', new GitLabPlatform(httpClient, logger, false));
        this.platforms.set('local-gitlab', new GitLabPlatform(httpClient, logger, true));
        this.platforms.set('gitee', new GiteePlatform(httpClient, logger));
    }

    /**
     * 获取平台实例
     */
    getPlatform(platformName: string): IPlatform | null {
        const platform = this.platforms.get(platformName);
        if (!platform) {
            return null;
        }
        return platform;
    }

    /**
     * 销毁所有平台
     */
    dispose(): void {
        for (const platform of this.platforms.values()) {
            if ('dispose' in platform && typeof (platform as any).dispose === 'function') {
                (platform as any).dispose();
            }
        }
        this.platforms.clear();
    }
}
