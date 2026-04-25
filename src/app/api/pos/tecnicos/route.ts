import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/pos/supabase";
import { TBL_TECNICOS, TBL_OS } from "@/lib/pos/constants";

export async function GET(req: NextRequest) {
  const contarServicos = req.nextUrl.searchParams.get("contarServicos");
  const osAtual = req.nextUrl.searchParams.get("osAtual") || "";

  if (contarServicos) {
    const { data: ordens } = await supabase
      .from(TBL_OS)
      .select("Id_Ordem")
      .eq("Os_Tecnico", contarServicos)
      .in("Status", [
        "Execução",
        "Execução (Realizando Diagnóstico)",
        "Execução aguardando peças (em transporte)",
      ]);
    const count = (ordens || []).filter(o => o.Id_Ordem !== osAtual).length;
    return NextResponse.json({ servicosEmExecucao: count });
  }

  const { data } = await supabase.from(TBL_TECNICOS).select("*");
  const nomes = (data || []).map((t) => t.UsuNome || "Técnico").sort();
  return NextResponse.json(nomes);
}
