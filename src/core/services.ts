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
     * 解析已有的提交消息，将正文和脚注拆分出来
     */
    private parseExistingSections(existingMessage?: string): {
        body: string[];
        footers: string[];
        hasBreakingFooter: boolean;
        existingIssueNumbers: Set<number>;
    } {
        if (!existingMessage || !existingMessage.trim()) {
            return {
                body: [],
                footers: [],
                hasBreakingFooter: false,
                existingIssueNumbers: new Set<number>()
            };
        }

        const lines = existingMessage.split(/\r?\n/);
        // 丢弃首行标题，其余部分按正文/脚注拆分
        lines.shift();

        // 去掉前导空行
        while (lines.length > 0 && !lines[0].trim()) {
            lines.shift();
        }

        const footerPattern = /^(BREAKING\s+CHANGE|BREAKING-CHANGE|Closes|Fixes|Resolves|Refs?|See)\b/i;
        const body: string[] = [];
        const footers: string[] = [];
        let footerStarted = false;

        for (const line of lines) {
            const trimmedLine = line.trimEnd();
            const isFooter = footerPattern.test(trimmedLine.trim());
            if (isFooter) {
                footerStarted = true;
            }

            if (footerStarted) {
                footers.push(trimmedLine);
            } else {
                body.push(trimmedLine);
            }
        }

        // 去掉正文结尾的空行
        while (body.length > 0 && !body[body.length - 1].trim()) {
            body.pop();
        }

        // 去掉脚注前导空行
        while (footers.length > 0 && !footers[0].trim()) {
            footers.shift();
        }

        const hasBreakingFooter = footers.some(line =>
            /^(BREAKING\s+CHANGE|BREAKING-CHANGE)/i.test(line.trim())
        );

        const existingIssueNumbers = new Set<number>();
        for (const footer of footers) {
            const match = footer.match(/^(Closes|Fixes|Resolves)\s+#?(\d+)/i);
            if (match) {
                const num = parseInt(match[2], 10);
                if (!isNaN(num)) {
                    existingIssueNumbers.add(num);
                }
            }
        }

        return { body, footers, hasBreakingFooter, existingIssueNumbers };
    }

    /**
     * 生成提交消息
     */
    generateCommitMessage(options: CommitOptions): string {
        const cleanedTitle = removeCommitTypePrefix(options.title);
        const existingSections = this.parseExistingSections(options.existingMessage);
        const shouldMarkBreaking = options.isBreaking || existingSections.hasBreakingFooter;

        // 构建提交消息头部
        let commitHeader = options.type;
        if (options.scope && options.scope.trim()) {
            commitHeader += `(${options.scope.trim()})`;
        }

        if (shouldMarkBreaking) {
            commitHeader += '!';
        }

        commitHeader += `: ${cleanedTitle}`;

        const lines: string[] = [commitHeader];

        // 拼接正文
        if (existingSections.body.length > 0) {
            lines.push('');
            lines.push(...existingSections.body);
        }

        // 处理脚注、去重
        const footerLines: string[] = [];
        const footerDedup = new Set<string>();
        const addFooter = (footer: string) => {
            const normalized = footer.trim();
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (footerDedup.has(key)) {
                return;
            }
            footerDedup.add(key);
            footerLines.push(normalized);
        };

        existingSections.footers.forEach(addFooter);

        // 根据选择标记填充 BREAKING 信息（如果用户选择或原文已有）
        if (shouldMarkBreaking && !existingSections.hasBreakingFooter) {
            addFooter('BREAKING CHANGE: 这是一个破坏性变更，可能影响现有功能的使用方式');
        }

        // 添加议题引用，避免与已有的重复
        const existingIssues = new Set(existingSections.existingIssueNumbers);
        options.issues.forEach(issue => {
            if (!existingIssues.has(issue.number)) {
                addFooter(`Closes #${issue.number}`);
                existingIssues.add(issue.number);
            }
        });

        if (footerLines.length > 0) {
            if (lines[lines.length - 1] !== '') {
                lines.push('');
            }
            lines.push(...footerLines);
        }

        return lines.join('\n');
    }
}
