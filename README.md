# NEKTE TypeScript SDK

> Client and server packages for the NEKTE agent-to-agent coordination protocol.

## Packages

| Package | Description |
|---|---|
| `@nekte/client` | Transport port, HTTP/gRPC adapters, discovery cache, streaming + cancel, task lifecycle |
| `@nekte/server` | Capability registry, task registry (DDD), HTTP/WS/gRPC transports, auth, SSE + gRPC streaming |

## Install

```bash
npm install @nekte/client  # for consuming agents
npm install @nekte/server  # for serving agents
```

Both packages depend on `@nekte/core` from the [protocol](https://github.com/nekte-protocol/protocol) repo.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm demo        # Two-agent end-to-end demo
pnpm benchmark   # Token comparison benchmarks
```

## License

MIT
