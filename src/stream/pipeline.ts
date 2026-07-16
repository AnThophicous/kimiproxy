import { StreamingToolParser } from '../tools/parser.ts';
import { ConnectStreamParser } from '../kimi/connect.ts';
import { updateSessionParent } from '../kimi/session.ts';
import {
  BUFFER_WINDOW,
  cleanPauseMessage,
  isPausedMessage,
  MAX_AUTO_CONTINUE_TURNS,
} from './pause.ts';
import { createKimiStreamWithRetry } from '../kimi/client.ts';
import type { MessageToolCall, ParsedToolCall } from '../domain/types.ts';

export type PipelineEvent =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; index: number; id: string; name: string }
  | { kind: 'tool_args'; index: number; arguments: string }
  | {
      kind: 'meta';
      uiSessionId?: string;
      assistantMessageId?: string;
    };

export interface PipelineResult {
  text: string;
  reasoning: string;
  toolCalls: MessageToolCall[];
  uiSessionId: string;
  assistantMessageId: string;
}

function toMessageToolCall(tc: ParsedToolCall, index: number): MessageToolCall & { index: number } {
  return {
    id: tc.id,
    type: 'function',
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    },
    index,
  } as MessageToolCall & { index: number };
}

export async function* iterateKimiPipeline(
  initialStream: ReadableStream,
  initialUiSessionId: string,
  options: {
    isThinkingModel: boolean;
    model: string;
    signal?: AbortSignal;
    autoContinue?: boolean;
  },
  onEvent?: (event: PipelineEvent) => void | Promise<void>
): AsyncGenerator<PipelineEvent, PipelineResult> {
  let currentStream = initialStream;
  let uiSessionId = initialUiSessionId;
  let assistantMessageId = '';
  let reasoning = '';
  let text = '';
  const toolCalls: Array<MessageToolCall & { index: number }> = [];
  let totalToolCalls = 0;
  let autoContinueTurns = 0;
  const autoContinue = options.autoContinue !== false;

  const emit = async (event: PipelineEvent) => {
    if (onEvent) await onEvent(event);
    return event;
  };

  while (true) {
    const reader = currentStream.getReader();
    const parser = new ConnectStreamParser();
    const toolParser = new StreamingToolParser();
    let textStreamBuffer = '';
    let turnText = '';
    let lastEmittedToolCount = 0;

    try {
      while (true) {
        if (options.signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunks = parser.feed(value);
        for (const msg of chunks) {
          if (msg.op === 'set' && msg.mask === 'chat.lastRequest' && msg.chat?.id) {
            uiSessionId = msg.chat.id;
            yield await emit({ kind: 'meta', uiSessionId });
          }

          if (msg.op === 'set' && msg.mask === 'message' && msg.message) {
            if (msg.message.role === 'assistant' && msg.message.id) {
              assistantMessageId = msg.message.id;
              updateSessionParent(uiSessionId, assistantMessageId);
              yield await emit({ kind: 'meta', assistantMessageId, uiSessionId });
            }
          }

          if (msg.block?.think?.content) {
            const delta = msg.block.think.content;
            reasoning += delta;
            yield await emit({ kind: 'reasoning', text: delta });
          }

          if (msg.block?.text?.content) {
            const delta = msg.block.text.content;
            const { text: safeText, toolCalls: parsedTools } = toolParser.feed(delta);

            if (safeText) {
              textStreamBuffer += safeText;
              turnText += safeText;
              if (textStreamBuffer.length > BUFFER_WINDOW) {
                const toEmit = textStreamBuffer.substring(
                  0,
                  textStreamBuffer.length - BUFFER_WINDOW
                );
                textStreamBuffer = textStreamBuffer.substring(
                  textStreamBuffer.length - BUFFER_WINDOW
                );
                text += toEmit;
                yield await emit({ kind: 'text', text: toEmit });
              }
            }

            for (const tc of parsedTools) {
              const index = toolCalls.length;
              const args = JSON.stringify(tc.arguments);
              yield await emit({
                kind: 'tool_start',
                index,
                id: tc.id,
                name: tc.name,
              });
              yield await emit({
                kind: 'tool_args',
                index,
                arguments: args,
              });
              toolCalls.push(toMessageToolCall(tc, index));
            }
            lastEmittedToolCount = toolParser.getEmittedToolCallCount();
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
      }
    }

    const { text: remainingText, toolCalls: remainingTools } = toolParser.flush();
    if (remainingText) {
      textStreamBuffer += remainingText;
      turnText += remainingText;
    }
    for (const tc of remainingTools) {
      const index = toolCalls.length;
      const args = JSON.stringify(tc.arguments);
      yield await emit({
        kind: 'tool_start',
        index,
        id: tc.id,
        name: tc.name,
      });
      yield await emit({
        kind: 'tool_args',
        index,
        arguments: args,
      });
      toolCalls.push(toMessageToolCall(tc, index));
      lastEmittedToolCount = toolParser.getEmittedToolCallCount();
    }

    const hasPause = isPausedMessage(textStreamBuffer) || isPausedMessage(turnText);
    if (hasPause) {
      textStreamBuffer = cleanPauseMessage(textStreamBuffer);
      turnText = cleanPauseMessage(turnText);
    }

    if (
      hasPause &&
      autoContinue &&
      autoContinueTurns < MAX_AUTO_CONTINUE_TURNS &&
      !options.signal?.aborted
    ) {
      totalToolCalls += lastEmittedToolCount;
      const next = await createKimiStreamWithRetry(
        'continue',
        options.isThinkingModel,
        options.model,
        undefined,
        options.signal
      );
      currentStream = next.stream;
      uiSessionId = next.uiSessionId || uiSessionId;
      autoContinueTurns++;
      continue;
    }

    if (textStreamBuffer) {
      text += textStreamBuffer;
      yield await emit({ kind: 'text', text: textStreamBuffer });
      textStreamBuffer = '';
    }
    totalToolCalls += lastEmittedToolCount;
    break;
  }

  return {
    text,
    reasoning,
    toolCalls,
    uiSessionId,
    assistantMessageId,
  };
}

export async function consumeKimiPipeline(
  stream: ReadableStream,
  uiSessionId: string,
  options: {
    isThinkingModel: boolean;
    model: string;
    signal?: AbortSignal;
    autoContinue?: boolean;
  }
): Promise<PipelineResult> {
  const gen = iterateKimiPipeline(stream, uiSessionId, options);
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}
