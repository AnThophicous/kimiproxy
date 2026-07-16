export function encodeConnectRequest(payload: unknown): Uint8Array {
  const jsonStr = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);
  const length = jsonBytes.length;

  const framed = new Uint8Array(5 + length);
  framed[0] = 0x00;
  framed[1] = (length >> 24) & 0xff;
  framed[2] = (length >> 16) & 0xff;
  framed[3] = (length >> 8) & 0xff;
  framed[4] = length & 0xff;
  framed.set(jsonBytes, 5);

  return framed;
}

export class ConnectStreamParser {
  private buffer: Uint8Array = new Uint8Array(0);

  feed(chunk: Uint8Array): any[] {
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    const messages: any[] = [];
    const textDecoder = new TextDecoder();

    while (this.buffer.length >= 5) {
      const flags = this.buffer[0];
      const length =
        (this.buffer[1] << 24) |
        (this.buffer[2] << 16) |
        (this.buffer[3] << 8) |
        this.buffer[4];

      if (this.buffer.length < 5 + length) {
        break;
      }

      const payload = this.buffer.slice(5, 5 + length);
      this.buffer = this.buffer.slice(5 + length);

      if (flags === 0x00) {
        const jsonStr = textDecoder.decode(payload);
        try {
          messages.push(JSON.parse(jsonStr));
        } catch {
        }
      }
    }

    return messages;
  }
}
