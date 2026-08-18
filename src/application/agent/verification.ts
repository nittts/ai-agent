export interface VerificationInput {
  answer: string;
  context: string;
  sourceCount: number;
  /**
   * A pergunta conta como evidência para efeito de números.
   *
   * "multiplicado por 12 meses" põe o 12 na conta sem que ele esteja em fonte
   * alguma, e a resposta correta então cita 1800. Um número que o USUÁRIO
   * forneceu não é invenção do modelo — sinalizá-lo transformaria o detector em
   * ruído, e detector ruidoso é ignorado, que é o mesmo que não existir.
   */
  question?: string;
}

export interface VerificationResult {
  ok: boolean;
  unsupportedFigures: number[];
  invalidCitations: number[];
}

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

const FIGURE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

const DERIVATION_TOLERANCE = 0.001;

export function citedMarkers(text: string): number[] {
  const out: number[] = [];

  for (const match of text.matchAll(CITATION)) {
    for (const part of match[1].split(',')) out.push(Number(part.trim()));
  }

  return out;
}

export function extractFigures(text: string): number[] {
  const semCitacoes = text.replace(CITATION, ' ');
  const semRazoes = semCitacoes.replace(/\d+\s*\/\s*\d+/g, ' ');

  const out: number[] = [];

  for (const raw of semRazoes.match(FIGURE) ?? []) {
    const value = Number(raw.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(value)) out.push(value);
  }

  return out;
}

function derivable(value: number, known: number[]): boolean {
  for (const a of known) {
    for (const b of known) {
      const candidates = [a + b, a - b, a * b, b === 0 ? NaN : a / b];
      if (candidates.some((c) => Math.abs(c - value) < DERIVATION_TOLERANCE)) return true;
    }
  }

  return false;
}

export function verifyAnswer({
  answer,
  context,
  sourceCount,
  question = '',
}: VerificationInput): VerificationResult {
  const invalidCitations = [...new Set(citedMarkers(answer))].filter(
    (n) => n < 1 || n > sourceCount,
  );

  const known = [...extractFigures(context), ...extractFigures(question)];
  const claimed = [...new Set(extractFigures(answer))];

  const unsupportedFigures =
    sourceCount === 0
      ? []
      : claimed.filter((value) => !known.includes(value) && !derivable(value, known));

  return {
    ok: invalidCitations.length === 0 && unsupportedFigures.length === 0,
    unsupportedFigures,
    invalidCitations,
  };
}

const OPERADORES: Record<string, (a: number, b: number) => number> = {
  '-': (a, b) => a - b,
  '−': (a, b) => a - b,
  menos: (a, b) => a - b,
  '+': (a, b) => a + b,
  mais: (a, b) => a + b,
  x: (a, b) => a * b,
  '*': (a, b) => a * b,
  '×': (a, b) => a * b,
  vezes: (a, b) => a * b,
  '/': (a, b) => (b === 0 ? NaN : a / b),
  '÷': (a, b) => (b === 0 ? NaN : a / b),
};

const CONTA = new RegExp(
  String.raw`(\d[\d.,]*)[^\d=]{0,45}?(−|×|÷|[-+*/x]|menos|mais|vezes)[^\d=]{0,45}?(\d[\d.,]*)[^\d=]{0,45}?=[^\d]{0,25}?(\d[\d.,]*)`,
  'gi',
);

function paraNumero(bruto: string): number {
  const limpo = bruto.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.').replace(/[.,]$/, '');
  return Number(limpo);
}

export function checkArithmetic(answer: string): string[] {
  const erradas: string[] = [];

  for (const [, a, op, b, resultado] of answer.matchAll(CONTA)) {
    const calcular = OPERADORES[op.toLowerCase()];
    if (!calcular) continue;

    const [x, y, z] = [paraNumero(a), paraNumero(b), paraNumero(resultado)];
    if (![x, y, z].every(Number.isFinite)) continue;

    const esperado = calcular(x, y);
    if (!Number.isFinite(esperado)) continue;

    if (Math.abs(esperado - z) > DERIVATION_TOLERANCE) {
      erradas.push(`${a} ${op} ${b} = ${resultado}`);
    }
  }

  return erradas;
}
