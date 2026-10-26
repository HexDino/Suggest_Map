import { handle } from '../functions/handler.ts';

Deno.serve({ hostname: '127.0.0.1', port: 8100 }, handle);
