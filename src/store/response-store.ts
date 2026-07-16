import type { Message, ResponseObject } from '../domain/types.ts';

export interface StoredResponseRecord {
  response: ResponseObject;
  messages: Message[];
  kimiChatId: string;
  kimiParentId: string | null;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 3600;

class MemoryResponseStore {
  private responses = new Map<string, StoredResponseRecord>();
  private sessionTips = new Map<string, string>();

  put(record: StoredResponseRecord): void {
    this.responses.set(record.response.id, record);
    if (record.response.session_id) {
      this.sessionTips.set(record.response.session_id, record.response.id);
    }
  }

  get(id: string): StoredResponseRecord | null {
    const rec = this.responses.get(id);
    if (!rec) return null;
    if (rec.expiresAt < Math.floor(Date.now() / 1000)) {
      this.responses.delete(id);
      return null;
    }
    return rec;
  }

  delete(id: string): boolean {
    const rec = this.responses.get(id);
    if (!rec) return false;
    this.responses.delete(id);
    if (rec.response.session_id) {
      const tip = this.sessionTips.get(rec.response.session_id);
      if (tip === id) this.sessionTips.delete(rec.response.session_id);
    }
    return true;
  }

  getTip(sessionId: string): string | null {
    return this.sessionTips.get(sessionId) ?? null;
  }

  setTip(sessionId: string, responseId: string): void {
    this.sessionTips.set(sessionId, responseId);
  }

  makeRecord(
    response: ResponseObject,
    messages: Message[],
    kimiChatId: string,
    kimiParentId: string | null,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): StoredResponseRecord {
    return {
      response,
      messages,
      kimiChatId,
      kimiParentId,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
  }

  prune(): number {
    const now = Math.floor(Date.now() / 1000);
    let n = 0;
    for (const [id, rec] of this.responses) {
      if (rec.expiresAt < now) {
        this.responses.delete(id);
        n++;
      }
    }
    return n;
  }
}

export const responseStore = new MemoryResponseStore();
