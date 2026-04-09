# @nekte/server

NEKTE protocol server — register capabilities, handle delegation, and serve agents.

## Features

- **Capability registry** — Register capabilities with Zod schemas and handlers
- **Task registry** — DDD aggregate root with validated state machine
- **Multiple transports** — HTTP/SSE, WebSocket, gRPC (optional)
- **Streaming delegation** — SSE and gRPC server-streaming with progress events
- **Task lifecycle** — Cancel (AbortSignal), suspend (checkpoint), resume
- **Auth** — Pluggable authentication (bearer, API key, custom)
- **Budget-aware** — Responses respect `max_tokens` and `detail_level`

## Install

```bash
pnpm add @nekte/server

# Optional: gRPC transport
pnpm add @grpc/grpc-js @grpc/proto-loader
```

## Usage

```typescript
import { z } from 'zod';
import { NekteServer } from '@nekte/server';

const server = new NekteServer({ agent: 'nlp-worker' });

server.capability('sentiment', {
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ score: z.number() }),
  category: 'nlp',
  description: 'Analyze text sentiment',
  handler: async (input, ctx) => {
    if (ctx.signal.aborted) throw new Error('Cancelled');
    return { score: 0.9 };
  },
  toMinimal: (out) => `positive ${out.score}`,
});

// Streaming delegate with cancel support
server.onDelegate(async (task, stream, context, signal) => {
  for (let i = 1; i <= 100; i++) {
    if (signal.aborted) return;
    stream.progress(i, 100, `Processing batch ${i}`);
  }
  stream.complete(task.id, { minimal: 'Done' });
});

server.listen(4001);
```

### Adding gRPC

```typescript
import { createGrpcTransport } from '@nekte/server';

const grpc = await createGrpcTransport(server, { port: 4002 });
```

## License

MIT
