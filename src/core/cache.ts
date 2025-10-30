/**
 * 真正的 LRU 缓存实现
 *
 * 修复原有问题：
 * 1. 原实现删除的是最早插入的，不是最少使用的
 * 2. 现在 get 操作会更新访问顺序，保证 LRU 语义正确
 */

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export class Cache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private readonly ttl: number;
    private readonly maxSize: number;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(ttlMinutes: number = 5, maxSize: number = 100) {
        this.ttl = ttlMinutes * 60 * 1000;
        this.maxSize = maxSize;

        // 定期清理过期缓存，最多5分钟一次
        const cleanupInterval = Math.min(this.ttl / 2, 5 * 60 * 1000);
        this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
    }

    set(key: string, data: T): void {
        // 如果已存在，先删除（这样重新插入会在最后）
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // 如果缓存满了，删除最久未使用的项（Map 的第一个元素）
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        // 检查是否过期
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }

        // LRU 关键：删除后重新插入，移到最后（最近使用）
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.data;
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }

        // 检查是否过期
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    clear(): void {
        this.cache.clear();
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    size(): number {
        return this.cache.size;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
    }

    dispose(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        this.clear();
    }
}
