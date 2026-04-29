-- Adiciona colunas Data_Fim_Servico, Servico_Numero e Hora_Inicio_Servico na Ordem_Servico
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Data_Fim_Servico" DATE;
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Servico_Numero" INTEGER;
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Hora_Inicio_Servico" TEXT DEFAULT '';
