A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.\
Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.

It provides the methods `execCmd`, `execPerlCode` and `callFn` to interact with FHEM.\
See the [full documentation](https://derkallevombau.github.io/fhem-client/) for details.

## Changelog
- 0.1.4:
    - Retry on error via
        - Property `Options.retryIntervals` of `options` param of `FhemClient.constructor`.
        - Property `FhemClient.expirationPeriod`
    - Specify agent options via property `Options.agentOptions` of `options` param of
      `FhemClient.constructor`.<br>
    - Uses the same socket for each request.
    - Type definitions (.d.ts) included.
    - Completely rewritten in TypeScript, targeting ES2020.
- 0.1.2: Specify request options for http[s].get via property `Options.getOptions` of
  `options` param of `FhemClient.constructor`.<br>
  Especially useful to set a request timeout. There is a built-in timeout, but that's pretty long.<br>
  FYI: Setting RequestOptions.timeout merely generates an event when the specified time has elapsed,
  but we actually abort the request.
- 0.1.1: Added specific error codes instead of just 'EFHEMCL'.

## Example
### Import
#### TypeScript
```typescript
import FhemClient = require('fhem-client');
```
#### JavaScript
```js
const FhemClient = require('fhem-client');
```
### Usage
```typescript
const fhemClient = new FhemClient(
    {
        url: 'https://localhost:8083/fhem',
        username: 'thatsme',
        password: 'topsecret',
        getOptions: { timeout: 2000 }
    }
);

fhemClient.expirationPeriod = 20000;

async function example()
{
	await fhemClient.execCmd('get hub currentActivity')
		.then(
			result => console.log('Current activity:', result),
			// Like below, but in plain JS.
			// You may also write it like this in TS with the following directive for @typescript-eslint, in case you are using it:
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions
			e => console.log(`Error: Message: ${e.message}, code: ${e.code}`)
		);

	await fhemClient.execPerlCode('join("\n", map("Device: $_, type: $defs{$_}{TYPE}", keys %defs))')
		.then(
			(result: string) => console.log(`Your devices:\n${result}`),
			// This is correct TS code:
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
			(e: Error) => console.log(`Error: Message: ${e.message}, code: ${(e as any).code as string}`)
		);

	// Notify your companion device that your server application is shutting down
	// by calling its function 'serverEvent' with arguments <device hash>, 'ServerStateChanged', 'ShuttingDown'.
	await fhemClient.callFn('myDevice', 'serverEvent', true, false, 'ServerStateChanged', 'ShuttingDown');
}

void example()
```
