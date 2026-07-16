const PAUSE_PATTERNS = [
  /maximum number of tool calls/i,
  /reached the maximum number of tool/i,
  /Type [‘'"]continue[’'"] to resume/i,
  /número máximo de chamadas de ferramenta/i,
  /Digite [‘'"]continue[’'"] para retomar/i,
  /limite máximo de chamadas/i,
];

const PHRASES_TO_REMOVE = [
  /This task paused because Kimi reached the maximum number of tool calls for a single message\.\s*Type [‘'"]continue[’'"] to resume the task\./gi,
  /Esta tarefa foi pausada porque o Kimi atingiu o número máximo de chamadas de ferramenta para uma única mensagem\.\s*Digite [‘'"]continue[’'"] para retomar a tarefa\./gi,
  /This task paused because Kimi reached the maximum number of tool calls for a single message\.\s*Type [‘'"]continue[’'"] to resume\./gi,
  /This task paused because Kimi reached.*/gi,
  /Esta tarefa foi pausada porque.*/gi,
];

export function isPausedMessage(text: string): boolean {
  return PAUSE_PATTERNS.some((pattern) => pattern.test(text));
}

export function cleanPauseMessage(text: string): string {
  let cleaned = text;
  for (const regex of PHRASES_TO_REMOVE) {
    cleaned = cleaned.replace(regex, '');
  }
  return cleaned.trim();
}

export const BUFFER_WINDOW = 200;
export const MAX_AUTO_CONTINUE_TURNS = 5;
