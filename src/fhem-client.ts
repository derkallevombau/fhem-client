/*
 * fhem-client.ts
 * Author: derkallevombau
 * Created: Oct 04, 2019
 */

// eslint-plugin-tsdoc is useful when transforming JSDoc comments to TSDoc,
// but it complains about backslashes used for line breaks, even though this
// is valid Markdown syntax. Furthermore, it doesn't know typedoc's @linkcode.
// Instead of removing it, I just disable it when it shows merely pointless warnings.
/* eslint-disable tsdoc/syntax */

// N.B.: Although https://github.com/microsoft/tsdoc/blob/master/spec/code-snippets/DeclarationReferences.ts
// states that {@link (FhemClient:constructor)} is the way to refer to the ctor, neither ApiExtractor nor typedoc
// recognise that reference, even though MS states that the devs of these tools are involved in the development
// of MS' TSDoc standard.
// On the other hand, {@link FhemClient.constructor} works as expected with typedoc, whereas the spec says this
// wouldn't reference the ctor, but a regular member whose name is "constructor".

/**
 * A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.\
 * Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.
 *
 * It provides the methods `execCmd`, `execPerlCode` and `callFn` to interact with FHEM.\
 * See the [full documentation](https://derkallevombau.github.io/fhem-client/) for details.
 *
 * ## Changelog
 * - 0.1.9: Fixed tsc error "Cannot find module 'src/logger-iface' or its corresponding type declarations"
 *          when compiling a project that imports fhem-client.
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
import { URL } from 'url';
import { strict as assert } from 'assert';

import { Logger, logLevels } from './logger-iface';

interface FhemOptions
{
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

interface Options extends FhemOptions
{
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

/**
 * Returns a `Promise<void>` that will be resolved after `ms` millis.
 * @param ms - Time in millis.
 * @internal
*/
function sleep(ms: number): Promise<void>
{
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** @internal */
class ErrorWithCode extends Error
{
	code: string;

	constructor(message: string, code: string)
	{
		super(message);

		this.code = code;
	}
}

/** @internal */
function getErrorCode(e: any)
{
	const code = (e as ErrorWithCode).code;

	if (!code)
	{
		throw new Error(`'code' doesn't exist. 'message': ${(e as Error).message}`);
	}

	return code;
}

class FhemClient
{
	/**
	 * FHEM URL, username and password.
	 * @internal
	 */
	private fhemOptions: FhemOptions;

	/**
	 * Default request options for http[s].request.
	 * @internal
	 */
	private reqOptions: http.RequestOptions | https.RequestOptions = { method: 'GET' };

	/** @internal */
	private retryIntervalFromCode = new Map(
		[
			['EFHEMCL_RES', 500],
			['EFHEMCL_ABRT', 500],
			['EFHEMCL_TIMEDOUT', 1000],
			['EFHEMCL_CONNREFUSED', 10000],
			['EFHEMCL_NETUNREACH', 10000]
		]
	);

	/** @internal */
	private logger: Logger;
	/** @internal */
	private url: URL;

	// typeof is crucial here since http and
	// https are modules.
	/** @internal */
	private client: typeof http | typeof https;

	// For debugging only.
	/** @internal */
	private localPort: number;
	/** @internal */
	private lastSocket;

	/**
	 * Time in millis after which to discard a failed request.\
	 * If this has been set to a positive value and a request fails, then, if the respective error code has a positive
	 * retry interval, it will be reissued after the specified time until it succeeds or `expirationPeriod` is exceeded.\
	 * If set to 0 (the default), a failed request will be discarded immediately and an `Error` will be thrown.
	 * See property {@linkcode Options.retryIntervals} of `options` param of {@linkcode FhemClient.constructor}.
	 */
	expirationPeriod = 0;

	/**
	 * Creates and initialises an instance of FhemClient.
	 * @param options - An `object` specifying FHEM- and request-related settings.
	 * @param logger - You can pass any logger instance as long as it provides the methods `log(level, ...args)`, `debug`, `info`, `warn` and `error`.
	 * @throws `Error` with code 'EFHEMCL_INVLURL' in case `options.url` is not a valid url string.
	 */
	constructor(options: Options, logger?: Logger)
	{
		try
		{
			this.url = new URL(options.url);
		}
		catch (e)
		{
			if (getErrorCode(e) === 'ERR_INVALID_URL') this.error(`'${options.url}' is not a valid URL.`, 'INVLURL');
		}

		// Merge user-provided get options with defaults and remove from 'options'.
		// N.B.: If options.getOptions is undefined, it just won't contribute anyting ('{ ...undefined } === { }').
		this.reqOptions = { ...this.reqOptions, ...options.getOptions };
		delete options.getOptions;

		// If using SSL, accept self-signed certificate.
		if (this.url.protocol === 'https:') (this.reqOptions as https.RequestOptions).rejectUnauthorized = false;

		// Merge user-provided agent options with defaults and remove from 'options'.
		const agentOptions = { keepAlive: true, maxSockets: 1, ...options.agentOptions };
		delete options.agentOptions;

		// Merge user-provided retry intervals with defaults and remove from 'options'.
		if (options.retryIntervals)
			for (const codeAndInterval of options.retryIntervals)
				this.retryIntervalFromCode.set(codeAndInterval[0], codeAndInterval[1]);
		delete options.retryIntervals;

		// Remaining entries are FHEM options.
		this.fhemOptions = options;

		this.client = this.url.protocol === 'https:' ? https : http; // Yes, Node.js forces the user to select the appropriate module.

		// Create and set agent for requests
		this.reqOptions.agent = new this.client.Agent(agentOptions);

		if (options.username && options.password)
		{
			this.url.username = options.username;
			this.url.password = options.password;
		}

		this.url.searchParams.set('XHR', '1'); // We just want the result of the command, not the whole page.

		if (logger) this.logger = logger;
		else
		{
			// Use dummy logger if no logger provided.

			const dummyFn = () => { /* Nothing to do. */ };

			for (const fnName of ['log', ...logLevels]) this.logger[fnName] = dummyFn;
		}
	}

	// /**
	//  * If you have enabled `keepAlive` (the default), call this method when you do not
	//  * need to make any further requests.\
	//  * This will destroy any sockets that are currently in use by the agent.\
	//  * If you miss calling this method, your program will keep running until the server
	//  * terminates the connection.
	//  */
	// closeConnection(): void
	// {
	// 	(this.reqOptions.agent as http.Agent).destroy();

	// 	this.logger.info('closeConnection: Called Agent.destroy().');
	// }

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
	callFn(name: string, functionName: string, passDevHash?: boolean, functionReturnsHash?: boolean, ...args: (string | number | boolean)[]): Promise<string | number | void | (string | number)[] | Map<string | number, string | number>>
	{
		const logger = this.logger;

		// N.B.: 'const error = this.error;' doesn't work for methods referring to 'this'
		// themselves: When calling the method via the variable, 'this' inside the method's
		// body will be undefined since the method wasn't called on 'this'.
		// Instead, we can use bind() to set the object the method will be called on:
		const error = this.error.bind(this);

		logger.info(`callFn: Invoking ${functionName}() of FHEM device ${name} with arguments`, ['<device hash>', ...args]); // Using spread operator to merge arrays

		// Build Perl code string.

		const useStatement = "use Scalar::Util 'looks_like_number'";
		let translateUndefined: string;
		let invocation: string;
		// Nothing to interpolate, but we don't need to escape quotes.
		// eslint-disable-next-line @typescript-eslint/quotes
		const processRet = `!defined($ret[0])?'undef':'['.join(',',map(looks_like_number($_)?$_:"'$_'",@ret)).']'`;

		if (args.length)
		{
			// Using double quotes for string args since they could contain single quotes.
			// N.B.: args must be of type '(string | number)[]', not 'string[] | number[]'. // Oh, really?! ;)
			//       While the former is an array whose elements can be both strings and numbers,
			//       the latter is either an array of strings or an array of numbers.
			//       In the latter case, the map method has a very "funny" signature...
			const argsStr = args.map(
				arg =>
				{
					switch (typeof arg)
					{
						case 'number': return arg;
						case 'boolean': return arg ? 1 : '';
						case 'string': return `"${arg}"`;
					}
				}
			).join(',');

			if (argsStr.includes('undefined')) // No regex matching needed, it's just a string.
			{
				// Replace string "undefined" resulting from passing an undefined arg to this method
				// with Perl's undef. This can be done in Perl code only.
				// We use map on a list created from argsStr and get a Perl array we must pass to CallFn.
				translateUndefined = `my @args=map(($_ eq 'undefined'?undef:$_),(${argsStr}))`;

				invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}},@args)` : `CallFn('${name}','${functionName}',@args)`;
			}
			else invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}},${argsStr})` : `CallFn('${name}','${functionName}',${argsStr})`;
		}
		else invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}})` : `CallFn('${name}','${functionName}')`;

		const code = translateUndefined ? `${useStatement};;${translateUndefined};;my @ret=${invocation};;${processRet}` : `${useStatement};;my @ret=${invocation};;${processRet}`;

		// Execute it.

		return this.execPerlCode_(code, true).then(
			ret => // Either 'undef' or an array in JSON (see 'processRet'), or an FHEM error message.
			{
				if (ret === 'undef') return;

				let retArray: (string | number)[];

				try
				{
					// We assume ret is an array in JSON, hence a string.
					// But since TS merely knows it is of type string | number,
					// we need to use a Type Assertion here to tell TS that
					// it is a string for sure.
					// Since we got a new rule (@typescript-eslint/no-unsafe-assignment),
					// we must also assert that JSON.parse returns the expected type, not 'any'.
					retArray = JSON.parse(ret as string) as (string | number)[];
				}
				catch (e) // ret must be an error message from FHEM.
				{
					error(`callFn: Failed to invoke ${functionName} of FHEM device ${name}: ${ret as string}.`, 'CF_FHEMERR');
				}

				if (retArray.length === 1) return retArray[0];

				if (functionReturnsHash)
				{
					if (retArray.length % 2 === 0) // Even-sized list => Transform into a Map.
					{
						const map = new Map<string | number, string | number>();

						for (let i = 0; i < retArray.length; i += 2) map.set(retArray[i], retArray[i + 1]);

						return map;
					}
					else
					{
						error('callFn: Cannot create a Map from an odd-sized list.', 'CF_ODDLIST');
					}
				}

				return retArray;
			}
		);
	}

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
	execPerlCode(code: string): Promise<string | number | void>
	{
		return this.execPerlCode_(code, false);
	}

	/** @internal */
	private execPerlCode_(code: string, calledInternally: boolean)
	{
		// Log as debug if we have been called internally
		// since the method called by the user has already created a log entry.
		this.logger.log(calledInternally ? 'debug' : 'info', `execPerlCode: Executing '${code}'...`);

		// 'callAndRetry' calls the provided method via 'apply', so there is no problem.
		// eslint-disable-next-line @typescript-eslint/unbound-method
		return this.callAndRetry(this.execCmd_, `{ ${code} }`, true);
	}

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
	execCmd(cmd: string): Promise<string | number | void>
	{
		// await this.execPerlCode('"FHEMWEB instances:\n" . join("\n", map { /WEB_+/ ? $_ : () } keys %defs)')
		// 	.then(r => this.logger.debug(r));

		// 'callAndRetry' calls the provided method via 'apply', so there is no problem.
		// eslint-disable-next-line @typescript-eslint/unbound-method
		return this.callAndRetry(this.execCmd_, cmd, false);
	}

	/** @internal */
	private execCmd_(cmd: string, calledInternally: boolean): Promise<string | number>
	{
		const logger = this.logger;
		const url = this.url;
		const error = this.error.bind(this);

		// Log as debug if we have been called internally
		// since the method called by the user has already created a log entry.
		logger.log(calledInternally ? 'debug' : 'info', `execCmd: Executing FHEM command '${cmd}'...`);

		url.searchParams.set('cmd', cmd);

		let body = '';

		return this.getWithPromise<string | number>(
			(res, resolve, reject) =>
			{
				switch (res.statusCode)
				{
					case 200:
						res.on('data',
							chunk => body += chunk
						).on('end',
							() =>
							{
								// FHEMWEB appends a newline to the result, remove it.
								// In case an error message is returned, it already contains a newline.
								body = body.replace(/\n+$/, '');

								logger.debug(`execCmd: Request succeeded. Response: '${body.length > 50 ? body.slice(0, 50) + '...' : body}'`);

								// If we got a number, return it as such.
								const number = Number(body);
								resolve(isNaN(number) ? body : number);
							}
						);

						break;
					case 400: // No or invalid CSRF token when requesting execution of 'cmd'
						if (!res.headers['x-fhem-csrftoken']) // We didn't get a token, but it is needed.
						{
							error(`execCmd: Failed to execute FHEM command '${cmd}': Obviously, this FHEMWEB does use a CSRF token, but it doesn't send it.`, 'NOTOKEN', reject);
						}
						else // We got a token => Use it.
						{
							if (url.searchParams.has('fwcsrf'))
							{
								logger.info('execCmd: CSRF token no longer valid, updating token and reissuing request...');
							}
							else
							{
								logger.info('execCmd: CSRF token needed, reissuing request with token...');
							}

							// Workaround: Oddly, the socket isn't reused for the next request;
							// instead, it is closed when FHEMWEB closes the connection after some time,
							// so we destroy it for a new socket to be created immediately.
							// N.B.: We are using just one socket. This workaround has to be applied merely one;
							// subsequent requests will use the existing socket.
							res.socket.destroy();

							// Set the (new) token which FHEM has sent us in the response...
							// N.B.: The elements of res.headers['foo'] are of type string[].
							//       But since we know that the CSRF token is a single string,
							//       we use a Type Assertion here.
							url.searchParams.set('fwcsrf', res.headers['x-fhem-csrftoken'] as string);

							// ...and signal 'callAndRetry' to call this method again immediately
							// by resolving the Promise with 'undefined'.
							resolve(undefined);

						}

						break;
					case 401: // Authentication error
						error(`execCmd: Failed to execute FHEM command '${cmd}': Wrong username or password.`, 'AUTH', reject);

						break;
					case 302: // Found => Wrong webname
						error(`execCmd: Failed to execute FHEM command '${cmd}': Wrong FHEM 'webname' in ${this.fhemOptions.url}.`, 'WEBN', reject);

						break;
					default:
						error(`execCmd: Failed to execute FHEM command '${cmd}': Status: ${res.statusCode}, message: '${res.statusMessage}'.`, '', reject);
				}
			}
		);
	}

	/**
	 * Wraps a call to `this.client.get` in a `Promise<R>`.
	 * @template R The type of the value that will be passed to `resolve`.
	 * @param processResponse -
	 * A callback that will be called on server response with the response object,\
	 * as well as the two functions to `resolve` or `reject` the `Promise`.
	 * @returns A `Promise<R>` that will be resolved by `processResponse` on success\
	 * or rejected by `processResponse`, the request 'error' listener or a response listener\
	 * with one of the following errors.
	 * @throws `Error` with code 'EFHEMCL_RES' in case of response error.
	 * @throws `Error` with code 'EFHEMCL_ABRT' in case the response closed prematurely.
	 * @throws `Error` with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
	 * @throws `Error` with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
	 * @throws `Error` with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
	 * @throws `Error` with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
	 * @throws `Error` with code 'EFHEMCL_REQ' in case of a different request error.
	 * @internal
	 */
	// N.B.: The specified return type causes a Promise<R> to be constructed.
	private getWithPromise<R>(processResponse: (res: http.IncomingMessage, resolve: (value?: R) => void, reject: (reason?: any) => void) => void): Promise<R>
	{
		const logger = this.logger;
		const error  = this.error.bind(this);

		return new Promise(
			(resolve, reject) =>
			{
				// Added type so it known inside the lambda.
				const req: http.ClientRequest = this.client.request(this.url, this.reqOptions,
					res =>
					{
						// Remove 'timeout' listener as soon as we receive a response.
						req.removeAllListeners('timeout');

						res.on('error',
							e => error(`getWithPromise: Response error: Code: ${getErrorCode(e)}, message: ${e.message}`, 'RES', reject)
						).on('aborted',
							() => error('getWithPromise: Response closed prematurely.', 'ABRT', reject)
						).on('close',
							() => logger.debug(`getWithPromise: Connection (local port ${this.localPort}) closed.`)
						);

						logger.debug(`getWithPromise: Server HTTP Version: ${res.httpVersion}`);
						// logger.debug(`getWithPromise: Server response headers:\n${JSON.stringify(res.headers, undefined, 4)}`);

						processResponse(res, resolve, reject);
					}
				).on('error',
					e =>
					{
						const code = getErrorCode(e);

						switch (code)
						{
							case 'ETIMEDOUT': // Either because of 'timeout' option or the built-in timeout.
								error(`getWithPromise: Connecting to ${this.fhemOptions.url} timed out.`, 'TIMEDOUT', reject);
								break;
							case 'ECONNREFUSED':
								error(`getWithPromise: Connection to ${this.fhemOptions.url} refused.`, 'CONNREFUSED', reject);
								break;
							case 'ENETUNREACH':
								error(`getWithPromise: Cannot connect to ${this.fhemOptions.url}: Network is unreachable.`, 'NETUNREACH', reject);
								break;
							case 'ECONNRESET':
								error(`getWithPromise: Connection reset by ${this.url.host}. Check if '${this.url.protocol}' is the right protocol.`, 'CONNRESET', reject);
								break;
							default:
								error(`getWithPromise: Request failed: Code: ${code}, message: ${e.message}`, 'REQ', reject);
						}
					}
				).on('timeout',
					() =>
					{
						// N.B.: - Setting RequestOptions.timeout merely generates this event when the specified time has elapsed;
						//         the request must be aborted manually.
						//       - This event is emitted even after the response has been received.
						//       - This event will not be emitted after the 'error' event has been emitted.

						logger.info('getWithPromise: Aborting request because timeout value set by user exceeded.');

						// This triggers the 'error' event with the appropriate error code.
						req.destroy(new ErrorWithCode('', 'ETIMEDOUT'));
					}
				).on('socket',
					socket =>
					{
						if (socket === this.lastSocket)
						{
							logger.debug(`getWithPromise: Reusing socket (local port ${socket.localPort}) from last request.`);
						}
						else // Add listeners only if this is a new socket.
						{
							socket.on('connect',
								() =>
								{
									logger.debug(`getWithPromise: New socket (local port ${socket.localPort}) connected.`);

									// Save localPort as this property will be undefined in 'close' event.
									this.localPort = socket.localPort;

									// It is sufficient to save the last socket since we restricted the max number
									// of sockets to 1 via Agent option 'maxSockets'. TODO: Explain why this one socket may change!
									this.lastSocket = socket;
								}
							).on('close',
								() => logger.debug(`getWithPromise: Socket (local port ${this.localPort}) closed.`)
							).on('end',
								() => logger.debug(`getWithPromise: Socket (local port ${socket.localPort}): end.`)
							);
						}
					}
				);

				// logger.debug(`getWithPromise: RequestHeaders:\n${JSON.stringify(req.getHeaders(), undefined, 4)}`);

				req.end();
			}
		);
	}

	/**
	 * Logs `message` as error if it is a nonempty string, constructs an `Error` object with `message`
	 * and `code` 'EFHEMCL_<codeSuff>'.\
	 * Then, if `reject` function supplied, it is called with the `Error` object;\
	 * otherwise, the `Error` is thrown.
	 * @param message - The error message.
	 * @param codeSuff - `string` string to be appended to 'EFHEMCL_' to form the error code.
	 * @param reject - The function to reject the `Promise`.
	 * @internal
	 */
	private error(message: string, codeSuff: string, reject?: (reason?: any) => void)
	{
		if (message) this.logger.error(message);

		const e = new ErrorWithCode(message, `EFHEMCL_${codeSuff}`);

		if (reject) reject(e);
		else throw e;
	}

	/**
	 * Invokes `method` on `this` with `args`.\
	 * On error, if `expirationPeriod` property has been set to a positive value
	 * and we have a positive retry interval for the respective error code, the method
	 * will be invoked again after the specified time until it returns without error
	 * or `expirationPeriod` is exceeded.\
	 * If the latter occurs, the last error will be thrown.
	 * @param method - Instance method to be invoked.
	 * @param args - Arguments for `method`.
	 * @internal
	 */
	// Type params A and R copied from CallableFunction.apply (see tsconfig.json "strictBindCallApply").
	private async callAndRetry<A extends any[], R>(method: (...args: A) => Promise<R>, ...args: A)
	{
		const expirationTime = this.expirationPeriod > 0 ? Date.now() + this.expirationPeriod : undefined;
		let retry: boolean;

		do
		{
			let retryInterval: number;
			let noSleep = false;

			retry = false;

			// 'apply' is similar to 'bind', but instead of returning a bound function
			// that can be called later on, it calls the function immediately and returns
			// the result.
			const result = await method.apply(this, args)
				.catch(
					e =>
					{
						assert(e instanceof ErrorWithCode, `Library error: ${(e as Error).stack}`);

						// Thanks to “assertion signatures” (since TS 3.7; see declaration of Node.js' assert function),
						// e: any is treated as ErrorWithCode by TS for the rest of the scope.

						if (expirationTime && this.retryIntervalFromCode.has(e.code))
						{
							retryInterval = this.retryIntervalFromCode.get(e.code);

							if (retryInterval > 0 && Date.now() + retryInterval < expirationTime) // Request must not expire before actually being sent.
							{
								this.logger.info(`Retrying in ${retryInterval} ms...`);

								retry = true;
							}
							else throw e; // Retry not desired or request expired => rethrow error.
						}
						else throw e; // Retry not desired => rethrow error.
					}
				);

			if (result === undefined)
			{
				noSleep = retry = true;
			}

			if (retry)
			{
				if (!noSleep) await sleep(retryInterval);
			}
			else return result;
		}
		while (retry);
	}
}

/**
 * This results in `module.exports = FhemClient;` in the js output,
 * as it was before I migrated to TypeScript, so in JS projects,
 * it can be imported like before.
 * In TS, the `import x = require()` form must be used.
 */
export = FhemClient;
