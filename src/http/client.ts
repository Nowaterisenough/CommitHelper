import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { HttpRequestOptions } from '../core/types';
import { Logger } from '../core/logger';

/**
 * HTTP 客户端
 *
 * 封装 HTTP 请求逻辑，管理连接池，支持重试
 */
export class HttpClient {
    private readonly httpAgent: http.Agent;
    private readonly httpsAgent: https.Agent;
    private readonly logger: Logger;
    private readonly defaultTimeout: number;
    private readonly maxResponseSize: number;

    constructor(logger: Logger, timeout: number = 8000) {
        this.logger = logger;
        this.defaultTimeout = timeout;
        this.maxResponseSize = 10 * 1024 * 1024; // 10MB

        // HTTP 连接池配置
        this.httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 5,
            maxFreeSockets: 2,
            timeout: timeout
        });

        // HTTPS 连接池配置
        this.httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 5,
            maxFreeSockets: 2,
            timeout: timeout
        });
    }

    /**
     * 发起 HTTP 请求
     */
    async request<T = any>(url: string, options: HttpRequestOptions = {}): Promise<T> {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'Connection': 'keep-alive',
                ...options.headers
            },
            timeout: options.timeout || this.defaultTimeout,
            agent: isHttps ? this.httpsAgent : this.httpAgent
        };

        this.logger.log('发起HTTP请求', {
            url: this.sanitizeUrl(url),
            method: requestOptions.method,
            hostname: requestOptions.hostname,
            keepAlive: true
        });

        return new Promise((resolve, reject) => {
            const req = client.request(requestOptions, (res) => {
                const chunks: Buffer[] = [];
                let totalLength = 0;

                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    totalLength += chunk.length;

                    // 防止响应过大
                    if (totalLength > this.maxResponseSize) {
                        req.destroy();
                        reject(new Error('响应数据过大'));
                    }
                });

                res.on('end', () => {
                    this.logger.log('HTTP响应', {
                        statusCode: res.statusCode,
                        contentLength: totalLength,
                        headers: {
                            'content-type': res.headers['content-type'],
                            'x-ratelimit-remaining': res.headers['x-ratelimit-remaining']
                        }
                    });

                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        const data = Buffer.concat(chunks, totalLength).toString('utf8');
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}\n${data.substring(0, 500)}`));
                        return;
                    }

                    try {
                        const data = Buffer.concat(chunks, totalLength).toString('utf8');
                        const result = JSON.parse(data);
                        resolve(result);
                    } catch (error) {
                        const data = Buffer.concat(chunks, totalLength).toString('utf8');
                        this.logger.error('JSON解析失败', { dataLength: data.length, error });
                        reject(new Error(`JSON解析失败: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error('HTTP请求错误', error);
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });

            if (options.body) {
                req.write(JSON.stringify(options.body));
            }

            req.end();
        });
    }

    /**
     * 带重试机制的请求
     */
    async requestWithRetry<T = any>(
        url: string,
        options: HttpRequestOptions = {},
        retries: number = 2
    ): Promise<T> {
        for (let i = 0; i <= retries; i++) {
            try {
                return await this.request<T>(url, options);
            } catch (error) {
                if (i === retries) {
                    throw error;
                }
                // 递增延迟重试
                await this.sleep(1000 * (i + 1));
            }
        }
        throw new Error('重试失败');
    }

    /**
     * 清理敏感信息的 URL
     */
    private sanitizeUrl(url: string): string {
        return url
            .replace(/token=[^&]+/g, 'token=***')
            .replace(/Bearer [^,}]+/g, 'Bearer ***');
    }

    /**
     * 延迟函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 销毁客户端
     */
    dispose(): void {
        this.httpAgent.destroy();
        this.httpsAgent.destroy();
    }
}
