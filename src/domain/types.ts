export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  nullable?: boolean;
}

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
    strict?: boolean;
  };
}

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: JsonSchema;
  strict?: boolean;
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }
  | { type: 'function'; name: string };

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface MessageToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface Message {
  role: string;
  content: string | null | Array<{ type?: string; text?: string; [key: string]: unknown }>;
  tool_calls?: MessageToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface StreamOptions {
  include_usage?: boolean;
}

export interface OpenAIRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  tools?: FunctionToolDefinition[];
  tool_choice?: ToolChoice;
  stream_options?: StreamOptions;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  user?: string;
  metadata?: Record<string, string>;
  session_id?: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChoiceDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCallDelta[];
  refusal?: string | null;
}

export interface Choice {
  index: number;
  delta?: ChoiceDelta;
  message?: {
    role: string;
    content: string | null;
    reasoning_content?: string;
    tool_calls?: MessageToolCall[];
    refusal?: string | null;
  };
  logprobs: null;
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Choice[];
  usage?: Usage | null;
  system_fingerprint?: string | null;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Choice[];
  usage: Usage;
  system_fingerprint?: string | null;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: string;
  isError: boolean;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<unknown>;

export interface ToolExecutionContext {
  messages: Message[];
  turn: number;
  model: string;
  state: Record<string, unknown>;
}

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: JsonSchema;
  strict: boolean;
  handler: ToolHandler;
  policy?: ToolPolicy;
}

export interface ToolPolicy {
  maxCallsPerRun?: number;
  requiresApproval?: boolean;
  rateLimit?: number;
  allowedContexts?: string[];
}

export type ResponseInput =
  | string
  | Array<ResponseInputItem>;

export type ResponseInputItem =
  | {
      role: string;
      content: string | Array<{ type?: string; text?: string; [key: string]: unknown }>;
      type?: string;
      id?: string;
      status?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      output?: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
      id?: string;
      status?: string;
    }
  | {
      type: 'message';
      role: string;
      content: unknown;
      id?: string;
      status?: string;
    }
  | {
      type: 'reasoning';
      id?: string;
      summary?: unknown[];
      content?: unknown[];
    }
  | Record<string, unknown>;

export interface ResponsesRequest {
  model: string;
  input?: ResponseInput;
  instructions?: string | null;
  stream?: boolean;
  store?: boolean;
  previous_response_id?: string | null;
  last_response_id?: string | null;
  conversation?: string | { id: string } | null;
  tools?: Array<ResponsesFunctionTool | FunctionToolDefinition | Record<string, unknown>>;
  tool_choice?: ToolChoice;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  parallel_tool_calls?: boolean;
  metadata?: Record<string, string>;
  text?: {
    format?: {
      type: string;
      name?: string;
      strict?: boolean;
      schema?: JsonSchema;
    };
  };
  session_id?: string;
  user?: string;
}

export interface ResponseUsage {
  input_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details?: { reasoning_tokens: number };
  total_tokens: number;
}

export type ResponseStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled';

export interface ResponseOutputText {
  type: 'output_text';
  text: string;
  annotations: unknown[];
  logprobs?: unknown[];
}

export interface ResponseMessageItem {
  id: string;
  type: 'message';
  status: string;
  role: 'assistant';
  content: Array<ResponseOutputText | { type: 'refusal'; refusal: string }>;
}

export interface ResponseFunctionCallItem {
  id: string;
  type: 'function_call';
  status: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponseReasoningItem {
  id: string;
  type: 'reasoning';
  content: unknown[];
  summary: Array<{ type: string; text: string }>;
}

export type ResponseOutputItem =
  | ResponseMessageItem
  | ResponseFunctionCallItem
  | ResponseReasoningItem
  | Record<string, unknown>;

export interface ResponseObject {
  id: string;
  object: 'response';
  created_at: number;
  status: ResponseStatus;
  completed_at?: number | null;
  error: { code: string; message: string } | null;
  incomplete_details: { reason: string } | null;
  instructions: string | null;
  max_output_tokens: number | null;
  model: string;
  output: ResponseOutputItem[];
  parallel_tool_calls: boolean;
  previous_response_id: string | null;
  reasoning: { effort: string | null; summary: string | null } | null;
  store: boolean;
  temperature: number | null;
  text: { format: { type: string } };
  tool_choice: ToolChoice | string;
  tools: unknown[];
  top_p: number | null;
  truncation: string;
  usage: ResponseUsage | null;
  user: string | null;
  metadata: Record<string, string>;
  background: boolean;
  service_tier?: string;
  session_id?: string | null;
  output_text?: string;
}

export interface StreamEvent {
  type: string;
  sequence_number: number;
  [key: string]: unknown;
}
