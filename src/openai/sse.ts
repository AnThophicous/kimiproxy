import type { Context } from 'hono';
import { stream as honoStream } from 'hono/streaming';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export interface SseWriter {
  writeData: (payload: unknown) => Promise<void>;
  writeEvent: (event: string, payload: unknown) => Promise<void>;
  writeDone: () => Promise<void>;
  writeComment: (text?: string) => Promise<void>;
  writeError: (message: string, type?: string, code?: string | null) => Promise<void>;
  aborted: () => boolean;
  onAbort: (cb: () => void) => void;
}

export function applySseHeaders(c: Context): void {
  for (const [key, value] of Object.entries(SSE_HEADERS)) {
    c.header(key, value);
  }
}

export function createSseResponse(
  c: Context,
  handler: (writer: SseWriter) => Promise<void>
) {
  applySseHeaders(c);

  return honoStream(c, async (streamWriter) => {
    let aborted = false;
    const abortListeners: Array<() => void> = [];

    streamWriter.onAbort(() => {
      aborted = true;
      for (const cb of abortListeners) {
        try {
          cb();
        } catch {
        }
      }
    });

    const writer: SseWriter = {
      writeData: async (payload: unknown) => {
        if (aborted) return;
        await streamWriter.write(`data: ${JSON.stringify(payload)}\n\n`);
      },
      writeEvent: async (event: string, payload: unknown) => {
        if (aborted) return;
        await streamWriter.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      },
      writeDone: async () => {
        if (aborted) return;
        await streamWriter.write('data: [DONE]\n\n');
      },
      writeComment: async (text = 'ping') => {
        if (aborted) return;
        await streamWriter.write(`: ${text}\n\n`);
      },
      writeError: async (message: string, type = 'server_error', code: string | null = null) => {
        if (aborted) return;
        await streamWriter.write(
          `data: ${JSON.stringify({
            error: { message, type, param: null, code },
          })}\n\n`
        );
      },
      aborted: () => aborted,
      onAbort: (cb: () => void) => {
        abortListeners.push(cb);
      },
    };

    const keepalive = setInterval(() => {
      void writer.writeComment('keepalive');
    }, 15000);
    if (typeof keepalive.unref === 'function') keepalive.unref();

    try {
      await handler(writer);
    } catch (err) {
      if (!aborted) {
        const message = err instanceof Error ? err.message : String(err);
        await writer.writeError(message);
        await writer.writeDone();
      }
    } finally {
      clearInterval(keepalive);
    }
  });
}

export class SequenceCounter {
  private n = 0;
  next(): number {
    return this.n++;
  }
}
