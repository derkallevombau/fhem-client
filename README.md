<a name="FhemClient"></a>

## FhemClient
A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.
Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.

**Kind**: global class

* [FhemClient](#FhemClient)
    * [new FhemClient(options, [logger])](#new_FhemClient_new)
    * [.callFn(name, functionName, [passDevHash], [functionReturnsHash], ...args)](#FhemClient+callFn) ⇒ <code>Promise.&lt;(string\|number\|void\|Array.&lt;(string\|number)&gt;\|Map.&lt;(string\|number), (string\|number)&gt;)&gt;</code>
    * [.execPerlCode(code)](#FhemClient+execPerlCode) ⇒ <code>Promise.&lt;(string\|number)&gt;</code>
    * [.execCmd(cmd)](#FhemClient+execCmd) ⇒ <code>Promise.&lt;(string\|number)&gt;</code>

<a name="new_FhemClient_new"></a>

### new FhemClient(options, [logger])
Creates and initialises an instance of FhemClient.

**Throws**:

- <code>Error</code> with code 'EFHEMCL_INVLURL' in case `options.url` is not a valid url string.


| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> |  |
| options.url | <code>string</code> | The URL of the desired FHEMWEB instance: 'http[s]://host:port/webname'. |
| options.username | <code>string</code> | Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance. |
| options.password | <code>string</code> | Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance. |
| [logger] | <code>Logger</code> | You can pass any logger instance as long as it provides the methods log(level, ...args), debug(), info(), warn() and error(). |

**Example**
```js
const FhemClient = require('fhem-client');
const fhemClient = new FhemClient({ url: 'https://localhost:8083/fhem', username: 'thatsme', password: 'topsecret' });

fhemClient.execCmd('set lamp on').then(() => console.log('Succeeded'), e => console.log('Failed:', e));
fhemClient.execCmd('get hub currentActivity').then(result => console.log('Current activity:', result), e => console.log('Failed:', e));
```
<a name="FhemClient+callFn"></a>

### fhemClient.callFn(name, functionName, [passDevHash], [functionReturnsHash], ...args) ⇒ <code>Promise.&lt;(string\|number\|void\|Array.&lt;(string\|number)&gt;\|Map.&lt;(string\|number), (string\|number)&gt;)&gt;</code>
Request FHEMWEB to call a registered module function. This method corresponds to FHEM's Perl function 'CallFn'.

**Kind**: instance method of [<code>FhemClient</code>](#FhemClient)
**Returns**: <code>Promise.&lt;(string\|number\|void\|Array.&lt;(string\|number)&gt;\|Map.&lt;(string\|number), (string\|number)&gt;)&gt;</code> - A `Promise` that will be resolved
with the result on success or rejected with one of the following errors.

If the function cannot be found in the module hash or returns undef, the result will be undefined.

If the function returns a scalar or a list, the result will be a value or an array, respectively.
Furthermore, if the list is even-sized and `functionReturnsHash === true`, the result will be a Map.

In either case, numbers will be returned as numbers, not as strings.
**Throws**:

- <code>Error</code> with code 'EFHEMCL_RES' in case of response error.
- <code>Error</code> with code 'EFHEMCL_ABRT' in case the response closed prematurely.
- <code>Error</code> with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
- <code>Error</code> with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
- <code>Error</code> with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
- <code>Error</code> with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
- <code>Error</code> with code 'EFHEMCL_REQ' in case of a different request error.
- <code>Error</code> with code 'EFHEMCL_AUTH' in case of wrong username or password.
- <code>Error</code> with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
- <code>Error</code> with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.
- <code>Error</code> with code 'EFHEMCL_CF_FHEMERR' in case FHEM returned an error message instead of the function's
return value, e. g. if `functionName` exists in the module hash, but the corresponding value names a function
that doesn't exist.
- <code>Error</code> with code 'EFHEMCL_CF_ODDLIST' in case `functionReturnsHash === true` and the function returned
an odd-sized list.


| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | The name of the device to call the function for. |
| functionName | <code>string</code> | The name of the function as used to register it in the module hash. |
| [passDevHash] | <code>boolean</code> | Whether the ref to the instance hash of the device should be passed to the function as first argument. Defaults to `false`. |
| [functionReturnsHash] | <code>boolean</code> | Whether the function returns a hash that should be transformed into a Map. Defaults to `false`. If the function returns a hash (literal, no ref), which is just an even-sized list, you must indicate this. Failing to do so will give you an array of key/value pairs. On the other hand, if you provide true for this and the function returns an odd-sized list, the `Promise` will be rejected. This parameter is meaningless if the function returns a scalar. |
| ...args | <code>string</code> \| <code>number</code> | The arguments to be passed to the function. If an argument is `undefined`, the function will get Perl's undef for that argument. |

<a name="FhemClient+execPerlCode"></a>

### fhemClient.execPerlCode(code) ⇒ <code>Promise.&lt;(string\|number)&gt;</code>
Request FHEMWEB to execute Perl code.

**Kind**: instance method of [<code>FhemClient</code>](#FhemClient)
**Returns**: <code>Promise.&lt;(string\|number)&gt;</code> - A `Promise` that will be resolved
with the result in its actual data type on success
or rejected with one of the following errors.
**Throws**:

- <code>Error</code> with code 'EFHEMCL_RES' in case of response error.
- <code>Error</code> with code 'EFHEMCL_ABRT' in case the response closed prematurely.
- <code>Error</code> with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
- <code>Error</code> with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
- <code>Error</code> with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
- <code>Error</code> with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
- <code>Error</code> with code 'EFHEMCL_REQ' in case of a different request error.
- <code>Error</code> with code 'EFHEMCL_AUTH' in case of wrong username or password.
- <code>Error</code> with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
- <code>Error</code> with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.


| Param | Type | Description |
| --- | --- | --- |
| code | <code>string</code> | A string containing valid Perl code. Be sure to use ';;' to separate multiple statements. |

<a name="FhemClient+execCmd"></a>

### fhemClient.execCmd(cmd) ⇒ <code>Promise.&lt;(string\|number)&gt;</code>
Request FHEMWEB to execute a FHEM command.

**Kind**: instance method of [<code>FhemClient</code>](#FhemClient)
**Returns**: <code>Promise.&lt;(string\|number)&gt;</code> - A `Promise` that will be resolved
with the result in its actual data type on success
or rejected with one of the following errors.
**Throws**:

- <code>Error</code> with code 'EFHEMCL_RES' in case of response error.
- <code>Error</code> with code 'EFHEMCL_ABRT' in case the response closed prematurely.
- <code>Error</code> with code 'EFHEMCL_TIMEDOUT' in case connecting timed out.
- <code>Error</code> with code 'EFHEMCL_CONNREFUSED' in case the connection has been refused.
- <code>Error</code> with code 'EFHEMCL_NETUNREACH' in case the network is unreachable.
- <code>Error</code> with code 'EFHEMCL_CONNRESET' in case the connection has been reset by peer.
- <code>Error</code> with code 'EFHEMCL_REQ' in case of a different request error.
- <code>Error</code> with code 'EFHEMCL_AUTH' in case of wrong username or password.
- <code>Error</code> with code 'EFHEMCL_WEBN' in case of a wrong FHEM 'webname'.
- <code>Error</code> with code 'EFHEMCL_NOTOKEN' in case FHEMWEB does use but not send the CSRF Token.


| Param | Type | Description |
| --- | --- | --- |
| cmd | <code>string</code> | The FHEM command to execute |
