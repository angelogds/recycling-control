# Arquitetura futura — Portal Mestre Campo do Gado

## Objetivo
Criar uma página central para acesso aos sistemas industriais da Campo do Gado sem acoplar os bancos de dados de cada aplicação nesta primeira etapa.

## Fase 1 — Portal de direcionamento
- Portal único com identidade visual Campo do Gado.
- Cards para cada sistema disponível: Produção/Reciclagem, Manutenção V2, Graxaria e futuros módulos.
- Cada card abre o sistema correspondente pela URL configurada.
- Cadastro central de sistemas por nome, ícone, URL, status e ordem de exibição.
- Não duplicar regras de negócio dos sistemas existentes.

## Fase 2 — Identidade e autenticação
- Avaliar login central/SSO para evitar múltiplas credenciais.
- Mapear perfis e permissões por sistema antes de compartilhar sessão.
- Nunca liberar módulos apenas porque o usuário possui acesso ao portal.

## Fase 3 — Integração de dados
- Expor APIs específicas e versionadas em cada sistema.
- Priorizar integração por identificadores estáveis e não por acesso direto ao SQLite de outro sistema.
- Exemplos futuros: equipamento/manutenção, produção por turno, paradas, disponibilidade e indicadores gerenciais.
- Manter cada sistema responsável pela integridade do próprio banco.

## Diretriz
Primeiro padronizar interface e estabilidade de cada aplicação. Depois integrar autenticação e dados de forma controlada, evitando criar dependência direta entre os bancos atuais.
