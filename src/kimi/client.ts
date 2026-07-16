import {
  getKimiHeaders,
  resolveAccountId,
  clearAccountCache,
} from '../services/playwright.ts';
import { encodeConnectRequest } from './connect.ts';
import { getModelScenario } from './models.ts';
import { getSessionParent } from './session.ts';
import {
  assertNotLimitResponse,
  errorLooksLikeLimit,
  KimiLimitError,
} from '../account/limits.ts';
import {
  beginRecycleInBackground,
  isAutoRecycleEnabled,
  pickFallbackAccount,
} from '../account/auto-recycle.ts';
import { getPreferredAccount, markExhausted } from '../account/pool.ts';

export interface KimiStreamResult {
  stream: ReadableStream;
  headers: Record<string, string>;
  uiSessionId: string;
  accountId: string;
}

async function buildAndFetch(
  prompt: string,
  enableThinking: boolean,
  modelId: string,
  forcedParentId: string | null | undefined,
  signal: AbortSignal | undefined,
  accountId: string | null | undefined
): Promise<KimiStreamResult> {
  const resolvedAccount = getPreferredAccount(accountId);
  const { headers, chatSessionId, parentMessageId } = await getKimiHeaders(
    forcedParentId === null,
    resolvedAccount
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
  const thinking = enableThinking || modelConfig.thinking || false;

  const message: any = {
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
  };

  if (modelConfig.isGoal !== undefined) {
    message.is_goal = modelConfig.isGoal;
  }

  const options: any = {
    thinking,
  };

  if (modelConfig.enablePlugin) {
    options.enable_plugin = true;
  }
  if (modelConfig.contextLength) {
    options.context_length = modelConfig.contextLength;
  }
  if (modelConfig.agentMode) {
    options.agent_mode = modelConfig.agentMode;
  }

  const payload: any = {
    scenario: modelConfig.scenario,
    message,
    options,
  };

  if (activeChatId) {
    payload.chat_id = activeChatId;
  }

  if (modelConfig.tools?.length) {
    payload.tools = modelConfig.tools;
  }

  if (modelConfig.kimiplusId) {
    payload.kimiplus_id = modelConfig.kimiplusId;
    payload.project_id = '';
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
    assertNotLimitResponse(response.status, errText);
    throw new Error(
      `Failed to fetch from Kimi: ${response.status} ${response.statusText} - ${errText}`
    );
  }

  return {
    stream: response.body,
    headers,
    uiSessionId: activeChatId,
    accountId: resolvedAccount,
  };
}

export async function createKimiStream(
  prompt: string,
  enableThinking: boolean,
  modelId: string,
  forcedParentId?: string | null,
  signal?: AbortSignal,
  accountId?: string | null
): Promise<KimiStreamResult> {
  return buildAndFetch(
    prompt,
    enableThinking,
    modelId,
    forcedParentId,
    signal,
    accountId
  );
}

export async function createKimiStreamWithRetry(
  prompt: string,
  enableThinking: boolean,
  modelId: string,
  forcedParentId?: string | null,
  signal?: AbortSignal,
  retries = 4,
  accountId?: string | null
): Promise<KimiStreamResult> {
  let lastError: unknown;
  let activeAccount = getPreferredAccount(accountId);
  const tried = new Set<string>();
  let recyclePromise: Promise<void> | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const result = await buildAndFetch(
        prompt,
        enableThinking,
        modelId,
        forcedParentId,
        signal,
        activeAccount
      );
      return result;
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;

      const failedId = resolveAccountId(activeAccount);
      tried.add(failedId);

      if (errorLooksLikeLimit(err) && isAutoRecycleEnabled()) {
        markExhausted(failedId, 120_000);
        console.log(
          `[kimi] limite em "${failedId}" → recycle em BACKGROUND + fallback imediato`
        );

        if (!recyclePromise) {
          const started = beginRecycleInBackground(failedId);
          recyclePromise = started.promise.catch((e) => {
            console.error('[kimi] recycle background erro:', e);
          });
        }

        const fallback = pickFallbackAccount(failedId);
        if (fallback && !tried.has(fallback)) {
          console.log(`[kimi] hot-swap → account="${fallback}" (enquanto "${failedId}" recicla)`);
          activeAccount = fallback;
          continue;
        }

        const anyOther = pickFallbackAccount(failedId);
        if (anyOther) {
          console.log(`[kimi] hot-swap → account="${anyOther}"`);
          activeAccount = anyOther;
          continue;
        }

        if (recyclePromise) {
          console.log(
            `[kimi] sem fallback pronto — aguardando recycle de "${failedId}"...`
          );
          try {
            await recyclePromise;
            await clearAccountCache(failedId);
            activeAccount = failedId;
            recyclePromise = null;
            continue;
          } catch (recycleErr) {
            lastError = recycleErr;
          }
        }
      }

      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 800));
        const next = pickFallbackAccount(failedId);
        if (next) activeAccount = next;
      }
    }
  }
  throw lastError;
}
