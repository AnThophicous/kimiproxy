export function getModelScenario(modelId: string) {
  const cleanModel = modelId.replace('-no-thinking', '');
  if (cleanModel === 'k2d6') {
    return { scenario: 'SCENARIO_K2D5', thinking: false };
  }
  if (cleanModel === 'k2d6-thinking') {
    return { scenario: 'SCENARIO_K2D5', thinking: true };
  }
  if (cleanModel === 'k2d6-agent') {
    return {
      scenario: 'SCENARIO_OK_COMPUTER',
      kimiPlusId: 'ok-computer',
      agentMode: 'TYPE_NORMAL',
    };
  }
  if (cleanModel === 'k2d6-agent-ultra') {
    return {
      scenario: 'SCENARIO_OK_COMPUTER',
      kimiPlusId: 'ok-computer',
      agentMode: 'TYPE_ULTRA',
    };
  }
  return { scenario: 'SCENARIO_K2D5', thinking: modelId.includes('thinking') };
}

export async function fetchKimiModels(): Promise<any[]> {
  const created = Math.floor(Date.now() / 1000);
  return [
    { id: 'k2d6', object: 'model', created, owned_by: 'kimi' },
    { id: 'k2d6-thinking', object: 'model', created, owned_by: 'kimi' },
    { id: 'k2d6-agent', object: 'model', created, owned_by: 'kimi' },
    { id: 'k2d6-agent-ultra', object: 'model', created, owned_by: 'kimi' },
  ];
}
