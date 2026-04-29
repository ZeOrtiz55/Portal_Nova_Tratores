-- Tabela para armazenar coordenadas confirmadas por cliente
-- Evita re-geocodificação e re-confirmação toda vez que o técnico visita o mesmo cliente
CREATE TABLE IF NOT EXISTS clientes_coordenadas (
  id SERIAL PRIMARY KEY,
  cnpj TEXT,
  nome_cliente TEXT NOT NULL,
  endereco TEXT NOT NULL,
  cidade TEXT DEFAULT '',
  coordenadas JSONB NOT NULL, -- { lat: number, lng: number }
  confirmado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca rápida por CNPJ ou nome
CREATE INDEX IF NOT EXISTS idx_clientes_coord_cnpj ON clientes_coordenadas (cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_coord_nome ON clientes_coordenadas (nome_cliente);

-- Constraint: um registro por combinação cnpj+endereco ou nome+endereco
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_coord_unique
  ON clientes_coordenadas (COALESCE(cnpj, ''), nome_cliente, endereco);

-- Adiciona coluna cnpj na agenda_visao (para lookup de coordenadas salvas)
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "cnpj" TEXT DEFAULT '';
