import * as vscode from 'vscode';
import { AppContext } from './core/context';
import { CommitHelperService } from './core/services';
import { IssuePicker } from './ui/issue-picker';
import { Issue } from './core/types';

/**
 * 重构后的扩展主文件
 *
 * 职责：
 * 1. 管理扩展生命周期
 * 2. 注册命令
 * 3. 委托具体逻辑给服务层
 *
 * 不再包含业务逻辑，保持简洁
 */

let appContext: AppContext;
let service: CommitHelperService;
let issuePicker: IssuePicker;

/**
 * 格式化提交消息 - 主要功能
 */
async function formatCommitMessage(): Promise<void> {
    appContext.logger.log('开始格式化提交消息');

    try {
        // 获取仓库信息
        const repoInfo = await appContext.repoManager.getRepoInfo();
        if (!repoInfo) {
            vscode.window.showErrorMessage('无法获取仓库信息，请确保在Git仓库中打开项目');
            return;
        }

        appContext.logger.log('仓库信息获取成功', repoInfo);

        // 获取当前提交消息
        const inputBox = appContext.repoManager.getInputBox();
        if (!inputBox) {
            vscode.window.showErrorMessage('无法获取Git输入框');
            return;
        }

        const currentMessage = inputBox.value || '';
        const hasExistingContent = currentMessage.trim().length > 0;

        appContext.logger.log('当前提交消息状态', {
            hasContent: hasExistingContent,
            length: currentMessage.length
        });

        // 异步获取议题
        let allIssues: Issue[];
        try {
            allIssues = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "正在获取议题列表...",
                cancellable: true
            }, async (progress, token) => {
                const issues = await service.fetchIssues(repoInfo);
                if (token.isCancellationRequested) {
                    throw new Error('用户取消操作');
                }
                return issues;
            });
        } catch (error: any) {
            // 处理特定错误
            if (error.message && error.message.includes('用户取消')) {
                return; // 用户取消，静默返回
            }

            // 显示错误并返回
            appContext.logger.error('获取议题失败', error);
            vscode.window.showErrorMessage(error.message || '获取议题失败');
            return;
        }

        // 选择议题
        const { selectedIssue, userCancelled } = await issuePicker.pick(allIssues, hasExistingContent, repoInfo);
        if (userCancelled) {
            return;
        }

        // 确定提交标题
        const commitTitle = await service.determineCommitTitle(currentMessage, selectedIssue, hasExistingContent);
        if (!commitTitle) {
            return; // 用户取消
        }

        // 获取提交类型和作用域
        const typeAndScope = await service.getCommitTypeAndScope();
        if (!typeAndScope) {
            return; // 用户取消
        }

        // 生成最终提交消息
        const finalMessage = service.generateCommitMessage({
            type: typeAndScope.commitType,
            scope: typeAndScope.scope,
            title: commitTitle,
            issues: selectedIssue ? [selectedIssue] : [],
            isBreaking: typeAndScope.isBreaking,
            existingMessage: hasExistingContent ? currentMessage : undefined
        });

        // 更新Git输入框
        inputBox.value = finalMessage;

        appContext.logger.log('提交消息生成完成', {
            hasIssue: !!selectedIssue,
            issueNumber: selectedIssue?.number,
            messageLength: finalMessage.length
        });

        vscode.window.showInformationMessage(
            selectedIssue
                ? `提交消息已生成并绑定议题 #${selectedIssue.number}！`
                : '提交消息已生成！'
        );

    } catch (error: any) {
        const errorMsg = `格式化提交消息失败: ${error.message}`;
        appContext.logger.error(errorMsg, error);
        vscode.window.showErrorMessage(errorMsg);
    }
}

/**
 * 测试配置
 */
async function testConfig(): Promise<void> {
    appContext.logger.log('=== 开始测试配置 ===');

    try {
        const repoInfo = await appContext.repoManager.getRepoInfo();
        if (!repoInfo) {
            vscode.window.showErrorMessage('无法获取仓库信息');
            return;
        }

        appContext.logger.log('仓库信息', repoInfo);

        const platform = appContext.platformFactory.getPlatform(repoInfo.platform);
        if (!platform) {
            vscode.window.showErrorMessage(`不支持的平台: ${repoInfo.platform}`);
            return;
        }

        const accessToken = await platform.getAccessToken(repoInfo);
        if (!accessToken) {
            vscode.window.showErrorMessage(`未找到 ${repoInfo.platform} 的访问令牌，请在设置中配置`);
            return;
        }

        appContext.logger.log('Token获取成功', {
            platform: repoInfo.platform,
            tokenPrefix: accessToken.substring(0, 8) + '...'
        });

        // 测试API连接
        const issues = await service.fetchIssues(repoInfo);

        vscode.window.showInformationMessage(
            `配置测试完成！找到 ${issues.length} 个议题。详情请查看输出面板。`
        );

    } catch (error: any) {
        const errorMsg = `配置测试失败: ${error.message}`;
        appContext.logger.error(errorMsg, error);
        vscode.window.showErrorMessage(errorMsg);
    }
}

/**
 * 调试配置
 */
async function debugConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration('commitHelper');

    appContext.logger.log('=== 配置调试信息 ===');
    appContext.logger.log('CommitHelper配置:', {
        localGitlabToken: config.get<string>('localGitlabToken') ? '已配置' : '未配置',
        gitlabToken: config.get<string>('gitlabToken') ? '已配置' : '未配置',
        githubToken: config.get<string>('githubToken') ? '已配置' : '未配置',
        giteeToken: config.get<string>('giteeToken') ? '已配置' : '未配置'
    });

    const repoInfo = await appContext.repoManager.getRepoInfo();
    if (repoInfo) {
        appContext.logger.log('仓库信息:', repoInfo);
        const platform = appContext.platformFactory.getPlatform(repoInfo.platform);
        if (platform) {
            const token = await platform.getAccessToken(repoInfo);
            appContext.logger.log('最终获取的Token:', token ? token.substring(0, 8) + '...' : 'none');
        }
    }

    vscode.window.showInformationMessage('配置调试信息已输出到CommitHelper频道');
}

/**
 * 调试仓库信息
 */
async function debugRepo(): Promise<void> {
    try {
        appContext.logger.log('=== Git仓库调试信息 ===');

        const repoInfo = await appContext.repoManager.getRepoInfo();
        if (!repoInfo) {
            appContext.logger.log('未找到Git仓库');
            return;
        }

        appContext.logger.log('仓库信息:', repoInfo);

        const platform = appContext.platformFactory.getPlatform(repoInfo.platform);
        if (platform) {
            const token = await platform.getAccessToken(repoInfo);
            appContext.logger.log('Token获取结果:', {
                platform: repoInfo.platform,
                hasToken: !!token,
                tokenPrefix: token ? token.substring(0, 8) + '...' : 'none'
            });
        }

        vscode.window.showInformationMessage('调试信息已输出到CommitHelper频道');

    } catch (error) {
        appContext.logger.error('调试失败', error);
    }
}

/**
 * 清除缓存
 */
async function clearCache(): Promise<void> {
    appContext.clearAllCaches();
    vscode.window.showInformationMessage('所有缓存已清除');
}

/**
 * 切换调试模式
 */
async function toggleDebug(): Promise<void> {
    const newMode = !appContext.isDebugMode();
    appContext.setDebugMode(newMode);
    vscode.window.showInformationMessage(`调试模式: ${newMode ? '开启' : '关闭'}`);
}

/**
 * 扩展激活函数
 */
export function activate(context: vscode.ExtensionContext) {
    // 初始化全局上下文
    appContext = new AppContext();
    service = new CommitHelperService(appContext);
    issuePicker = new IssuePicker(service);

    appContext.logger.log('CommitHelper 插件已激活');

    // 注册所有命令
    const commands = [
        vscode.commands.registerCommand('CommitHelper.formatMessage', formatCommitMessage),
        vscode.commands.registerCommand('CommitHelper.testConfig', testConfig),
        vscode.commands.registerCommand('CommitHelper.debugConfig', debugConfig),
        vscode.commands.registerCommand('CommitHelper.debugRepo', debugRepo),
        vscode.commands.registerCommand('CommitHelper.clearCache', clearCache),
        vscode.commands.registerCommand('CommitHelper.toggleDebug', toggleDebug)
    ];

    context.subscriptions.push(...commands);

    // 注册上下文清理
    context.subscriptions.push({
        dispose: () => {
            appContext.dispose();
        }
    });
}

/**
 * 扩展停用函数
 */
export function deactivate() {
    if (appContext) {
        appContext.dispose();
    }
}
