import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

export function iniciarOtel(nomeServico: string, versao: string): void {
  if (sdk) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: nomeServico,
      [ATTR_SERVICE_VERSION]: versao,
    }),

    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  });

  sdk.start();
}

export async function encerrarOtel(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
