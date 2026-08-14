# Política de Acesso e Segurança de TI

## Senha corporativa

A senha corporativa deve ter no mínimo 12 caracteres, combinando letras maiúsculas,
minúsculas, números e ao menos um caractere especial. A troca é obrigatória a cada 180
dias, e as últimas 5 senhas não podem ser reutilizadas.

### Reset de senha

O colaborador pode redefinir a própria senha pelo portal de autoatendimento em
`portal.interno/senha`, usando o segundo fator já cadastrado. O processo é imediato e não
exige abertura de chamado.

Se o segundo fator estiver indisponível — aparelho perdido, trocado ou sem acesso — é
necessário abrir chamado na categoria `acesso`. Nesse caso o time de TI valida a
identidade por videochamada com documento oficial antes de liberar a redefinição.

## Autenticação multifator (MFA)

O MFA é obrigatório para todos os colaboradores, sem exceção, e se aplica a e-mail,
VPN, portal do colaborador e console de nuvem.

São aceitos como segundo fator: aplicativo autenticador (TOTP) e chave de segurança
física (FIDO2). SMS não é aceito como segundo fator.

## VPN

O acesso à rede interna a partir de fora do escritório exige VPN corporativa. O cliente
de VPN é instalado automaticamente nos equipamentos fornecidos pela empresa.

A conexão de VPN exige MFA a cada 12 horas. Sessões ficam limitadas a 12 horas contínuas
e são encerradas automaticamente após esse período.

### Acesso a partir do exterior

Conexões de VPN originadas fora do Brasil são bloqueadas por padrão. Para viagens
internacionais, o colaborador deve abrir chamado na categoria `acesso` com no mínimo 5
dias úteis de antecedência, informando país e período.

A liberação é temporária, limitada ao período informado, e exige MFA por chave de
segurança física — aplicativo autenticador não é suficiente para acesso internacional.

## Equipamentos

O equipamento padrão fornecido é notebook corporativo com disco criptografado. A
solicitação de equipamento adicional (monitor, dock, periféricos) é feita por chamado na
categoria `equipamento`.

É proibido instalar software não homologado, desabilitar a criptografia de disco ou o
antivírus corporativo, e conectar dispositivos de armazenamento removível não
autorizados.

## Chamados e SLA

Os chamados de TI seguem os seguintes prazos de atendimento:

- Categoria `acesso`: 3 dias úteis.
- Categoria `equipamento`: 10 dias úteis.
- Categoria `software`: 5 dias úteis.
- Incidente com severidade crítica: 4 horas.

O prazo é contado a partir da abertura do chamado. Chamados que ultrapassam o SLA são
escalados automaticamente para a liderança de TI.

## Uso de ferramentas de IA

É permitido usar assistentes de IA aprovados pela empresa para apoio ao trabalho. É
proibido inserir dados pessoais de clientes, credenciais, código proprietário ou
informação financeira não pública em ferramentas de IA não homologadas.
