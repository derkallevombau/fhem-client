/**
 * logger-iface.ts
 * Author: derkallevombau
 * Created: Mar 03, 2021
 */
/** @ignore */
declare type LogMethod = (level: string, ...args: any[]) => void;
/** @ignore */
declare type LoggerLevelMethod = (message: any, ...args: any[]) => void;
/** @ignore */
export default interface Logger {
    log: LogMethod;
    debug: LoggerLevelMethod;
    info: LoggerLevelMethod;
    warn: LoggerLevelMethod;
    error: LoggerLevelMethod;
    fatal: LoggerLevelMethod;
}
export {};
//# sourceMappingURL=logger-iface.d.ts.map