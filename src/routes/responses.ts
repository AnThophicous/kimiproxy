import type { Context } from 'hono';
import type { ResponsesRequest } from '../domain/types.ts';
import { createSseResponse } from '../openai/sse.ts';
import {
  runResponsesNonStream,
  runResponsesStream,
} from '../orchestrator/run.ts';
import { responseStore } from '../store/response-store.ts';
import { notFound, statusFromError, toErrorBody } from '../openai/errors.ts';

export async function createResponse(c: Context) {
  try {
    const body: ResponsesRequest = await c.req.json();

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

    if (body.input == null && !body.previous_response_id && !body.last_response_id) {
      return c.json(
        {
          error: {
            message: 'Missing required parameter: input',
            type: 'invalid_request_error',
            param: 'input',
            code: 'invalid_request_error',
          },
        },
        400
      );
    }

    if (body.stream) {
      return createSseResponse(c, async (writer) => {
        await runResponsesStream(body, writer);
      });
    }

    const response = await runResponsesNonStream(body);
    return c.json(response);
  } catch (err: any) {
    console.error('Error in createResponse:', err);
    return c.json(toErrorBody(err), statusFromError(err) as any);
  }
}

export async function getResponse(c: Context) {
  try {
    const id = c.req.param('id');
    const rec = responseStore.get(id);
    if (!rec) {
      throw notFound(`Response with id '${id}' not found.`, 'id');
    }
    return c.json(rec.response);
  } catch (err: any) {
    return c.json(toErrorBody(err), statusFromError(err) as any);
  }
}

export async function deleteResponse(c: Context) {
  try {
    const id = c.req.param('id');
    const ok = responseStore.delete(id);
    if (!ok) {
      throw notFound(`Response with id '${id}' not found.`, 'id');
    }
    return c.json({
      id,
      object: 'response',
      deleted: true,
    });
  } catch (err: any) {
    return c.json(toErrorBody(err), statusFromError(err) as any);
  }
}

export async function cancelResponse(c: Context) {
  return c.json(
    {
      error: {
        message:
          'Only background responses can be cancelled. This proxy does not support background mode.',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_request_error',
      },
    },
    400
  );
}
