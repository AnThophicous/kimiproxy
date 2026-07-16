import type { Context } from 'hono';
import { fetchKimiModels } from '../kimi/models.ts';
import { statusFromError, toErrorBody } from '../openai/errors.ts';

export async function listModels(c: Context) {
  try {
    const models = await fetchKimiModels();
    return c.json({
      object: 'list',
      data: models,
    });
  } catch (err: any) {
    return c.json(toErrorBody(err), statusFromError(err) as any);
  }
}

export async function getModel(c: Context) {
  try {
    const id = c.req.param('id');
    const models = await fetchKimiModels();
    const model = models.find((m) => m.id === id);
    if (!model) {
      return c.json(
        {
          error: {
            message: `The model '${id}' does not exist`,
            type: 'invalid_request_error',
            param: 'model',
            code: 'model_not_found',
          },
        },
        404
      );
    }
    return c.json(model);
  } catch (err: any) {
    return c.json(toErrorBody(err), statusFromError(err) as any);
  }
}
