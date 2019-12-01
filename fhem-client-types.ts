/**
 * @file fhem-client-types.ts
 * Created on: Nov 30, 2019
 * @author derkallevombau
 */

import { IncomingMessage } from 'http';

type LogMethod = (level: string, ...args: any[]) => void;
type LoggerLevelMethod = (message: any, ...args: any[]) => void;
export type Logger = { log: LogMethod, debug: LoggerLevelMethod, info: LoggerLevelMethod, warn: LoggerLevelMethod, error: LoggerLevelMethod, fatal: LoggerLevelMethod };

export type RejectFn = (reason?: any) => void;

export type ProcessResponseFn = (res: IncomingMessage, resolve: (value?: any) => void, reject: (reason?: any) => void) => void;
