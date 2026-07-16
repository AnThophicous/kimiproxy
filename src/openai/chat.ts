import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChoiceDelta,
  MessageToolCall,
  Usage,
} from '../domain/types.ts';

export function makeChatId(uuid: string): string {
  return `chatcmpl-${uuid}`;
}

export function estimateUsage(prompt: string, completion: string, reasoning = ''): Usage {
  const promptTokens = Math.ceil(prompt.length / 3.5);
  const completionTokens = Math.ceil((completion.length + reasoning.length) / 3.5);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    completion_tokens_details: reasoning
      ? { reasoning_tokens: Math.ceil(reasoning.length / 3.5) }
      : undefined,
  };
}

export function chatChunk(
  id: string,
  model: string,
  created: number,
  delta: ChoiceDelta,
  finishReason: string | null = null,
  usage: Usage | null | undefined = undefined
): ChatCompletionChunk {
  const chunk: ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
  };
  if (usage !== undefined) chunk.usage = usage;
  return chunk;
}

export function usageOnlyChunk(
  id: string,
  model: string,
  created: number,
  usage: Usage
): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [],
    usage,
  };
}

export function chatCompletion(
  id: string,
  model: string,
  created: number,
  content: string | null,
  toolCalls: MessageToolCall[],
  reasoning: string,
  usage: Usage
): ChatCompletion {
  const message: ChatCompletion['choices'][0]['message'] = {
    role: 'assistant',
    content: toolCalls.length ? null : content,
  };
  if (reasoning) message!.reasoning_content = reasoning;
  if (toolCalls.length) {
    message!.tool_calls = toolCalls.map((tc, index) => ({ ...tc, index } as MessageToolCall & { index?: number }));
  }

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        logprobs: null,
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      },
    ],
    usage,
  };
}

export function toolStartDelta(
  index: number,
  id: string,
  name: string
): ChoiceDelta {
  return {
    tool_calls: [
      {
        index,
        id,
        type: 'function',
        function: { name, arguments: '' },
      },
    ],
  };
}

export function toolArgsDelta(index: number, argsFragment: string): ChoiceDelta {
  return {
    tool_calls: [
      {
        index,
        function: { arguments: argsFragment },
      },
    ],
  };
}
