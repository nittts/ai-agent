import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

const NOME_TRACER = 'assistente-rh-ti';

export function comSpan<T>(
  nome: string,
  atributos: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return trace.getTracer(NOME_TRACER).startActiveSpan(nome, { attributes: atributos }, async (span) => {
    try {
      const resultado = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return resultado;
    } catch (erro) {
      span.recordException(erro instanceof Error ? erro : new Error(String(erro)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: erro instanceof Error ? erro.message : String(erro),
      });
      throw erro;
    } finally {
      span.end();
    }
  });
}

export function anotarSpanAtual(atributos: Attributes): void {
  trace.getActiveSpan()?.setAttributes(atributos);
}
