interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export class Cache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private ttl: number;
    private maxSize: number;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(ttlMinutes: number = 5, maxSize: number = 100) {
        this.ttl = ttlMinutes * 60 * 1000;
        this.maxSize = maxSize;
        
        // 定期清理过期缓存
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, Math.min(this.ttl / 2, 5 * 60 * 1000)); // 最多5分钟清理一次
    }

    set(key: string, data: T): void {
        // 如果缓存已满，删除最旧的项目
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
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
        if (!entry) return undefined;

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.data;
    }

    clear(): void {
        this.cache.clear();
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
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