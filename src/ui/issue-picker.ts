import * as vscode from 'vscode';
import { Issue, RepoInfo } from '../core/types';
import { CommitHelperService } from '../core/services';
import { detectIssueType } from '../utils/commit';

interface IssuePickItem extends vscode.QuickPickItem {
    action: 'refresh' | 'manual' | 'none' | 'info' | 'select' | 'separator';
    issue: Issue | null;
}

/**
 * 议题选择器
 */
export class IssuePicker {
    private readonly service: CommitHelperService;

    constructor(service: CommitHelperService) {
        this.service = service;
    }

    /**
     * 显示议题选择界面
     */
    async pick(
        issues: Issue[],
        hasExistingContent: boolean,
        repoInfo: RepoInfo
    ): Promise<{ selectedIssue: Issue | null; userCancelled: boolean }> {
        let currentIssues = issues;

        while (true) {
            const pickItems = this.createPickItems(currentIssues);

            const selectedItem = await vscode.window.showQuickPick(pickItems, {
                placeHolder: hasExistingContent
                    ? '选择要绑定的议题（当前已有提交内容，将保留现有内容）'
                    : '选择要绑定的议题或不绑定议题',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selectedItem === undefined) {
                return { selectedIssue: null, userCancelled: true };
            }

            // 忽略分隔线
            if (selectedItem.action === 'separator' || selectedItem.kind === vscode.QuickPickItemKind.Separator) {
                continue;
            }

            // 处理刷新
            if (selectedItem.action === 'refresh') {
                const refreshedIssues = await this.refreshIssues(repoInfo);
                if (refreshedIssues) {
                    currentIssues = refreshedIssues;
                    vscode.window.showInformationMessage(`议题列表已刷新，共找到 ${currentIssues.length} 个议题`);
                }
                continue;
            }

            // 处理手动绑定
            if (selectedItem.action === 'manual') {
                const manualIssue = await this.handleManualBinding();
                if (manualIssue) {
                    return { selectedIssue: manualIssue, userCancelled: false };
                }
                continue;
            }

            // 处理信息项
            if (selectedItem.action === 'info') {
                continue;
            }

            // 处理正常选择
            return { selectedIssue: selectedItem.issue, userCancelled: false };
        }
    }

    /**
     * 创建选择项
     */
    private createPickItems(issues: Issue[]): IssuePickItem[] {
        const pickItems: IssuePickItem[] = [
            {
                label: '$(refresh) 刷新议题列表',
                description: '重新获取最新的议题列表',
                action: 'refresh',
                issue: null
            },
            {
                label: '$(edit) 手动绑定议题',
                description: '手动输入议题编号进行绑定',
                action: 'manual',
                issue: null
            },
            {
                label: '$(x) 不绑定议题',
                description: '本次提交不关联任何议题',
                action: 'none',
                issue: null
            }
        ];

        if (issues.length === 0) {
            pickItems.splice(0, 1);
            pickItems.unshift({
                label: '$(info) 未找到议题',
                description: '当前仓库没有打开的议题',
                action: 'info',
                issue: null
            });
        } else {
            pickItems.push({
                label: '',
                description: '',
                action: 'separator',
                issue: null,
                kind: vscode.QuickPickItemKind.Separator
            } as any);

            const issueItems: IssuePickItem[] = issues.map(issue => {
                const maxTitleLength = 100;
                const displayTitle = issue.title.length > maxTitleLength
                    ? issue.title.substring(0, maxTitleLength) + '...'
                    : issue.title;

                return {
                    label: displayTitle,
                    detail: `#${issue.number}`,
                    action: 'select',
                    issue
                };
            });

            pickItems.push(...issueItems);
        }

        return pickItems;
    }

    /**
     * 刷新议题
     */
    private async refreshIssues(repoInfo: RepoInfo): Promise<Issue[] | null> {
        try {
            const issues = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "正在刷新议题列表...",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "连接到远程仓库..." });
                const fetchedIssues = await this.service.refreshIssues(repoInfo);
                progress.report({ increment: 100, message: "议题获取完成" });
                return fetchedIssues;
            });

            return issues;
        } catch (error: any) {
            // 显示具体的错误消息
            vscode.window.showErrorMessage(error.message || '刷新议题失败');
            return null;
        }
    }

    /**
     * 处理手动绑定
     */
    private async handleManualBinding(): Promise<Issue | null> {
        const issueInput = await vscode.window.showInputBox({
            prompt: '输入议题编号',
            placeHolder: '例如：123 或 #123',
            validateInput: (value) => {
                if (!value) return undefined;
                const cleaned = value.replace('#', '');
                const number = parseInt(cleaned, 10);
                if (isNaN(number) || number <= 0) {
                    return '请输入有效的议题编号';
                }
                return undefined;
            }
        });

        if (!issueInput) {
            return null;
        }

        const issueNumber = parseInt(issueInput.replace('#', ''), 10);

        const manualIssue: Issue = {
            id: issueNumber,
            number: issueNumber,
            title: `手动绑定的议题 #${issueNumber}`,
            state: 'open',
            url: ''
        };

        vscode.window.showInformationMessage(`已手动绑定议题 #${issueNumber}`);
        return manualIssue;
    }
}
