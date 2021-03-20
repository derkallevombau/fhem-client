/**
 * logger-iface.ts
 * Author: derkallevombau
 * Created: Mar 03, 2021
 */

/* eslint-disable tsdoc/syntax */

/** @ignore */
type LogMethod = (level: LogLevels, ...args: any[]) => void;

/** @ignore */
type LoggerLevelMethod = (message: any, ...args: any[]) => void;

/**
 * String array of common log levels.
 */
export const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/**
 * String regexp to match a common log level.
 */
export const logLevelRE = '(?:trace|debug|info|warn|error|fatal)';

/**
 * Union type of common log levels.
 */
export type LogLevels = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Interface for a logger providing the usual log methods.
 */
export interface Logger
{
	log: LogMethod;
	trace: LoggerLevelMethod;
	debug: LoggerLevelMethod;
	info : LoggerLevelMethod;
	warn : LoggerLevelMethod;
	error: LoggerLevelMethod;
	fatal: LoggerLevelMethod;
}
