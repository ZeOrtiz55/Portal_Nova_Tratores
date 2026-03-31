'use client'
import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { usePermissoes } from '@/hooks/usePermissoes'
import SemPermissao from '@/components/SemPermissao'
import { supabase } from '@/lib/supabase'
import {
  Users, Calendar, Wrench, Package, AlertTriangle, Check,
  Clock, ChevronDown, ChevronUp, RefreshCw,
  MapPin, Navigation, Star, XCircle, FileText, Plus, X,
  ChevronLeft, ChevronRight, AlertOctagon, ThumbsUp, ThumbsDown,
  Send, TrendingDown, Eye
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────
interface Tecnico {
  user_id: string
  tecnico_nome: string
  tecnico_email: string
  mecanico_role: 'tecnico' | 'observador'
}

interface AgendaItem {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  data_agendada: string
  turno: string | null
  hora_inicio: string | null
  hora_fim: string | null
  descricao: string | null
  endereco: string | null
  cliente: string | null
  status: string
  created_at: string
}

interface Execucao {
  id: number
  id_ordem: string
  tecnico_nome: string
  data_execucao: string
  status: string
  servico_realizado: string | null
  created_at: string
}

interface Requisicao {
  id: number
  id_ordem: string | null
  tecnico_nome: string
  material_solicitado: string
  quantidade: string | null
  urgencia: string
  status: string
  atualizada_pelo_tecnico: boolean
  created_at: string
}

interface OrdemServico {
  Id_Ordem: string
  Status: string
  Os_Cliente: string
  Cnpj_Cliente: string
  Os_Tecnico: string
  Os_Tecnico2: string
  Previsao_Execucao: string | null
  Serv_Solicitado: string
  Endereco_Cliente: string
  Cidade_Cliente: string
  Tipo_Servico: string
}

interface ClienteOmie {
  nome_fantasia: string
  razao_social: string
  cnpj_cpf: string
  cidade: string
}

interface ClienteManual {
  Cli_Nome: string
  Cli_Cpf_Cnpj: string
  Cli_Cidade: string
}

interface Caminho {
  id: number
  tecnico_nome: string
  destino: string
  cidade: string
  motivo: string
  data_saida: string
  status: string
  created_at: string
}

interface Ocorrencia {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  tipo: string
  descricao: string
  data: string
  pontos_descontados: number
  created_at: string
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

// ─── Helpers ─────────────────────────────────────────────────────────
const STAT_CARD = {
  background: '#fff', borderRadius: 14, padding: 20,
  boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
}

function getWeekDays(date: Date): Date[] {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday)
    dd.setDate(monday.getDate() + i)
    return dd
  })
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0]
}

function formatDateBR(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}`
}

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// Normaliza nome para comparação fuzzy (remove acentos, lowercase, split)
function normalizarNome(nome: string): string[] {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(p => p.length > 2) // ignora preposições: de, da, do, e
}

// Verifica se dois nomes são a mesma pessoa (pelo menos primeiro nome + 1 sobrenome batem)
function nomesBatem(nomeA: string, nomeB: string): boolean {
  if (!nomeA || !nomeB) return false
  const partesA = normalizarNome(nomeA)
  const partesB = normalizarNome(nomeB)
  if (partesA.length === 0 || partesB.length === 0) return false
  // Primeiro nome tem que bater
  if (partesA[0] !== partesB[0]) return false
  // Se só tem primeiro nome, já basta
  if (partesA.length === 1 || partesB.length === 1) return true
  // Pelo menos 1 sobrenome em comum
  const sobrenomesA = new Set(partesA.slice(1))
  return partesB.slice(1).some(p => sobrenomesA.has(p))
}

const TIPO_OCORRENCIA: Record<string, { label: string; color: string }> = {
  atraso: { label: 'Atraso', color: '#F59E0B' },
  erro: { label: 'Erro', color: '#EF4444' },
  retrabalho: { label: 'Retrabalho', color: '#DC2626' },
  falta_material: { label: 'Falta Material', color: '#8B5CF6' },
  outros: { label: 'Outros', color: '#6B7280' },
}

// ─── Component ───────────────────────────────────────────────────────
export default function PainelMecanicosWrapper() {
  const { userProfile } = useAuth()
  const { temAcesso, loading: loadingPerm } = usePermissoes(userProfile?.id)
  if (!loadingPerm && userProfile && !temAcesso('painel-mecanicos')) return <SemPermissao />
  return <PainelMecanicosPage />
}

function PainelMecanicosPage() {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [agendaSemana, setAgendaSemana] = useState<AgendaItem[]>([])
  const [execucoesRecentes, setExecucoesRecentes] = useState<Execucao[]>([])
  const [requisicoes, setRequisicoes] = useState<Requisicao[]>([])
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [ordensAbertas, setOrdensAbertas] = useState<OrdemServico[]>([])
  const [clientesCidade, setClientesCidade] = useState<{ nomes: string[]; cnpj: string; cidade: string }[]>([])
  const [caminhos, setCaminhos] = useState<Caminho[]>([])
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [justificativas, setJustificativas] = useState<Justificativa[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('visao-geral')
  const [expandedTec, setExpandedTec] = useState<string | null>(null)
  const [tecSubTab, setTecSubTab] = useState<'atrasos' | 'ocorrencias' | 'execucoes'>('atrasos')
  const [semanaRef, setSemanaRef] = useState(new Date())

  // Modal novo caminho
  const [showCaminhoModal, setShowCaminhoModal] = useState(false)
  const [novoCaminho, setNovoCaminho] = useState({ tecnico_nome: '', destino: '', cidade: '', motivo: '' })

  // Modal nova ocorrência
  const [showOcorrenciaModal, setShowOcorrenciaModal] = useState(false)
  const [novaOcorrencia, setNovaOcorrencia] = useState({ tecnico_nome: '', id_ordem: '', tipo: 'atraso', descricao: '', pontos_descontados: 0 })

  const weekDays = useMemo(() => getWeekDays(semanaRef), [semanaRef])
  const weekStart = formatDate(weekDays[0])
  const weekEnd = formatDate(weekDays[6])

  const carregar = async () => {
    setLoading(true)

    const [
      { data: tecs },
      { data: usus },
      { data: agenda },
      { data: execs },
      { data: reqs },
      { data: ords },
      { data: ordsAbertas },
      { data: clientesOmie },
      { data: clientesManuais },
      { data: cams },
      { data: ocors },
      { data: justs },
    ] = await Promise.all([
      supabase.from('portal_permissoes').select('user_id, mecanico_role, mecanico_tecnico_nome').not('mecanico_role', 'is', null).not('mecanico_tecnico_nome', 'is', null),
      supabase.from('financeiro_usu').select('id, email'),
      supabase.from('agenda_tecnico').select('*').gte('data_agendada', weekStart).lte('data_agendada', weekEnd).order('hora_inicio'),
      supabase.from('os_tecnico_execucao').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('mecanico_requisicoes').select('*').order('created_at', { ascending: false }).limit(100),
      // Ordens da semana (todas, incluindo concluídas - para a agenda)
      supabase.from('Ordem_Servico').select('*')
        .not('Previsao_Execucao', 'is', null)
        .gte('Previsao_Execucao', weekStart)
        .lte('Previsao_Execucao', weekEnd)
        .order('Previsao_Execucao', { ascending: true }),
      // Ordens abertas (para atrasos e visão geral)
      supabase.from('Ordem_Servico').select('*')
        .not('Status', 'in', '("Concluída","Cancelada")')
        .not('Previsao_Execucao', 'is', null)
        .order('Previsao_Execucao', { ascending: true }),
      // Clientes para buscar cidade
      supabase.from('Clientes').select('nome_fantasia,razao_social,cnpj_cpf,cidade'),
      supabase.from('Clientes_Manuais').select('Cli_Nome,Cli_Cpf_Cnpj,Cli_Cidade'),
      supabase.from('tecnico_caminhos').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('tecnico_ocorrencias').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('tecnico_justificativas').select('*').order('created_at', { ascending: false }).limit(200),
    ])

    // Montar lista de clientes com cidade para busca flexível
    const lista: { nomes: string[]; cnpj: string; cidade: string }[] = []
    ;((clientesOmie as ClienteOmie[]) || []).forEach(c => {
      if (!c.cidade) return
      lista.push({
        nomes: [c.nome_fantasia, c.razao_social].filter(Boolean),
        cnpj: (c.cnpj_cpf || '').replace(/[^\d]/g, ''),
        cidade: c.cidade,
      })
    })
    ;((clientesManuais as ClienteManual[]) || []).forEach(c => {
      if (!c.Cli_Cidade) return
      lista.push({
        nomes: [c.Cli_Nome].filter(Boolean),
        cnpj: (c.Cli_Cpf_Cnpj || '').replace(/[^\d]/g, ''),
        cidade: c.Cli_Cidade,
      })
    })
    setClientesCidade(lista)

    const emailMap: Record<string, string> = {}
    ;((usus || []) as any[]).forEach(u => { emailMap[u.id] = u.email || '' })
    setTecnicos(
      ((tecs || []) as any[]).map(t => ({
        user_id: t.user_id,
        tecnico_nome: t.mecanico_tecnico_nome,
        tecnico_email: emailMap[t.user_id] || '',
        mecanico_role: t.mecanico_role,
      })).sort((a, b) => a.tecnico_nome.localeCompare(b.tecnico_nome))
    )
    setAgendaSemana((agenda as AgendaItem[]) || [])
    setExecucoesRecentes((execs as Execucao[]) || [])
    setRequisicoes((reqs as Requisicao[]) || [])
    setOrdens((ords as OrdemServico[]) || [])
    setOrdensAbertas((ordsAbertas as OrdemServico[]) || [])
    setCaminhos((cams as Caminho[]) || [])
    setOcorrencias((ocors as Ocorrencia[]) || [])
    setJustificativas((justs as Justificativa[]) || [])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [weekStart, weekEnd])

  // Realtime
  useEffect(() => {
    const channels = [
      supabase.channel('painel_exec').on('postgres_changes', { event: '*', schema: 'public', table: 'os_tecnico_execucao' }, () => carregar()).subscribe(),
      supabase.channel('painel_req').on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_requisicoes' }, () => carregar()).subscribe(),
      supabase.channel('painel_cam').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_caminhos' }, () => carregar()).subscribe(),
      supabase.channel('painel_agenda').on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_tecnico' }, () => carregar()).subscribe(),
      supabase.channel('painel_just').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregar()).subscribe(),
    ]
    return () => { channels.forEach(c => supabase.removeChannel(c)) }
  }, [])

  // ─── Computed ────────────────────────────────────────────────────
  const tecnicosAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')
  const reqPendentes = requisicoes.filter(r => r.status === 'pendente')
  const justPendentes = justificativas.filter(j => j.status === 'pendente')
  const caminhosAtivos = caminhos.filter(c => c.status === 'em_transito')
  const hoje = formatDate(new Date())

  // Mapa OS → cidade (pré-calculado para performance)
  const cidadePorOrdem = useMemo(() => {
    const map: Record<string, string> = {}
    const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const todasOrdens = [...ordens, ...ordensAbertas]
    todasOrdens.forEach(o => {
      if (map[o.Id_Ordem]) return
      // 0) Prioridade: Cidade_Cliente direto da OS
      if (o.Cidade_Cliente && o.Cidade_Cliente.trim()) {
        map[o.Id_Ordem] = o.Cidade_Cliente.trim()
        return
      }
      const cnpjLimpo = o.Cnpj_Cliente ? o.Cnpj_Cliente.replace(/[^\d]/g, '') : ''
      const nomeNorm = o.Os_Cliente ? normalize(o.Os_Cliente) : ''
      // 1) Match por CNPJ
      if (cnpjLimpo) {
        const found = clientesCidade.find(c => c.cnpj === cnpjLimpo)
        if (found) { map[o.Id_Ordem] = found.cidade; return }
      }
      // 2) Match por nome (contains em ambas direções)
      if (nomeNorm) {
        const found = clientesCidade.find(c =>
          c.nomes.some(n => {
            const nn = normalize(n)
            return nn.includes(nomeNorm) || nomeNorm.includes(nn)
          })
        )
        if (found) { map[o.Id_Ordem] = found.cidade; return }
      }
      // 3) Fallback: endereço após vírgula
      if (o.Endereco_Cliente) {
        const partes = o.Endereco_Cliente.split(',')
        if (partes.length >= 2) {
          const ultima = partes[partes.length - 1].trim()
          if (ultima && !/^\d/.test(ultima)) map[o.Id_Ordem] = ultima
        }
      }
    })
    return map
  }, [ordens, ordensAbertas, clientesCidade])

  // Mapeamento: para cada técnico, encontra as ordens dele via nome fuzzy
  const ordensPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    tecnicos.forEach(tec => {
      map[tec.tecnico_nome] = ordens.filter(o =>
        nomesBatem(tec.tecnico_nome, o.Os_Tecnico) || nomesBatem(tec.tecnico_nome, o.Os_Tecnico2)
      )
    })
    return map
  }, [tecnicos, ordens])

  // Mapeamento das ordens abertas por técnico (para atrasos/visão geral)
  const ordensAbertasPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    tecnicos.forEach(tec => {
      map[tec.tecnico_nome] = ordensAbertas.filter(o =>
        nomesBatem(tec.tecnico_nome, o.Os_Tecnico) || nomesBatem(tec.tecnico_nome, o.Os_Tecnico2)
      )
    })
    return map
  }, [tecnicos, ordensAbertas])

  // Pontuação por técnico: base 100 - pontos de ocorrências
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

  // Ordens em atraso por técnico (ordensAbertas com Previsao passada)
  const ordensAtrasoPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    const hojeDate = new Date()
    tecnicos.forEach(tec => {
      const ordsTec = ordensAbertasPorTecnico[tec.tecnico_nome] || []
      const atrasadas = ordsTec.filter(o => {
        if (!o.Previsao_Execucao) return false
        return new Date(o.Previsao_Execucao + 'T23:59:59') < hojeDate
      })
      if (atrasadas.length > 0) map[tec.tecnico_nome] = atrasadas
    })
    return map
  }, [tecnicos, ordensAbertasPorTecnico])

  // ─── Notificar admins via portal_notificacoes (bell icon) ──────
  const notificarAdmins = async (tipo: string, titulo: string, descricao?: string, link?: string) => {
    try {
      const { data: admins } = await supabase
        .from('portal_permissoes')
        .select('user_id')
        .eq('is_admin', true)
      if (!admins || admins.length === 0) return
      await supabase.from('portal_notificacoes').insert(
        admins.map((a: { user_id: string }) => ({
          user_id: a.user_id,
          tipo,
          titulo,
          descricao: descricao || null,
          link: link || '/painel-mecanicos',
        }))
      )
    } catch (err) { console.error('[Painel] Erro ao notificar admins:', err) }
  }

  // ─── Actions ─────────────────────────────────────────────────────
  const aprovarRequisicao = async (reqId: number) => {
    await supabase.from('mecanico_requisicoes').update({ status: 'aprovada', data_aprovacao: new Date().toISOString() }).eq('id', reqId)
    const req = requisicoes.find(r => r.id === reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome, tipo: 'requisicao', titulo: 'Requisição aprovada',
        descricao: `Sua requisição "${req.material_solicitado}" foi aprovada.`, link: '', lida: false,
      })
      await notificarAdmins('pos', `Requisição aprovada - ${req.tecnico_nome}`, `Material: ${req.material_solicitado}`, '/painel-mecanicos')
    }
    carregar()
  }

  const recusarRequisicao = async (reqId: number) => {
    if (!confirm('Recusar esta requisição?')) return
    const req = requisicoes.find(r => r.id === reqId)
    await supabase.from('mecanico_requisicoes').update({ status: 'recusada' }).eq('id', reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome, tipo: 'requisicao', titulo: 'Requisição recusada',
        descricao: `Sua requisição "${req.material_solicitado}" foi recusada.`, link: '', lida: false,
      })
    }
    carregar()
  }

  const salvarCaminho = async () => {
    if (!novoCaminho.tecnico_nome || !novoCaminho.destino || !novoCaminho.cidade) return
    await supabase.from('tecnico_caminhos').insert({
      tecnico_nome: novoCaminho.tecnico_nome,
      destino: novoCaminho.destino,
      cidade: novoCaminho.cidade,
      motivo: novoCaminho.motivo,
      status: 'em_transito',
    })
    await notificarAdmins(
      'pos',
      `Novo caminho - ${novoCaminho.tecnico_nome}`,
      `Indo para ${novoCaminho.destino} (${novoCaminho.cidade})${novoCaminho.motivo ? ` - ${novoCaminho.motivo}` : ''}`,
      '/painel-mecanicos'
    )
    await supabase.from('mecanico_notificacoes').insert({
      tecnico_nome: novoCaminho.tecnico_nome, tipo: 'agenda',
      titulo: 'Caminho registrado',
      descricao: `Destino: ${novoCaminho.destino} (${novoCaminho.cidade})`,
      link: '', lida: false,
    })
    setNovoCaminho({ tecnico_nome: '', destino: '', cidade: '', motivo: '' })
    setShowCaminhoModal(false)
    carregar()
  }

  const finalizarCaminho = async (id: number, status: string) => {
    const cam = caminhos.find(c => c.id === id)
    await supabase.from('tecnico_caminhos').update({ status }).eq('id', id)
    if (cam) {
      await notificarAdmins(
        'pos',
        `${cam.tecnico_nome} ${status === 'chegou' ? 'chegou ao destino' : status}`,
        `${cam.destino} (${cam.cidade})`,
        '/painel-mecanicos'
      )
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
    await notificarAdmins(
      'pos',
      `Nova ocorrência - ${novaOcorrencia.tecnico_nome}`,
      `${tipoLabel}: ${novaOcorrencia.descricao}${novaOcorrencia.id_ordem ? ` (OS: ${novaOcorrencia.id_ordem})` : ''} | -${novaOcorrencia.pontos_descontados} pts`,
      '/painel-mecanicos'
    )
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
      await notificarAdmins(
        'pos',
        `Justificativa ${aprovada ? 'aceita' : 'recusada'} - ${just.tecnico_nome}`,
        `${just.justificativa.substring(0, 100)}${aprovada ? ' (sem desconto)' : ' (desconta comissão)'}`,
        '/painel-mecanicos'
      )
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: just.tecnico_nome, tipo: 'execucao',
        titulo: `Justificativa ${aprovada ? 'aceita' : 'recusada'}`,
        descricao: aprovada ? 'Sua justificativa foi aceita, sem desconto na comissão.' : 'Sua justificativa foi recusada, haverá desconto na comissão.',
        link: '', lida: false,
      })
    }
    carregar()
  }

  const mudarSemana = (dir: number) => {
    const nova = new Date(semanaRef)
    nova.setDate(nova.getDate() + dir * 7)
    setSemanaRef(nova)
  }

  // ─── Tabs ────────────────────────────────────────────────────────
  const TABS = [
    { id: 'visao-geral', label: 'Visão Geral' },
    { id: 'agenda-semanal', label: 'Agenda Semanal' },
    { id: 'tecnicos', label: 'Técnicos' },
    { id: 'justificativas', label: `Justificativas${justPendentes.length ? ` (${justPendentes.length})` : ''}` },
    { id: 'requisicoes', label: `Requisições${reqPendentes.length ? ` (${reqPendentes.length})` : ''}` },
    { id: 'execucoes', label: 'Execuções' },
  ]

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Carregando painel...</div>

  return (
    <div style={{ maxWidth: tab === 'agenda-semanal' ? '100%' : 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
          <Users size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Painel Mecânicos
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowOcorrenciaModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <AlertOctagon size={14} /> Nova Ocorrência
          </button>
          <button onClick={carregar} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#EFF6FF', color: '#1E3A5F', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            background: tab === t.id ? '#1E3A5F' : '#F3F4F6',
            color: tab === t.id ? '#fff' : '#6B7280',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ VISÃO GERAL ═══ */}
      {tab === 'visao-geral' && (
        <div>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={STAT_CARD}>
              <Users size={20} color="#1E3A5F" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{tecnicosAtivos.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Técnicos ativos</div>
            </div>
            <div style={STAT_CARD}>
              <Calendar size={20} color="#3B82F6" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>
                {agendaSemana.filter(a => a.data_agendada === hoje).length}
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Agendamentos hoje</div>
            </div>
            <div style={STAT_CARD}>
              <Navigation size={20} color="#8B5CF6" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{caminhosAtivos.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Em trânsito</div>
            </div>
            <div style={STAT_CARD}>
              <Wrench size={20} color="#10B981" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>
                {execucoesRecentes.filter(e => e.status === 'enviado').length}
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Execuções enviadas</div>
            </div>
            <div style={{ ...STAT_CARD, border: reqPendentes.length > 0 ? '2px solid #F59E0B' : undefined }}>
              <Package size={20} color="#F59E0B" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{reqPendentes.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Requisições pend.</div>
            </div>
          </div>

          {/* Técnicos em trânsito - Caminhos ativos */}
          {caminhosAtivos.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Navigation size={16} color="#8B5CF6" /> Técnicos em Trânsito
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {caminhosAtivos.map(cam => (
                  <div key={cam.id} style={{
                    ...STAT_CARD, padding: 16, borderLeft: '4px solid #8B5CF6',
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{cam.tecnico_nome}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, background: '#EDE9FE', color: '#7C3AED', padding: '2px 8px', borderRadius: 6 }}>
                        Em trânsito
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={14} color="#6B7280" />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{cam.destino}</span>
                      <span style={{ fontSize: 11, color: '#6B7280' }}>({cam.cidade})</span>
                    </div>
                    {cam.motivo && <div style={{ fontSize: 12, color: '#6B7280' }}>{cam.motivo}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                        Saiu: {new Date(cam.data_saida).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => finalizarCaminho(cam.id, 'chegou')} style={{
                          background: '#D1FAE5', color: '#065F46', border: 'none', borderRadius: 6,
                          padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>
                          Chegou
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Onde cada técnico está / vai hoje */}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={16} color="#3B82F6" /> Localização dos Técnicos Hoje
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
            {tecnicosAtivos.map(tec => {
              const caminhoAtivo = caminhosAtivos.find(c => c.tecnico_nome === tec.tecnico_nome)
              const ordensHojeTec = (ordensPorTecnico[tec.tecnico_nome] || []).filter(o => o.Previsao_Execucao === hoje)
              const ordensDoTec = ordensAbertasPorTecnico[tec.tecnico_nome] || []
              const temAtividade = caminhoAtivo || ordensHojeTec.length > 0

              return (
                <div key={tec.user_id} style={{
                  ...STAT_CARD, padding: 14,
                  borderLeft: `4px solid ${caminhoAtivo ? '#8B5CF6' : ordensHojeTec.length > 0 ? '#3B82F6' : '#D1D5DB'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', background: '#1E3A5F',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                      }}>
                        {tec.tecnico_nome.charAt(0)}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{tec.tecnico_nome.split(' ').slice(0, 2).join(' ')}</span>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                      background: caminhoAtivo ? '#EDE9FE' : ordensHojeTec.length > 0 ? '#EFF6FF' : '#F3F4F6',
                      color: caminhoAtivo ? '#7C3AED' : ordensHojeTec.length > 0 ? '#2563EB' : '#9CA3AF',
                    }}>
                      {caminhoAtivo ? 'Em trânsito' : ordensHojeTec.length > 0 ? `${ordensHojeTec.length} serviço(s)` : 'Sem agenda'}
                    </span>
                  </div>

                  {/* Caminho ativo */}
                  {caminhoAtivo && (
                    <div style={{
                      background: '#F5F3FF', borderRadius: 8, padding: '8px 10px', marginBottom: 8,
                      borderLeft: '3px solid #8B5CF6',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                        <Navigation size={12} /> {caminhoAtivo.destino} - {caminhoAtivo.cidade}
                      </div>
                      {caminhoAtivo.motivo && (
                        <div style={{ fontSize: 11, color: '#6B7280' }}>{caminhoAtivo.motivo}</div>
                      )}
                    </div>
                  )}

                  {/* Serviços de hoje */}
                  {ordensHojeTec.length > 0 && ordensHojeTec.map(o => {
                    const cidade = cidadePorOrdem[o.Id_Ordem] || ''
                    const clienteNome = o.Os_Cliente ? o.Os_Cliente.split(' ').slice(0, 2).join(' ') : ''
                    const isConcluida = o.Status === 'Concluída'
                    let solicitacao = ''
                    if (o.Serv_Solicitado) {
                      const match = o.Serv_Solicitado.match(/Solicitação do cliente:\s*([\s\S]*?)(?:\nServiço Realizado:|$)/i)
                      solicitacao = match ? match[1].trim() : o.Serv_Solicitado.substring(0, 80)
                    }
                    return (
                      <div key={o.Id_Ordem} style={{
                        background: isConcluida ? '#F0FDF4' : '#EFF6FF', borderRadius: 8,
                        padding: '8px 10px', marginBottom: 6,
                        borderLeft: `3px solid ${isConcluida ? '#10B981' : '#3B82F6'}`,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F', marginBottom: 2 }}>
                          {clienteNome}{cidade ? ` - ${cidade}` : ''}
                          {isConcluida && (
                            <span style={{ fontSize: 8, fontWeight: 700, color: '#065F46', background: '#D1FAE5', padding: '1px 4px', borderRadius: 3, marginLeft: 4 }}>OK</span>
                          )}
                        </div>
                        {solicitacao && (
                          <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.3 }}>
                            {solicitacao.substring(0, 120)}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {!temAtividade && (
                    <div style={{ fontSize: 12, color: '#D1D5DB' }}>
                      {ordensDoTec.length > 0 ? `${ordensDoTec.length} OS em andamento` : 'Nenhuma atividade'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Ordens em Atraso ── */}
          {(() => {
            const todosAtrasos = tecnicosAtivos.flatMap(tec =>
              (ordensAtrasoPorTecnico[tec.tecnico_nome] || []).map(o => ({ ...o, _tecnico: tec.tecnico_nome }))
            )
            if (todosAtrasos.length === 0) return null
            return (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={16} color="#EF4444" /> Ordens em Atraso ({todosAtrasos.length})
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                  {todosAtrasos.map(o => {
                    const cidade = cidadePorOrdem[o.Id_Ordem] || ''
                    const clienteNome = o.Os_Cliente ? o.Os_Cliente.split(' ').slice(0, 2).join(' ') : ''
                    const diasAtraso = o.Previsao_Execucao
                      ? Math.floor((new Date().getTime() - new Date(o.Previsao_Execucao + 'T23:59:59').getTime()) / 86400000)
                      : 0
                    let solicitacao = ''
                    if (o.Serv_Solicitado) {
                      const match = o.Serv_Solicitado.match(/Solicitação do cliente:\s*([\s\S]*?)(?:\nServiço Realizado:|$)/i)
                      solicitacao = match ? match[1].trim() : o.Serv_Solicitado.substring(0, 80)
                    }
                    return (
                      <div key={o.Id_Ordem} style={{
                        ...STAT_CARD, padding: 14, borderLeft: '4px solid #EF4444',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F' }}>{o._tecnico.split(' ').slice(0, 2).join(' ')}</span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: '#DC2626', background: '#FEE2E2',
                            padding: '2px 8px', borderRadius: 6,
                          }}>
                            {diasAtraso} dia{diasAtraso !== 1 ? 's' : ''} atraso
                          </span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 2 }}>
                          {clienteNome}{cidade ? ` - ${cidade}` : ''}
                        </div>
                        {solicitacao && (
                          <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.3 }}>
                            {solicitacao.substring(0, 120)}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
                          {o.Id_Ordem} • Prev: {o.Previsao_Execucao ? new Date(o.Previsao_Execucao + 'T12:00:00').toLocaleDateString('pt-BR') : '-'} • {o.Status}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── Requisições Pendentes ── */}
          {reqPendentes.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Package size={16} color="#F59E0B" /> Requisições Pendentes ({reqPendentes.length})
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                {reqPendentes.map(req => (
                  <div key={req.id} style={{
                    ...STAT_CARD, padding: 14, borderLeft: '4px solid #F59E0B',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F' }}>{req.tecnico_nome.split(' ').slice(0, 2).join(' ')}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: req.urgencia === 'alta' ? '#FEE2E2' : req.urgencia === 'media' ? '#FEF3C7' : '#F3F4F6',
                        color: req.urgencia === 'alta' ? '#DC2626' : req.urgencia === 'media' ? '#D97706' : '#6B7280',
                      }}>
                        {req.urgencia === 'alta' ? 'Urgente' : req.urgencia === 'media' ? 'Média' : 'Normal'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 2 }}>
                      {req.material_solicitado}
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
                      {req.quantidade && `Qtd: ${req.quantidade} • `}
                      {req.id_ordem && `OS: ${req.id_ordem} • `}
                      {new Date(req.created_at).toLocaleDateString('pt-BR')}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => aprovarRequisicao(req.id)} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        background: '#D1FAE5', color: '#065F46', border: 'none', borderRadius: 6,
                        padding: '6px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>
                        <Check size={12} /> Aprovar
                      </button>
                      <button onClick={() => recusarRequisicao(req.id)} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: 6,
                        padding: '6px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>
                        <XCircle size={12} /> Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Últimas Execuções Enviadas ── */}
          {(() => {
            const execEnviadas = execucoesRecentes.filter(e => e.status === 'enviado').slice(0, 10)
            if (execEnviadas.length === 0) return null
            return (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wrench size={16} color="#10B981" /> Últimas Execuções Enviadas
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                  {execEnviadas.map(ex => (
                    <div key={ex.id} style={{
                      ...STAT_CARD, padding: 14, borderLeft: '4px solid #10B981',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F' }}>{ex.tecnico_nome.split(' ').slice(0, 2).join(' ')}</span>
                        <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                          {new Date(ex.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                        OS: {ex.id_ordem}
                      </div>
                      {ex.servico_realizado && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.3 }}>
                          {ex.servico_realizado.substring(0, 120)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ═══ AGENDA SEMANAL ═══ */}
      {tab === 'agenda-semanal' && (
        <div>
          {/* Week navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <button onClick={() => mudarSemana(-1)} style={{
              background: '#F3F4F6', border: 'none', borderRadius: 8, padding: '8px 12px',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
            }}>
              <ChevronLeft size={18} />
            </button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1F2937' }}>
                Semana {formatDateBR(weekStart)} - {formatDateBR(weekEnd)}
              </div>
              <button onClick={() => setSemanaRef(new Date())} style={{
                background: 'none', border: 'none', color: '#3B82F6', fontSize: 12,
                fontWeight: 600, cursor: 'pointer', marginTop: 4,
              }}>
                Ir para semana atual
              </button>
            </div>
            <button onClick={() => mudarSemana(1)} style={{
              background: '#F3F4F6', border: 'none', borderRadius: 8, padding: '8px 12px',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
            }}>
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Grid semanal - full width */}
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: '100%' }}>
              {/* Header dias */}
              <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(7, 1fr)', gap: 1, marginBottom: 1 }}>
                <div style={{ padding: '14px 12px', background: '#1E3A5F', borderRadius: '8px 0 0 0', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                  Técnico
                </div>
                {weekDays.map((d, i) => {
                  const isHoje = formatDate(d) === hoje
                  return (
                    <div key={i} style={{
                      padding: '14px 8px', textAlign: 'center',
                      background: isHoje ? '#2563EB' : '#1E3A5F',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                      borderRadius: i === 6 ? '0 8px 0 0' : undefined,
                    }}>
                      <div>{DIAS_SEMANA[i]}</div>
                      <div style={{ fontSize: 20, marginTop: 2 }}>{d.getDate()}</div>
                    </div>
                  )
                })}
              </div>

              {/* Rows por técnico */}
              {tecnicosAtivos.map((tec) => {
                const ordensDoTec = ordensPorTecnico[tec.tecnico_nome] || []

                return (
                  <div key={tec.user_id} style={{ display: 'grid', gridTemplateColumns: '150px repeat(7, 1fr)', gap: 1, marginBottom: 1 }}>
                    <div style={{
                      padding: '12px 10px', background: '#fff', border: '1px solid #E5E7EB',
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1E3A5F',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: '#1E3A5F',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                      }}>
                        {tec.tecnico_nome.charAt(0)}
                      </div>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                        {tec.tecnico_nome.split(' ').slice(0, 2).join(' ')}
                      </span>
                    </div>
                    {weekDays.map((d, dayIdx) => {
                      const dateStr = formatDate(d)
                      const isHoje = dateStr === hoje
                      const isPast = d < new Date(hoje)
                      const ordensNoDia = ordensDoTec.filter(o => o.Previsao_Execucao === dateStr)
                      const agendaNoDia = agendaSemana.filter(a =>
                        a.tecnico_nome === tec.tecnico_nome && a.data_agendada === dateStr
                      )
                      const caminhosNoDia = caminhos.filter(c =>
                        c.tecnico_nome === tec.tecnico_nome &&
                        c.data_saida.split('T')[0] === dateStr
                      )

                      return (
                        <div key={dayIdx} style={{
                          padding: 6, background: isHoje ? '#EFF6FF' : isPast ? '#FAFAFA' : '#fff',
                          border: `1px solid ${isHoje ? '#BFDBFE' : '#E5E7EB'}`,
                          minHeight: 100, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          {ordensNoDia.map(o => {
                            const cidade = cidadePorOrdem[o.Id_Ordem] || ''
                            const isConcluida = o.Status === 'Concluída'
                            const isCancelada = o.Status === 'Cancelada'
                            const isExecucao = o.Status.includes('Execução') || o.Status.includes('Aguardando ordem')
                            const bgColor = isConcluida ? '#F0FDF4' : isCancelada ? '#F5F5F5' : isExecucao ? '#EFF6FF' : '#FFFBEB'
                            const borderColor = isConcluida ? '#10B981' : isCancelada ? '#9CA3AF' : isExecucao ? '#3B82F6' : '#F59E0B'
                            const clienteNome = o.Os_Cliente ? o.Os_Cliente.split(' ').slice(0, 2).join(' ') : ''
                            // Extrair conteúdo após "Solicitação do cliente:" e antes de "Serviço Realizado:"
                            let solicitacao = ''
                            if (o.Serv_Solicitado) {
                              const match = o.Serv_Solicitado.match(/Solicitação do cliente:\s*([\s\S]*?)(?:\nServiço Realizado:|$)/i)
                              solicitacao = match ? match[1].trim() : o.Serv_Solicitado.substring(0, 80)
                            }
                            return (
                              <div key={o.Id_Ordem} style={{
                                background: bgColor,
                                borderRadius: 6, padding: '6px 8px',
                                borderLeft: `3px solid ${borderColor}`,
                                opacity: isCancelada ? 0.5 : 1,
                              }}>
                                <div style={{ fontWeight: 700, color: '#1E3A5F', fontSize: 12, marginBottom: 2 }}>
                                  {clienteNome}{cidade ? ` - ${cidade}` : ''}
                                  {isConcluida && (
                                    <span style={{ fontSize: 8, fontWeight: 700, color: '#065F46', background: '#D1FAE5', padding: '1px 4px', borderRadius: 3, marginLeft: 4 }}>OK</span>
                                  )}
                                </div>
                                {solicitacao && (
                                  <div style={{ color: '#374151', fontSize: 10, lineHeight: 1.3 }}>
                                    {solicitacao.substring(0, 100)}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {caminhosNoDia.map(cam => (
                            <div key={cam.id} style={{
                              background: '#EDE9FE', borderRadius: 6, padding: '5px 8px',
                              borderLeft: '3px solid #8B5CF6',
                            }}>
                              <div style={{ fontWeight: 700, color: '#7C3AED', fontSize: 11, marginBottom: 2 }}>
                                <Navigation size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                                {cam.destino}
                              </div>
                              <div style={{ fontSize: 10, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <MapPin size={8} /> {cam.cidade}
                              </div>
                            </div>
                          ))}
                          {agendaNoDia.filter(a => !a.id_ordem).map(ag => {
                            const turnoColors: Record<string, string> = { manha: '#F59E0B', tarde: '#3B82F6', integral: '#10B981' }
                            const turnoLabels: Record<string, string> = { manha: 'Manhã', tarde: 'Tarde', integral: 'Integral' }
                            const turnoKey = ag.turno || 'manha'
                            return (
                              <div key={`ag-${ag.id}`} style={{
                                background: '#FFFBEB', borderRadius: 6, padding: '6px 8px',
                                borderLeft: `3px solid ${turnoColors[turnoKey] || '#F59E0B'}`,
                              }}>
                                <div style={{ fontWeight: 700, color: '#92400E', fontSize: 10, letterSpacing: '0.3px', marginBottom: 2 }}>MANUAL</div>
                                {ag.cliente && (
                                  <div style={{ fontWeight: 700, color: '#1E3A5F', fontSize: 12, marginBottom: 2 }}>
                                    {ag.cliente.split(' ').slice(0, 2).join(' ')}
                                  </div>
                                )}
                                {ag.descricao && (
                                  <div style={{ color: '#374151', fontSize: 10, lineHeight: 1.3 }}>
                                    {ag.descricao.substring(0, 80)}
                                  </div>
                                )}
                                <div style={{ color: turnoColors[turnoKey] || '#F59E0B', fontWeight: 600, fontSize: 10, marginTop: 2 }}>
                                  {turnoLabels[turnoKey] || turnoKey}
                                  {ag.hora_inicio ? ` ${ag.hora_inicio}` : ''}
                                </div>
                              </div>
                            )
                          })}
                          {ordensNoDia.length === 0 && caminhosNoDia.length === 0 && agendaNoDia.filter(a => !a.id_ordem).length === 0 && (
                            <div style={{ color: '#E5E7EB', fontSize: 10, textAlign: 'center', paddingTop: 30 }}>—</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TÉCNICOS ═══ */}
      {tab === 'tecnicos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tecnicos.map(tec => {
            const isExpanded = expandedTec === tec.user_id
            const pontos = pontuacaoTecnico[tec.tecnico_nome] ?? 100
            const atrasosDoTec = ordensAtrasoPorTecnico[tec.tecnico_nome] || []
            const ocorrDoTec = ocorrencias.filter(o => o.tecnico_nome === tec.tecnico_nome)
            const execsDoTec = execucoesRecentes.filter(e => e.tecnico_nome === tec.tecnico_nome)
            const pontosColor = pontos >= 80 ? '#10B981' : pontos >= 50 ? '#F59E0B' : '#EF4444'
            const roleLabel = tec.mecanico_role === 'tecnico' ? 'TÉCNICO' : 'OBSERVADOR'
            const roleColor = tec.mecanico_role === 'tecnico' ? '#1E3A5F' : '#7C3AED'

            return (
              <div key={tec.user_id} style={{ ...STAT_CARD, padding: 0, overflow: 'hidden' }}>
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 16px', cursor: 'pointer',
                  }}
                  onClick={() => { setExpandedTec(isExpanded ? null : tec.user_id); setTecSubTab('atrasos') }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: '#1E3A5F',
                      color: '#fff', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 14, fontWeight: 700,
                    }}>
                      {tec.tecnico_nome.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937' }}>{tec.tecnico_nome}</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>
                        {tec.tecnico_email}
                        <span style={{ color: roleColor, marginLeft: 8, fontWeight: 700 }}>{roleLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Pontuação */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: `${pontosColor}15`, padding: '4px 10px', borderRadius: 8,
                    }}>
                      <Star size={14} color={pontosColor} />
                      <span style={{ fontSize: 16, fontWeight: 800, color: pontosColor }}>{pontos}</span>
                    </div>
                    {atrasosDoTec.length > 0 && (
                      <span style={{
                        background: '#FEE2E2', color: '#DC2626', fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 10,
                      }}>
                        {atrasosDoTec.length} atraso(s)
                      </span>
                    )}
                    {ocorrDoTec.length > 0 && (
                      <span style={{
                        background: '#FEF3C7', color: '#D97706', fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 10,
                      }}>
                        {ocorrDoTec.length} ocorrência(s)
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid #F3F4F6' }}>
                    {/* Sub tabs */}
                    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #F3F4F6' }}>
                      {([
                        { id: 'atrasos', label: `Atrasos (${atrasosDoTec.length})`, icon: <Clock size={13} /> },
                        { id: 'ocorrencias', label: `Ocorrências (${ocorrDoTec.length})`, icon: <AlertOctagon size={13} /> },
                        { id: 'execucoes', label: `Execuções (${execsDoTec.length})`, icon: <Wrench size={13} /> },
                      ] as const).map(st => (
                        <button key={st.id} onClick={() => setTecSubTab(st.id)} style={{
                          padding: '10px 16px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                          background: tecSubTab === st.id ? '#EFF6FF' : 'transparent',
                          color: tecSubTab === st.id ? '#1E3A5F' : '#6B7280',
                          borderBottom: tecSubTab === st.id ? '2px solid #1E3A5F' : '2px solid transparent',
                        }}>
                          {st.icon} {st.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ padding: 16 }}>
                      {/* Atrasos */}
                      {tecSubTab === 'atrasos' && (
                        atrasosDoTec.length === 0 ? (
                          <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 20 }}>
                            Nenhum serviço em atraso
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {atrasosDoTec.map(o => {
                              const diasAtraso = Math.ceil((Date.now() - new Date(o.Previsao_Execucao + 'T23:59:59').getTime()) / (1000 * 60 * 60 * 24))
                              return (
                                <div key={o.Id_Ordem} style={{
                                  padding: 12, background: '#FEF2F2', borderRadius: 8,
                                  borderLeft: '4px solid #EF4444',
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>{o.Id_Ordem}</span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>
                                      {diasAtraso} dia(s) de atraso
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{o.Os_Cliente}</div>
                                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                                    {o.Tipo_Servico} • Previsão: {formatDateBR(o.Previsao_Execucao!)}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{o.Endereco_Cliente}</div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      )}

                      {/* Ocorrências (cagadas) */}
                      {tecSubTab === 'ocorrencias' && (
                        ocorrDoTec.length === 0 ? (
                          <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 20 }}>
                            Nenhuma ocorrência registrada
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {ocorrDoTec.map(oc => {
                              const tipoInfo = TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros
                              const justDoOc = justificativas.find(j => j.id_ocorrencia === oc.id)
                              return (
                                <div key={oc.id} style={{
                                  padding: 12, background: '#fff', borderRadius: 8,
                                  border: '1px solid #E5E7EB', borderLeft: `4px solid ${tipoInfo.color}`,
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{
                                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                        background: `${tipoInfo.color}20`, color: tipoInfo.color,
                                      }}>
                                        {tipoInfo.label}
                                      </span>
                                      {oc.id_ordem && <span style={{ fontSize: 12, color: '#6B7280' }}>OS: {oc.id_ordem}</span>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>
                                        -{oc.pontos_descontados} pts
                                      </span>
                                      {justDoOc && (
                                        <span style={{
                                          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                          background: justDoOc.status === 'aprovada' ? '#D1FAE5' : justDoOc.status === 'recusada' ? '#FEE2E2' : '#FEF3C7',
                                          color: justDoOc.status === 'aprovada' ? '#065F46' : justDoOc.status === 'recusada' ? '#DC2626' : '#D97706',
                                        }}>
                                          Just. {justDoOc.status}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 13, color: '#374151' }}>{oc.descricao}</div>
                                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                                    {new Date(oc.data).toLocaleDateString('pt-BR')}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      )}

                      {/* Execuções */}
                      {tecSubTab === 'execucoes' && (
                        execsDoTec.length === 0 ? (
                          <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 20 }}>
                            Nenhuma execução registrada
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {execsDoTec.slice(0, 10).map(ex => (
                              <div key={ex.id} style={{
                                padding: 10, background: '#fff', borderRadius: 8,
                                border: '1px solid #E5E7EB',
                                borderLeft: `4px solid ${ex.status === 'enviado' ? '#10B981' : '#F59E0B'}`,
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{ex.id_ordem}</span>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                    background: ex.status === 'enviado' ? '#D1FAE5' : '#FEF3C7',
                                    color: ex.status === 'enviado' ? '#065F46' : '#92400E',
                                  }}>
                                    {ex.status === 'enviado' ? 'Enviado' : 'Rascunho'}
                                  </span>
                                </div>
                                {ex.servico_realizado && (
                                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                                    {ex.servico_realizado.length > 120 ? ex.servico_realizado.substring(0, 120) + '...' : ex.servico_realizado}
                                  </div>
                                )}
                                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
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
      )}

      {/* ═══ JUSTIFICATIVAS ═══ */}
      {tab === 'justificativas' && (
        <div>
          {/* Pendentes primeiro */}
          {justPendentes.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#D97706', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} /> Pendentes de Avaliação ({justPendentes.length})
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {justPendentes.map(j => {
                  const oc = ocorrencias.find(o => o.id === j.id_ocorrencia)
                  return (
                    <div key={j.id} style={{
                      ...STAT_CARD, padding: 16, borderLeft: '4px solid #F59E0B',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{j.tecnico_nome}</span>
                          {j.id_ordem && <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>OS: {j.id_ordem}</span>}
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: '#FEF3C7', color: '#D97706',
                        }}>
                          Pendente
                        </span>
                      </div>
                      {oc && (
                        <div style={{
                          background: '#F9FAFB', borderRadius: 6, padding: 10, marginBottom: 8,
                          border: '1px solid #E5E7EB',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Ocorrência:</div>
                          <div style={{ fontSize: 12, color: '#374151' }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                              background: `${(TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).color}20`,
                              color: (TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).color,
                              marginRight: 6,
                            }}>
                              {(TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).label}
                            </span>
                            {oc.descricao}
                            <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 8 }}>-{oc.pontos_descontados} pts</span>
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 13, color: '#374151', marginBottom: 12, background: '#FFFBEB', padding: 10, borderRadius: 6, border: '1px solid #FDE68A' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Justificativa do técnico:</div>
                        {j.justificativa}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => avaliarJustificativa(j.id, true)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          background: '#10B981', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}>
                          <ThumbsUp size={16} /> Aceitar (não descontar)
                        </button>
                        <button onClick={() => avaliarJustificativa(j.id, false)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}>
                          <ThumbsDown size={16} /> Recusar (descontar comissão)
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Já avaliadas */}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} /> Histórico de Justificativas
          </h2>
          {justificativas.filter(j => j.status !== 'pendente').length === 0 ? (
            <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 40 }}>
              Nenhuma justificativa avaliada
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {justificativas.filter(j => j.status !== 'pendente').map(j => {
                const oc = ocorrencias.find(o => o.id === j.id_ocorrencia)
                return (
                  <div key={j.id} style={{
                    ...STAT_CARD, padding: 14,
                    borderLeft: `4px solid ${j.status === 'aprovada' ? '#10B981' : '#DC2626'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{j.tecnico_nome}</span>
                        {j.id_ordem && <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>OS: {j.id_ordem}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: j.status === 'aprovada' ? '#D1FAE5' : '#FEE2E2',
                          color: j.status === 'aprovada' ? '#065F46' : '#DC2626',
                        }}>
                          {j.status === 'aprovada' ? 'Aceita' : 'Recusada'}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: j.descontar_comissao ? '#FEE2E2' : '#D1FAE5',
                          color: j.descontar_comissao ? '#DC2626' : '#065F46',
                        }}>
                          {j.descontar_comissao ? 'Desconta comissão' : 'Sem desconto'}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{j.justificativa}</div>
                    {oc && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>Ocorrência: {oc.descricao}</div>}
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                      {j.data_avaliacao && `Avaliado em ${new Date(j.data_avaliacao).toLocaleDateString('pt-BR')}`}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ REQUISIÇÕES ═══ */}
      {tab === 'requisicoes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requisicoes.length === 0 ? (
            <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 40 }}>
              Nenhuma requisição registrada
            </div>
          ) : (
            requisicoes.map(req => {
              const isPendente = req.status === 'pendente'
              const statusColors: Record<string, { bg: string; color: string }> = {
                pendente: { bg: '#FEF3C7', color: '#D97706' },
                aprovada: { bg: '#EFF6FF', color: '#2563EB' },
                recusada: { bg: '#FEE2E2', color: '#DC2626' },
                atualizada: { bg: '#D1FAE5', color: '#065F46' },
              }
              const sc = statusColors[req.status] || statusColors.pendente
              return (
                <div key={req.id} style={{
                  ...STAT_CARD, padding: 14, borderLeft: `4px solid ${sc.color}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{req.tecnico_nome}</span>
                      {req.id_ordem && <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>OS: {req.id_ordem}</span>}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                      background: sc.bg, color: sc.color, textTransform: 'capitalize',
                    }}>
                      {req.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{req.material_solicitado}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {req.quantidade && `Qtd: ${req.quantidade} • `}
                      {req.urgencia === 'urgente' ? '🔴 Urgente' : 'Normal'}
                      {' • '}{new Date(req.created_at).toLocaleDateString('pt-BR')}
                    </div>
                    {isPendente && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => aprovarRequisicao(req.id)} style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          background: '#10B981', color: '#fff', border: 'none',
                          borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}>
                          <Check size={12} /> Aprovar
                        </button>
                        <button onClick={() => recusarRequisicao(req.id)} style={{
                          background: '#FEE2E2', color: '#DC2626', border: 'none',
                          borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}>
                          Recusar
                        </button>
                      </div>
                    )}
                  </div>
                  {req.status === 'aprovada' && !req.atualizada_pelo_tecnico && (
                    <div style={{ fontSize: 11, color: '#D97706', marginTop: 6, fontWeight: 600 }}>
                      <AlertTriangle size={12} style={{ verticalAlign: 'middle' }} /> Técnico ainda não confirmou recebimento
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ═══ EXECUÇÕES ═══ */}
      {tab === 'execucoes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {execucoesRecentes.length === 0 ? (
            <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 40 }}>
              Nenhuma execução registrada
            </div>
          ) : (
            execucoesRecentes.map(ex => (
              <div key={ex.id} style={{
                ...STAT_CARD, padding: 14,
                borderLeft: `4px solid ${ex.status === 'enviado' ? '#10B981' : '#F59E0B'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{ex.id_ordem}</span>
                    <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>{ex.tecnico_nome}</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: ex.status === 'enviado' ? '#D1FAE5' : '#FEF3C7',
                    color: ex.status === 'enviado' ? '#065F46' : '#92400E',
                  }}>
                    {ex.status === 'enviado' ? 'Enviado' : 'Rascunho'}
                  </span>
                </div>
                {ex.servico_realizado && (
                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                    {ex.servico_realizado.length > 150 ? ex.servico_realizado.substring(0, 150) + '...' : ex.servico_realizado}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                  Execução: {new Date(ex.data_execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                  {' • '}Enviado: {new Date(ex.created_at).toLocaleDateString('pt-BR')}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══ MODAL NOVO CAMINHO ═══ */}
      {showCaminhoModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowCaminhoModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%',
            maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
                <Navigation size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                Novo Caminho
              </h2>
              <button onClick={() => setShowCaminhoModal(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280',
              }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Técnico</label>
                <select
                  value={novoCaminho.tecnico_nome}
                  onChange={e => setNovoCaminho({ ...novoCaminho, tecnico_nome: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, background: '#fff',
                  }}
                >
                  <option value="">Selecione...</option>
                  {tecnicosAtivos.map(t => (
                    <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Destino</label>
                <input
                  type="text"
                  value={novoCaminho.destino}
                  onChange={e => setNovoCaminho({ ...novoCaminho, destino: e.target.value })}
                  placeholder="Ex: Fazenda São João"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Cidade</label>
                <input
                  type="text"
                  value={novoCaminho.cidade}
                  onChange={e => setNovoCaminho({ ...novoCaminho, cidade: e.target.value })}
                  placeholder="Ex: Ribeirão Preto"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Motivo</label>
                <textarea
                  value={novoCaminho.motivo}
                  onChange={e => setNovoCaminho({ ...novoCaminho, motivo: e.target.value })}
                  placeholder="Ex: Manutenção preventiva trator John Deere"
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
              </div>
              <button onClick={salvarCaminho} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: '#1E3A5F', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
              }}>
                <Send size={16} /> Registrar Caminho
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL NOVA OCORRÊNCIA ═══ */}
      {showOcorrenciaModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowOcorrenciaModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%',
            maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', margin: 0 }}>
                <AlertOctagon size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                Nova Ocorrência
              </h2>
              <button onClick={() => setShowOcorrenciaModal(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280',
              }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Técnico</label>
                <select
                  value={novaOcorrencia.tecnico_nome}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tecnico_nome: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, background: '#fff',
                  }}
                >
                  <option value="">Selecione...</option>
                  {tecnicos.map(t => (
                    <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>OS (opcional)</label>
                <input
                  type="text"
                  value={novaOcorrencia.id_ordem}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, id_ordem: e.target.value })}
                  placeholder="Ex: OS-001"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Tipo</label>
                <select
                  value={novaOcorrencia.tipo}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tipo: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, background: '#fff',
                  }}
                >
                  {Object.entries(TIPO_OCORRENCIA).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Descrição</label>
                <textarea
                  value={novaOcorrencia.descricao}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, descricao: e.target.value })}
                  placeholder="Descreva a ocorrência..."
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Pontos a descontar
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={novaOcorrencia.pontos_descontados}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, pontos_descontados: Number(e.target.value) })}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                    fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>
              <button onClick={salvarOcorrencia} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: '#DC2626', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
              }}>
                <AlertOctagon size={16} /> Registrar Ocorrência
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
