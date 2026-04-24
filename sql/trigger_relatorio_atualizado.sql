-- Trigger: quando o técnico anexa o relatório (ID_Relatorio_Final passa de NULL/vazio para um valor),
-- muda o Status automaticamente para "Relatório Atualizado"
-- (apenas se estiver em fase de execução, não altera Concluída/Cancelada)

CREATE OR REPLACE FUNCTION fn_relatorio_atualizado()
RETURNS TRIGGER AS $$
BEGIN
  -- Só atua se ID_Relatorio_Final mudou de vazio/null para preenchido
  IF (OLD."ID_Relatorio_Final" IS NULL OR OLD."ID_Relatorio_Final" = '')
     AND NEW."ID_Relatorio_Final" IS NOT NULL
     AND NEW."ID_Relatorio_Final" != ''
     AND NEW."Status" NOT IN ('Concluída', 'Cancelada', 'Relatório Atualizado')
  THEN
    NEW."Status" := 'Relatório Atualizado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_relatorio_atualizado ON "Ordem_Servico";

CREATE TRIGGER trg_relatorio_atualizado
  BEFORE UPDATE ON "Ordem_Servico"
  FOR EACH ROW
  EXECUTE FUNCTION fn_relatorio_atualizado();
