export class SseReader {
  private buffer = '';

  feed(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const payloads: string[] = [];
    let cut: number;

    while ((cut = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut + 2);

      const lines = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''));

      if (lines.length > 0) payloads.push(lines.join('\n'));
    }

    return payloads;
  }

  remainder(): string {
    return this.buffer;
  }
}
