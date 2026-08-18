import { describe, it, expect } from 'vitest';
import { mergeFacts, sanitiseFacts } from '../../../src/domain/conversation';

/**
 * A matrícula é fato da SESSÃO, não turno de conversa.
 *
 * Guardá-la no histórico a fazia expirar com a janela de 6 turnos: quem dizia
 * "use esse id daqui em diante" e fazia duas perguntas sobre política voltava a
 * ouvir "preciso da sua matrícula". Fato e turno têm tempos de vida diferentes.
 */
describe('sanitiseFacts', () => {
  it('aceita uma matrícula inteira e positiva', () => {
    expect(sanitiseFacts({ employeeId: 1042 })).toEqual({ employeeId: 1042 });
  });

  it.each([{ employeeId: 0 }, { employeeId: -3 }, { employeeId: 1.5 }, { employeeId: 'x' }, null, 'oi', undefined])(
    'descarta o que não é matrícula: %s',
    (entrada) => {
      expect(sanitiseFacts(entrada)).toEqual({});
    },
  );

  /** O campo vem do cliente; nada além do que conhecemos pode entrar. */
  it('ignora campos desconhecidos vindos do cliente', () => {
    expect(sanitiseFacts({ employeeId: 1042, admin: true })).toEqual({ employeeId: 1042 });
  });
});

describe('mergeFacts', () => {
  it('o fato novo sobrescreve o antigo', () => {
    expect(mergeFacts({ employeeId: 1042 }, { employeeId: 2001 })).toEqual({ employeeId: 2001 });
  });

  it('ausência não apaga o que já se sabia — é isso que faz o fato durar', () => {
    expect(mergeFacts({ employeeId: 1042 }, {})).toEqual({ employeeId: 1042 });
    expect(mergeFacts({ employeeId: 1042 }, { employeeId: undefined })).toEqual({ employeeId: 1042 });
  });
});
