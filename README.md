A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.\
Uses Node.js http or https module, depending on the protocol specified in the URL; no further dependencies.

## Changelog
- 0.1.4:
    - Retry on error via
        - Property `Options.retryIntervals` of `options` param of `FhemClient.constructor`.
        - Property `FhemClient.expirationPeriod`
    - Type definitions (.d.ts) included.
    - Completely rewritten in TypeScript, targeting ES2020.
- 0.1.2: Specify options for http[s].get via property `Options.getOptions` of `options` param of `FhemClient.constructor`.

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
```js
const fhemClient = new FhemClient(
    {
        url: 'https://localhost:8083/fhem',
        username: 'thatsme',
        password: 'topsecret',
        getOptions: { timeout: 5000 }
    }
);

fhemClient.expirationPeriod = 10000;

fhemClient.execCmd('set lamp on').then(
    () => console.log('Succeeded'),
    e  => console.log(`Error: Message: ${e.message}, code: ${e.code}`)
);

fhemClient.execCmd('get hub currentActivity').then(
    result => console.log('Current activity:', result),
    e      => console.log(`Error: Message: ${e.message}, code: ${e.code}`)
);
```
