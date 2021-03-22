/**
 * logger-iface.ts
 * Author: derkallevombau
 * Created: Mar 03, 2021
 */
/** @ignore */
declare type LogMethod = (level: LogLevels, ...args: any[]) => void;
/** @ignore */
declare type LoggerLevelMethod = (message: any, ...args: any[]) => void;
/**
 * String array of common log levels.
 * @ignore
 */
export declare const logLevels: string[];
/**
 * String regexp to match a common log level.
 * @ignore
 */
export declare const logLevelRE = "(?:trace|debug|info|warn|error|fatal)";
/**
 * Union type of common log levels.
 * @ignore
 */
export declare type LogLevels = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
/**
 * Interface for a logger providing the usual log methods.
 * @ignore
 */
export interface Logger {
    log: LogMethod;
    trace: LoggerLevelMethod;
    debug: LoggerLevelMethod;
    info: LoggerLevelMethod;
    warn: LoggerLevelMethod;
    error: LoggerLevelMethod;
    fatal: LoggerLevelMethod;
}
export {};
//# sourceMappingURL=logger-iface.d.ts.map