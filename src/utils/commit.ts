import { IssueTypeInfo, CommitTypeInfo } from '../core/types';

/**
 * 提交相关的工具函数
 */

// 预编译的提交类型模式
const COMMIT_TYPE_PATTERNS = [
    /^(feat|fix|docs?|style|refactor|test|chore|perf|ci|build|revert|hotfix|security|update|add|remove)(\(.+?\))?!?\s*[:：]\s*/i,
    /^\[?(feat|fix|docs?|style|refactor|test|chore|perf|ci|build|revert|hotfix|security|update|add|remove)\]?\s*[:：]?\s*/i
];

// 议题类型识别规则
const ISSUE_TYPE_RULES = [
    { pattern: /^(\[?(?:feat|feature|新功能|功能)\]?[:：\s-]|feat\s*[:：]|feature\s*[:：])/i, type: 'feat', icon: '[FEAT]', label: '新功能' },
    { pattern: /^(\[?(?:fix|bug|修复|修改|bugfix)\]?[:：\s-]|fix\s*[:：]|bug\s*[:：])/i, type: 'fix', icon: '[FIX]', label: 'Bug修复' },
    { pattern: /^(\[?(?:docs?|文档|说明)\]?[:：\s-]|docs?\s*[:：])/i, type: 'docs', icon: '[DOCS]', label: '文档' },
    { pattern: /^(\[?(?:style|样式|格式)\]?[:：\s-]|style\s*[:：])/i, type: 'style', icon: '[STYLE]', label: '样式' },
    { pattern: /^(\[?(?:refactor|重构)\]?[:：\s-]|refactor\s*[:：])/i, type: 'refactor', icon: '[REFACTOR]', label: '重构' },
    { pattern: /^(\[?(?:test|测试)\]?[:：\s-]|test\s*[:：])/i, type: 'test', icon: '[TEST]', label: '测试' },
    { pattern: /^(\[?(?:chore|杂项|维护|配置)\]?[:：\s-]|chore\s*[:：])/i, type: 'chore', icon: '[CHORE]', label: '维护' },
    { pattern: /^(\[?(?:perf|性能|优化)\]?[:：\s-]|perf\s*[:：])/i, type: 'perf', icon: '[PERF]', label: '性能优化' },
    { pattern: /^(\[?(?:ci|持续集成|集成)\]?[:：\s-]|ci\s*[:：])/i, type: 'ci', icon: '[CI]', label: 'CI/CD' },
    { pattern: /^(\[?(?:build|构建|编译)\]?[:：\s-]|build\s*[:：])/i, type: 'build', icon: '[BUILD]', label: '构建' },
    { pattern: /^(\[?(?:revert|回滚|撤销)\]?[:：\s-]|revert\s*[:：])/i, type: 'revert', icon: '[REVERT]', label: '回滚' },
    { pattern: /^(\[?(?:hotfix|紧急修复|热修复)\]?[:：\s-]|hotfix\s*[:：])/i, type: 'hotfix', icon: '[HOTFIX]', label: '紧急修复' },
    { pattern: /^(\[?(?:security|安全)\]?[:：\s-]|security\s*[:：])/i, type: 'security', icon: '[SECURITY]', label: '安全' },
    { pattern: /^(\[?(?:update|更新|升级)\]?[:：\s-]|update\s*[:：])/i, type: 'update', icon: '[UPDATE]', label: '更新' },
    { pattern: /^(\[?(?:add|添加|新增)\]?[:：\s-]|add\s*[:：])/i, type: 'add', icon: '[ADD]', label: '新增' },
    { pattern: /^(\[?(?:remove|删除|移除)\]?[:：\s-]|remove\s*[:：])/i, type: 'remove', icon: '[REMOVE]', label: '删除' }
];

/**
 * 清理议题标题
 * 移除各种格式的前缀标签和提交类型
 */
export function cleanIssueTitle(title: string): string {
    if (!title) return title;

    const cleanPatterns = [
        // 清理各种格式的前缀标签
        /^(?:\[[^\]]+\]|【[^】]+】|\([^)]+\)|[A-Z]+[-:])\s*-?\s*/,
        // 清理 feat/fix 等类型前缀
        /^(feat|fix|docs?|style|refactor|test|chore|perf|ci|build|revert|hotfix|security|update|add|remove)(\(.+?\))?!?\s*[:：]\s*/i,
        // 清理带方括号的类型前缀
        /^\[?(feat|fix|docs?|style|refactor|test|chore|perf|ci|build|revert|hotfix|security|update|add|remove)\]?\s*[:：]?\s*/i,
        // 清理中文类型前缀
        /^(新功能|功能|修复|修改|文档|样式|重构|测试|维护|性能|持续集成|构建|回滚|热修复|安全|更新|添加|删除)[:：]\s*/
    ];

    let cleanedTitle = title;

    for (const pattern of cleanPatterns) {
        const cleaned = cleanedTitle.replace(pattern, '').trim();
        if (cleaned && cleaned !== cleanedTitle) {
            cleanedTitle = cleaned;
            break;
        }
    }

    // 如果清理后为空或太短，返回原标题
    if (!cleanedTitle || cleanedTitle.length < 3) {
        return title;
    }

    return cleanedTitle;
}

/**
 * 识别议题类型
 */
export function detectIssueType(title: string): IssueTypeInfo {
    if (!title) {
        return { type: 'other', icon: '[OTHER]', label: '其他' };
    }

    for (const rule of ISSUE_TYPE_RULES) {
        if (rule.pattern.test(title)) {
            return {
                type: rule.type,
                icon: rule.icon,
                label: rule.label
            };
        }
    }

    return { type: 'other', icon: '[OTHER]', label: '其他' };
}

/**
 * 移除标题中的提交类型前缀
 */
export function removeCommitTypePrefix(title: string): string {
    let cleanedTitle = title;

    for (const pattern of COMMIT_TYPE_PATTERNS) {
        cleanedTitle = cleanedTitle.replace(pattern, '').trim();
    }

    // 移除 BREAKING CHANGE 内容
    cleanedTitle = cleanedTitle.replace(/\n\nBREAKING CHANGE:.*$/s, '').trim();

    // 移除 Closes 内容
    cleanedTitle = cleanedTitle.replace(/\n\nCloses #\d+$/gm, '').trim();

    return cleanedTitle || title;
}

/**
 * 获取提交类型列表
 */
export function getCommitTypes(): CommitTypeInfo[] {
    return [
        { label: 'feat', detail: '添加新的功能特性' },
        { label: 'fix', detail: '修复代码中的错误' },
        { label: 'docs', detail: '仅文档相关的更改' },
        { label: 'style', detail: '不影响代码含义的更改（空格、格式化、缺少分号等）' },
        { label: 'refactor', detail: '既不修复bug也不添加功能的代码更改' },
        { label: 'test', detail: '添加缺失的测试或更正现有测试' },
        { label: 'chore', detail: '对构建过程或辅助工具和库的更改' },
        { label: 'perf', detail: '提高性能的代码更改' },
        { label: 'ci', detail: 'CI配置文件和脚本的更改' },
        { label: 'build', detail: '影响构建系统或外部依赖的更改' },
        { label: 'revert', detail: '恢复之前的提交' }
    ];
}
