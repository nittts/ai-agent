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
