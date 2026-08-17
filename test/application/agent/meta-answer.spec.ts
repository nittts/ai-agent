import { describe, it, expect } from 'vitest';
import { metaAnswerFor } from '../../../src/application/agent/nodes/meta.node';

const DESPEDIDA = /fico por aqui|é só chamar|até (mais|logo)|tchau/i;

/**
 * A tabela de decisão do nó `meta`, testada SEM grafo e SEM modelo.
 *
 * O classificador escolhe o tipo; o que se faz com o tipo é decisão nossa, e é
 * só disso que este arquivo trata. Testar isto através do provider fake seria
 * testar as regex do fake — que nunca vão classificar como um modelo de verdade
 * e cuja "aprovação" não diz nada sobre o sistema.
 */
describe('metaAnswerFor', () => {
  it('cumprimento no primeiro contato: apresenta-se por inteiro', () => {
    const texto = metaAnswerFor('greeting', true);

    expect(texto).toContain('Sou o assistente interno');
    expect(texto).not.toMatch(DESPEDIDA);
  });

  it('cumprimento no meio da conversa: cumprimenta de volta, curto', () => {
    const texto = metaAnswerFor('greeting', false);

    expect(texto.length).toBeLessThan(160);
    expect(texto).not.toMatch(DESPEDIDA);
  });

  /**
   * O defeito relatado, travado como invariante: nenhuma combinação pode
   * responder a um cumprimento com uma despedida.
   */
  it.each([true, false])('cumprimento NUNCA vira despedida (primeiro contato: %s)', (primeiro) => {
    expect(metaAnswerFor('greeting', primeiro)).not.toMatch(DESPEDIDA);
  });

  /** Não se encerra uma conversa que ainda não começou. */
  it('encerramento no primeiro contato é impossível — apresenta-se', () => {
    const texto = metaAnswerFor('closing', true);

    expect(texto).toContain('Sou o assistente interno');
    expect(texto).not.toMatch(DESPEDIDA);
  });

  it('encerramento depois de uma resposta: despede-se', () => {
    expect(metaAnswerFor('closing', false)).toMatch(DESPEDIDA);
  });

  it('pergunta sobre o assistente: catálogo inteiro na primeira vez, curto depois', () => {
    const primeira = metaAnswerFor('about', true);
    const segunda = metaAnswerFor('about', false);

    expect(primeira).toContain('Sou o assistente interno');
    expect(segunda.length).toBeLessThan(primeira.length);
    expect(segunda).not.toMatch(DESPEDIDA);
  });

  /**
   * O classificador pode omitir o campo. O padrão precisa ser seguro — e o
   * seguro aqui é falar do que o assistente faz, nunca se despedir.
   */
  it.each([true, false])('tipo ausente nunca vira despedida (primeiro contato: %s)', (primeiro) => {
    expect(metaAnswerFor(undefined, primeiro)).not.toMatch(DESPEDIDA);
  });
});
