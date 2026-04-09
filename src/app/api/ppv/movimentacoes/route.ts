import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch, formatarDataBR } from "@/lib/ppv/supabase";
import { TBL_ITENS, TBL_PRODUTOS } from "@/lib/ppv/constants";
import { buscarPPVPorId, atualizarValorTotal, registrarLog } from "@/lib/ppv/queries";
import { movimentacaoSchema, editarPrecoItemSchema } from "@/lib/ppv/schemas";
import { logAndNotify } from "@/lib/server/audit-notify";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = movimentacaoSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }
    const dados = parsed.data;

    const mov = {
      Id: Math.floor(Math.random() * 9000000000) + 1000000000,
      Id_PPV: dados.id,
      Data_Hora: formatarDataBR(new Date().toISOString(), true),
      Tecnico: dados.tecnico,
      TipoMovimento: dados.tipoMovimento,
      CodProduto: dados.codigo,
      Descricao: dados.descricao,
      Qtde: String(dados.quantidade),
      Preco: dados.preco,
    };

    await supabaseFetch(TBL_ITENS, "POST", [mov]);

    const logMsg = dados.tipoMovimento === "Devolução"
      ? `Devolveu item: ${dados.quantidade} un de ${dados.codigo}`
      : `Adicionou item: ${dados.quantidade} un de ${dados.codigo}`;
    const userNameLog = dados.userName || "Sistema";
    await registrarLog(dados.id, logMsg, userNameLog);
    await atualizarValorTotal(dados.id);

    await logAndNotify({
      userName: userNameLog, sistema: "ppv", acao: dados.tipoMovimento === "Devolução" ? "devolver" : "adicionar_item",
      entidade: "pedido", entidadeId: dados.id, entidadeLabel: `PPV ${dados.id}`,
      detalhes: { codigo: dados.codigo, quantidade: dados.quantidade, tipo: dados.tipoMovimento },
      notifTitulo: `PPV ${dados.id}: ${dados.tipoMovimento}`,
      notifDescricao: `${userNameLog} ${dados.tipoMovimento === "Devolução" ? "devolveu" : "adicionou"} ${dados.quantidade}x ${dados.codigo}`,
      notifLink: `/ppv?id=${dados.id}`,
    });

    const detalhes = await buscarPPVPorId(dados.id);
    return NextResponse.json(detalhes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Edita o preço de um item dentro de um PPV existente (atualiza todas as movimentações
// daquele CodProduto naquele Id_PPV — saídas e devoluções — e recalcula o total)
export async function PATCH(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = editarPrecoItemSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }
    const { id, codigo, preco, userName } = parsed.data;

    // 1. Atualiza o preço de todas as movimentações desse item neste PPV
    await supabaseFetch(
      `${TBL_ITENS}?Id_PPV=eq.${encodeURIComponent(id)}&CodProduto=eq.${encodeURIComponent(codigo)}`,
      "PATCH",
      { Preco: preco }
    );

    // 2. Atualiza também o cadastro (Produtos_Completos) — será sobrescrito no próximo sync com o Omie
    try {
      await supabaseFetch(
        `${TBL_PRODUTOS}?Codigo_Produto=eq.${encodeURIComponent(codigo)}`,
        "PATCH",
        { Preco_Venda: preco }
      );
    } catch (e) {
      console.error("Erro ao atualizar preço no cadastro:", e);
    }

    await atualizarValorTotal(id);
    await registrarLog(id, `Preço do item ${codigo} alterado para R$ ${preco.toFixed(2)} (cadastro atualizado)`, userName || "Sistema");

    const detalhes = await buscarPPVPorId(id);
    return NextResponse.json(detalhes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
