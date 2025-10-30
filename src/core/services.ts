import * as vscode from 'vscode';
import { AppContext } from './context';
import { Issue, RepoInfo, CommitOptions } from './types';
import { cleanIssueTitle, removeCommitTypePrefix, getCommitTypes } from '../utils/commit';

/**
 * 业务服务层
 * 封装核心业务逻辑，简化主流程
 */
export class CommitHelperService {
    private readonly ctx: AppContext;

    constructor(ctx: AppContext) {
        this.ctx = ctx;
    }

    /**
     * 获取议题列表
     */
    async fetchIssues(repoInfo: RepoInfo): Promise<Issue[]> {
        const cacheKey = `${repoInfo.platform}-${repoInfo.owner}-${repoInfo.repo}`;

        // 检查缓存
        const cached = this.ctx.issueCache.get(cacheKey);
        if (cached) {
            this.ctx.logger.log('使用缓存的议题数据', { count: cached.length });
            return cached;
        }

        // 获取平台实例
        const platform = this.ctx.platformFactory.getPlatform(repoInfo.platform);
        if (!platform) {
            throw new Error(`不支持的平台: ${repoInfo.platform}`);
        }

        // 获取访问令牌
        const accessToken = await platform.getAccessToken(repoInfo);
        if (!accessToken) {
            const errorMsg = `未找到 ${repoInfo.platform} 的访问令牌，请在设置中配置`;
            this.ctx.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        // 获取议题
        const issues = await platform.fetchIssues(repoInfo, accessToken, this.ctx.getMaxIssues());

        // 缓存结果
        this.ctx.issueCache.set(cacheKey, issues);

        this.ctx.logger.log('议题获取成功', {
            totalCount: issues.length,
            platform: repoInfo.platform
        });

        return issues;
    }

    /**
     * 刷新议题列表
     */
    async refreshIssues(repoInfo: RepoInfo): Promise<Issue[]> {
        const cacheKey = `${repoInfo.platform}-${repoInfo.owner}-${repoInfo.repo}`;
        this.ctx.issueCache.delete(cacheKey);

        return this.fetchIssues(repoInfo);
    }

    /**
     * 确定提交标题
     */
    async determineCommitTitle(
        currentMessage: string,
        selectedIssue: Issue | null,
        hasExistingContent: boolean
    ): Promise<string | null> {
        if (hasExistingContent) {
            // 提取现有标题，移除提交类型前缀
            const commitTitle = removeCommitTypePrefix(currentMessage.trim());
            this.ctx.logger.log('使用现有提交消息内容', {
                original: currentMessage,
                extracted: commitTitle
            });
            return commitTitle || currentMessage.trim();
        }

        if (selectedIssue) {
            // 使用议题标题，清理前缀
            const cleanedTitle = cleanIssueTitle(selectedIssue.title);
            this.ctx.logger.log('使用议题标题', {
                rawTitle: selectedIssue.title,
                cleanedTitle
            });
            return cleanedTitle;
        }

        // 需要用户输入
        const inputTitle = await vscode.window.showInputBox({
            prompt: '输入提交描述',
            placeHolder: '简要描述本次提交的内容'
        });

        if (!inputTitle || !inputTitle.trim()) {
            this.ctx.logger.log('用户未输入提交描述');
            return null;
        }

        const commitTitle = inputTitle.trim();
        this.ctx.logger.log('用户手动输入的标题', { title: commitTitle });
        return commitTitle;
    }

    /**
     * 获取提交类型和作用域
     */
    async getCommitTypeAndScope(): Promise<{
        commitType: string;
        scope: string;
        cancelled: boolean;
        isBreaking: boolean;
    } | null> {
        const commitTypes = getCommitTypes();
        let isBreaking = false;

        while (true) {
            // 添加 Breaking Change 切换选项
            const optionsWithToggle: vscode.QuickPickItem[] = [
                {
                    label: `${isBreaking ? '$(check)' : '$(circle-outline)'} Breaking Change`,
                    description: '点击设置为Breaking Change类型(破坏性变更)',
                    __toggle: true
                } as any,
                {
                    label: '',
                    kind: vscode.QuickPickItemKind.Separator
                },
                ...commitTypes.map(item => ({
                    label: item.label,
                    detail: item.detail,
                    __type: item.label
                }))
            ];

            const selectedType = await vscode.window.showQuickPick(optionsWithToggle, {
                placeHolder: `选择提交类型${isBreaking ? ' (当前为 Breaking Change)' : ''}`,
                matchOnDetail: true
            });

            if (!selectedType) {
                this.ctx.logger.log('用户未选择提交类型');
                return null;
            }

            // 处理特殊操作
            if (selectedType.kind === vscode.QuickPickItemKind.Separator) {
                continue;
            }

            if ((selectedType as any).__toggle) {
                isBreaking = !isBreaking;
                continue;
            }

            // 正常的提交类型选择
            const commitType = (selectedType as any).__type;
            this.ctx.logger.log('用户选择的提交类型', {
                type: commitType,
                isBreaking
            });

            // 输入作用域（可选）
            const scope = await vscode.window.showInputBox({
                prompt: '输入作用域（可选）',
                placeHolder: '例如：api, ui, auth'
            });

            this.ctx.logger.log('用户输入的作用域', { scope: scope || '无' });

            return {
                commitType,
                scope: scope || '',
                cancelled: false,
                isBreaking
            };
        }
    }

    /**
     * 生成提交消息
     */
    generateCommitMessage(options: CommitOptions): string {
        let cleanedTitle = removeCommitTypePrefix(options.title);

        // 构建提交消息
        let commitMessage = options.type;
        if (options.scope && options.scope.trim()) {
            commitMessage += `(${options.scope.trim()})`;
        }

        if (options.isBreaking) {
            commitMessage += '!';
        }

        commitMessage += `: ${cleanedTitle}`;

        // 添加 BREAKING CHANGE 说明
        if (options.isBreaking) {
            commitMessage += '\n\nBREAKING CHANGE: 这是一个破坏性变更，可能影响现有功能的使用方式';
        }

        // 添加议题引用
        if (options.issues.length > 0) {
            commitMessage += `\n\nCloses #${options.issues[0].number}`;
        }

        return commitMessage;
    }
}
