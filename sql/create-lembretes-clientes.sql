-- Tabela de lembretes associados a clientes (módulo POS)
CREATE TABLE IF NOT EXISTS lembretes_clientes (
  id BIGSERIAL PRIMARY KEY,
  cliente_chaves TEXT[] NOT NULL DEFAULT '{}',
  cliente_nomes TEXT NOT NULL DEFAULT '',
  lembrete TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para busca por chave de cliente (usado com operador @> / cs)
CREATE INDEX IF NOT EXISTS idx_lembretes_cliente_chaves ON lembretes_clientes USING GIN (cliente_chaves);

-- Índice para busca por nome de cliente (ILIKE)
CREATE INDEX IF NOT EXISTS idx_lembretes_cliente_nomes ON lembretes_clientes USING GIN (cliente_nomes gin_trgm_ops);

-- RLS desabilitado para acesso via anon key (mesmo padrão das outras tabelas)
ALTER TABLE lembretes_clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso público lembretes" ON lembretes_clientes
  FOR ALL USING (true) WITH CHECK (true);
