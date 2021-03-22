/// <reference types="node" />
/**
 * A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.\
 * Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.
 *
 * It provides the methods `execCmd`, `execPerlCode` and `callFn` to interact with FHEM.\
 * See the [full documentation](https://derkallevombau.github.io/fhem-client/) for details.
 *
 * ## Changelog
 * - 0.1.8: {@linkcode FhemClient.callFn} now accepts `boolean` args.
 * - 0.1.4:
 *     - Retry on error via
 *         - Property {@linkcode Options.retryIntervals} of `options` param of {@linkcode FhemClient.constructor}.
 *         - Property {@linkcode FhemClient.expirationPeriod}
 *     - Specify agent options via property {@linkcode Options.agentOptions} of `options` param of
 *       {@linkcode FhemClient.constructor}.<br>
 *     - Uses the same socket for each request.
 *     - Type definitions (.d.ts) included.
 *     - Completely rewritten in TypeScript, targeting ES2020.
 * - 0.1.2: Specify request options for http[s].get via property {@linkcode Options.getOptions} of
 *   `options` param of {@linkcode FhemClient.constructor}.<br>
 *   Especially useful to set a request timeout. There is a built-in timeout, but that's pretty long.<br>
 *   FYI: Setting RequestOptions.timeout merely generates an event when the specified time has elapsed,
 *   but we actually abort the request.
 * - 0.1.1: Added specific error codes instead of just 'EFHEMCL'.
 *
 * ## Examples
 * ### Import
 * #### TypeScript
 * ```typescript
 * import FhemClient = require('fhem-client');
 * ```
 * #### JavaScript
 * ```js
 * const FhemClient = require('fhem-client');
 * ```
 * ### Usage
 * ```typescript
 * const fhemClient = new FhemClient(
 * 	{
 * 		url: 'https://localhost:8083/fhem',
 * 		username: 'thatsme',
 * 		password: 'topsecret',
 * 		getOptions: { timeout: 2000 }
 * 	}
 * );
 *
 * fhemClient.expirationPeriod = 20000;
 *
 * async function example()
 * {
 * 	await fhemClient.execCmd('get hub currentActivity')
 * 		.then(
 * 			result => console.log('Current activity:', result),
 * 			// Like below, but in plain JS.
 * 			// You may also write it like this in TS with the following directive for @typescript-eslint, in case you are using it:
 * 			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions
 * 			e => console.log(`Error: Message: ${e.message}, code: ${e.code}`)
 * 		);
 *
 * 	await fhemClient.execPerlCode('join("\n", map("Device: $_, type: $defs{$_}{TYPE}", keys %defs))')
 * 		.then(
 * 			(result: string) => console.log(`Your devices:\n${result}`),
 * 			// This is correct TS code:
 *			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
 * 			(e: Error) => console.log(`Error: Message: ${e.message}, code: ${(e as any).code as string}`)
 * 		);
 *
 * 	// Notify your companion device that your server application is shutting down
 * 	// by calling its function 'serverEvent' with arguments <device hash>, 'ServerStateChanged', 'ShuttingDown'.
 * 	await fhemClient.callFn('myDevice', 'serverEvent', true, false, 'ServerStateChanged', 'ShuttingDown');
 * }
 *
 * void example()
 * ```
 * @packageDocumentation
 */
import * as http from 'http';
import * as https from 'https';
import { Logger } from './logger-iface';
interface FhemOptions {
    /**
     * The URL of the desired FHEMWEB device: 'http[s]://&lt;host&gt;:&lt;port&gt;/webname'.
     */
    url: string;
    /**
     * Must be supplied if you have enabled Basic Auth for the respective FHEMWEB device.
     */
    username: string;
    /**
     * Must be supplied if you have enabled Basic Auth for the respective FHEMWEB device.
     */
    password: string;
}
interface Options extends FhemOptions {
    /**
     * An object for specifying options for the agent to be used for the requests
     * (See [Node.js API doc](https://nodejs.org/docs/latest-v14.x/api/http.html#http_new_agent_options)).\
     * Defaults to `{ keepAlive: true, maxSockets: 1 }`.\
     * If you specify additional options, they will be merged with the defaults.\
     * If you specify an option that has a default value, your value will override the default.
     */
    agentOptions?: http.AgentOptions | https.AgentOptions;
    /**
     * An object for specifying request options for http[s].request (See [Node.js API doc](https://nodejs.org/docs/latest-v14.x/api/https.html#https_https_request_url_options_callback)).\
     * Defaults to `{ rejectUnauthorized: false }` in case of https to accept self-signed certificates, `{}` otherwise.\
     * If you specify additional options, they will be merged with the defaults.\
     * If you specify an option that has a default value, your value will override the default.\
     * If you specify a `timeout`, it will work as you would expect (i. e. throw an `Error` when a timeout occurs).
     */
    getOptions?: http.RequestOptions | https.RequestOptions;
    /**
     * An array whose elements are arrays containing an error code
     * and a retry interval in millis.\
     * If {@linkcode FhemClient.expirationPeriod} property has been set to a positive value and a request fails, then, if the respective error code has a positive
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
     * Time in millis after which to discard a failed request.\
     * If this has been set to a positive value and a request fails, then, if the respective error code has a positive
     * retry interval, it will be reissued after the specified time until it succeeds or `expirationPeriod` is exceeded.\
     * If set to 0 (the default), a failed request will be discarded immediately and an `Error` will be thrown.
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
     * @param functionReturnsHash - Whether the function returns a hash that should be transformed to a Map. Defaults to `false`.
     *
     * If the function returns a hash (literal, no ref), which is just an even-sized list, you must indicate this.\
     * Failing to do so will give you an array of key/value pairs.
     *
     * On the other hand, if you provide true for this and the function returns an odd-sized list, the `Promise` will be rejected.\
     * This parameter is meaningless if the function returns a scalar.
     * @param args - The arguments to be passed to the function.\
     * If an argument is `undefined`, the function will get Perl's 'undef' for that argument.\
     * If an argument is `true` or `false`, the function will get 1 or "", respectively.
     * @returns A `Promise` that will be resolved with the result on success or rejected with one of the following errors.
     *
     * If the function cannot be found in the module hash or returns 'undef', the result will be `undefined`.
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
     * return value,\
     * e. g. if `functionName` exists in the module hash, but the corresponding value names a function
     * that doesn't exist.
     * @throws `Error` with code 'EFHEMCL_CF_ODDLIST' in case `functionReturnsHash === true` and the function returned
     * an odd-sized list.
     */
    callFn(name: string, functionName: string, passDevHash?: boolean, functionReturnsHash?: boolean, ...args: (string | number | boolean)[]): Promise<string | number | void | (string | number)[] | Map<string | number, string | number>>;
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
}
/**
 * This results in `module.exports = FhemClient;` in the js output,
 * as it was before I migrated to TypeScript, so in JS projects,
 * it can be imported like before.
 * In TS, the `import x = require()` form must be used.
 */
export = FhemClient;
//# sourceMappingURL=fhem-client.d.ts.map