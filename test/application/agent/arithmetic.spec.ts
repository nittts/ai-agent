import { describe, it, expect } from 'vitest';
import { checkArithmetic } from '../../../src/application/agent/verification';

/**
 * Confere a conta que a resposta ESCREVE, deterministicamente.
 *
 * LIMITE DITO DE FRENTE: isto pega conta que NÃO FECHA, não premissa errada.
 * O defeito famoso deste projeto — "30 − 10 = 20 dias restantes" — passa aqui
 * intacto, porque trinta menos dez É vinte. O erro estava em partir de 30 em
 * vez do saldo de 18, e nenhuma checagem sintática distingue isso. Contra
 * premissa errada o remédio foi ancorar o fato no corpus.
 *
 * O que sobra ainda vale: o modelo escrever "18 - 10 = 9" e ninguém notar.
 *
 * Escolha deliberada: verificar em vez de chamar uma calculadora. Uma
 * ferramenta tornaria a matemática exata e custaria um hop, quebrando o "número
 * fixo de chamadas por rota" que é o argumento central do grafo.
 */
describe('checkArithmetic', () => {
  it('aceita uma conta correta escrita com símbolos', () => {
    expect(checkArithmetic('18 - 10 = 8 dias restantes.')).toEqual([]);
  });

  it('acusa a conta que não fecha', () => {
    expect(checkArithmetic('18 - 10 = 9 dias restantes.')).toEqual(['18 - 10 = 9']);
  });

  /** A conta certa sobre a premissa errada PASSA — e tem de passar. */
  it('não é capaz de julgar a premissa, só a operação', () => {
    expect(checkArithmetic('30 - 10 = 20 dias restantes.')).toEqual([]);
  });

  /** Como o modelo realmente escreve: com rótulos no meio dos números. */
  it('atravessa os parênteses explicativos que o modelo intercala', () => {
    const errada = 'Fazendo o cálculo: 18 dias (saldo) - 10 dias (vendidos) = 9 dias restantes.';
    expect(checkArithmetic(errada)).toHaveLength(1);

    const certa = '18 dias (saldo atual) - 10 dias (vendidos) = 8 dias de descanso.';
    expect(checkArithmetic(certa)).toEqual([]);
  });

  it('entende o operador escrito por extenso', () => {
    expect(checkArithmetic('18 dias de saldo menos 10 dias vendidos = 9 dias')).toHaveLength(1);
    expect(checkArithmetic('18 dias de saldo menos 10 dias vendidos = 8 dias')).toEqual([]);
  });

  it('confere multiplicação e divisão', () => {
    expect(checkArithmetic('R$ 150,00 x 12 meses = R$ 1.800,00')).toEqual([]);
    expect(checkArithmetic('R$ 150,00 x 12 meses = R$ 1.500,00')).toHaveLength(1);
    expect(checkArithmetic('24 horas ÷ 8 horas por dia = 3 dias')).toEqual([]);
  });

  /** Sem conta escrita não há o que conferir — e silêncio é a resposta certa. */
  it.each([
    'Você tem 18 dias de férias disponíveis [1].',
    'O limite é de no máximo 1/3 do período.',
    'O prazo é de 30 dias corridos a partir da data da despesa.',
  ])('não inventa achado onde não há conta: %s', (texto) => {
    expect(checkArithmetic(texto)).toEqual([]);
  });
});
