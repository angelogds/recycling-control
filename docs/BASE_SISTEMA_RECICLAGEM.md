# Base funcional do sistema de reciclagem

Este documento transforma a ideia operacional informada em uma base clara de produto para implementação.

## 1) Objetivo do sistema

Controlar, com rastreabilidade por horário, operador e equipamento, todas as etapas do ciclo produtivo:

1. Chegada da matéria-prima (portaria)
2. Descarga na tova de recepção
3. Trituração e carregamento de digestor
4. Cozimento
5. Encerramento do ciclo e liberação do digestor para novo uso

Com esses registros, o sistema deve permitir medir produtividade por equipamento, turno e período (diário, semanal e mensal).

---

## 2) Perfis de acesso (login)

### 2.1 Portaria
Responsável por iniciar o processo com o registro da chegada do caminhão.

**Campos mínimos no registro de chegada:**
- Data/hora de entrada (automática)
- Identificação da frota/caminhão (placa, número interno ou ambos)
- Toneladas da carga (informada manualmente)
- Usuário da portaria logado

### 2.2 Operador
Responsável por executar e finalizar cada fase operacional após a chegada.

**Ações do operador:**
- Confirmar descarga na tova de recepção
- Iniciar e finalizar trituração
- Selecionar digestor (1, 2, 3 ou 4) para carregamento
- Iniciar e finalizar cozimento
- Encerrar ciclo

### 2.3 Administrador (recomendado)
Responsável por cadastros, usuários, parâmetros e relatórios.

---

## 3) Fluxo operacional (ciclo)

## Etapa A — Chegada do caminhão
1. Portaria registra entrada.
2. Sistema grava horário automático.
3. Portaria informa toneladas.
4. Carga fica com status **“Aguardando descarga”**.

## Etapa B — Descarga na tova
1. Operador seleciona a carga aguardando.
2. Operador confirma descarga.
3. Sistema grava horário de descarga.
4. Sistema calcula **tempo de pátio** = descarga - chegada.
5. Sistema incrementa saldo da tova.

## Etapa C — Trituração + carregamento do digestor
1. Operador escolhe digestor destino (1-4).
2. Operador inicia trituração.
3. Sistema grava início da trituração.
4. Operador finaliza trituração ao término do carregamento.
5. Sistema grava fim da trituração.
6. Sistema calcula **tempo de trituração/carregamento**.

## Etapa D — Cozimento
1. Operador inicia cozimento do digestor carregado.
2. Sistema grava início do cozimento.
3. Operador finaliza cozimento.
4. Sistema grava fim do cozimento.
5. Sistema calcula **tempo de cozimento**.

## Etapa E — Encerramento e liberação
1. Sistema encerra o ciclo da carga.
2. Digestor muda status para **“Livre”** (ex.: verde no painel).
3. Digestor volta a ficar disponível para novo ciclo.

---

## 4) Estados e regras de negócio

## 4.1 Status da carga
- `CHEGOU`
- `DESCARREGADA_NA_TOVA`
- `TRITURACAO_EM_ANDAMENTO`
- `TRITURACAO_FINALIZADA`
- `COZIMENTO_EM_ANDAMENTO`
- `CICLO_FINALIZADO`

## 4.2 Status do digestor
- `LIVRE`
- `CARREGANDO`
- `COZINHANDO`

## 4.3 Regras essenciais
- Só iniciar trituração se houver carga descarregada na tova.
- Só iniciar cozimento se trituração tiver sido finalizada.
- Um digestor não pode receber duas cargas simultâneas.
- Data/hora de eventos críticos deve ser sempre automática (servidor).
- Todo evento deve guardar o usuário responsável (auditoria).

---

## 5) Dados mínimos por ciclo (rastreabilidade)

- ID da carga/ciclo
- Caminhão/frota
- Toneladas
- Data/hora de chegada
- Usuário da portaria
- Data/hora de descarga na tova
- Usuário operador da descarga
- Digestor selecionado
- Data/hora início e fim da trituração
- Usuário operador da trituração
- Data/hora início e fim do cozimento
- Usuário operador do cozimento
- Durações calculadas:
  - Tempo chegada → descarga
  - Tempo de trituração
  - Tempo de cozimento
  - Tempo total do ciclo
- Turno operacional (manhã/tarde/noite)

---

## 6) Telas sugeridas

## 6.1 Login
- Acesso separado por perfil (Portaria, Operador, Admin)

## 6.2 Painel Portaria
- Registrar chegada de caminhão
- Lista de chegadas do dia com status

## 6.3 Painel Operador
- Filas: “Aguardando descarga”, “Aguardando trituração”, “Em cozimento”
- Cartões dos digestores 1-4 com status visual
- Botões de início/finalização por etapa

## 6.4 Painel de digestores
- Visão em tempo real do estado de cada digestor
- Nome/foto do digestor e operador responsável no ciclo atual

## 6.5 Relatórios
- Diário, semanal e mensal
- Filtros por período, operador, digestor, turno
- Indicadores de tempo médio por etapa
- Exportação PDF com identificação de operadores do turno

---

## 7) Indicadores (KPIs)

- Tempo médio de pátio (chegada → descarga)
- Tempo médio de trituração por digestor
- Tempo médio de cozimento por digestor
- Ciclos por turno / dia / semana / mês
- Toneladas processadas por período
- Utilização de cada digestor (%)
- Ranking técnico de gargalos por etapa (tempo acima da meta)

---

## 8) Estrutura técnica recomendada

- **Back-end:** API com autenticação por perfil
- **Banco:** tabelas de usuários, cargas, eventos de ciclo, digestores, turnos
- **Front-end:** dashboards por perfil com atualização periódica
- **Auditoria:** log de ações por usuário e horário
- **Relatórios:** geração PDF/CSV

---

## 9) MVP (primeira versão)

Para começar rápido e gerar valor imediato:

1. Login (portaria e operador)
2. Registro de chegada com tonelagem
3. Confirmação de descarga na tova
4. Fluxo completo de trituração e cozimento por digestor
5. Cálculo automático dos tempos por etapa
6. Relatório diário simples por digestor e operador

---

## 10) Próximos incrementos

- Integração com balança para capturar tonelagem automática
- Alertas de etapa acima do tempo padrão
- Painel TV em tempo real na operação
- Metas por turno/equipamento
- Assinatura digital do operador no fechamento de ciclo
