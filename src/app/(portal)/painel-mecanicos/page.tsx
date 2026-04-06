'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { usePermissoes } from '@/hooks/usePermissoes'
import SemPermissao from '@/components/SemPermissao'
import { supabase } from '@/lib/supabase'
import BlocoVisaoGeral from '@/components/painel-mecanicos/BlocoVisaoGeral'
import BlocoOrdens from '@/components/painel-mecanicos/BlocoOrdens'
import BlocoRequisicoes from '@/components/painel-mecanicos/BlocoRequisicoes'
import BlocoAlertas, { type Alerta } from '@/components/painel-mecanicos/BlocoAlertas'
import {
  Users, FileText, Package, AlertTriangle, RefreshCw,
  ChevronDown, Star, Clock, Wrench, AlertOctagon,
  ThumbsUp, ThumbsDown, X, LayoutDashboard
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────
interface Tecnico {
  user_id: string
  tecnico_nome: string
  tecnico_email: string
  mecanico_role: 'tecnico' | 'observador'
}

interface OrdemServico {
  Id_Ordem: string
  Status: string
  Os_Cliente: string
  Cnpj_Cliente: string
  Os_Tecnico: string
  Os_Tecnico2: string
  Previsao_Execucao: string | null
  Previsao_Faturamento: string | null
  Serv_Solicitado: string
  Endereco_Cliente: string
  Cidade_Cliente: string
  Tipo_Servico: string
  Qtd_HR: string | number | null
}

interface RequisicaoGeral {
  id: number
  titulo: string
  tipo: string
  solicitante: string
  setor: string
  status: string
  ordem_servico: string | null
  created_at: string
  updated_at: string | null
}

interface UsuarioBanco {
  id: string
  nome: string
  email: string
}

interface Caminho {
  id: number
  tecnico_nome: string
  destino: string
  cidade: string
  motivo: string
  data_saida: string
  status: string
}

interface Execucao {
  id: number
  tecnico_nome: string
  id_ordem: string
  servico_realizado: string
  data_execucao: string
  status: string
}

interface RequisicaoMecanico {
  id: number
  tecnico_nome: string
  material_solicitado: string
  quantidade: string
  urgencia: string
  id_ordem: string | null
  status: string
  created_at: string
}

interface Ocorrencia {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  tipo: string
  descricao: string
  pontos_descontados: number
  data: string
}

interface Justificativa {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  id_ocorrencia: number | null
  justificativa: string
  status: string
  descontar_comissao: boolean | null
  avaliado_por: string | null
  data_avaliacao: string | null
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────
function normalizarNome(nome: string): string[] {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(p => p.length > 2)
}

function nomesBatem(nomeA: string, nomeB: string): boolean {
  if (!nomeA || !nomeB) return false
  const partesA = normalizarNome(nomeA)
  const partesB = normalizarNome(nomeB)
  if (partesA.length === 0 || partesB.length === 0) return false
  if (partesA[0] !== partesB[0]) return false
  if (partesA.length === 1 || partesB.length === 1) return true
  const sobrenomesA = new Set(partesA.slice(1))
  return partesB.slice(1).some(p => sobrenomesA.has(p))
}

const TIPO_OCORRENCIA: Record<string, { label: string; color: string }> = {
  atraso: { label: 'Atraso', color: '#D97706' },
  erro: { label: 'Erro', color: '#DC2626' },
  retrabalho: { label: 'Retrabalho', color: '#B91C1C' },
  falta_material: { label: 'Falta Material', color: '#7C3AED' },
  outros: { label: 'Outros', color: '#71717A' },
}

type Bloco = 'visao' | 'ordens' | 'requisicoes' | 'alertas' | 'tecnicos'

// ─── Component ───────────────────────────────────────────────────
export default function PainelMecanicosWrapper() {
  const { userProfile } = useAuth()
  const { temAcesso, loading: loadingPerm } = usePermissoes(userProfile?.id)
  if (!loadingPerm && userProfile && !temAcesso('painel-mecanicos')) return <SemPermissao />
  return <PainelMecanicosPage />
}

function PainelMecanicosPage() {
  const { userProfile } = useAuth()
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [requisicoes, setRequisicoes] = useState<RequisicaoGeral[]>([])
  const [usuariosBanco, setUsuariosBanco] = useState<UsuarioBanco[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [caminhos, setCaminhos] = useState<Caminho[]>([])
  const [execucoesRecentes, setExecucoesRecentes] = useState<Execucao[]>([])
  const [reqsMecanico, setReqsMecanico] = useState<RequisicaoMecanico[]>([])
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [justificativas, setJustificativas] = useState<Justificativa[]>([])
  const [loading, setLoading] = useState(true)
  const [blocoAtivo, setBlocoAtivo] = useState<Bloco>('visao')

  // Técnicos expandidos
  const [expandedTec, setExpandedTec] = useState<string | null>(null)
  const [tecSubTab, setTecSubTab] = useState<'atrasos' | 'ocorrencias' | 'execucoes'>('atrasos')

  // Modal nova ocorrência
  const [showOcorrenciaModal, setShowOcorrenciaModal] = useState(false)
  const [novaOcorrencia, setNovaOcorrencia] = useState({ tecnico_nome: '', id_ordem: '', tipo: 'atraso', descricao: '', pontos_descontados: 0 })

  const carregar = useCallback(async () => {
    setLoading(true)

    const [
      { data: tecs },
      { data: usus },
      { data: ords },
      { data: reqs },
      { data: alerts },
      { data: cams },
      { data: execs },
      { data: reqsMec },
      { data: ocors },
      { data: justs },
    ] = await Promise.all([
      supabase.from('portal_permissoes')
        .select('user_id, mecanico_role, mecanico_tecnico_nome')
        .not('mecanico_role', 'is', null)
        .not('mecanico_tecnico_nome', 'is', null),
      supabase.from('financeiro_usu').select('id, nome, email'),
      supabase.from('Ordem_Servico').select('*')
        .order('Previsao_Execucao', { ascending: true }),
      supabase.from('Requisicao').select('*')
        .order('id', { ascending: false })
        .limit(500),
      supabase.from('painel_alertas').select('*')
        .order('created_at', { ascending: false }),
      supabase.from('tecnico_caminhos').select('*')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('os_tecnico_execucao').select('*')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('mecanico_requisicoes').select('*')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('tecnico_ocorrencias').select('*')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('tecnico_justificativas').select('*')
        .order('created_at', { ascending: false }).limit(200),
    ])

    const emailMap: Record<string, string> = {}
    const usuList: UsuarioBanco[] = []
    ;((usus || []) as any[]).forEach(u => {
      emailMap[u.id] = u.email || ''
      usuList.push({ id: u.id, nome: u.nome || '', email: u.email || '' })
    })
    setUsuariosBanco(usuList)

    setTecnicos(
      ((tecs || []) as any[]).map(t => ({
        user_id: t.user_id,
        tecnico_nome: t.mecanico_tecnico_nome,
        tecnico_email: emailMap[t.user_id] || '',
        mecanico_role: t.mecanico_role,
      })).sort((a: Tecnico, b: Tecnico) => a.tecnico_nome.localeCompare(b.tecnico_nome))
    )

    setOrdens((ords as OrdemServico[]) || [])

    // Normaliza requisições (campos legados)
    setRequisicoes(
      ((reqs || []) as any[]).map(r => ({
        id: r.id,
        titulo: r.titulo || r.Material_Serv_Solicitado || '',
        tipo: r.tipo || r.ReqTipo || 'Peça',
        solicitante: r.solicitante || r.ReqSolicitante || '',
        setor: r.setor || r.ReqQuem || '',
        status: r.status || 'pedido',
        ordem_servico: r.ordem_servico || r.Os_Vinculada || null,
        created_at: r.created_at || '',
        updated_at: r.updated_at || null,
      }))
    )

    setAlertas((alerts as Alerta[]) || [])
    setCaminhos((cams as Caminho[]) || [])
    setExecucoesRecentes((execs as Execucao[]) || [])
    setReqsMecanico((reqsMec as RequisicaoMecanico[]) || [])
    setOcorrencias((ocors as Ocorrencia[]) || [])
    setJustificativas((justs as Justificativa[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Realtime
  useEffect(() => {
    const channels = [
      supabase.channel('painel_os').on('postgres_changes', { event: '*', schema: 'public', table: 'Ordem_Servico' }, () => carregar()).subscribe(),
      supabase.channel('painel_req2').on('postgres_changes', { event: '*', schema: 'public', table: 'Requisicao' }, () => carregar()).subscribe(),
      supabase.channel('painel_alertas').on('postgres_changes', { event: '*', schema: 'public', table: 'painel_alertas' }, () => carregar()).subscribe(),
      supabase.channel('painel_exec').on('postgres_changes', { event: '*', schema: 'public', table: 'os_tecnico_execucao' }, () => carregar()).subscribe(),
      supabase.channel('painel_req_m').on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_requisicoes' }, () => carregar()).subscribe(),
      supabase.channel('painel_just').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregar()).subscribe(),
      supabase.channel('painel_cam').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_caminhos' }, () => carregar()).subscribe(),
      supabase.channel('painel_agenda_visao').on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_visao' }, () => carregar()).subscribe(),
    ]
    return () => { channels.forEach(c => supabase.removeChannel(c)) }
  }, [carregar])

  // ─── Computed ────────────────────────────────────────────────
  const tecnicosAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')
  const reqPendentes = reqsMecanico.filter(r => r.status === 'pendente')
  const justPendentes = justificativas.filter(j => j.status === 'pendente')

  // Ordens ativas por técnico
  const ordensPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    tecnicos.forEach(tec => {
      map[tec.tecnico_nome] = ordens.filter(o =>
        o.Status !== 'Concluída' && o.Status !== 'Cancelada' &&
        (nomesBatem(tec.tecnico_nome, o.Os_Tecnico) || nomesBatem(tec.tecnico_nome, o.Os_Tecnico2))
      )
    })
    return map
  }, [tecnicos, ordens])

  // Pontuação por técnico
  const pontuacaoTecnico = useMemo(() => {
    const map: Record<string, number> = {}
    tecnicos.forEach(t => { map[t.tecnico_nome] = 100 })
    ocorrencias.forEach(o => {
      if (map[o.tecnico_nome] !== undefined) {
        const justAprovada = justificativas.find(j => j.id_ocorrencia === o.id && j.status === 'aprovada' && j.descontar_comissao === false)
        if (!justAprovada) {
          map[o.tecnico_nome] = Math.max(0, (map[o.tecnico_nome] || 100) - o.pontos_descontados)
        }
      }
    })
    return map
  }, [tecnicos, ocorrencias, justificativas])

  // Ordens em atraso por técnico
  const ordensAtrasoPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    const hoje = new Date()
    tecnicos.forEach(tec => {
      const ordsTec = ordens.filter(o =>
        o.Status !== 'Concluída' && o.Status !== 'Cancelada' &&
        (nomesBatem(tec.tecnico_nome, o.Os_Tecnico) || nomesBatem(tec.tecnico_nome, o.Os_Tecnico2))
      )
      const atrasadas = ordsTec.filter(o =>
        o.Previsao_Execucao && new Date(o.Previsao_Execucao + 'T23:59:59') < hoje
      )
      if (atrasadas.length > 0) map[tec.tecnico_nome] = atrasadas
    })
    return map
  }, [tecnicos, ordens])

  // Contagens para badges dos blocos
  const ordensAtivasCount = useMemo(() =>
    ordens.filter(o => o.Status !== 'Concluída' && o.Status !== 'Cancelada').length,
    [ordens]
  )
  const reqsPedidoCount = useMemo(() =>
    requisicoes.filter(r => r.status === 'pedido').length,
    [requisicoes]
  )
  const alertasAbertosCount = useMemo(() =>
    alertas.filter(a => a.status === 'aberto').length,
    [alertas]
  )

  // ─── Actions ─────────────────────────────────────────────────
  const notificarAdmins = async (tipo: string, titulo: string, descricao?: string, link?: string) => {
    try {
      const { data: admins } = await supabase
        .from('portal_permissoes').select('user_id').eq('is_admin', true)
      if (!admins || admins.length === 0) return
      await supabase.from('portal_notificacoes').insert(
        admins.map((a: { user_id: string }) => ({
          user_id: a.user_id, tipo, titulo,
          descricao: descricao || null,
          link: link || '/painel-mecanicos',
        }))
      )
    } catch (err) { console.error('[Painel] Erro ao notificar:', err) }
  }

  const aprovarRequisicao = async (reqId: number) => {
    await supabase.from('mecanico_requisicoes').update({ status: 'aprovada', data_aprovacao: new Date().toISOString() }).eq('id', reqId)
    const req = reqsMecanico.find(r => r.id === reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome, tipo: 'requisicao', titulo: 'Requisição aprovada',
        descricao: `Sua requisição "${req.material_solicitado}" foi aprovada.`, link: '', lida: false,
      })
      await notificarAdmins('pos', `Requisição aprovada - ${req.tecnico_nome}`, `Material: ${req.material_solicitado}`)
    }
    carregar()
  }

  const recusarRequisicao = async (reqId: number) => {
    if (!confirm('Recusar esta requisição?')) return
    const req = reqsMecanico.find(r => r.id === reqId)
    await supabase.from('mecanico_requisicoes').update({ status: 'recusada' }).eq('id', reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome, tipo: 'requisicao', titulo: 'Requisição recusada',
        descricao: `Sua requisição "${req.material_solicitado}" foi recusada.`, link: '', lida: false,
      })
    }
    carregar()
  }

  const salvarOcorrencia = async () => {
    if (!novaOcorrencia.tecnico_nome || !novaOcorrencia.descricao) return
    await supabase.from('tecnico_ocorrencias').insert({
      tecnico_nome: novaOcorrencia.tecnico_nome,
      id_ordem: novaOcorrencia.id_ordem || null,
      tipo: novaOcorrencia.tipo,
      descricao: novaOcorrencia.descricao,
      pontos_descontados: novaOcorrencia.pontos_descontados,
    })
    const tipoLabel = (TIPO_OCORRENCIA[novaOcorrencia.tipo] || TIPO_OCORRENCIA.outros).label
    await notificarAdmins('pos', `Nova ocorrência - ${novaOcorrencia.tecnico_nome}`,
      `${tipoLabel}: ${novaOcorrencia.descricao}${novaOcorrencia.id_ordem ? ` (OS: ${novaOcorrencia.id_ordem})` : ''} | -${novaOcorrencia.pontos_descontados} pts`)
    await supabase.from('mecanico_notificacoes').insert({
      tecnico_nome: novaOcorrencia.tecnico_nome, tipo: 'execucao',
      titulo: `Ocorrência registrada: ${tipoLabel}`,
      descricao: `${novaOcorrencia.descricao} (-${novaOcorrencia.pontos_descontados} pts)`,
      link: '', lida: false,
    })
    setNovaOcorrencia({ tecnico_nome: '', id_ordem: '', tipo: 'atraso', descricao: '', pontos_descontados: 0 })
    setShowOcorrenciaModal(false)
    carregar()
  }

  const avaliarJustificativa = async (id: number, aprovada: boolean) => {
    const just = justificativas.find(j => j.id === id)
    await supabase.from('tecnico_justificativas').update({
      status: aprovada ? 'aprovada' : 'recusada',
      descontar_comissao: !aprovada,
      data_avaliacao: new Date().toISOString(),
    }).eq('id', id)
    if (just) {
      await notificarAdmins('pos',
        `Justificativa ${aprovada ? 'aceita' : 'recusada'} - ${just.tecnico_nome}`,
        `${just.justificativa.substring(0, 100)}${aprovada ? ' (sem desconto)' : ' (desconta comissão)'}`)
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: just.tecnico_nome, tipo: 'execucao',
        titulo: `Justificativa ${aprovada ? 'aceita' : 'recusada'}`,
        descricao: aprovada ? 'Sua justificativa foi aceita, sem desconto na comissão.' : 'Sua justificativa foi recusada, haverá desconto na comissão.',
        link: '', lida: false,
      })
    }
    carregar()
  }

  // ─── Render ──────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, color: '#A1A1AA', gap: 10 }}>
      <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 14 }}>Carregando...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const TABS: { id: Bloco; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'visao', label: 'Visão Geral', icon: <LayoutDashboard size={15} /> },
    { id: 'ordens', label: 'Ordens', icon: <FileText size={15} />, count: ordensAtivasCount },
    { id: 'requisicoes', label: 'Requisições', icon: <Package size={15} />, count: reqsPedidoCount },
    { id: 'alertas', label: 'Alertas', icon: <AlertTriangle size={15} />, count: alertasAbertosCount },
    { id: 'tecnicos', label: 'Técnicos', icon: <Users size={15} />, count: tecnicosAtivos.length },
  ]

  const INP: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid #E4E4E7', fontSize: 13, boxSizing: 'border-box',
    background: '#FAFAFA', outline: 'none', color: '#18181B',
  }
  const MLBL: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#71717A', display: 'block', marginBottom: 5 }

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* ─── Header ─── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        marginBottom: 32,
      }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#18181B', margin: 0, letterSpacing: '-0.025em' }}>
            Painel Mecânicos
          </h1>
          <p style={{ fontSize: 13, color: '#A1A1AA', margin: '4px 0 0', fontWeight: 400 }}>
            {tecnicosAtivos.length} técnicos · {ordensAtivasCount} ordens ativas · {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowOcorrenciaModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#18181B', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            <AlertOctagon size={14} /> Nova Ocorrência
          </button>
          <button onClick={carregar} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#fff', color: '#71717A', border: '1px solid #E4E4E7', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E4E4E7', marginBottom: 28 }}>
        {TABS.map(t => {
          const active = blocoAtivo === t.id
          return (
            <button
              key={t.id}
              onClick={() => setBlocoAtivo(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 20px', border: 'none',
                background: 'transparent', cursor: 'pointer',
                borderBottom: active ? '2px solid #18181B' : '2px solid transparent',
                marginBottom: -1, transition: 'all 0.15s',
              }}
            >
              <span style={{ color: active ? '#18181B' : '#A1A1AA', display: 'flex' }}>{t.icon}</span>
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#18181B' : '#71717A' }}>
                {t.label}
              </span>
              {(t.count !== undefined && t.count > 0) && (
                <span style={{
                  fontSize: 11, fontWeight: 500, minWidth: 18, textAlign: 'center',
                  padding: '1px 6px', borderRadius: 10,
                  background: active ? '#18181B' : '#F4F4F5',
                  color: active ? '#fff' : '#71717A',
                }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ═══ VISÃO GERAL ═══ */}
      {blocoAtivo === 'visao' && (
        <BlocoVisaoGeral tecnicos={tecnicos} ordens={ordens} caminhos={caminhos} />
      )}

      {/* ═══ ORDENS ═══ */}
      {blocoAtivo === 'ordens' && (
        <BlocoOrdens tecnicos={tecnicos} ordens={ordens} />
      )}

      {/* ═══ REQUISIÇÕES ═══ */}
      {blocoAtivo === 'requisicoes' && (
        <BlocoRequisicoes tecnicos={tecnicos} requisicoes={requisicoes} usuariosBanco={usuariosBanco} />
      )}

      {/* ═══ ALERTAS ═══ */}
      {blocoAtivo === 'alertas' && (
        <BlocoAlertas tecnicos={tecnicos} alertas={alertas} onRecarregar={carregar} userName={userProfile?.nome || ''} />
      )}

      {/* ═══ TÉCNICOS ═══ */}
      {blocoAtivo === 'tecnicos' && (
        <div>
          {/* Justificativas pendentes */}
          {justPendentes.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#18181B', margin: 0 }}>
                  Justificativas pendentes
                </h3>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#D97706', background: '#FFFBEB', padding: '2px 8px', borderRadius: 10 }}>
                  {justPendentes.length}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
                {justPendentes.map(j => {
                  const oc = ocorrencias.find(o => o.id === j.id_ocorrencia)
                  return (
                    <div key={j.id} style={{
                      background: '#fff', borderRadius: 10, padding: 18,
                      border: '1px solid #E4E4E7', borderLeft: '3px solid #D97706',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#18181B' }}>{j.tecnico_nome}</span>
                          {j.id_ordem && <span style={{ fontSize: 12, color: '#A1A1AA', marginLeft: 8 }}>OS: {j.id_ordem}</span>}
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: '#FFFBEB', color: '#D97706' }}>
                          Pendente
                        </span>
                      </div>
                      {oc && (
                        <div style={{
                          background: '#FAFAFA', borderRadius: 8, padding: 12, marginBottom: 12,
                          border: '1px solid #F4F4F5',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: '#A1A1AA', marginBottom: 4 }}>Ocorrência</div>
                          <div style={{ fontSize: 13, color: '#3F3F46' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                              background: `${(TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).color}12`,
                              color: (TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).color,
                              marginRight: 6,
                            }}>
                              {(TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).label}
                            </span>
                            {oc.descricao}
                            <span style={{ color: '#DC2626', fontWeight: 600, marginLeft: 8 }}>-{oc.pontos_descontados}pts</span>
                          </div>
                        </div>
                      )}
                      <div style={{
                        fontSize: 13, color: '#3F3F46', marginBottom: 14, background: '#FFFBEB',
                        padding: 12, borderRadius: 8, border: '1px solid #FEF3C7', lineHeight: 1.5,
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: '#92400E', marginBottom: 4 }}>Justificativa</div>
                        {j.justificativa}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => avaliarJustificativa(j.id, true)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          background: '#18181B', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        }}>
                          <ThumbsUp size={14} /> Aceitar
                        </button>
                        <button onClick={() => avaliarJustificativa(j.id, false)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          background: '#fff', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 8,
                          padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        }}>
                          <ThumbsDown size={14} /> Recusar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Requisições pendentes do mecânico */}
          {reqPendentes.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#18181B', margin: 0 }}>
                  Requisições de material
                </h3>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#D97706', background: '#FFFBEB', padding: '2px 8px', borderRadius: 10 }}>
                  {reqPendentes.length}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                {reqPendentes.map(req => (
                  <div key={req.id} style={{
                    background: '#fff', borderRadius: 10, padding: 16,
                    border: '1px solid #E4E4E7',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#18181B' }}>{req.tecnico_nome.split(' ').slice(0, 2).join(' ')}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6,
                        background: req.urgencia === 'alta' ? '#FEF2F2' : '#F4F4F5',
                        color: req.urgencia === 'alta' ? '#DC2626' : '#71717A',
                      }}>
                        {req.urgencia === 'alta' ? 'Urgente' : 'Normal'}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#3F3F46' }}>{req.material_solicitado}</div>
                    <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 4 }}>
                      {req.quantidade && `Qtd: ${req.quantidade} · `}
                      {req.id_ordem && `OS: ${req.id_ordem} · `}
                      {new Date(req.created_at).toLocaleDateString('pt-BR')}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={() => aprovarRequisicao(req.id)} style={{
                        flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 500,
                        background: '#18181B', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                      }}>
                        Aprovar
                      </button>
                      <button onClick={() => recusarRequisicao(req.id)} style={{
                        flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 500,
                        background: '#fff', color: '#71717A', border: '1px solid #E4E4E7', borderRadius: 6, cursor: 'pointer',
                      }}>
                        Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lista de técnicos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#18181B', margin: 0 }}>Equipe</h3>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#71717A', background: '#F4F4F5', padding: '2px 8px', borderRadius: 10 }}>
              {tecnicosAtivos.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tecnicos.map(tec => {
              const isExpanded = expandedTec === tec.user_id
              const pontos = pontuacaoTecnico[tec.tecnico_nome] ?? 100
              const atrasosDoTec = ordensAtrasoPorTecnico[tec.tecnico_nome] || []
              const ocorrDoTec = ocorrencias.filter(o => o.tecnico_nome === tec.tecnico_nome)
              const execsDoTec = execucoesRecentes.filter(e => e.tecnico_nome === tec.tecnico_nome)
              const ordsTec = ordensPorTecnico[tec.tecnico_nome] || []
              const pontosColor = pontos >= 80 ? '#18181B' : pontos >= 50 ? '#D97706' : '#DC2626'
              const isTecnico = tec.mecanico_role === 'tecnico'

              return (
                <div key={tec.user_id} style={{
                  background: '#fff', borderRadius: 10, border: '1px solid #E4E4E7', overflow: 'hidden',
                }}>
                  <div
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '14px 20px', cursor: 'pointer',
                    }}
                    onClick={() => { setExpandedTec(isExpanded ? null : tec.user_id); setTecSubTab('atrasos') }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: '#F4F4F5',
                        color: '#3F3F46', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 14, fontWeight: 700,
                      }}>
                        {tec.tecnico_nome.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#18181B' }}>{tec.tecnico_nome}</div>
                        <div style={{ fontSize: 12, color: '#A1A1AA', display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                          <span>{ordsTec.length} ordens</span>
                          <span style={{ color: '#D4D4D8' }}>·</span>
                          <span style={{
                            fontSize: 11, fontWeight: 500, padding: '0px 6px', borderRadius: 4,
                            background: isTecnico ? '#F4F4F5' : '#FAF5FF',
                            color: isTecnico ? '#71717A' : '#7C3AED',
                          }}>
                            {isTecnico ? 'Técnico' : 'Observador'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {atrasosDoTec.length > 0 && (
                        <span style={{
                          background: '#FEF2F2', color: '#DC2626', fontSize: 11, fontWeight: 500,
                          padding: '3px 10px', borderRadius: 6,
                        }}>
                          {atrasosDoTec.length} atraso{atrasosDoTec.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Star size={13} color={pontosColor} fill={pontos >= 80 ? pontosColor : 'none'} />
                        <span style={{ fontSize: 15, fontWeight: 700, color: pontosColor }}>{pontos}</span>
                      </div>
                      <ChevronDown size={16} color="#A1A1AA" style={{
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #F4F4F5' }}>
                      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #F4F4F5' }}>
                        {([
                          { id: 'atrasos', label: `Atrasos (${atrasosDoTec.length})`, icon: <Clock size={13} /> },
                          { id: 'ocorrencias', label: `Ocorrências (${ocorrDoTec.length})`, icon: <AlertOctagon size={13} /> },
                          { id: 'execucoes', label: `Execuções (${execsDoTec.length})`, icon: <Wrench size={13} /> },
                        ] as const).map(st => {
                          const active = tecSubTab === st.id
                          return (
                            <button key={st.id} onClick={() => setTecSubTab(st.id)} style={{
                              padding: '10px 20px', fontSize: 12, fontWeight: active ? 600 : 400, border: 'none', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 5,
                              background: 'transparent',
                              color: active ? '#18181B' : '#A1A1AA',
                              borderBottom: active ? '2px solid #18181B' : '2px solid transparent',
                              marginBottom: -1,
                            }}>
                              {st.icon} {st.label}
                            </button>
                          )
                        })}
                      </div>

                      <div style={{ padding: 20 }}>
                        {tecSubTab === 'atrasos' && (
                          atrasosDoTec.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#D4D4D8', fontSize: 13, padding: 24 }}>
                              Nenhum serviço em atraso
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {atrasosDoTec.map(o => {
                                const diasAtraso = Math.ceil((Date.now() - new Date(o.Previsao_Execucao + 'T23:59:59').getTime()) / (1000 * 60 * 60 * 24))
                                return (
                                  <div key={o.Id_Ordem} style={{
                                    padding: 14, background: '#FAFAFA', borderRadius: 8,
                                    border: '1px solid #F4F4F5', borderLeft: '3px solid #DC2626',
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#18181B' }}>{o.Id_Ordem}</span>
                                      <span style={{ fontSize: 12, fontWeight: 500, color: '#DC2626' }}>
                                        {diasAtraso} dia{diasAtraso !== 1 ? 's' : ''} de atraso
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 13, color: '#3F3F46' }}>{o.Os_Cliente}</div>
                                    <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 4 }}>
                                      {o.Tipo_Servico} · Previsão: {o.Previsao_Execucao ? new Date(o.Previsao_Execucao + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        )}

                        {tecSubTab === 'ocorrencias' && (
                          ocorrDoTec.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#D4D4D8', fontSize: 13, padding: 24 }}>
                              Nenhuma ocorrência registrada
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {ocorrDoTec.map(oc => {
                                const tipoInfo = TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros
                                const justDoOc = justificativas.find(j => j.id_ocorrencia === oc.id)
                                return (
                                  <div key={oc.id} style={{
                                    padding: 14, background: '#FAFAFA', borderRadius: 8,
                                    border: '1px solid #F4F4F5', borderLeft: `3px solid ${tipoInfo.color}`,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{
                                          fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
                                          background: `${tipoInfo.color}12`, color: tipoInfo.color,
                                        }}>
                                          {tipoInfo.label}
                                        </span>
                                        {oc.id_ordem && <span style={{ fontSize: 12, color: '#A1A1AA' }}>OS: {oc.id_ordem}</span>}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#DC2626' }}>-{oc.pontos_descontados}pts</span>
                                        {justDoOc && (
                                          <span style={{
                                            fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 4,
                                            background: justDoOc.status === 'aprovada' ? '#F0FDF4' : justDoOc.status === 'recusada' ? '#FEF2F2' : '#FFFBEB',
                                            color: justDoOc.status === 'aprovada' ? '#15803D' : justDoOc.status === 'recusada' ? '#DC2626' : '#D97706',
                                          }}>
                                            {justDoOc.status}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 13, color: '#3F3F46', lineHeight: 1.5 }}>{oc.descricao}</div>
                                    <div style={{ fontSize: 12, color: '#D4D4D8', marginTop: 6 }}>
                                      {new Date(oc.data).toLocaleDateString('pt-BR')}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        )}

                        {tecSubTab === 'execucoes' && (
                          execsDoTec.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#D4D4D8', fontSize: 13, padding: 24 }}>
                              Nenhuma execução registrada
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {execsDoTec.slice(0, 10).map(ex => (
                                <div key={ex.id} style={{
                                  padding: 14, background: '#FAFAFA', borderRadius: 8,
                                  border: '1px solid #F4F4F5',
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#18181B' }}>{ex.id_ordem}</span>
                                    <span style={{
                                      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
                                      background: ex.status === 'enviado' ? '#F0FDF4' : '#FFFBEB',
                                      color: ex.status === 'enviado' ? '#15803D' : '#92400E',
                                    }}>
                                      {ex.status === 'enviado' ? 'Enviado' : 'Rascunho'}
                                    </span>
                                  </div>
                                  {ex.servico_realizado && (
                                    <div style={{ fontSize: 13, color: '#52525B', lineHeight: 1.5 }}>
                                      {ex.servico_realizado.length > 120 ? ex.servico_realizado.substring(0, 120) + '...' : ex.servico_realizado}
                                    </div>
                                  )}
                                  <div style={{ fontSize: 12, color: '#D4D4D8', marginTop: 6 }}>
                                    {new Date(ex.data_execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══ MODAL NOVA OCORRÊNCIA ═══ */}
      {showOcorrenciaModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowOcorrenciaModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28, width: '100%',
            maxWidth: 440, border: '1px solid #E4E4E7',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#18181B', margin: 0 }}>Nova Ocorrência</h2>
              <button onClick={() => setShowOcorrenciaModal(false)} style={{
                background: '#F4F4F5', border: 'none', cursor: 'pointer', color: '#A1A1AA',
                width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={MLBL}>Técnico</label>
                <select value={novaOcorrencia.tecnico_nome}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tecnico_nome: e.target.value })}
                  style={{ ...INP, background: '#fff' }}>
                  <option value="">Selecione...</option>
                  {tecnicos.map(t => <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>)}
                </select>
              </div>
              <div>
                <label style={MLBL}>OS (opcional)</label>
                <input type="text" value={novaOcorrencia.id_ordem}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, id_ordem: e.target.value })}
                  placeholder="Ex: OS-001" style={INP} />
              </div>
              <div>
                <label style={MLBL}>Tipo</label>
                <select value={novaOcorrencia.tipo}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tipo: e.target.value })}
                  style={{ ...INP, background: '#fff' }}>
                  {Object.entries(TIPO_OCORRENCIA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={MLBL}>Descrição</label>
                <textarea value={novaOcorrencia.descricao}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, descricao: e.target.value })}
                  placeholder="Descreva a ocorrência..." rows={3}
                  style={{ ...INP, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={MLBL}>Pontos a descontar</label>
                <input type="number" min={0} max={100} value={novaOcorrencia.pontos_descontados}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, pontos_descontados: Number(e.target.value) })}
                  style={INP} />
              </div>
              <button onClick={salvarOcorrencia} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                background: '#18181B', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                marginTop: 4,
              }}>
                Registrar Ocorrência
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
