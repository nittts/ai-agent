import { describe, it, expect } from 'vitest';
import { sanitiseAction } from '../../../src/domain/conversation';

/**
 * A confirmação é a fronteira entre falar e fazer, e ela é de código.
 *
 * O objeto que executa é o mesmo que apareceu na tela, devolvido pelo cliente.
 * Um "sim" nunca volta ao classificador: se voltasse, um pedido ambíguo poderia
 * executar algo diferente do que a pessoa leu e aprovou.
 */
describe('sanitiseAction', () => {
  const valida = { kind: 'open_ticket', employeeId: 1042, category: 'access', title: 'VPN não conecta' };

  it('aceita uma ação bem formada', () => {
    expect(sanitiseAction(valida)).toEqual(valida);
  });

  it.each([
    ['sem matrícula', { ...valida, employeeId: undefined }],
    ['matrícula inválida', { ...valida, employeeId: -1 }],
    ['categoria inventada', { ...valida, category: 'financeiro' }],
    ['título vazio', { ...valida, title: '   ' }],
    ['outro tipo de ação', { ...valida, kind: 'delete_employee' }],
    ['não é objeto', 'sim, pode abrir'],
    ['nulo', null],
  ])('recusa %s — nada executa sem estrutura completa', (_caso, entrada) => {
    expect(sanitiseAction(entrada)).toBeUndefined();
  });

  it('trunca o título em vez de aceitar payload arbitrário', () => {
    const longo = sanitiseAction({ ...valida, title: 'x'.repeat(500) });
    expect(longo?.title).toHaveLength(120);
  });
});
