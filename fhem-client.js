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
 * A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.
 * Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.
 * @example
 * const FhemClient = require('fhem-client');
 * const fhemClient = new FhemClient({ url: 'https://localhost:8083/fhem', username: 'thatsme', password: 'topsecret' });
 *
 * fhemClient.execCmd('set lamp on').then(() => console.log('Succeeded'), e => console.log('Failed:', e));
 * fhemClient.execCmd('get hub currentActivity').then(result => console.log('Current activity:', result), e => console.log('Failed:', e));
 */
class FhemClient
{
	/**
	 * Creates and initialises an instance of FhemClient.
	 * @param {object} options
	 * @param {string} options.url The URL of the desired FHEMWEB instance: 'http[s]://host:port/webname'
	 * @param {string} options.username Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance
	 * @param {string} options.password Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance
	 * @param {Logger} [logger] You can pass any logger instance as long as it provides the methods log(level, ...args), debug(), info(), warn() and error().
	 */
	constructor(options, logger)
	{
		this.logger = logger ? logger : { log: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
		this.fhem   = options;

		this.url    = new URL(options.url);
		this.client = this.url.protocol === 'https:' ? https : http; // Yes, Node.js forces the user to select the appropriate module. // Not putting the ternary if inside one 'require()' for VS Code's type inference to work.

		if (options.username && options.password)
		{
			this.url.username = options.username;
			this.url.password = options.password;
		}

		this.url.searchParams.set('XHR', '1'); // We just want the result of the command, not the whole page.

		this.getOptions = { headers: { Connection: 'keep-alive' }, rejectUnauthorized: false };
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
	 * On the other hand, if you provide true for this and the function returns a scalar or an odd-sized list, the `Promise` will be rejected.
	 * @param {...string | number} args The arguments to be passed to the function.
	 * If an argument is `undefined`, the function will get Perl's undef for that argument.
	 * @returns {Promise<string | number | void | Array<string | number> | Map<string | number, string | number>>} A `Promise` that will be resolved
	 * with the result on success or rejected with an `Error` object with code 'EFHEMCL'.
	 *
	 * If the function cannot be found in the module hash or returns undef, the result will be undefined.
	 *
	 * If the function returns a scalar or a list, the result will be a value or an array, respectively.
	 * Furthermore, if the list is even-sized and `functionReturnsHash === true`, the result will be a Map.
	 *
	 * In either case, numbers will be returned as numbers, not as strings.
	 */
	callFn(name, functionName, passDevHash, functionReturnsHash, ...args)
	{
		const { logger, error } = this;

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
				catch (e)
				{
					const message = `callFn: Failed to invoke ${functionName}() of FHEM device ${name}: ${ret}.`;

					logger.error(message);
					throw error(message);
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
						const message = 'callFn: Cannot create a Map from an odd-sized list.';

						logger.error(message);
						throw error(message);
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
	 * or rejected with an `Error` object with code 'EFHEMCL'.
	 */
	execPerlCode(code, calledByCallFn)
	{
		return this.execCmd(`{ ${code} }`, calledByCallFn);
	}

	/**
	 * Request FHEMWEB to execute a FHEM command.
	 * @param {string} cmd The FHEM command to execute
	 * @param {boolean} [calledByCallFn] Used internally.
	 * @returns {Promise<string | number>} A `Promise` that will be resolved
	 * with the result in its actual data type on success
	 * or rejected with an `Error` object with code 'EFHEMCL'.
	 */
	execCmd(cmd, calledByCallFn)
	{
		const { logger, url, error } = this; // '{ a, b, ... } = obj;' is short for 'a = obj.a; b = obj.b; ...'

		// No token => Obtain it and call this method again.
		if (!url.searchParams.get('fwcsrf')) return this.obtainCsrfToken().then(
			token =>
			{
				if (token) url.searchParams.set('fwcsrf', token);

				return this.execCmd(cmd);
			}
		);

		logger.log(calledByCallFn ? 'debug' : 'info', `execCmd: Executing FHEM command '${cmd}'...`);

		url.searchParams.set('cmd', cmd);

		let body = '';

		return this.getWithPromise(
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
							const message = `execCmd: Failed to execute FHEM command '${cmd}': Obviously, this FHEMWEB does use a CSRF token, but it doesn't send it.`;

							logger.error(message);
							reject(error(message));
						}

						break;
					case 401: // Authentication error
					{
						const message = `execCmd: Failed to execute FHEM command '${cmd}': Wrong username or password.`;

						logger.error(message);
						reject(error(message));

						break;
					}
					default:
					{
						const message = `execCmd: Failed to execute FHEM command '${cmd}': Status: ${res.statusCode}, message: '${res.statusMessage}'.`;

						logger.error(message);
						reject(error(message));
					}
				}
			}
		);
	}

	/**
	 * Obtains the CSRF token, if any, from FHEMWEB without causing a "FHEMWEB WEB CSRF error".
	 * @returns {Promise<string>} A `Promise` that will be resolved
	 * with the token or an empty string on success
	 * or rejected with an `Error` object with code 'EFHEMCL'.
	 * @ignore
	 */
	obtainCsrfToken()
	{
		const { logger, error } = this;

		return this.getWithPromise(
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
					case 401: // Authentication error
					{
						const message = 'execCmd: Failed to get CSRF token: Wrong username or password.';

						logger.error(message);
						reject(error(message));

						break;
					}
					default:
					{
						const message = `execCmd: Failed to get CSRF token: Status: ${res.statusCode}, message: '${res.statusMessage}'.`;

						logger.error(message);
						reject(error(message));
					}
				}
			}
		);
	}

	// For jsdoc2md
	// * @param {function(http.IncomingMessage, function(any?): void, function(any?): void): void} processResponse

	/**
	 * Wraps a call to `this.client.get()` in a `Promise`.
	 * Handler that will be called on server response with the response object,
	 * as well as the two functions to resolve or reject the `Promise`.
	 * @param {(res: http.IncomingMessage, resolve: (value?: any) => void, reject: (reason?: any) => void) => void} processResponse
	 * @returns {Promise<any>} A `Promise` that will be resolved by `processResponse` on success
	 * or rejected by `processResponse`, the request listener or the response listener
	 * with an `Error` object with code 'EFHEMCL'.
	 * @private
	 * @ignore
	 */
	getWithPromise(processResponse)
	{
		const { logger, error } = this;

		return new Promise(
			(resolve, reject) =>
			{
				this.client.get(this.url, this.getOptions,
					res =>
					{
						res.on('error',
							e =>
							{
								const message = `execCmd: Response error: ${e.message}.`;

								logger.error(message);
								reject(error(message));
							}
						);

						res.on('aborted',
							() =>
							{
								const message = 'execCmd: Response closed prematurely.';

								logger.error(message);
								reject(error(message));
							}
						);

						res.on('close', () => logger.debug('execCmd: Connection closed.'));

						processResponse(res, resolve, reject);
					}
				).on('error',
					e =>
					{
						const message = `execCmd: Request failed: ${e.message}.`;

						logger.error(message);
						reject(error(message));
					}
				);
			}
		);
	}

	/**
	 * Returns an `Error` object constructed
	 * with `message` and code property set to 'EFHEMCL'.
	 * @param {string} message
	 * @private
	 * @ignore
	 */
	error(message)
	{
		const e = new Error(message);
		// @ts-ignore
		e.code = 'EFHEMCL';

		return e;
	}}

module.exports = FhemClient;
