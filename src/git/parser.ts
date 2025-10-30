import { RepoInfo } from '../core/types';
import { Logger } from '../core/logger';

/**
 * Git URL 解析器
 *
 * 支持各种 Git URL 格式：
 * - HTTPS: https://github.com/user/repo.git
 * - SSH with port: ssh://git@host:port/user/repo.git
 * - SSH standard: git@github.com:user/repo.git
 * - SSH no port: ssh://git@host/user/repo.git
 */

// 预编译正则表达式
const URL_PATTERNS = {
    https: /^(https?:\/\/([^\/]+))\/([^\/]+)\/(.+?)(?:\.git)?$/,
    sshWithPort: /^ssh:\/\/git@([^:\/]+):(\d+)\/([^\/]+)\/(.+?)(?:\.git)?$/,
    sshStandard: /^git@([^:]+):([^\/]+)\/(.+?)(?:\.git)?$/,
    sshNoPort: /^ssh:\/\/git@([^\/]+)\/([^\/]+)\/(.+?)(?:\.git)?$/
};

const KNOWN_PLATFORMS = {
    'github.com': 'github',
    'gitlab.com': 'gitlab',
    'gitee.com': 'gitee'
};

export class GitUrlParser {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 解析 Git URL
     */
    parse(url: string): RepoInfo | null {
        this.logger.log('解析Git URL', { url });

        // 尝试各种格式
        let repoInfo = this.parseHttps(url);
        if (repoInfo) return repoInfo;

        repoInfo = this.parseSshWithPort(url);
        if (repoInfo) return repoInfo;

        repoInfo = this.parseSshStandard(url);
        if (repoInfo) return repoInfo;

        repoInfo = this.parseSshNoPort(url);
        if (repoInfo) return repoInfo;

        this.logger.log('Git URL解析失败');
        return null;
    }

    /**
     * 解析 HTTPS 格式
     */
    private parseHttps(url: string): RepoInfo | null {
        const match = url.match(URL_PATTERNS.https);
        if (!match) return null;

        const [, fullHostUrl, hostname, owner, repo] = match;
        this.logger.log('HTTPS格式匹配成功', { fullHostUrl, hostname, owner, repo });

        return this.createRepoInfo(hostname, owner, repo, fullHostUrl);
    }

    /**
     * 解析 SSH 带端口格式
     */
    private parseSshWithPort(url: string): RepoInfo | null {
        const match = url.match(URL_PATTERNS.sshWithPort);
        if (!match) return null;

        const [, hostname, port, owner, repo] = match;
        this.logger.log('SSH格式（带端口）匹配成功', { hostname, port, owner, repo });

        // 已知平台
        if (this.isKnownPlatform(hostname)) {
            return this.createRepoInfo(hostname, owner, repo, `https://${hostname}`);
        }

        // 本地 GitLab
        const protocol = this.isInternalAddress(hostname) ? 'http' : 'https';
        const webPort = port === '2222' ? '' : `:${port}`;
        const hostUrl = `${protocol}://${hostname}${webPort}`;

        return {
            platform: 'local-gitlab',
            owner,
            repo,
            baseUrl: `${hostUrl}/api/v4`,
            hostUrl
        };
    }

    /**
     * 解析标准 SSH 格式
     */
    private parseSshStandard(url: string): RepoInfo | null {
        const match = url.match(URL_PATTERNS.sshStandard);
        if (!match) return null;

        const [, hostname, owner, repo] = match;
        this.logger.log('SSH格式（标准）匹配成功', { hostname, owner, repo });

        // 已知平台
        if (this.isKnownPlatform(hostname)) {
            return this.createRepoInfo(hostname, owner, repo, `https://${hostname}`);
        }

        // 本地 GitLab
        const protocol = this.isInternalAddress(hostname) ? 'http' : 'https';
        const hostUrl = `${protocol}://${hostname}`;

        return {
            platform: 'local-gitlab',
            owner,
            repo,
            baseUrl: `${hostUrl}/api/v4`,
            hostUrl
        };
    }

    /**
     * 解析 SSH 无端口格式
     */
    private parseSshNoPort(url: string): RepoInfo | null {
        const match = url.match(URL_PATTERNS.sshNoPort);
        if (!match) return null;

        const [, hostname, owner, repo] = match;
        this.logger.log('SSH格式（无端口）匹配成功', { hostname, owner, repo });

        // 已知平台
        if (this.isKnownPlatform(hostname)) {
            return this.createRepoInfo(hostname, owner, repo, `https://${hostname}`);
        }

        // 本地 GitLab
        const protocol = this.isInternalAddress(hostname) ? 'http' : 'https';
        const hostUrl = `${protocol}://${hostname}`;

        return {
            platform: 'local-gitlab',
            owner,
            repo,
            baseUrl: `${hostUrl}/api/v4`,
            hostUrl
        };
    }

    /**
     * 检查是否为已知平台
     */
    private isKnownPlatform(hostname: string): boolean {
        return Object.keys(KNOWN_PLATFORMS).some(platform => hostname.includes(platform));
    }

    /**
     * 检查是否为内网地址
     */
    private isInternalAddress(hostname: string): boolean {
        return !!(
            hostname.match(/^192\.168\./) ||
            hostname.match(/^10\./) ||
            hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
            hostname === 'localhost'
        );
    }

    /**
     * 创建仓库信息
     */
    private createRepoInfo(hostname: string, owner: string, repo: string, hostUrl: string): RepoInfo {
        // GitHub
        if (hostname.includes('github.com')) {
            return {
                platform: 'github',
                owner,
                repo,
                baseUrl: 'https://api.github.com',
                hostUrl
            };
        }

        // GitLab
        if (hostname.includes('gitlab.com')) {
            return {
                platform: 'gitlab',
                owner,
                repo,
                baseUrl: 'https://gitlab.com/api/v4',
                hostUrl
            };
        }

        // Gitee
        if (hostname.includes('gitee.com')) {
            return {
                platform: 'gitee',
                owner,
                repo,
                baseUrl: 'https://gitee.com/api/v5',
                hostUrl
            };
        }

        // 其他情况当作本地 GitLab
        return {
            platform: 'local-gitlab',
            owner,
            repo,
            baseUrl: `${hostUrl}/api/v4`,
            hostUrl
        };
    }
}
