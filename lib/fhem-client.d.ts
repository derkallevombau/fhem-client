/// <reference types="node" />
import * as https from 'https';
interface FhemOptions {
    /**
     * The URL of the desired FHEMWEB instance: 'http[s]://&lt;host&gt;:&lt;port&gt;/webname'.
     */
    url: string;
    /**
     * Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance.
     */
    username: string;
    /**
     * Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance.
     */
    password: string;
}
interface Options extends FhemOptions {
    /**
     * Options for http[s].get.\
     * Defaults to `{ headers: { Connection: 'keep-alive' }, rejectUnauthorized: false }`.\
     * If you specify additional options, they will be merged with the defaults.\
     * If you specify an option that has a default value, your value will override the default.
     * This also means that if you specify an object for `headers`, it will
     * completely replace the default one.\
     * If you specify `timeout`, it will work as expected (i. e. throw an `Error` when a timeout occurs).
     */
    getOptions?: https.RequestOptions;
    /**
     * An array whose elements are arrays containing an error code
     * and a retry interval in millis.\
     * If `expirationPeriod` property has been set to a positive value and a request fails, then, if the respective error code has a positive
     * retry interval, it will be reissued after the specified time until it succeeds or expires.\
     * Some errors already have a default retry interval; you can use this parameter to override defaults and to set retry intervals
     * for errors that do not have a default one.
     *
     * ### Example (the defaults)
     * ```js
     * [
     * 	['EFHEMCL_RES', 500],
     * 	['EFHEMCL_ABRT', 500],
     * 	['EFHEMCL_TIMEDOUT', 1000],
     * 	['EFHEMCL_CONNREFUSED', 10000],
     * 	['EFHEMCL_NETUNREACH', 10000]
     * ]
     * ```
     */
    retryIntervals?: [string, number][];
}
declare class FhemClient {
    /**
     * FHEM URL, username and password.
     */
    private fhemOptions;
    private getOptions;
    private retryIntervalFromCode;
    private logger;
    private url;
    private client;
    /**
     * Flag indicating whether we aborted the current request
     * because it timed out.
     */
    private reqAborted;
    /**
     * Time in millis after which to discard a failed request.
     * See property {@linkcode Options.retryIntervals} of `options` param of {@linkcode FhemClient.constructor}.
     */
    expirationPeriod: number;
    /**
     * Creates and initialises an instance of FhemClient.
     * @param options - An `object` specifying FHEM- and request-related settings.
     * @param logger - You can pass any logger instance as long as it provides the methods `log(level, ...args)`, `debug`, `info`, `warn` and `error`.
     * @throws `Error` with code 'EFHEMCL_INVLURL' in case `options.url` is not a valid url string.
     */
    constructor(options: Options, logger?: Logger);
    /**
     * Request FHEMWEB to call a registered module function. This method corresponds to FHEM's Perl function 'CallFn'.
     * @param name - The name of the device to call the function for.
     * @param functionName - The name of the function as used to register it in the module hash.
     * @param passDevHash - Whether the ref to the instance hash of the device should be passed to the function as first argument. Defaults to `false`.
     * @param functionReturnsHash - Whether the function returns a hash that should be transformed into a Map. Defaults to `false`.
     *
     * If the function returns a hash (literal, no ref), which is just an even-sized list, you must indicate this.\
     * Failing to do so will give you an array of key/value pairs.
     *
     * On the other hand, if you provide true for this and the function returns an odd-sized list, the `Promise` will be rejected.\
     * This parameter is meaningless if the function returns a scalar.
     * @param args - The arguments to be passed to the function.
     * If an argument is `undefined`, the function will get Perl's undef for that argument.
     * @returns A `Promise` that will be resolved with the result on success or rejected with one of the following errors.
     *
     * If the function cannot be found in the module hash or returns undef, the result will be undefined.
     *
     * If the function returns a scalar or a list, the result will be a value or an array, respectively.\
     * Furthermore, if the list is even-sized and `functionReturnsHash === true`, the result will be a Map.
     *
     * In either case, numbers will be returned as numbers, not as strings.
     * @throws `Error` with code 'EFHEMCL_RES' in case of response error (default retry interval: 500 ms).
     * @throws `Error` with code 'EFHEMCL_ABRT' in case the response closed prematurely (default retry interval: 500 ms).
     * @throws `Error` with code 'EFHEMCL_TIMEDOUT' in case connecting timed out (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_NETUNREACH' in case the network is unreachable (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
     * @throws `Error` with code 'EFHEMCL_REQ' in case of a different request error.
     * @throws `Error` with code 'EFHEMCL_AUTH' in case of wrong username or password.
     * @throws `Error` with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
     * @throws `Error` with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
     * @throws `Error` with code 'EFHEMCL_CF_FHEMERR' in case FHEM returned an error message instead of the function's
     * return value, e. g. if `functionName` exists in the module hash, but the corresponding value names a function
     * that doesn't exist.
     * @throws `Error` with code 'EFHEMCL_CF_ODDLIST' in case `functionReturnsHash === true` and the function returned
     * an odd-sized list.
     */
    callFn(name: string, functionName: string, passDevHash?: boolean, functionReturnsHash?: boolean, ...args: (string | number)[]): Promise<string | number | void | (string | number)[] | Map<string | number, string | number>>;
    /**
     * Actual 'callFn' before implementing retry feature.
     */
    private callFn_;
    /**
     * Request FHEMWEB to execute Perl code.
     * @param code - A string containing valid Perl code. Be sure to use ';;' to separate multiple statements.
     * @returns A `Promise` that will be resolved with the result in its actual data type on success or rejected with one of the following errors.
     * @throws `Error` with code 'EFHEMCL_RES' in case of response error (default retry interval: 500 ms).
     * @throws `Error` with code 'EFHEMCL_ABRT' in case the response closed prematurely (default retry interval: 500 ms).
     * @throws `Error` with code 'EFHEMCL_TIMEDOUT' in case connecting timed out (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_NETUNREACH' in case the network is unreachable (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
     * @throws `Error` with code 'EFHEMCL_REQ' in case of a different request error.
     * @throws `Error` with code 'EFHEMCL_AUTH' in case of wrong username or password.
     * @throws `Error` with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
     * @throws `Error` with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
     */
    execPerlCode(code: string): Promise<string | number | void>;
    private execPerlCode__;
    private execPerlCode_;
    /**
     * Request FHEMWEB to execute a FHEM command.
     * @param cmd - The FHEM command to execute
     * @returns A `Promise` that will be resolved with the result in its actual data type on success or rejected with one of the following errors.
     * @throws `Error` with code 'EFHEMCL_RES' in case of response error (default retry interval: 500 ms).
     * @throws `Error` with code 'EFHEMCL_ABRT' in case the response closed prematurely (default retry interval: 500 ms).
     * @throws `Error` with code 'EFHEMCL_TIMEDOUT' in case connecting timed out (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_NETUNREACH' in case the network is unreachable (default retry interval: 10000 ms).
     * @throws `Error` with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
     * @throws `Error` with code 'EFHEMCL_REQ' in case of a different request error.
     * @throws `Error` with code 'EFHEMCL_AUTH' in case of wrong username or password.
     * @throws `Error` with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
     * @throws `Error` with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
     */
    execCmd(cmd: string): Promise<string | number | void>;
    private execCmd__;
    private execCmd_;
    /**
     * Obtains the CSRF token, if any, from FHEMWEB without causing a "FHEMWEB WEB CSRF error".
     * @returns A `Promise<string>` that will be\
     * resolved with the token or an empty string on success\
     * or rejected with one of the following errors.
     * @throws `Error` with code 'EFHEMCL_RES' in case of response error.
     * @throws `Error` with code 'EFHEMCL_ABRT' in case the response closed prematurely.
     * @throws `Error` with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
     * @throws `Error` with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
     * @throws `Error` with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
     * @throws `Error` with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
     * @throws `Error` with code 'EFHEMCL_REQ' in case of a different request error.
     * @throws `Error` with code 'EFHEMCL_AUTH' in case of wrong username or password.
     * @throws `Error` with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
     */
    private obtainCsrfToken;
    /**
     * Used by `execCmd` and `obtainCsrfToken` for status codes
     * which can be handled in a common way.
     * @param res - The server response object.
     * @param messagePrefix - Prefix for error message.
     * @param reject - The function to reject the `Promise`.
     */
    private handleStatusCode;
    /**
     * Wraps a call to `this.client.get` in a `Promise<R>`.
     * @template R The type of the value that will be passed to `resolve`.
     * @param processResponse -
     * A callback that will be called on server response with the response object,\
     * as well as the two functions to `resolve` or `reject` the `Promise`.
     * @returns A `Promise<R>` that will be resolved by `processResponse` on success\
     * or rejected by `processResponse`, the request listener or the response listener\
     * with one of the following errors.
     * @throws `Error` with code 'EFHEMCL_RES' in case of response error.
     * @throws `Error` with code 'EFHEMCL_ABRT' in case the response closed prematurely.
     * @throws `Error` with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
     * @throws `Error` with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
     * @throws `Error` with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
     * @throws `Error` with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
     * @throws `Error` with code 'EFHEMCL_REQ' in case of a different request error.
     */
    private getWithPromise;
    /**
     * Logs `message` as error, constructs an `Error` object with `message`
     * and `code` 'EFHEMCL_<codeSuff>'.\
     * Then, if `reject` function supplied, it is called with the `Error` object;\
     * otherwise, the `Error` is thrown.
     * @param message - The error message.
     * @param codeSuff - `string` string to be appended to 'EFHEMCL_' to form the error code.
     * @param reject - The function to reject the `Promise`.
     */
    private error;
    /**
     * Invokes `method` on `this` with `args`.\
     * On error, if `expirationPeriod` property has been set to a positive value
     * and we have a positive retry interval for the respective error code, the method
     * will be invoked again after the specified time until it returns without error
     * or `expirationPeriod` is exceeded.\
     * If the latter occurs, the last error will be thrown.
     * @param method - Instance method to be invoked.
     * @param args - Arguments for `method`.
     */
    private callAndRetry;
}
/**
 * This results in `module.exports = FhemClient;` in the js output,
 * as it was before I migrated to TypeScript, so in JS projects,
 * it can be imported like before.
 * In TS, the `import x = require()` form must be used.
 */
export = FhemClient;
//# sourceMappingURL=fhem-client.d.ts.map