import { v4 as uuidv4 } from 'uuid';
import type {
  FunctionToolDefinition,
  Message,
  MessageToolCall,
  OpenAIRequest,
  ResponsesRequest,
  ToolChoice,
  Usage,
} from '../domain/types.ts';
import { createKimiStreamWithRetry } from '../kimi/client.ts';
import {
  flattenMessagesToPrompt,
  isNewChatSession,
} from '../kimi/prompt.ts';
import {
  chatChunk,
  chatCompletion,
  estimateUsage,
  makeChatId,
  toolArgsDelta,
  toolStartDelta,
  usageOnlyChunk,
} from '../openai/chat.ts';
import {
  buildOutputItems,
  buildResponseObject,
  makeResponseId,
  mapChatUsage,
  normalizeResponsesTools,
  resolvePreviousId,
  responsesInputToMessages,
  ResponsesStreamEmitter,
} from '../openai/responses.ts';
import type { SseWriter } from '../openai/sse.ts';
import { responseStore } from '../store/response-store.ts';
import { iterateKimiPipeline } from '../stream/pipeline.ts';
import { invalidRequest, notFound } from '../openai/errors.ts';

export interface RunContext {
  model: string;
  messages: Message[];
  tools?: FunctionToolDefinition[];
  toolChoice?: ToolChoice;
  stream?: boolean;
  includeUsage?: boolean;
  signal?: AbortSignal;
  isNewSession?: boolean;
  forcedParentId?: string | null;
}

export async function prepareKimiRun(ctx: RunContext) {
  const finalPrompt = flattenMessagesToPrompt(
    ctx.messages,
    ctx.tools,
    ctx.toolChoice
  );
  const isThinkingModel = ctx.model.includes('thinking');
  const isNewSession =
    ctx.isNewSession ?? isNewChatSession(ctx.messages);
  const forcedParent =
    ctx.forcedParentId !== undefined
      ? ctx.forcedParentId
      : isNewSession
        ? null
        : undefined;

  const result = await createKimiStreamWithRetry(
    finalPrompt,
    isThinkingModel,
    ctx.model,
    forcedParent,
    ctx.signal
  );

  return {
    finalPrompt,
    isThinkingModel,
    stream: result.stream,
    uiSessionId: result.uiSessionId,
  };
}

export async function runChatCompletionNonStream(body: OpenAIRequest) {
  const created = Math.floor(Date.now() / 1000);
  const completionId = makeChatId(uuidv4());
  const prepared = await prepareKimiRun({
    model: body.model,
    messages: body.messages || [],
    tools: body.tools,
    toolChoice: body.tool_choice,
  });

  const result = await (async () => {
    const gen = iterateKimiPipeline(prepared.stream, prepared.uiSessionId, {
      isThinkingModel: prepared.isThinkingModel,
      model: body.model,
    });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    return step.value;
  })();

  const usage = estimateUsage(
    prepared.finalPrompt,
    result.text,
    result.reasoning
  );
  const toolCalls = result.toolCalls as MessageToolCall[];
  return chatCompletion(
    completionId,
    body.model,
    created,
    result.text,
    toolCalls,
    result.reasoning,
    usage
  );
}

export async function runChatCompletionStream(
  body: OpenAIRequest,
  writer: SseWriter
): Promise<void> {
  const created = Math.floor(Date.now() / 1000);
  const completionId = makeChatId(uuidv4());
  const includeUsage = Boolean(body.stream_options?.include_usage);
  const ac = new AbortController();
  writer.onAbort(() => ac.abort());

  const prepared = await prepareKimiRun({
    model: body.model,
    messages: body.messages || [],
    tools: body.tools,
    toolChoice: body.tool_choice,
    signal: ac.signal,
  });

  const send = async (delta: any, finishReason: string | null = null, usage?: Usage | null) => {
    if (writer.aborted()) return;
    const usageField =
      usage !== undefined ? usage : includeUsage ? null : undefined;
    await writer.writeData(
      chatChunk(
        completionId,
        body.model,
        created,
        delta,
        finishReason,
        usageField
      )
    );
  };

  await send({ role: 'assistant', content: '' });

  let text = '';
  let reasoning = '';
  let toolCount = 0;

  for await (const event of iterateKimiPipeline(
    prepared.stream,
    prepared.uiSessionId,
    {
      isThinkingModel: prepared.isThinkingModel,
      model: body.model,
      signal: ac.signal,
    }
  )) {
    if (writer.aborted()) break;

    if (event.kind === 'reasoning') {
      reasoning += event.text;
      await send({ reasoning_content: event.text });
    } else if (event.kind === 'text') {
      text += event.text;
      await send({ content: event.text });
    } else if (event.kind === 'tool_start') {
      toolCount = Math.max(toolCount, event.index + 1);
      await send(toolStartDelta(event.index, event.id, event.name));
    } else if (event.kind === 'tool_args') {
      await send(toolArgsDelta(event.index, event.arguments));
    }
  }

  if (writer.aborted()) return;

  const usage = estimateUsage(prepared.finalPrompt, text, reasoning);
  const finishReason = toolCount > 0 ? 'tool_calls' : 'stop';
  await send({}, finishReason, usage);

  if (includeUsage) {
    await writer.writeData(
      usageOnlyChunk(completionId, body.model, created, usage)
    );
  }

  await writer.writeDone();
}

export async function runResponsesNonStream(body: ResponsesRequest) {
  const previousId = resolvePreviousId(body);
  let priorMessages: Message[] = [];
  let forcedParentId: string | null | undefined = undefined;
  let sessionId = body.session_id ?? null;

  if (previousId) {
    const prev = responseStore.get(previousId);
    if (!prev) {
      throw notFound(
        `Previous response with id '${previousId}' not found.`,
        'previous_response_id'
      );
    }
    priorMessages = [...prev.messages];
    for (const item of prev.response.output) {
      if ((item as any).type === 'message') {
        const text = ((item as any).content || [])
          .filter((c: any) => c.type === 'output_text')
          .map((c: any) => c.text)
          .join('');
        priorMessages.push({ role: 'assistant', content: text });
      } else if ((item as any).type === 'function_call') {
        priorMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: (item as any).call_id,
              type: 'function',
              function: {
                name: (item as any).name,
                arguments: (item as any).arguments,
              },
            },
          ],
        });
      }
    }
    forcedParentId = prev.kimiParentId;
    sessionId = sessionId || prev.response.session_id || null;
  }

  if (body.conversation && previousId) {
    throw invalidRequest(
      'previous_response_id cannot be used in conjunction with conversation',
      'previous_response_id'
    );
  }

  const messages = responsesInputToMessages(body, priorMessages);
  if (!body.input && !previousId) {
    throw invalidRequest('Missing required parameter: input', 'input');
  }

  const tools = normalizeResponsesTools(body.tools);
  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = makeResponseId();

  const prepared = await prepareKimiRun({
    model: body.model,
    messages,
    tools,
    toolChoice: body.tool_choice as any,
    isNewSession: !previousId && isNewChatSession(messages),
    forcedParentId: previousId ? forcedParentId : undefined,
  });

  const result = await (async () => {
    const gen = iterateKimiPipeline(prepared.stream, prepared.uiSessionId, {
      isThinkingModel: prepared.isThinkingModel,
      model: body.model,
    });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    return step.value;
  })();

  const usage = mapChatUsage(
    estimateUsage(prepared.finalPrompt, result.text, result.reasoning)
  );
  const output = buildOutputItems(
    result.text,
    result.reasoning,
    result.toolCalls
  );
  const storeFlag = body.store !== false;
  const response = buildResponseObject({
    id: responseId,
    model: body.model,
    createdAt,
    status: 'completed',
    output,
    usage,
    body,
    previousResponseId: previousId,
    sessionId: sessionId || result.uiSessionId || null,
  });

  if (storeFlag) {
    const nextMessages = [
      ...messages,
      {
        role: 'assistant' as const,
        content: result.toolCalls.length ? null : result.text,
        tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
        reasoning_content: result.reasoning || undefined,
      },
    ];
    responseStore.put(
      responseStore.makeRecord(
        response,
        nextMessages,
        result.uiSessionId,
        result.assistantMessageId || null
      )
    );
    if (sessionId) responseStore.setTip(sessionId, responseId);
  }

  return response;
}

export async function runResponsesStream(
  body: ResponsesRequest,
  writer: SseWriter
): Promise<void> {
  const previousId = resolvePreviousId(body);
  let priorMessages: Message[] = [];
  let forcedParentId: string | null | undefined = undefined;
  let sessionId = body.session_id ?? null;

  if (previousId) {
    const prev = responseStore.get(previousId);
    if (!prev) {
      throw notFound(
        `Previous response with id '${previousId}' not found.`,
        'previous_response_id'
      );
    }
    priorMessages = [...prev.messages];
    for (const item of prev.response.output) {
      if ((item as any).type === 'message') {
        const text = ((item as any).content || [])
          .filter((c: any) => c.type === 'output_text')
          .map((c: any) => c.text)
          .join('');
        priorMessages.push({ role: 'assistant', content: text });
      } else if ((item as any).type === 'function_call') {
        priorMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: (item as any).call_id,
              type: 'function',
              function: {
                name: (item as any).name,
                arguments: (item as any).arguments,
              },
            },
          ],
        });
      }
    }
    forcedParentId = prev.kimiParentId;
    sessionId = sessionId || prev.response.session_id || null;
  }

  if (body.conversation && previousId) {
    throw invalidRequest(
      'previous_response_id cannot be used in conjunction with conversation',
      'previous_response_id'
    );
  }

  const messages = responsesInputToMessages(body, priorMessages);
  if (!body.input && !previousId) {
    throw invalidRequest('Missing required parameter: input', 'input');
  }

  const tools = normalizeResponsesTools(body.tools);
  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = makeResponseId();
  const ac = new AbortController();
  writer.onAbort(() => ac.abort());

  const prepared = await prepareKimiRun({
    model: body.model,
    messages,
    tools,
    toolChoice: body.tool_choice as any,
    isNewSession: !previousId && isNewChatSession(messages),
    forcedParentId: previousId ? forcedParentId : undefined,
    signal: ac.signal,
  });

  const effectiveSessionId = sessionId || prepared.uiSessionId || null;
  const emitter = new ResponsesStreamEmitter(
    responseId,
    body.model,
    createdAt,
    body,
    previousId,
    effectiveSessionId,
    async (event, payload) => {
      if (!writer.aborted()) {
        await writer.writeEvent(event, payload);
      }
    }
  );

  await emitter.emitCreated();

  let toolCalls: MessageToolCall[] = [];
  let lastUiSessionId = prepared.uiSessionId;
  let lastAssistantId = '';

  for await (const event of iterateKimiPipeline(
    prepared.stream,
    prepared.uiSessionId,
    {
      isThinkingModel: prepared.isThinkingModel,
      model: body.model,
      signal: ac.signal,
    }
  )) {
    if (writer.aborted()) break;
    if (event.kind === 'reasoning') {
      await emitter.emitReasoningDelta(event.text);
    } else if (event.kind === 'text') {
      await emitter.emitTextDelta(event.text);
    } else if (event.kind === 'tool_start') {
      toolCalls[event.index] = {
        id: event.id,
        type: 'function',
        function: { name: event.name, arguments: '' },
      };
    } else if (event.kind === 'tool_args') {
      const existing = toolCalls[event.index];
      if (existing) {
        existing.function.arguments = event.arguments;
        await emitter.emitToolCall(
          event.index,
          existing.id,
          existing.function.name,
          event.arguments
        );
      }
    } else if (event.kind === 'meta') {
      if (event.uiSessionId) lastUiSessionId = event.uiSessionId;
      if (event.assistantMessageId) lastAssistantId = event.assistantMessageId;
    }
  }

  if (writer.aborted()) return;

  const usage = mapChatUsage(
    estimateUsage(
      prepared.finalPrompt,
      emitter.getText(),
      emitter.getReasoning()
    )
  );
  const response = await emitter.emitCompleted(usage);

  if (body.store !== false) {
    const nextMessages = [
      ...messages,
      {
        role: 'assistant' as const,
        content: toolCalls.filter(Boolean).length
          ? null
          : emitter.getText(),
        tool_calls: toolCalls.filter(Boolean).length
          ? toolCalls.filter(Boolean)
          : undefined,
        reasoning_content: emitter.getReasoning() || undefined,
      },
    ];
    responseStore.put(
      responseStore.makeRecord(
        response,
        nextMessages,
        lastUiSessionId,
        lastAssistantId || null
      )
    );
    if (effectiveSessionId) {
      responseStore.setTip(effectiveSessionId, responseId);
    }
  }
}
