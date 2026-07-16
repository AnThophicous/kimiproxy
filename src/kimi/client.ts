import { getKimiHeaders } from '../services/playwright.ts';
import { encodeConnectRequest } from './connect.ts';
import { getModelScenario } from './models.ts';
import { getSessionParent } from './session.ts';

export interface KimiStreamResult {
  stream: ReadableStream;
  headers: Record<string, string>;
  uiSessionId: string;
}

export async function createKimiStream(
  prompt: string,
  enableThinking: boolean,
  modelId: string,
  forcedParentId?: string | null,
  signal?: AbortSignal
): Promise<KimiStreamResult> {
  const { headers, chatSessionId, parentMessageId } = await getKimiHeaders(
    forcedParentId === null
  );

  let actualParentId: string | null = parentMessageId;
  let activeChatId = chatSessionId;

  if (forcedParentId !== undefined) {
    actualParentId = forcedParentId;
  } else if (activeChatId) {
    const stored = getSessionParent(activeChatId);
    if (stored !== undefined) {
      actualParentId = stored;
    }
  }

  const modelConfig = getModelScenario(modelId);

  const payload: any = {
    scenario: modelConfig.scenario,
    message: {
      parent_id: actualParentId || '',
      role: 'user',
      blocks: [
        {
          message_id: '',
          text: {
            content: prompt,
          },
        },
      ],
      scenario: modelConfig.scenario,
    },
    options: {
      thinking: enableThinking || modelConfig.thinking || false,
    },
  };

  if (activeChatId) {
    payload.chat_id = activeChatId;
  }

  if ((modelConfig as any).kimiPlusId) {
    payload.kimi_plus_id = (modelConfig as any).kimiPlusId;
  }
  if ((modelConfig as any).agentMode) {
    payload.options.agent_mode = (modelConfig as any).agentMode;
  }

  const framedPayload = encodeConnectRequest(payload);

  const response = await fetch(
    'https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat',
    {
      method: 'POST',
      headers: {
        accept: '*/*',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        authorization: headers['authorization'],
        'connect-protocol-version': '1',
        'content-type': 'application/connect+json',
        cookie: headers['cookie'],
        origin: 'https://www.kimi.com',
        referer: activeChatId
          ? `https://www.kimi.com/chat/${activeChatId}`
          : 'https://www.kimi.com/',
        'user-agent': headers['user-agent'],
        'x-msh-device-id': headers['x-msh-device-id'],
        'x-msh-platform': 'web',
        'x-msh-session-id': headers['x-msh-session-id'],
        'x-msh-version': '1.0.0',
        'x-traffic-id': headers['x-traffic-id'],
        'r-timezone': headers['r-timezone'],
      },
      body: framedPayload,
      signal,
    }
  );

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Failed to fetch from Kimi: ${response.status} ${response.statusText} - ${errText}`
    );
  }

  return {
    stream: response.body,
    headers,
    uiSessionId: activeChatId,
  };
}

export async function createKimiStreamWithRetry(
  prompt: string,
  enableThinking: boolean,
  modelId: string,
  forcedParentId?: string | null,
  signal?: AbortSignal,
  retries = 3
): Promise<KimiStreamResult> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await createKimiStream(
        prompt,
        enableThinking,
        modelId,
        forcedParentId,
        signal
      );
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  throw lastError;
}
