"use strict";
const http = require("http");
const https = require("https");
const url_1 = require("url");
const assert_1 = require("assert");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
class ErrorWithCode extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
function getErrorCode(e) {
    const code = e.code;
    if (!code) {
        throw new Error(`'code' doesn't exist. 'message': ${e.message}`);
    }
    return code;
}
class FhemClient {
    constructor(options, logger) {
        this.reqOptions = { method: 'GET' };
        this.retryIntervalFromCode = new Map([
            ['EFHEMCL_RES', 500],
            ['EFHEMCL_ABRT', 500],
            ['EFHEMCL_TIMEDOUT', 1000],
            ['EFHEMCL_CONNREFUSED', 10000],
            ['EFHEMCL_NETUNREACH', 10000]
        ]);
        this.expirationPeriod = 0;
        try {
            this.url = new url_1.URL(options.url);
        }
        catch (e) {
            if (getErrorCode(e) === 'ERR_INVALID_URL')
                this.error(`'${options.url}' is not a valid URL.`, 'INVLURL');
        }
        this.reqOptions = { ...this.reqOptions, ...options.getOptions };
        delete options.getOptions;
        if (this.url.protocol === 'https:')
            this.reqOptions.rejectUnauthorized = false;
        const agentOptions = { keepAlive: true, maxSockets: 1, ...options.agentOptions };
        delete options.agentOptions;
        if (options.retryIntervals)
            for (const codeAndInterval of options.retryIntervals)
                this.retryIntervalFromCode.set(codeAndInterval[0], codeAndInterval[1]);
        delete options.retryIntervals;
        this.fhemOptions = options;
        this.client = this.url.protocol === 'https:' ? https : http;
        this.reqOptions.agent = new this.client.Agent(agentOptions);
        if (options.username && options.password) {
            this.url.username = options.username;
            this.url.password = options.password;
        }
        this.url.searchParams.set('XHR', '1');
        if (logger)
            this.logger = logger;
        else {
            const dummyFn = () => { };
            for (const fnName of ['log', 'debug', 'info', 'warn', 'error'])
                this.logger[fnName] = dummyFn;
        }
    }
    callFn(name, functionName, passDevHash, functionReturnsHash, ...args) {
        const logger = this.logger;
        const error = this.error.bind(this);
        logger.info(`callFn: Invoking ${functionName}() of FHEM device ${name} with arguments`, ['<device hash>', ...args]);
        const useStatement = "use Scalar::Util 'looks_like_number'";
        let translateUndefined;
        let invocation;
        const processRet = `!defined($ret[0])?'undef':'['.join(',',map(looks_like_number($_)?$_:"'$_'",@ret)).']'`;
        if (args.length) {
            const argsStr = args.map(arg => {
                switch (typeof arg) {
                    case 'number': return arg;
                    case 'boolean': return arg ? 1 : '';
                    case 'string': return `"${arg}"`;
                }
            }).join(',');
            if (argsStr.includes('undefined')) {
                translateUndefined = `my @args=map(($_ eq 'undefined'?undef:$_),(${argsStr}))`;
                invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}},@args)` : `CallFn('${name}','${functionName}',@args)`;
            }
            else
                invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}},${argsStr})` : `CallFn('${name}','${functionName}',${argsStr})`;
        }
        else
            invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}})` : `CallFn('${name}','${functionName}')`;
        const code = translateUndefined ? `${useStatement};;${translateUndefined};;my @ret=${invocation};;${processRet}` : `${useStatement};;my @ret=${invocation};;${processRet}`;
        return this.execPerlCode_(code, true).then(ret => {
            if (ret === 'undef')
                return;
            let retArray;
            try {
                retArray = JSON.parse(ret);
            }
            catch (e) {
                error(`callFn: Failed to invoke ${functionName} of FHEM device ${name}: ${ret}.`, 'CF_FHEMERR');
            }
            if (retArray.length === 1)
                return retArray[0];
            if (functionReturnsHash) {
                if (retArray.length % 2 === 0) {
                    const map = new Map();
                    for (let i = 0; i < retArray.length; i += 2)
                        map.set(retArray[i], retArray[i + 1]);
                    return map;
                }
                else {
                    error('callFn: Cannot create a Map from an odd-sized list.', 'CF_ODDLIST');
                }
            }
            return retArray;
        });
    }
    execPerlCode(code) {
        return this.execPerlCode_(code, false);
    }
    execPerlCode_(code, calledInternally) {
        this.logger.log(calledInternally ? 'debug' : 'info', `execPerlCode: Executing '${code}'...`);
        return this.callAndRetry(this.execCmd_, `{ ${code} }`, true);
    }
    execCmd(cmd) {
        return this.callAndRetry(this.execCmd_, cmd, false);
    }
    execCmd_(cmd, calledInternally) {
        const logger = this.logger;
        const url = this.url;
        const error = this.error.bind(this);
        logger.log(calledInternally ? 'debug' : 'info', `execCmd: Executing FHEM command '${cmd}'...`);
        url.searchParams.set('cmd', cmd);
        let body = '';
        return this.getWithPromise((res, resolve, reject) => {
            switch (res.statusCode) {
                case 200:
                    res.on('data', chunk => body += chunk).on('end', () => {
                        body = body.replace(/\n+$/, '');
                        logger.debug(`execCmd: Request succeeded. Response: '${body.length > 50 ? body.slice(0, 50) + '...' : body}'`);
                        const number = Number(body);
                        resolve(isNaN(number) ? body : number);
                    });
                    break;
                case 400:
                    if (!res.headers['x-fhem-csrftoken']) {
                        error(`execCmd: Failed to execute FHEM command '${cmd}': Obviously, this FHEMWEB does use a CSRF token, but it doesn't send it.`, 'NOTOKEN', reject);
                    }
                    else {
                        if (url.searchParams.has('fwcsrf')) {
                            logger.info('execCmd: CSRF token no longer valid, updating token and reissuing request...');
                        }
                        else {
                            logger.info('execCmd: CSRF token needed, reissuing request with token...');
                        }
                        res.socket.destroy();
                        url.searchParams.set('fwcsrf', res.headers['x-fhem-csrftoken']);
                        resolve(undefined);
                    }
                    break;
                case 401:
                    error(`execCmd: Failed to execute FHEM command '${cmd}': Wrong username or password.`, 'AUTH', reject);
                    break;
                case 302:
                    error(`execCmd: Failed to execute FHEM command '${cmd}': Wrong FHEM 'webname' in ${this.fhemOptions.url}.`, 'WEBN', reject);
                    break;
                default:
                    error(`execCmd: Failed to execute FHEM command '${cmd}': Status: ${res.statusCode}, message: '${res.statusMessage}'.`, '', reject);
            }
        });
    }
    getWithPromise(processResponse) {
        const logger = this.logger;
        const error = this.error.bind(this);
        return new Promise((resolve, reject) => {
            const req = this.client.request(this.url, this.reqOptions, res => {
                req.removeAllListeners('timeout');
                res.on('error', e => error(`getWithPromise: Response error: Code: ${getErrorCode(e)}, message: ${e.message}`, 'RES', reject)).on('aborted', () => error('getWithPromise: Response closed prematurely.', 'ABRT', reject)).on('close', () => logger.debug(`getWithPromise: Connection (local port ${this.localPort}) closed.`));
                logger.debug(`getWithPromise: Server HTTP Version: ${res.httpVersion}`);
                processResponse(res, resolve, reject);
            }).on('error', e => {
                const code = getErrorCode(e);
                switch (code) {
                    case 'ETIMEDOUT':
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
            }).on('timeout', () => {
                logger.info('getWithPromise: Aborting request because timeout value set by user exceeded.');
                req.destroy(new ErrorWithCode('', 'ETIMEDOUT'));
            }).on('socket', socket => {
                if (socket === this.lastSocket) {
                    logger.debug(`getWithPromise: Reusing socket (local port ${socket.localPort}) from last request.`);
                }
                else {
                    socket.on('connect', () => {
                        logger.debug(`getWithPromise: New socket (local port ${socket.localPort}) connected.`);
                        this.localPort = socket.localPort;
                        this.lastSocket = socket;
                    }).on('close', () => logger.debug(`getWithPromise: Socket (local port ${this.localPort}) closed.`)).on('end', () => logger.debug(`getWithPromise: Socket (local port ${socket.localPort}): end.`));
                }
            });
            req.end();
        });
    }
    error(message, codeSuff, reject) {
        if (message)
            this.logger.error(message);
        const e = new ErrorWithCode(message, `EFHEMCL_${codeSuff}`);
        if (reject)
            reject(e);
        else
            throw e;
    }
    async callAndRetry(method, ...args) {
        const expirationTime = this.expirationPeriod > 0 ? Date.now() + this.expirationPeriod : undefined;
        let retry;
        do {
            let retryInterval;
            let noSleep = false;
            retry = false;
            const result = await method.apply(this, args)
                .catch(e => {
                assert_1.strict(e instanceof ErrorWithCode, `Library error: ${e.stack}`);
                if (expirationTime && this.retryIntervalFromCode.has(e.code)) {
                    retryInterval = this.retryIntervalFromCode.get(e.code);
                    if (retryInterval > 0 && Date.now() + retryInterval < expirationTime) {
                        this.logger.info(`Retrying in ${retryInterval} ms...`);
                        retry = true;
                    }
                    else
                        throw e;
                }
                else
                    throw e;
            });
            if (result === undefined) {
                noSleep = retry = true;
            }
            if (retry) {
                if (!noSleep)
                    await sleep(retryInterval);
            }
            else
                return result;
        } while (retry);
    }
}
module.exports = FhemClient;
//# sourceMappingURL=fhem-client.js.map