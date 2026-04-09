# @nekte/client

NEKTE protocol client with lazy discovery, zero-schema invocation, and streaming delegation.

## Features

- **Progressive discovery** — L0 catalog (~8 tok/cap), L1 signatures, L2 full schemas
- **Zero-schema cache** — Version hashes eliminate redundant schema transmission
- **Token budget** — Control `max_tokens` and `detail_level` per request
- **Streaming delegation** — SSE-based streaming with cancel support
- **Task lifecycle** — Cancel, suspend, resume, and query task status
- **Multiple transports** — HTTP (default), gRPC (optional), WebSocket

## Install

```bash
pnpm add @nekte/client

# Optional: gRPC transport
pnpm add @grpc/grpc-js @grpc/proto-loader
```

## Usage

```typescript
import { NekteClient } from '@nekte/client';

const client = new NekteClient('http://localhost:4001');

// Progressive discovery
const catalog = await client.catalog();           // L0: ~24 tokens for 3 caps

// Zero-schema invocation with budget
const result = await client.invoke('sentiment', {
  input: { text: 'Great product!' },
  budget: { max_tokens: 50, detail_level: 'minimal' },
});

// Streaming delegation with cancel
const stream = client.delegateStream({
  id: 'task-001',
  desc: 'Analyze 10K reviews',
  timeout_ms: 60_000,
});

for await (const event of stream.events) {
  if (event.event === 'progress') console.log(`${event.data.processed}/${event.data.total}`);
  if (event.event === 'complete') console.log('Done:', event.data.out);
}
```

### gRPC Transport

```typescript
import { NekteClient, createGrpcClientTransport } from '@nekte/client';

const transport = await createGrpcClientTransport({ endpoint: 'localhost:4002' });
const client = new NekteClient('grpc://localhost:4002', { transport });
```

## License

MIT
