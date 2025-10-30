import { Issue, RepoInfo } from '../core/types';

/**
 * 平台接口
 *
 * 所有代码托管平台必须实现此接口
 * 策略模式：消除 switch/case，每个平台独立实现
 */
export interface IPlatform {
    /**
     * 平台名称
     */
    readonly name: string;

    /**
     * 获取访问令牌
     */
    getAccessToken(repoInfo: RepoInfo): Promise<string | undefined>;

    /**
     * 获取议题列表
     */
    fetchIssues(repoInfo: RepoInfo, accessToken: string, maxIssues: number): Promise<Issue[]>;
}
