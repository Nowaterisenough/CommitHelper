import * as vscode from 'vscode';

/**
 * 日志管理器
 *
 * 统一管理输出频道和日志级别
 */
export class Logger {
    private outputChannel: vscode.OutputChannel;
    private debugMode: boolean = false;

    constructor(channelName: string = 'CommitHelper') {
        this.outputChannel = vscode.window.createOutputChannel(channelName);
    }

    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
        this.log(`调试模式: ${enabled ? '开启' : '关闭'}`);
    }

    isDebugMode(): boolean {
        return this.debugMode;
    }

    /**
     * 记录普通日志
     */
    log(message: string, data?: any): void {
        if (!this.debugMode && !message.includes('错误')) {
            return; // 非调试模式只输出错误
        }

        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);

        if (data !== undefined) {
            try {
                this.outputChannel.appendLine(JSON.stringify(data, null, 2));
            } catch (error) {
                this.outputChannel.appendLine(`[JSON序列化失败]: ${String(data)}`);
            }
        }

        // 在调试模式下同时输出到控制台
        if (this.debugMode) {
            console.log(`[${timestamp}] ${message}`, data);
        }
    }

    /**
     * 记录错误日志（总是输出）
     */
    error(message: string, error?: any): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] 错误: ${message}`);

        if (error !== undefined) {
            if (error instanceof Error) {
                this.outputChannel.appendLine(`  ${error.message}`);
                if (error.stack) {
                    this.outputChannel.appendLine(`  ${error.stack}`);
                }
            } else {
                try {
                    this.outputChannel.appendLine(JSON.stringify(error, null, 2));
                } catch {
                    this.outputChannel.appendLine(String(error));
                }
            }
        }

        console.error(`[${timestamp}] ${message}`, error);
    }

    /**
     * 显示输出频道
     */
    show(): void {
        this.outputChannel.show();
    }

    /**
     * 清空日志
     */
    clear(): void {
        this.outputChannel.clear();
    }

    /**
     * 销毁日志器
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}
