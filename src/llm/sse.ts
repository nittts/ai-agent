export class LeitorSse {
  private buffer = '';

  alimentar(pedaco: string): string[] {
    this.buffer += pedaco.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const payloads: string[] = [];
    let corte: number;

    while ((corte = this.buffer.indexOf('\n\n')) >= 0) {
      const bloco = this.buffer.slice(0, corte);
      this.buffer = this.buffer.slice(corte + 2);

      const linhas = bloco
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''));

      if (linhas.length > 0) payloads.push(linhas.join('\n'));
    }

    return payloads;
  }

  resto(): string {
    return this.buffer;
  }
}
