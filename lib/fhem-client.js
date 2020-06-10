"use strict";
const http = require("http");
const https = require("https");
const url_1 = require("url");
const assert = require("assert");
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
        this.getOptions = { headers: { Connection: 'keep-alive' }, rejectUnauthorized: false };
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
        this.getOptions = { ...this.getOptions, ...options.getOptions };
        delete options.getOptions;
        if (options.retryIntervals)
            for (const codeAndInterval of options.retryIntervals)
                this.retryIntervalFromCode.set(codeAndInterval[0], codeAndInterval[1]);
        delete options.retryIntervals;
        this.fhemOptions = options;
        if (logger)
            this.logger = logger;
        else {
            const dummyFn = () => { };
            for (const fnName of ['log', 'debug', 'info', 'warn', 'error'])
                this.logger[fnName] = dummyFn;
        }
        this.client = this.url.protocol === 'https:' ? https : http;
        if (options.username && options.password) {
            this.url.username = options.username;
            this.url.password = options.password;
        }
        this.url.searchParams.set('XHR', '1');
    }
    callFn(name, functionName, passDevHash, functionReturnsHash, ...args) {
        return this.callAndRetry(this.callFn_, name, functionName, passDevHash, functionReturnsHash, ...args);
    }
    callFn_(name, functionName, passDevHash, functionReturnsHash, ...args) {
        const logger = this.logger;
        const error = this.error.bind(this);
        logger.info(`callFn: Invoking ${functionName}() of FHEM device ${name} with arguments`, ['<device hash>', ...args]);
        const useStatement = "use Scalar::Util 'looks_like_number'";
        let translateUndefined;
        let invocation;
        const processRet = `!defined($ret[0])?'undef':'['.join(',',map(looks_like_number($_)?$_:"'$_'",@ret)).']'`;
        if (args.length) {
            const argsStr = args.map(arg => typeof arg === 'number' ? arg : `"${arg}"`).join(',');
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
        return this.execPerlCode__(code, true).then(ret => {
            if (ret === 'undef')
                return;
            let retArray;
            try {
                retArray = JSON.parse(ret);
            }
            catch (e) {
                error(`callFn: Failed to invoke ${functionName}() of FHEM device ${name}: ${ret}.`, 'CF_FHEMERR');
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
        return this.execPerlCode__(code, false);
    }
    execPerlCode__(code, calledByCallFn) {
        return this.callAndRetry(this.execPerlCode_, code, calledByCallFn);
    }
    execPerlCode_(code, calledByCallFn) {
        return this.execCmd__(`{ ${code} }`, calledByCallFn);
    }
    execCmd(cmd) {
        return this.execCmd__(cmd, false);
    }
    execCmd__(cmd, calledByCallFn) {
        return this.callAndRetry(this.execCmd_, cmd, calledByCallFn);
    }
    execCmd_(cmd, calledByCallFn) {
        const logger = this.logger;
        const url = this.url;
        const error = this.error.bind(this);
        if (!url.searchParams.get('fwcsrf')) {
            return this.obtainCsrfToken()
                .then(token => {
                if (token)
                    url.searchParams.set('fwcsrf', token);
                return this.execCmd_(cmd, calledByCallFn);
            });
        }
        logger.log(calledByCallFn ? 'debug' : 'info', `execCmd: Executing FHEM command '${cmd}'...`);
        url.searchParams.set('cmd', cmd);
        let body = '';
        return this.getWithPromise((res, resolve, reject) => {
            switch (res.statusCode) {
                case 200:
                    res.on('data', chunk => body += chunk).on('end', () => {
                        body = body.replace(/\n+$/, '');
                        logger.debug(`execCmd: Request succeeded. Response: '${body}'`);
                        const number = Number(body);
                        resolve(isNaN(number) ? body : number);
                    });
                    break;
                case 400:
                    if (url.searchParams.has('fwcsrf')) {
                        logger.debug('execCmd: CSRF token no longer valid, updating token and reissuing request.');
                        url.searchParams.set('fwcsrf', res.headers['x-fhem-csrftoken']);
                        this.execCmd_(cmd, calledByCallFn)
                            .then(result => resolve(result), e => reject(e));
                    }
                    else {
                        error(`execCmd: Failed to execute FHEM command '${cmd}': Obviously, this FHEMWEB does use a CSRF token, but it doesn't send it.`, 'NOTOKEN', reject);
                    }
                    break;
                default:
                    this.handleStatusCode(res, `execCmd: Failed to execute FHEM command '${cmd}'`, reject);
            }
        });
    }
    obtainCsrfToken() {
        const logger = this.logger;
        return this.getWithPromise((res, resolve, reject) => {
            let token = res.headers['x-fhem-csrftoken'];
            if (!token)
                token = '';
            switch (res.statusCode) {
                case 400:
                    logger.warn('execCmd: Got 400 when obtaining CSRF token. This should not happen!');
                case 200:
                    if (token)
                        logger.debug('execCmd: Obtained CSRF token');
                    else
                        logger.warn("execCmd: No CSRF token received. Either this FHEMWEB doesn't use it, or it doesn't send it. We will see...");
                    resolve(token);
                    break;
                default:
                    this.handleStatusCode(res, 'execCmd: Failed to get CSRF token', reject);
            }
        });
    }
    handleStatusCode(res, messagePrefix, reject) {
        const error = this.error.bind(this);
        switch (res.statusCode) {
            case 401:
                error(`${messagePrefix}: Wrong username or password.`, 'AUTH', reject);
                break;
            case 302:
                error(`${messagePrefix}: Wrong FHEM 'webname' in ${this.fhemOptions.url}.`, 'WEBN', reject);
                break;
            default:
                error(`${messagePrefix}: Status: ${res.statusCode}, message: '${res.statusMessage}'.`, '', reject);
        }
    }
    getWithPromise(processResponse) {
        const logger = this.logger;
        const error = this.error.bind(this);
        return new Promise((resolve, reject) => {
            const req = this.client.get(this.url, this.getOptions, res => {
                req.removeAllListeners('timeout');
                res.on('error', e => error(`execCmd: Response error: Code: ${getErrorCode(e)}, message: ${e.message}`, 'RES', reject)).on('aborted', () => error('execCmd: Response closed prematurely.', 'ABRT', reject)).on('close', () => logger.debug('execCmd: Connection closed.'));
                processResponse(res, resolve, reject);
            }).on('error', e => {
                const code = getErrorCode(e);
                logger.debug(`execCmd: Request error: Code: ${code}, message: ${e.message}`);
                switch (code) {
                    case 'ETIMEDOUT':
                        error(`execCmd: Connecting to ${this.fhemOptions.url} timed out.`, 'TIMEDOUT', reject);
                        break;
                    case 'ECONNREFUSED':
                        error(`execCmd: Connection to ${this.fhemOptions.url} refused.`, 'CONNREFUSED', reject);
                        break;
                    case 'ENETUNREACH':
                        error(`execCmd: Cannot connect to ${this.fhemOptions.url}: Network is unreachable.`, 'NETUNREACH', reject);
                        break;
                    case 'ECONNRESET':
                        if (this.reqAborted) {
                            this.reqAborted = false;
                            error(`execCmd: Connecting to ${this.fhemOptions.url} timed out.`, 'TIMEDOUT', reject);
                            break;
                        }
                        error(`execCmd: Connection reset by ${this.url.host}. Check if '${this.url.protocol}' is the right protocol.`, 'CONNRESET', reject);
                        break;
                    default:
                        error(`execCmd: Request failed: Code: ${code}, message: ${e.message}`, 'REQ', reject);
                }
            }).on('timeout', () => {
                logger.debug('Aborting request because timeout value set by user exceeded.');
                this.reqAborted = true;
                req.abort();
            });
        });
    }
    error(message, codeSuff, reject) {
        this.logger.error(message);
        const e = new ErrorWithCode(message, `EFHEMCL_${codeSuff}`);
        if (reject)
            reject(e);
        else
            throw e;
    }
    async callAndRetry(method, ...args) {
        const expirationTime = this.expirationPeriod > 0 ? Date.now() + this.expirationPeriod : undefined;
        let retryInterval;
        let retry = false;
        let result;
        do {
            result = await method.apply(this, args)
                .catch(e => {
                assert(e instanceof ErrorWithCode);
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
            if (retry)
                await sleep(retryInterval);
            else
                return result;
        } while (retry);
    }
}
module.exports = FhemClient;
//# sourceMappingURL=fhem-client.js.map