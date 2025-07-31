interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export class Cache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private ttl: number;

    constructor(ttlMinutes: number = 5) {
        this.ttl = ttlMinutes * 60 * 1000;
    }

    set(key: string, data: T): void {
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
}