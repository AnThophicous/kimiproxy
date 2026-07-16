import test from 'node:test';
import assert from 'node:assert';

process.env.TEST_MOCK_PLAYWRIGHT = 'true';
process.env.API_KEY = '';

import { app } from '../index.ts';
import { encodeConnectRequest } from '../services/kimi.ts';
import { initPlaywright } from '../services/playwright.ts';

function setupFetchMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : 'url' in input ? input.url : String(input);
    if (urlStr.includes('kimi.com')) {
      return handler(urlStr, init);
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('POST /v1/responses non-stream returns response object', async () => {
  await initPlaywright(false);
  const restore = setupFetchMock(() => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(
          encodeConnectRequest({
            op: 'set',
            mask: 'block.text',
            block: { text: { content: 'Hello from responses' } },
          })
        );
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  });

  try {
    const res = await app.fetch(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'k2d6',
          input: 'Hi',
          store: true,
        }),
      })
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.object, 'response');
    assert.strictEqual(body.status, 'completed');
    assert.ok(body.id.startsWith('resp_'));
    assert.ok(Array.isArray(body.output));
    assert.ok(body.output_text.includes('Hello from responses') || body.output.some((o: any) => o.type === 'message'));
  } finally {
    restore();
  }
});

test('POST /v1/responses stream emits semantic SSE events', async () => {
  await initPlaywright(false);
  const restore = setupFetchMock(() => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(
          encodeConnectRequest({
            op: 'set',
            mask: 'block.text',
            block: { text: { content: 'streamed' } },
          })
        );
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  });

  try {
    const res = await app.fetch(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'k2d6',
          input: 'Hi',
          stream: true,
        }),
      })
    );
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('Content-Type')?.includes('text/event-stream'));

    const text = await res.text();
    assert.ok(text.includes('event: response.created'));
    assert.ok(text.includes('event: response.completed') || text.includes('response.output_text.delta'));
  } finally {
    restore();
  }
});

test('previous_response_id and last_response_id chain + GET/DELETE', async () => {
  await initPlaywright(false);
  let call = 0;
  const restore = setupFetchMock(() => {
    call++;
    const content = call === 1 ? 'first turn' : 'second turn';
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(
          encodeConnectRequest({
            op: 'set',
            mask: 'message',
            message: { id: `asst-${call}`, role: 'assistant' },
          })
        );
        c.enqueue(
          encodeConnectRequest({
            op: 'set',
            mask: 'block.text',
            block: { text: { content } },
          })
        );
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  });

  try {
    const r1 = await app.fetch(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'k2d6',
          input: 'hello',
          store: true,
          session_id: 'sess-test-1',
        }),
      })
    );
    const body1 = await r1.json();
    assert.strictEqual(body1.status, 'completed');
    assert.ok(body1.id);

    const getRes = await app.fetch(
      new Request(`http://localhost/v1/responses/${body1.id}`)
    );
    assert.strictEqual(getRes.status, 200);
    const got = await getRes.json();
    assert.strictEqual(got.id, body1.id);

    const r2 = await app.fetch(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'k2d6',
          input: 'again',
          store: true,
          last_response_id: body1.id,
          session_id: 'sess-test-1',
        }),
      })
    );
    const body2 = await r2.json();
    assert.strictEqual(body2.previous_response_id, body1.id);
    assert.strictEqual(body2.status, 'completed');

    const del = await app.fetch(
      new Request(`http://localhost/v1/responses/${body1.id}`, {
        method: 'DELETE',
      })
    );
    assert.strictEqual(del.status, 200);
    const delBody = await del.json();
    assert.strictEqual(delBody.deleted, true);
  } finally {
    restore();
  }
});
