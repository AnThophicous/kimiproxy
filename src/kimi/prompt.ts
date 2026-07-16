import type { FunctionToolDefinition, Message, ToolChoice } from '../domain/types.ts';

function contentToString(content: Message['content']): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === 'string') return c;
        if (c?.text) return String(c.text);
        if (c?.type === 'input_text' && c.text) return String(c.text);
        if (c?.type === 'output_text' && c.text) return String(c.text);
        return JSON.stringify(c);
      })
      .join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

export function buildToolsSystemPrompt(
  tools: FunctionToolDefinition[],
  toolChoice?: ToolChoice
): string {
  const formattedTools = tools.map((t) => {
    if (t.type === 'function') {
      return {
        name: t.function.name,
        description: t.function.description || '',
        parameters: t.function.parameters,
      };
    }
    return t;
  });
  const toolsJson = JSON.stringify(formattedTools, null, 2);

  let prompt = `\n\n# TOOLS AVAILABLE\nYou have access to the following tools:\n${toolsJson}\n\n# TOOL CALLING FORMAT (MANDATORY)\nTo use a tool, you MUST output a JSON object wrapped EXACTLY in these tags:\n<tool_call>\n{"name": "tool_name", "arguments": {"param_name": "value"}}\n</tool_call>\n\nEXAMPLE OF MULTIPLE TOOL CALLS:\n<tool_call>\n{"name": "read_file", "arguments": {"path": "file1.txt"}}\n</tool_call>\n<tool_call>\n{"name": "read_file", "arguments": {"path": "file2.txt"}}\n</tool_call>\n\nCRITICAL RULES:\n1. ONLY use the tags above for tool calling. NEVER output raw JSON without tags.\n2. You can call multiple tools by outputting multiple <tool_call> blocks consecutively.\n3. Do NOT output any other text (explanations, chat, etc.) after your <tool_call> blocks. Wait for the user to provide the tool response.\n4. The JSON inside the tags MUST be valid and include ALL required braces and the "arguments" field.\n5. If you need to use a tool, do it IMMEDIATELY without preamble.\n\n`;

  if (toolChoice && typeof toolChoice === 'object') {
    const forced =
      (toolChoice as any).function?.name || (toolChoice as any).name;
    if (forced) {
      prompt += `CRITICAL: You MUST call the tool "${forced}" in this response.\n\n`;
    }
  }

  return prompt;
}

export function flattenMessagesToPrompt(
  messages: Message[],
  tools?: FunctionToolDefinition[],
  toolChoice?: ToolChoice
): string {
  let prompt = '';
  let systemPrompt = '';

  for (const msg of messages) {
    const contentStr = contentToString(msg.content);

    if (msg.role === 'system' || msg.role === 'developer') {
      systemPrompt += contentStr + '\n\n';
    } else if (msg.role === 'user') {
      prompt += `User: ${contentStr}\n\n`;
    } else if (msg.role === 'assistant') {
      let assistantContent = contentStr;
      if (msg.reasoning_content) {
        assistantContent = `<think>\n${msg.reasoning_content}\n</think>\n${assistantContent}`;
      }
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let args = tc.function?.arguments || '{}';
          if (typeof args !== 'string') args = JSON.stringify(args);
          assistantContent += `\n<tool_call>{"name": "${tc.function?.name}", "arguments": ${args}}</tool_call>`;
        }
      }
      prompt += `Assistant: ${assistantContent.trim()}\n\n`;
    } else if (msg.role === 'tool' || msg.role === 'function') {
      prompt += `Tool Response (${msg.name || msg.tool_call_id || 'tool'}): ${contentStr}\n\n`;
    }
  }

  if (tools && tools.length > 0) {
    systemPrompt += buildToolsSystemPrompt(tools, toolChoice);
  }

  return systemPrompt ? `${systemPrompt}\n${prompt}` : prompt;
}

export function isNewChatSession(messages: Message[]): boolean {
  return !messages.some((m) => m.role === 'assistant');
}
