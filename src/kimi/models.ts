export type ModelScenarioConfig = {
  scenario: string;
  thinking?: boolean;
  kimiplusId?: string;
  agentMode?: string;
  tools?: Array<Record<string, unknown>>;
  enablePlugin?: boolean;
  contextLength?: string;
  isGoal?: boolean;
};

export function getModelScenario(modelId: string): ModelScenarioConfig {
  const cleanModel = modelId.replace('-no-thinking', '').toLowerCase();

  if (cleanModel === 'k2d6' || cleanModel === 'k2') {
    return { scenario: 'SCENARIO_K2D5', thinking: false };
  }

  if (
    cleanModel === 'k2d6-thinking' ||
    cleanModel === 'k2-thinking' ||
    cleanModel === 'k2.5' ||
    cleanModel === 'k2.6'
  ) {
    return { scenario: 'SCENARIO_K2D5', thinking: true };
  }

  const okComputerBase: ModelScenarioConfig = {
    scenario: 'SCENARIO_OK_COMPUTER',
    kimiplusId: 'ok-computer',
    thinking: true,
    enablePlugin: true,
    contextLength: 'CONTEXT_LENGTH_L',
    isGoal: false,
    tools: [
      { type: 'TOOL_TYPE_SEARCH', search: {} },
      { type: 'TOOL_TYPE_ASK_USER' },
    ],
  };

  if (
    cleanModel === 'k3-max' ||
    cleanModel === 'k3' ||
    cleanModel === 'k3max' ||
    cleanModel === 'kimi-k3-max' ||
    cleanModel === 'ok-computer' ||
    cleanModel === 'k2d6-agent'
  ) {
    return { ...okComputerBase };
  }

  if (cleanModel === 'k2d6-agent-ultra' || cleanModel === 'k3-max-ultra') {
    return {
      ...okComputerBase,
      agentMode: 'TYPE_ULTRA',
    };
  }

  return {
    scenario: 'SCENARIO_K2D5',
    thinking: modelId.includes('thinking'),
  };
}

export async function fetchKimiModels(): Promise<any[]> {
  const created = Math.floor(Date.now() / 1000);
  return [
    { id: 'k2d6', object: 'model', created, owned_by: 'kimi' },
    { id: 'k2d6-thinking', object: 'model', created, owned_by: 'kimi' },
    { id: 'k3-max', object: 'model', created, owned_by: 'kimi' },
    { id: 'k2d6-agent', object: 'model', created, owned_by: 'kimi' },
    { id: 'k2d6-agent-ultra', object: 'model', created, owned_by: 'kimi' },
  ];
}
