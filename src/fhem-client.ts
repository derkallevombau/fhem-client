/**
 * @file fhem-client.js
 * Created on: Oct 04, 2019
 * @author derkallevombau
 */

const http  = require('http');
const https = require('https');

/**
 * @typedef { (level: string, ...args: any[]) => void } LogMethod
 */
/**
 * @typedef { (message: any, ...args: any[]) => void } LoggerLevelMethod
 */
/**
 * Logger interface
 * @typedef {{ log: LogMethod, debug: LoggerLevelMethod, info: LoggerLevelMethod, warn: LoggerLevelMethod, error: LoggerLevelMethod }} Logger
 */

/**
 * Returns a `Promise` that will be resolved after `ms` millis.
 * @param {number} ms
 * @ignore
 */
function sleep(ms)
{
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.
 * Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.
 *
 * New since 0.1.4: Retry on error. See ctor param `options.retryIntervals` and property `expirationPeriod`.
 * New since 0.1.2: Specify options for http[s].get() via ctor param `options.getOptions`.
 *
 * @example
 * const FhemClient = require('fhem-client');
 * const fhemClient = new FhemClient(
 * 	{
 * 		url: 'https://localhost:8083/fhem',
 * 		username: 'thatsme',
 * 		password: 'topsecret',
 * 		getOptions: { timeout: 5000 }
 * 	}
 * );
 *
 * fhemClient.expirationPeriod = 10000;
 *
 * fhemClient.execCmd('set lamp on').then(
 * 	() => console.log('Succeeded'),
 * 	e  => console.log(`Error: Message: ${e.message}, code: ${e.code}`)
 * );
 *
 * fhemClient.execCmd('get hub currentActivity').then(
 * 	result => console.log('Current activity:', result),
 * 	e      => console.log(`Error: Message: ${e.message}, code: ${e.code}`)
 * );
 */
class FhemClient
{
	/**
	 * FHEM URL, username and password.
	 * @type FhemOptions
	 * @typedef {object} FhemOptions
	 * @property {string} FhemOptions.url
	 * @property {string} FhemOptions.username
	 * @property {string} FhemOptions.password
	 * @private
	 * @ignore
	 */
	#fhemOptions;

	/**
	 * @type https.RequestOptions
	 * @private
	 * @ignore
	 */
	#getOptions = { headers: { Connection: 'keep-alive' }, rejectUnauthorized: false };

	/**
	 * @private
	 * @ignore
	 */
	#retryIntervalFromCode = new Map(
		[
			['EFHEMCL_RES', 500],
			['EFHEMCL_ABRT', 500],
			['EFHEMCL_TIMEDOUT', 1000],
			['EFHEMCL_CONNREFUSED', 10000],
			['EFHEMCL_NETUNREACH', 10000]
		]
	);

	/**
	 * @type Logger
	 * @private
	 * @ignore
	 */
	#logger;

	/**
	 * @type URL
	 * @private
	 * @ignore
	 */
	#url

	/**
	 * @type http | https
	 * @private
	 * @ignore
	 */
	#client

	/**
	 * Time in millis after which to discard a failed request.
	 * See ctor parameter `options.retryIntervals`.
	 * @default 0
	 * @type number
	 * @public
	 */
	expirationPeriod = 0;

	/**
	 * Creates and initialises an instance of FhemClient.
	 * @param {object} options
	 * @param {string} options.url The URL of the desired FHEMWEB instance: 'http[s]://host:port/webname'.
	 * @param {string} options.username Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance.
	 * @param {string} options.password Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance.
	 * @param {https.RequestOptions} [options.getOptions] Options for http[s].get().
	 * Defaults to `{ headers: { Connection: 'keep-alive' }, rejectUnauthorized: false }`.
	 * If you specify additional options, they will be merged with the defaults. If you specify an option that has a default
	 * value, your value will override the default. This also means that if you specify an object for `headers`, it will
	 * completely replace the default one. If you specify `timeout`, it will work as expected.
	 * @param {Array<[string, number]>} [options.retryIntervals] An array whose elements are arrays containing an error code
	 * and a retry interval in millis.
	 * If `expirationPeriod` property has been set to a positive value and a request fails, then, if the respective error code has a positive
	 * retry interval, it will be reissued after the specified time until it succeeds or expires.
	 * Some errors already have a default retry interval; you can use this parameter to override defaults and to set retry intervals
	 * for errors that do not have a default one.
	 * @param {Logger} [logger] You can pass any logger instance as long as it provides the methods log(level, ...args), debug(), info(), warn() and error().
	 * @throws {Error} with code 'EFHEMCL_INVLURL' in case `options.url` is not a valid url string.
	 */
	constructor(options, logger)
	{
		try
		{
			this.#url = new URL(options.url);
		}
		catch (e)
		{
			if (e.code === 'ERR_INVALID_URL') this.#error(`'${options.url}' is not a valid URL.`, 'INVLURL');
		}

		// Merge user-provided get options with defaults and remove from 'options'.
		// N.B.: If options.getOptions is undefined, it just won't contribute anyting ('{ ...undefined } === { }').
		this.#getOptions = { ...this.#getOptions, ...options.getOptions };
		delete options.getOptions;

		// Merge user-provided retry intervals with defaults and remove from 'options'.
		if (options.retryIntervals)
			for (const codeAndInterval of options.retryIntervals)
				this.#retryIntervalFromCode.set(codeAndInterval[0], codeAndInterval[1]);
		delete options.retryIntervals;

		// Remaining entries are FHEM options.
		this.#fhemOptions = options;

		if (logger) this.#logger = logger;
		else
		{
			// Use dummy logger if no logger provided.

			const dummyFn = () => {};
			// @ts-ignore
			this.#logger = {};

			for (const fnName of ['log', 'debug', 'info', 'warn', 'error']) this.#logger[fnName] = dummyFn;
		}

		this.#client = this.#url.protocol === 'https:' ? https : http; // Yes, Node.js forces the user to select the appropriate module. // Not putting the ternary if inside one 'require()' for VS Code's type inference to work.
		// this.#client = this.#url.protocol === 'https:' ? https : http; // Yes, Node.js forces the user to select the appropriate module. // Not putting the ternary if inside one 'require()' for VS Code's type inference to work.

		if (options.username && options.password)
		{
			this.#url.username = options.username;
			this.#url.password = options.password;
		}

		this.#url.searchParams.set('XHR', '1'); // We just want the result of the command, not the whole page.
	}

	/**
	 * Request FHEMWEB to call a registered module function. This method corresponds to FHEM's Perl function 'CallFn'.
	 * @param {string} name The name of the device to call the function for.
	 * @param {string} functionName The name of the function as used to register it in the module hash.
	 * @param {boolean} [passDevHash] Whether the ref to the instance hash of the device should be passed to the function as first argument. Defaults to `false`.
	 * @param {boolean} [functionReturnsHash] Whether the function returns a hash that should be transformed into a Map. Defaults to `false`.
	 *
	 * If the function returns a hash (literal, no ref), which is just an even-sized list, you must indicate this.
	 * Failing to do so will give you an array of key/value pairs.
	 *
	 * On the other hand, if you provide true for this and the function returns an odd-sized list, the `Promise` will be rejected.
	 * This parameter is meaningless if the function returns a scalar.
	 * @param {...string | number} args The arguments to be passed to the function.
	 * If an argument is `undefined`, the function will get Perl's undef for that argument.
	 * @returns {Promise<string | number | void | Array<string | number> | Map<string | number, string | number>>} A `Promise` that will be resolved
	 * with the result on success or rejected with one of the following errors.
	 *
	 * If the function cannot be found in the module hash or returns undef, the result will be undefined.
	 *
	 * If the function returns a scalar or a list, the result will be a value or an array, respectively.
	 * Furthermore, if the list is even-sized and `functionReturnsHash === true`, the result will be a Map.
	 *
	 * In either case, numbers will be returned as numbers, not as strings.
	 * @throws {Error} with code 'EFHEMCL_RES' in case of response error (default retry interval: 500 ms).
	 * @throws {Error} with code 'EFHEMCL_ABRT' in case the response closed prematurely (default retry interval: 500 ms).
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT' in case connecting timed out (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH' in case the network is unreachable (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
	 * @throws {Error} with code 'EFHEMCL_REQ' in case of a different request error.
	 * @throws {Error} with code 'EFHEMCL_AUTH' in case of wrong username or password.
	 * @throws {Error} with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
	 * @throws {Error} with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
	 * @throws {Error} with code 'EFHEMCL_CF_FHEMERR' in case FHEM returned an error message instead of the function's
	 * return value, e. g. if `functionName` exists in the module hash, but the corresponding value names a function
	 * that doesn't exist.
	 * @throws {Error} with code 'EFHEMCL_CF_ODDLIST' in case `functionReturnsHash === true` and the function returned
	 * an odd-sized list.
	 */
	callFn(name, functionName, passDevHash, functionReturnsHash, ...args)
	{
		return this.#callAndRetry(this.#callFn_, name, functionName, passDevHash, functionReturnsHash, ...args);
	}

	/**
	 * Actual 'callFn' before implementing retry feature.
	 * Since private methods are not supported yet (Node.js v12.13.1),
	 * we use a private field with a lambda assigned as a workaround
	 * for the time being.
	 * @param {string} name
	 * @param {string} functionName
	 * @param {boolean} [passDevHash]
	 * @param {boolean} [functionReturnsHash]
	 * @param {...string | number} args
	 * @returns {Promise<string | number | void | Array<string | number> | Map<string | number, string | number>>}
	 * @throws {Error} with code 'EFHEMCL_RES'
	 * @throws {Error} with code 'EFHEMCL_ABRT'
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT'
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED'
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH'
	 * @throws {Error} with code 'EFHEMCL_CONNRESET'
	 * @throws {Error} with code 'EFHEMCL_REQ'
	 * @throws {Error} with code 'EFHEMCL_AUTH'
	 * @throws {Error} with code 'EFHEMCL_WEBN'
	 * @throws {Error} with code 'EFHEMCL_NOTOKEN'
	 * @throws {Error} with code 'EFHEMCL_CF_FHEMERR'
	 * @throws {Error} with code 'EFHEMCL_CF_ODDLIST'
	 * @private
	 * @ignore
	 */
	#callFn_ = (name, functionName, passDevHash, functionReturnsHash, ...args) =>
	{
		const logger = this.#logger;

		// N.B.: 'const error = this.#error;' doesn't work for methods referring to 'this'
		// themselves: When calling the method via the variable, 'this' inside the method's
		// body will be undefined since the method wasn't called on 'this'.
		// Instead, we can use bind() to set the object the method will be called on:
		const error = this.#error.bind(this);

		logger.info(`callFn: Invoking ${functionName}() of FHEM device ${name} with arguments`, ['<device hash>', ...args]); // Using spread operator to merge arrays

		let useStatement = "use Scalar::Util 'looks_like_number'";
		let translateUndefined;
		let invocation;
		let processRet = `!defined($ret[0])?'undef':'['.join(',',map(looks_like_number($_)?$_:"'$_'",@ret)).']'`; // Nothing to interpolate, but we don't need to escape quotes.

		if (args.length)
		{
			// Using double quotes for string args since they could contain single quotes.
			const argsStr = args.map(arg => typeof arg === 'number' ? arg : `"${arg}"`).join(',');

			if (argsStr.match('undefined'))
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

		return this.execPerlCode(code, true).then(
			ret => // Either 'undef' or an array in JSON, or an FHEM error message.
			{
				if (ret === 'undef') return;

				let retArray;

				try
				{
					// @ts-ignore
					retArray = JSON.parse(ret);
				}
				catch (e) // ret must be an error message from FHEM.
				{
					error(`callFn: Failed to invoke ${functionName}() of FHEM device ${name}: ${ret}.`, 'CF_FHEMERR');
				}

				if (retArray.length === 1) return retArray[0];

				if (functionReturnsHash)
				{
					if (retArray.length % 2 === 0)
					{
						const map = new Map();

						// @ts-ignore
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
	 * @param {string} code A string containing valid Perl code. Be sure to use ';;' to separate multiple statements.
	 * @param {boolean} [calledByCallFn] Used internally.
	 * @returns {Promise<string | number>} A `Promise` that will be resolved
	 * with the result in its actual data type on success
	 * or rejected with one of the following errors.
	 * @throws {Error} with code 'EFHEMCL_RES' in case of response error (default retry interval: 500 ms).
	 * @throws {Error} with code 'EFHEMCL_ABRT' in case the response closed prematurely (default retry interval: 500 ms).
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT' in case connecting timed out (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH' in case the network is unreachable (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
	 * @throws {Error} with code 'EFHEMCL_REQ' in case of a different request error.
	 * @throws {Error} with code 'EFHEMCL_AUTH' in case of wrong username or password.
	 * @throws {Error} with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
	 * @throws {Error} with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
	 */
	execPerlCode(code, calledByCallFn)
	{
		return this.#callAndRetry(this.#execPerlCode_, code, calledByCallFn);
	}

	/**
	 * @param {string} code
	 * @param {boolean} [calledByCallFn]
	 * @returns {Promise<string | number>}
	 * @throws {Error} with code 'EFHEMCL_RES'
	 * @throws {Error} with code 'EFHEMCL_ABRT'
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT'
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED'
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH'
	 * @throws {Error} with code 'EFHEMCL_CONNRESET'
	 * @throws {Error} with code 'EFHEMCL_REQ'
	 * @throws {Error} with code 'EFHEMCL_AUTH'
	 * @throws {Error} with code 'EFHEMCL_WEBN'
	 * @throws {Error} with code 'EFHEMCL_NOTOKEN'
	 * @private
	 * @ignore
	 */
	#execPerlCode_ = (code, calledByCallFn) =>
	{
		return this.execCmd(`{ ${code} }`, calledByCallFn);
	}

	/**
	 * Request FHEMWEB to execute a FHEM command.
	 * @param {string} cmd The FHEM command to execute
	 * @param {boolean} [calledByCallFn] Used internally.
	 * @returns {Promise<string | number>} A `Promise` that will be resolved
	 * with the result in its actual data type on success
	 * or rejected with one of the following errors.
	 * @throws {Error} with code 'EFHEMCL_RES' in case of response error (default retry interval: 500 ms).
	 * @throws {Error} with code 'EFHEMCL_ABRT' in case the response closed prematurely (default retry interval: 500 ms).
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT' in case connecting timed out (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH' in case the network is unreachable (default retry interval: 10000 ms).
	 * @throws {Error} with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
	 * @throws {Error} with code 'EFHEMCL_REQ' in case of a different request error.
	 * @throws {Error} with code 'EFHEMCL_AUTH' in case of wrong username or password.
	 * @throws {Error} with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
	 * @throws {Error} with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
	 */
	execCmd(cmd, calledByCallFn)
	{
		return this.#callAndRetry(this.#execCmd_, cmd, calledByCallFn);
	}

	/**
	 * @param {string} cmd
	 * @param {boolean} [calledByCallFn]
	 * @returns {Promise<string | number>}
	 * @throws {Error} with code 'EFHEMCL_RES'
	 * @throws {Error} with code 'EFHEMCL_ABRT'
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT'
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED'
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH'
	 * @throws {Error} with code 'EFHEMCL_CONNRESET'
	 * @throws {Error} with code 'EFHEMCL_REQ'
	 * @throws {Error} with code 'EFHEMCL_AUTH'
	 * @throws {Error} with code 'EFHEMCL_WEBN'
	 * @throws {Error} with code 'EFHEMCL_NOTOKEN'
	 * @private
	 * @ignore
	 */
	#execCmd_ = (cmd, calledByCallFn) =>
	{
		const logger = this.#logger;
		const url    = this.#url;
		const error  = this.#error.bind(this);

		// No token => Obtain it and call this method again.
		if (!url.searchParams.get('fwcsrf')) return this.#obtainCsrfToken().then(
			token =>
			{
				if (token) url.searchParams.set('fwcsrf', token);

				return this.#execCmd_(cmd, calledByCallFn);
			}
		);

		logger.log(calledByCallFn ? 'debug' : 'info', `execCmd: Executing FHEM command '${cmd}'...`);

		url.searchParams.set('cmd', cmd);

		let body = '';

		return this.#getWithPromise(
			(res, resolve, reject) =>
			{
				switch (res.statusCode)
				{
					case 200:
						res.on('data', chunk => body += chunk);
						res.on('end',
							() =>
							{
								// FHEMWEB appends a newline to the result, remove it.
								// In case an error message is returned, it already contains a newline.
								body = body.replace(/\n+$/, '');

								logger.debug(`execCmd: Request succeeded. Response: '${body}'`);

								// If we got a number, return it as such.
								const number = Number(body);
								resolve(isNaN(number) ? body : number);
							}
						);

						break;
					case 400: // No or invalid CSRF token when requesting execution of 'cmd'
						if (url.searchParams.has('fwcsrf'))
						{
							logger.debug('execCmd: CSRF token no longer valid, updating token and reissuing request.');

							// @ts-ignore
							url.searchParams.set('fwcsrf', res.headers['x-fhem-csrftoken']);

							this.execCmd(cmd).then(
								body => resolve(body),
								e => reject(e)
							);
						}
						else // We didn't get a token, but it is needed.
						{
							error(`execCmd: Failed to execute FHEM command '${cmd}': Obviously, this FHEMWEB does use a CSRF token, but it doesn't send it.`, 'NOTOKEN', reject);
						}

						break;
					default:
						this.#handleStatusCode(res, `execCmd: Failed to execute FHEM command '${cmd}'`, reject);
				}
			}
		);
	}

	/**
	 * Obtains the CSRF token, if any, from FHEMWEB without causing a "FHEMWEB WEB CSRF error".
	 * @returns {Promise<string>} A `Promise` that will be resolved
	 * with the token or an empty string on success
	 * or rejected with one of the following errors.
	 * @throws {Error} with code 'EFHEMCL_RES' in case of response error.
	 * @throws {Error} with code 'EFHEMCL_ABRT' in case the response closed prematurely.
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
	 * @throws {Error} with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
	 * @throws {Error} with code 'EFHEMCL_REQ' in case of a different request error.
	 * @throws {Error} with code 'EFHEMCL_AUTH' in case of wrong username or password.
	 * @throws {Error} with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
	 * @private
	 * @ignore
	 */
	#obtainCsrfToken = () =>
	{
		const logger = this.#logger;

		return this.#getWithPromise(
			(res, resolve, reject) =>
			{
				let token = res.headers['x-fhem-csrftoken'];
				if (!token) token = '';

				switch (res.statusCode)
				{
					case 400: // No or invalid CSRF token when requesting execution of 'cmd', but we shouldn't have a cmd here.
						logger.warn('execCmd: Got 400 when obtaining CSRF token. This should not happen!');
					// eslint-disable-next-line no-fallthrough
					case 200: // A GET request with correct authentication and without 'cmd' and 'fwcsrf' params gives no error.
						if (token) logger.debug('execCmd: Obtained CSRF token');
						else logger.warn("execCmd: No CSRF token received. Either this FHEMWEB doesn't use it, or it doesn't send it. We will see...");

						resolve(token);

						break;
					default:
						this.#handleStatusCode(res, 'execCmd: Failed to get CSRF token', reject);
				}
			}
		);
	}

	/**
	 * Used by `execCmd` and `obtainCsrfToken' for status codes
	 * which can be handled in a common way.
	 * @param {http.IncomingMessage} res
	 * @param {string} messagePrefix
	 * @param {(reason?: any) => void} reject
	 * @private
	 * @ignore
	 */
	#handleStatusCode = (res, messagePrefix, reject) =>
	{
		const error = this.#error.bind(this);

		switch (res.statusCode)
		{
			case 401: // Authentication error
				error(`${messagePrefix}: Wrong username or password.`, 'AUTH', reject);

				break;
			case 302: // Found => Wrong webname
				error(`${messagePrefix}: Wrong FHEM 'webname' in ${this.#fhemOptions.url}.`, 'WEBN', reject);

				break;
			default:
				error(`${messagePrefix}: Status: ${res.statusCode}, message: '${res.statusMessage}'.`, '', reject);
		}
	}

	/**
	 * Wraps a call to `this.#client.get()` in a `Promise`.
	 * @param {(res: http.IncomingMessage, resolve: (value?: any) => void, reject: (reason?: any) => void) => void} processResponse
	 * Handler that will be called on server response with the response object,
	 * as well as the two functions to resolve or reject the `Promise`.
	 * @returns {Promise<any>} A `Promise` that will be resolved by `processResponse` on success
	 * or rejected by `processResponse`, the request listener or the response listener
	 * with one of the following errors.
	 * @throws {Error} with code 'EFHEMCL_RES' in case of response error.
	 * @throws {Error} with code 'EFHEMCL_ABRT' in case the response closed prematurely.
	 * @throws {Error} with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
	 * @throws {Error} with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
	 * @throws {Error} with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
	 * @throws {Error} with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
	 * @throws {Error} with code 'EFHEMCL_REQ' in case of a different request error.
	 * @private
	 * @ignore
	 */
	#getWithPromise = (processResponse) =>
	{
		const logger = this.#logger;
		const error  = this.#error.bind(this);

		return new Promise(
			(resolve, reject) =>
			{
				const req = this.#client.get(this.#url, this.#getOptions,
					res =>
					{
						// Remove 'timeout' listener as soon as we receive a response.
						req.removeAllListeners('timeout');

						res.on('error',
							// @ts-ignore
							e => error(`execCmd: Response error: Code: ${e.code}, message: ${e.message}`, 'RES', reject)
						);

						res.on('aborted',
							() => error('execCmd: Response closed prematurely.', 'ABRT', reject)
						);

						res.on('close', () => logger.debug('execCmd: Connection closed.'));

						processResponse(res, resolve, reject);
					}
				).on('error',
					e =>
					{
						// @ts-ignore
						logger.debug(`execCmd: Request error: Code: ${e.code}, message: ${e.message}`);

						// @ts-ignore
						switch (e.code)
						{
							case 'ETIMEDOUT': // This has nothing to do with 'timeout' option. There is a built-in timeout, but that's pretty long.
								error(`execCmd: Connecting to ${this.#fhemOptions.url} timed out.`, 'TIMEDOUT', reject);
								break;
							case 'ECONNREFUSED':
								error(`execCmd: Connection to ${this.#fhemOptions.url} refused.`, 'CONNREFUSED', reject);
								break;
							case 'ENETUNREACH':
								error(`execCmd: Cannot connect to ${this.#fhemOptions.url}: Network is unreachable.`, 'NETUNREACH', reject);
								break;
							case 'ECONNRESET':
								if (this.reqAborted)
								{
									this.reqAborted = false;
									error(`execCmd: Connecting to ${this.#fhemOptions.url} timed out.`, 'TIMEDOUT', reject);
									break;
								}

								error(`execCmd: Connection reset by ${this.#url.host}. Check if '${this.#url.protocol}' is the right protocol.`, 'CONNRESET', reject);
								break;
							default:
								// @ts-ignore
								error(`execCmd: Request failed: Code: ${e.code}, message: ${e.message}`, 'REQ', reject);
							}
					}
				).on('timeout',
					() =>
					{
						// N.B.: Setting RequestOptions.timeout merely generates this event when the specified time has elapsed,
						// the request must be aborted manually.
						// Furthermore, this event is emitted even after the response has been received. In this case, aborting
						// the request would not harm, but setting the flag below would result in the next actual ECONNRESET being
						// incorrectly treated as ETIMEOUT. Thus, we remove this listener as soon as we receive a response.
						// This event will not be emitted after the 'error' event has been emitted.

						logger.debug('Aborting request because timeout value set by user exceeded.');

						// Aborting the request results in ECONNRESET, not what the user would expect on a timeout...
						// Thus, we set a flag that causes next ECONNRESET to be treated as ETIMEDOUT.
						this.reqAborted = true;
						req.abort();
					}
				);
			}
		);
	}

	/**
	 * Logs `message` as error, constructs an `Error` object with `message`
	 * and sets its `code` property to 'EFHEMCL_codeSuff'.
	 * Then, if `reject` function supplied, it is called with the `Error` object;
	 * otherwise, the `Error` is thrown.
	 * @param {string} message
	 * @param {string} codeSuff
	 * @param {(reason?: any) => void} [reject]
	 * @private
	 * @ignore
	 */
	#error = (message, codeSuff, reject) =>
	{
		this.#logger.error(message);

		const e = new Error(message);
		// @ts-ignore
		e.code = `EFHEMCL_${codeSuff}`;

		if (reject) reject(e);
		else throw e;
	}

	/**
	 * Invokes `method` on this with `args`.
	 * On error, if `expirationPeriod` property has been set to a positive value
	 * and we have a positive retry interval for the respective error code, the method
	 * will be invoked again after the specified time until it returns without error
	 * or `expirationPeriod` is exceeded.
	 * If the latter occurs, the last error will be thrown.
	 * @param {(...args: any[]) => Promise<any>} method Instance method to be invoked.
	 * @param {...any} args Arguments for `method`.
	 * @private
	 * @ignore
	 */
	#callAndRetry = async (method, ...args) =>
	{
		const expirationTime = this.expirationPeriod > 0 ? Date.now() + this.expirationPeriod : undefined;
		let retryInterval;
		let retry;
		let result;

		while (true)
		{
			retry = false;

			result = await method.apply(this, args).catch(
				e =>
				{
					if (expirationTime && this.#retryIntervalFromCode.has(e.code))
					{
						retryInterval = this.#retryIntervalFromCode.get(e.code);

						if (retryInterval > 0 && Date.now() + retryInterval < expirationTime) // Request must not expire before actually being sent.
						{
							this.#logger.info(`Retrying in ${retryInterval} ms...`);

							retry = true;
						}
						else throw e; // Retry not desired or request expired => rethrow error.
					}
					else throw e; // Retry not desired => rethrow error.
				}
			);

			if (retry) await sleep(retryInterval);
			else return result;
		}
	}
}

module.exports = FhemClient;
