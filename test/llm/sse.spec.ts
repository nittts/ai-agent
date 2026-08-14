import { describe, it, expect } from 'vitest';
import { LeitorSse } from '../../src/llm/sse';

describe('LeitorSse', () => {
  it('reconhece eventos terminados em CRLF — o formato que o Gemini usa', () => {
    const leitor = new LeitorSse();
    const eventos = leitor.alimentar('data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n');

    expect(eventos).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('reconhece eventos terminados em LF', () => {
    const leitor = new LeitorSse();
    expect(leitor.alimentar('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('reconhece CR isolado, também permitido pela especificação', () => {
    const leitor = new LeitorSse();
    expect(leitor.alimentar('data: {"a":1}\r\r')).toEqual(['{"a":1}']);
  });

  it('retém evento parcial entre leituras do socket', () => {
    const leitor = new LeitorSse();

    expect(leitor.alimentar('data: {"tex')).toEqual([]);
    expect(leitor.alimentar('to":"olá"}\r\n\r\n')).toEqual(['{"text":"olá"}'.replace('text', 'texto')]);
  });

  it('junta múltiplas linhas data: do mesmo evento', () => {
    const leitor = new LeitorSse();

    expect(leitor.alimentar('data: linha1\ndata: linha2\n\n')).toEqual(['linha1\nlinha2']);
  });

  it('ignora comentários e campos que não são data:', () => {
    const leitor = new LeitorSse();
    expect(leitor.alimentar(': keep-alive\nevent: ping\nid: 7\n\n')).toEqual([]);
    expect(leitor.alimentar('event: msg\ndata: {"ok":true}\n\n')).toEqual(['{"ok":true}']);
  });

  it('tolera ausência do espaço após data:', () => {
    const leitor = new LeitorSse();
    expect(leitor.alimentar('data:{"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('expõe a sobra não terminada, para diagnosticar stream truncado', () => {
    const leitor = new LeitorSse();
    leitor.alimentar('data: {"incompleto":');

    expect(leitor.resto()).toContain('incompleto');
  });

  it('processa um stream realista do Gemini de ponta a ponta', () => {
    const bruto =
      'data: {"candidates":[{"content":{"parts":[{"text":"Você tem "}],"role":"model"}}]}\r\n\r\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"30 dias."}],"role":"model"}}]}\r\n\r\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":57,"candidatesTokenCount":22}}\r\n\r\n';

    const leitor = new LeitorSse();
    const eventos = leitor.alimentar(bruto).map((p) => JSON.parse(p));

    const texto = eventos
      .flatMap((e) => e.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('');

    const uso = eventos.at(-1)?.usageMetadata;

    expect(texto).toBe('Você tem 30 dias.');
    expect(uso).toEqual({ promptTokenCount: 57, candidatesTokenCount: 22 });
  });

  it('produz o mesmo resultado independentemente de como o socket fatia os bytes', () => {
    const bruto =
      'data: {"candidates":[{"content":{"parts":[{"text":"abc"}]}}]}\r\n\r\n' +
      'data: {"usageMetadata":{"promptTokenCount":5}}\r\n\r\n';

    const inteiro = new LeitorSse().alimentar(bruto);

    const porByte = new LeitorSse();
    const fatiado: string[] = [];
    for (const ch of bruto) fatiado.push(...porByte.alimentar(ch));

    expect(fatiado).toEqual(inteiro);
  });
});
