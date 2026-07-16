import type { Context } from 'hono';
import type { OpenAIRequest } from '../domain/types.ts';
import { createSseResponse } from '../openai/sse.ts';
import {
  runChatCompletionNonStream,
  runChatCompletionStream,
} from '../orchestrator/run.ts';
import { statusFromError, toErrorBody } from '../openai/errors.ts';

export async function chatCompletions(c: Context) {
  try {
    const body: OpenAIRequest = await c.req.json();

    if (!body.model) {
      return c.json(
        {
          error: {
            message: 'Missing required parameter: model',
            type: 'invalid_request_error',
            param: 'model',
            code: 'invalid_request_error',
          },
        },
        400
      );
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json(
        {
          error: {
            message: 'Missing required parameter: messages',
            type: 'invalid_request_error',
            param: 'messages',
            code: 'invalid_request_error',
          },
        },
        400
      );
    }

    if (body.stream) {
      return createSseResponse(c, async (writer) => {
        await runChatCompletionStream(body, writer);
      });
    }

    const completion = await runChatCompletionNonStream(body);
    return c.json(completion);
  } catch (err: any) {
    console.error('Error in chatCompletions:', err);
    return c.json(toErrorBody(err), statusFromError(err) as any);
  }
}
