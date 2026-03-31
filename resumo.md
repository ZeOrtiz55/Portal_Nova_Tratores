# Portal Nova Tratores - Resumo Completo

## Visao Geral

Portal interno da **Nova Tratores** para gestao de pos-vendas, financeiro, pecas, requisicoes e tarefas. Aplicacao full-stack com Next.js 16 + Supabase (PostgreSQL + Realtime + Storage + Auth).

**Stack:** Next.js 16.1.6 | React 19.2.3 | TypeScript | Supabase | Tailwind CSS 4

**Dominio:** Empresa de tratores/maquinario agricola com duas unidades: **Nova Tratores** (principal) e **Castro Pecas**.

---

## Estrutura do Projeto

```
src/
  app/
    (portal)/           # Rotas protegidas (requer login)
      dashboard/        # Hub central com cards de modulos
      admin/            # Painel admin (permissoes de usuarios)
      pos/              # Ordens de Servico (OS) - Kanban
      ppv/              # Pedidos Pos-Venda (pecas) - Kanban
      financeiro/       # Modulo financeiro (15 sub-paginas)
      propostas/        # Propostas comerciais
      requisicoes/      # Requisicoes de material
      revisoes/         # Controle de revisoes de equipamentos
      tarefas/          # Gestao de tarefas entre usuarios
      atividades/       # Log de auditoria geral
      agenda-tecnicos/  # Agenda semanal dos tecnicos
      painel-mecanicos/ # Painel de gestao dos mecanicos
      meu-painel/       # Painel individual do tecnico
    api/                # Backend API routes
      pos/              # 17 endpoints (inclui estimativa de tempo)
      ppv/              # 13 endpoints
      financeiro/       # 1 endpoint (notificacoes)
      tarefas/          # 3 endpoints
      revisoes/         # 2 endpoints
      push/             # Push notifications
    login/              # Pagina de login/registro
  components/
    pos/                # 11 componentes (OS drawer, kanban, log, etc.)
    ppv/                # 18 componentes (kanban, formularios, modais)
    financeiro/         # 9 componentes (nav, notificacoes, chat, export)
    requisicoes/        # 8 componentes (kanban, forms, PDF)
    propostas/          # Componentes de propostas
    chat/               # ChatPanel.tsx
    PortalLayout.tsx    # Layout principal (sidebar, notificacoes, chat)
    SemPermissao.tsx    # Tela de acesso negado
  hooks/
    useAuth.ts          # Sessao + perfil do usuario
    usePermissoes.ts    # Controle de acesso por modulo
    useChat.ts          # Sistema de chat em tempo real
    useNotificacoes.ts  # Notificacoes com browser notifications
    useAuditLog.ts      # Log de auditoria
    useRefreshOnFocus.ts # Auto-refresh ao voltar na aba
  lib/
    supabase.ts         # Cliente Supabase (client-side)
    pos/                # Logica POS (omie, sync, types, constants, ors)
    ppv/                # Logica PPV (omie, schemas, queries, types)
    financeiro/         # Utils, constants, export (PDF/Excel)
    revisoes/           # Logica de revisoes
    tarefas/            # (migrado do Vikunja para Supabase)
```

---

## Modulos

### 1. POS - Ordens de Servico (`/pos`)

Gerencia ordens de servico de manutencao/revisao de tratores.

**Fases (11):**
1. Orcamento
2. Orcamento enviado para o cliente e aguardando
3. Execucao
4. Execucao Procurando pecas
5. Execucao aguardando pecas (em transporte)
6. Executada aguardando comercial
7. Aguardando outros
8. Aguardando ordem Tecnico
9. Executada aguardando cliente
10. Concluida
11. Cancelada

**Funcionalidades:**
- Kanban por fases com accordion colapsavel (Concluida/Cancelada fechadas por padrao)
- Drawer lateral para criar/editar OS com: cliente, tecnicos, horas, km, pecas, requisicoes, descontos
- Calculo automatico: Horas x R$193 + KM x R$2.80 + Pecas + Requisicoes - Descontos
- Auto-move por data: Previsao de execucao atingida → move para Execucao automaticamente
- Metricas de atraso por tecnico (tecnico_metricas)
- Lembretes por cliente
- Log de atividades por OS (logs_ppo)
- Impressao de OS
- Integracao Omie (enviar OS e criar Pedido de Venda)

- Estimativa de tempo automatica (ida + servico + volta) usando OpenRouteService API
  - Base: Nova Tratores - Av. Sao Sebastiao, 1065, Vila Campos, Piraju-SP (lat: -23.209201, lng: -49.370573)
  - Busca endereco do cliente em 2 fontes (Omie e OS), tenta cada uma ate geocodificar
  - Dropdown para escolher entre enderecos disponiveis + campo editavel + botao Fixar/Recalcular
  - Badge indica fonte do endereco: OMIE, CLIENTE MANUAL ou ENDERECO DA OS
- Multiplos dias de execucao por OS (sincroniza com agenda_tecnico)

**Tabelas:** `Ordem_Servico`, `logs_ppo`, `tecnico_metricas`, `lembretes_clientes`, `agenda_tecnico`

**Campos principais da OS:**
| Campo | Descricao |
|-------|-----------|
| Id_Ordem | PK (ex: OS-0001) |
| Status | Fase atual |
| Os_Cliente, Cnpj_Cliente | Cliente |
| Os_Tecnico, Os_Tecnico2 | Ate 2 tecnicos |
| Qtd_HR, Qtd_KM | Horas e km |
| Valor_Total | Calculado automaticamente |
| ID_PPV | PPVs vinculados (separados por virgula) |
| Id_Req | Requisicoes vinculadas |
| Ordem_Omie | Numero da OS no Omie (quando enviada) |
| Previsao_Execucao | Data para auto-move |
| Previsao_Faturamento | Data de faturamento |
| Cidade_Cliente | Cidade do cliente |
| Desconto, Desconto_Hora, Desconto_KM | Descontos aplicados |

---

### 2. PPV - Pedidos Pos-Venda (`/ppv`)

Gerencia movimentacao de pecas (saidas e devolucoes).

**Status (5):**
1. Aguardando (laranja)
2. Em Andamento (azul)
3. Aguardando Para Faturar (roxo)
4. Fechado (verde)
5. Cancelado (vermelho)

**Funcionalidades:**
- Kanban com 5 colunas de status
- 4 abas: Gestao (kanban), Novo Lancamento, Catalogo de Pecas, Rastreio
- Busca de produtos (Omie + manuais), clientes e OS vinculada
- Tipos de saida: Venda Balcao, Orcamento Cliente, Saida Tecnico (com/sem OS)
- Suporte a devolucoes (credito/estorno)
- Catalogo de pecas com CRUD
- Rastreio de encomendas
- Geracao de PDF
- Integracao Omie (Pedido de Venda) - multi-empresa (Nova Tratores + Castro Pecas)

**Tabelas:** `pedidos`, `movimentacoes`, `Produtos_Completos`, `Produtos_Manuais`, `logs_ppv`

**Sync POS ↔ PPV:**
- OS em Execucao → PPV muda para "Em Andamento"
- OS Executada → PPV muda para "Aguardando Para Faturar"
- Sincronizacao bidirecional via `sync-ppv.ts`

---

### 3. Financeiro (`/financeiro`)

Modulo financeiro com visoes separadas para equipe Financeiro e Pos-Vendas.

**Sub-paginas (16):**
| Rota | Descricao |
|------|-----------|
| `/financeiro` | Redirect baseado na funcao do usuario |
| `/home-financeiro` | Painel do Financeiro (Faturamento + Pagar + RH) |
| `/home-posvendas` | Painel do Pos-Vendas (cards para enviar/cobrar) |
| `/kanban-financeiro` | Kanban do Financeiro (5 colunas NF) |
| `/kanban` | Kanban do Pos-Vendas |
| `/vencidos` | Aba dedicada para cards vencidos (com badge pulsante) |
| `/dashboard` | Dashboard analitico |
| `/historico-pagar` | Historico de contas a pagar |
| `/historico-receber` | Historico de contas a receber |
| `/historico-rh` | Historico de chamados RH |
| `/relatorio-pagar` | Relatorio de pagamentos |
| `/novo-chamado-nf` | Criar chamado NF |
| `/novo-chamado-rh` | Criar chamado RH |
| `/novo-pagar-receber` | Criar conta a pagar/receber |
| `/configuracoes` | Configuracoes do usuario |
| `/logs` | Logs de auditoria do financeiro (somente admins) |

**Fluxo NF (Chamado_NF):**
```
gerar_boleto → enviar_cliente → aguardando_vencimento → pago
                                                       → vencido (se passou da data)
```

**Formas de pagamento:** Pix, Boleto 30 dias, Boleto Parcelado, Cartao a vista, Cartao Parcelado

**Regras automaticas:**
- Pix: nao mostra opcao de anexar boleto
- Boleto anexado em "gerar_boleto" → auto-move para "enviar_cliente"
- Boleto 30 dias vencido → auto-move para "pago"
- Outros vencidos sem comprovante → auto-move para "vencido"

**Notificacoes cruzadas:**
- Pos-Vendas move card → notifica Financeiro (`alvo: "financeiro"`)
- Financeiro move card → notifica Pos-Vendas (`alvo: "posvendas"`)
- Kanban/Vencidos → notifica baseado na `funcao` do usuario

**Tabelas:** `Chamado_NF`, `finan_pagar`, `finan_receber`, `finan_rh`, `mensagens_chat`, `portal_notificacoes`

---

### 4. Propostas (`/propostas`)

Gestao de propostas comerciais com Kanban. Duas perspectivas: clientes e fabricas. Modais dinamicos para criar/editar propostas, clientes, equipamentos e tratores. Inclui lixeira/reciclagem.

---

### 5. Requisicoes (`/requisicoes`)

Sistema de requisicoes de material/servico com Kanban. Gestao de fornecedores, usuarios e veiculos. Geracao de PDF para impressao. Integracao com notificacoes e auditoria.

**Tabelas:** `Solicitacao_Requisicao`, `Atualizar_Req`, `Fornecedores`, `Equipamentos`

---

### 6. Revisoes (`/revisoes`)

Controle de manutencao preventiva de equipamentos. Processa registros via email com anexos. Rastreia modelos, chassis e horas de manutencao. Calcula previsoes de revisao.

**Integracao:** Gmail (nodemailer) para notificacoes por email.

---

### 7. Tarefas (`/tarefas`)

Gestao de tarefas entre usuarios (migrado do Vikunja para Supabase).

**Prioridades:** Sem prioridade, Baixa, Normal, Alta, Urgente, Critica

**Status:** Pendente, Atrasada, Concluida

**Tabela:** `portal_tarefas` (com FK para `financeiro_usu`)

---

### 8. Dashboard (`/dashboard`)

Hub central com cards de acesso rapido para todos os modulos. Mostra resumo de tarefas pendentes e informacoes relevantes.

---

### 9. Admin (`/admin`)

Painel administrativo para gerenciar permissoes de usuarios.

**Modulos controlados:** Financeiro, Requisicoes, Revisoes, Pos-Vendas, Pecas, Propostas, Tarefas, Atividades, Mapa Geral, Painel Mecanicos

**Funcionalidades:**
- Controle de permissoes por modulo (toggle individual + toggle todos)
- Toggle admin por usuario
- Categoria (Pos Vendas, Pecas, Comercial, Financeiro)
- Exibe email do usuario (populado automaticamente no login)

---

### 10. Agenda Tecnicos (`/agenda-tecnicos`)

Agenda semanal dos tecnicos de campo.

**Funcionalidades:**
- Agendamento vinculado a OS ou servico manual (sem OS)
- Servicos manuais com nome do cliente e endereco
- Sincronizacao automatica com datas de execucao das OS
- Selecao de turno (manha, tarde, integral)
- Cards com tag "MANUAL" para servicos sem OS

**Tabela:** `agenda_tecnico` (tecnico_nome, id_ordem, data_agendada, turno, cliente, endereco, descricao, status)

---

### 11. Painel Mecanicos (`/painel-mecanicos`)

Painel de gestao dos mecanicos/tecnicos de campo. Acesso controlado pelo modulo `painel-mecanicos` no admin.

**Funcionalidades:**
- Visao geral dos tecnicos
- Agenda semanal com grid visual (mostra OS e servicos manuais)
- Caminhos, ocorrencias, justificativas
- Requisicoes de material dos tecnicos
- Cidade do cliente visivel nos cards

**Tabelas:** `mecanico_usuarios`, `agenda_tecnico`, `Ordem_Servico`

---

### 12. Atividades (`/atividades`)

Visualizador de log de auditoria. Mostra acoes de usuarios em todos os modulos com filtros por sistema e paginacao.

**Tabela:** `audit_log`

---

## Sistema de Autenticacao

1. **Supabase Auth** - Email/senha
2. **Login** (`/login`) - Login + registro com upload de avatar
3. **Perfil** - Armazenado em `financeiro_usu` (id UUID, nome, funcao, avatar_url)
4. **Permissoes** - `portal_permissoes` (user_id, is_admin, modulos_permitidos[])
5. **Funcao** - Campo `funcao` em `financeiro_usu`: "Financeiro" ou "Pos-Vendas" (determina visao no modulo financeiro e alvo de notificacoes)

---

## Banco de Dados (Supabase/PostgreSQL)

### Tabelas Principais

**Usuarios e Permissoes:**
- `financeiro_usu` - Usuarios (id, nome, funcao, avatar_url, email, som_notificacao, tema)
- `portal_permissoes` - Permissoes por modulo (user_id, is_admin, modulos_permitidos[])

**POS:**
- `Ordem_Servico` - Ordens de servico
- `logs_ppo` - Logs de atividade POS
- `tecnico_metricas` - Metricas de desempenho
- `lembretes_clientes` - Lembretes por cliente
- `agenda_tecnico` - Agenda dos tecnicos (tecnico_nome, id_ordem, data_agendada, turno, cliente, endereco, descricao, status)

**PPV:**
- `pedidos` - Pedidos pos-venda
- `movimentacoes` - Itens/movimentacoes de pecas
- `Produtos_Completos` - Catalogo Omie
- `Produtos_Manuais` - Produtos manuais
- `logs_ppv` - Logs de atividade PPV

**Financeiro:**
- `Chamado_NF` - Cards de NF (boleto/pix workflow)
- `finan_pagar` - Contas a pagar
- `finan_receber` - Contas a receber
- `finan_rh` - Chamados RH
- `mensagens_chat` - Chat por card

**Compartilhadas:**
- `Clientes` - Clientes (sync Omie)
- `Clientes_Manuais` - Clientes manuais
- `Tecnicos_Appsheet` - Tecnicos
- `Projeto` - Projetos/equipamentos
- `Fornecedores` - Fornecedores
- `Equipamentos` - Equipamentos

**Sistema:**
- `portal_notificacoes` - Notificacoes
- `portal_tarefas` - Tarefas
- `portal_chats` - Salas de chat
- `portal_chat_membros` - Membros de chat
- `portal_mensagens` - Mensagens de chat
- `portal_chat_leitura` - Leitura de mensagens
- `audit_log` - Log de auditoria
- `push_subscriptions` - Push notifications

**Storage Buckets:** `avatars`, `anexos`, `chat-anexos`, `chat-midia`

---

## Integracoes Externas

### Omie ERP
- **Uso:** Envio de OS e Pedidos de Venda, sync de clientes/projetos/produtos
- **Contas:** Nova Tratores (principal) + Castro Pecas (pecas)
- **Endpoints:** `https://app.omie.com.br/api/v1/`
  - `/geral/clientes/` - Clientes
  - `/geral/vendedores/` - Vendedores/tecnicos
  - `/geral/produtos/` - Produtos
  - `/geral/projetos/` - Projetos
  - `/servicos/os/` - Ordens de servico
  - `/produtos/pedido/` - Pedidos de venda
- **Arquivos:** `src/lib/pos/omie.ts`, `src/lib/ppv/omie.ts`, `src/lib/pos/sync-omie.ts`

### OpenRouteService (ORS)
- **Uso:** Geocodificacao de enderecos e calculo de rotas para estimativa de tempo do tecnico
- **API:** `https://api.openrouteservice.org/` (plano free, 1000 req/dia)
  - `/geocode/search` - Geocodificacao de endereco para coordenadas
  - `/v2/directions/driving-car` - Calculo de rota entre dois pontos
- **Base:** Nova Tratores, Av. Sao Sebastiao 1065, Piraju-SP (lat: -23.209201, lng: -49.370573)
- **Arquivo:** `src/lib/pos/ors.ts`

### Gmail (Nodemailer)
- **Uso:** Notificacoes de revisao de equipamentos
- **Arquivo:** `src/app/api/revisoes/emails/route.ts`

### Web Push
- **Uso:** Notificacoes push no navegador
- **Lib:** `web-push`

---

## Hooks Customizados

| Hook | Funcao |
|------|--------|
| `useAuth` | Sessao Supabase + perfil (id, nome, funcao, avatar_url) + logout |
| `usePermissoes` | Busca permissoes, verifica acesso a modulos, cache por userId |
| `useChat` | Chat em tempo real (individual + grupo), mensagens, leitura, upload |
| `useNotificacoes` | Notificacoes real-time, browser notifications, titulo piscante |
| `useAuditLog` | Insere logs na tabela audit_log |
| `useRefreshOnFocus` | Re-executa callback ao voltar na aba (debounce 30s) |

---

## Sistema de Notificacoes

**3 camadas:**
1. **Portal** - `portal_notificacoes` + Supabase Realtime (sino no header)
2. **Browser** - `Notification API` quando aba em background
3. **Push** - Service Worker + VAPID keys para notificacoes mesmo com navegador fechado

**Financeiro especifico:**
- `marcarMinhaAcao()` - Evita auto-notificacao (debounce 15s)
- `alvo` param: "financeiro" | "posvendas" | undefined
- Sons configuráveis (3 opcoes)

---

## Variaveis de Ambiente

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Omie - Nova Tratores
OMIE_APP_KEY=
OMIE_APP_SECRET=

# Omie - Castro Pecas (hardcoded em lib/ppv/omie.ts)

# Gmail
GMAIL_USER=
GMAIL_APP_PASSWORD=

# Push Notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY=

# OpenRouteService (Estimativa de tempo POS)
ORS_API_KEY=
```

---

## Valores de Negocio (Constants)

| Constante | Valor |
|-----------|-------|
| VALOR_HORA | R$ 193,00 |
| VALOR_KM | R$ 2,80 |
| Fases POS | 11 fases |
| Status PPV | 5 status |
| Status NF | 7 status |
| Prioridades Tarefa | 6 niveis (0-5) |

---

## Padroes do Codigo

- **Fetch Pattern:** API routes usam Supabase client direto; frontend usa `fetch()` para API routes
- **Estado:** Componentes locais com useState/useCallback; PPV usa React Context
- **Real-time:** Supabase Realtime channels para atualizacoes ao vivo
- **UI:** Drawer/modal pattern para detalhes; Kanban para fluxos; Accordion para agrupamento
- **Otimizacao:** useMemo para filtros client-side; Promise.all para queries paralelas; useRefreshOnFocus
- **Logs:** Cada modulo tem sua tabela de logs (logs_ppo, logs_ppv, audit_log)
- **Auditoria:** `useAuditLog` hook registra acoes em tabela centralizada
- **Export:** PDF (jsPDF) + Excel (xlsx) para relatorios
