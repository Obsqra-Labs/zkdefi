# @obsqra/sepolia-mm-client

Zero-dependency ESM wrapper around the [market-maker-sim](../../README.md) HTTP API (Starknet Sepolia, Ekubo).

## Usage

```js
import { createClient } from "@obsqra/sepolia-mm-client";

const api = createClient({ baseUrl: "http://localhost:8099" });
const state = await api.publicState();
console.log(state.pools?.length, "pools");
```

## Publish (optional)

From this directory:

```bash
npm publish --access public
```

Until published, depend via git path or `file:` in your app’s `package.json`.
