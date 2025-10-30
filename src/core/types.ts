/**
 * 核心类型定义
 */

export interface Issue {
    id: number;
    title: string;
    number: number;
    state: string;
    url: string;
}

export interface RepoInfo {
    platform: string;
    owner: string;
    repo: string;
    baseUrl: string;
    hostUrl?: string;
}

export interface CommitTypeInfo {
    label: string;
    detail: string;
}

export interface IssueTypeInfo {
    type: string;
    icon: string;
    label: string;
}

export interface CommitOptions {
    type: string;
    scope: string;
    title: string;
    issues: Issue[];
    isBreaking: boolean;
}

export interface HttpRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
    body?: any;
}

export interface PlatformConfig {
    token?: string;
    baseUrl: string;
    timeout?: number;
}
