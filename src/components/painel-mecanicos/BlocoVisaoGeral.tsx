'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  MapPin, Clock, ChevronDown, Truck,
  Loader2, Coffee, ArrowRight, ArrowLeft, Briefcase, Moon,
  RefreshCw, Plus, X, Trash2, Search, FileText
} from 'lucide-react'

// ── Types ──
interface OrdemServico {
  Id_Ordem: string; Status: string; Os_Cliente: string; Cnpj_Cliente: string
  Os_Tecnico: string; Os_Tecnico2: string; Previsao_Execucao: string | null
  Previsao_Faturamento: string | null; Serv_Solicitado: string
  Endereco_Cliente: string; Cidade_Cliente: string; Tipo_Servico: string
  Qtd_HR?: string | number | null
}
interface Tecnico { user_id: string; tecnico_nome: string; tecnico_email: string; mecanico_role: 'tecnico' | 'observador' }
interface Caminho { id: number; tecnico_nome: string; destino: string; cidade: string; motivo: string; data_saida: string; status: string }
interface AgendaRow {
  id: number; data: string; tecnico_nome: string; id_ordem: string | null; id_caminho: number | null
  cliente: string; servico: string; endereco: string; cidade: string
  endereco_opcoes: { label: string; fonte: string; endereco: string }[]
  coordenadas: { lat: number; lng: number } | null
  tempo_ida_min: number; distancia_ida_km: number; tempo_volta_min: number; distancia_volta_km: number
  qtd_horas: number; ordem_sequencia: number; status: string; observacoes: string
}
interface TrechoRota {
  tipo: 'saida' | 'deslocamento' | 'servico' | 'almoco' | 'retorno' | 'proximo_dia'
  label: string; sublabel: string; horaInicio: string; duracao?: string
  icon: 'truck' | 'arrow-right' | 'briefcase' | 'coffee' | 'arrow-left' | 'pin' | 'moon'; color: string
}

// ── Helpers ──
function normNome(n: string): string[] { return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2) }
function match(a: string, b: string) { if (!a || !b) return false; const pA = normNome(a), pB = normNome(b); if (!pA.length || !pB.length || pA[0] !== pB[0]) return false; if (pA.length === 1 || pB.length === 1) return true; const s = new Set(pA.slice(1)); return pB.slice(1).some(p => s.has(p)) }
function extrairSolicitacao(serv: string): string {
  if (!serv) return ''
  const idx = serv.indexOf('Solicitação do cliente:')
  if (idx === -1) return ''
  const after = serv.substring(idx + 'Solicitação do cliente:'.length)
  const fim = after.indexOf('Serviço Realizado')
  const trecho = fim > -1 ? after.substring(0, fim) : after
  return trecho.replace(/\n/g, ' ').trim()
}
function fm(m: number) { if (m < 60) return `${Math.round(m)}min`; const h = Math.floor(m / 60); const r = Math.round(m % 60); return r > 0 ? `${h}h${r}` : `${h}h` }
function fh(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}` }

const S = 510, AI = 660, AD = 90, FE = 1080
const IC: Record<string, React.ReactNode> = { truck: <Truck size={11} />, 'arrow-right': <ArrowRight size={11} />, briefcase: <Briefcase size={11} />, coffee: <Coffee size={11} />, 'arrow-left': <ArrowLeft size={11} />, pin: <MapPin size={11} />, moon: <Moon size={11} /> }

function cronograma(items: AgendaRow[]) {
  const t: TrechoRota[] = []; let c = S, al = false, dia = 0
  const ld = (d: number) => d === 0 ? '' : d === 1 ? ' (dia seguinte)' : ` (+${d}d)`
  const vira = () => { while (c >= FE) { t.push({ tipo: 'proximo_dia', label: `Fim expediente${ld(dia)}`, sublabel: 'Continua próximo dia 08:30', horaInicio: fh(FE), icon: 'moon', color: '#DC2626' }); dia++; c = S; al = false; t.push({ tipo: 'saida', label: `Retorno${ld(dia)}`, sublabel: 'Continuação', horaInicio: fh(c), icon: 'truck', color: '#71717A' }) } }
  t.push({ tipo: 'saida', label: 'Saída da oficina', sublabel: '08:30', horaInicio: fh(c), icon: 'truck', color: '#71717A' })
  for (const r of items) {
    const nm = r.cliente ? r.cliente.split(' ').slice(0, 3).join(' ') : r.id_ordem || '?'
    const dm = r.tempo_ida_min || 0, dk = r.distancia_ida_km || 0, sv = (r.qtd_horas || 2) * 60
    c += dm; vira()
    t.push({ tipo: 'deslocamento', label: `${nm}${ld(dia)}`, sublabel: `${fm(dm)} · ${dk}km`, horaInicio: fh(c), duracao: fm(dm), icon: 'arrow-right', color: '#52525B' })
    if (!al && c >= AI && c < AI + 90) { t.push({ tipo: 'almoco', label: 'Almoço', sublabel: '1h30', horaInicio: fh(c), duracao: '1h30', icon: 'coffee', color: '#D97706' }); c += AD; al = true }
    let rest = sv
    while (rest > 0) {
      if (!al && c >= AI && c < AI + 90) { t.push({ tipo: 'almoco', label: 'Almoço', sublabel: '1h30', horaInicio: fh(c), duracao: '1h30', icon: 'coffee', color: '#D97706' }); c += AD; al = true }
      const d = FE - c
      if (rest <= d) { t.push({ tipo: 'servico', label: `Serviço · ${r.id_ordem || ''}${rest < sv ? ' (cont.)' : ''}${ld(dia)}`, sublabel: fm(rest), horaInicio: fh(c), duracao: fm(rest), icon: 'briefcase', color: '#18181B' }); c += rest; rest = 0 }
      else { if (d > 0) { t.push({ tipo: 'servico', label: `Serviço · ${r.id_ordem || ''}${ld(dia)}`, sublabel: `${fm(d)}`, horaInicio: fh(c), duracao: fm(d), icon: 'briefcase', color: '#18181B' }); rest -= d }; c = FE; vira() }
    }
    if (!al && c >= AI && c <= AI + 120) { t.push({ tipo: 'almoco', label: 'Almoço', sublabel: '1h30', horaInicio: fh(c), duracao: '1h30', icon: 'coffee', color: '#D97706' }); c += AD; al = true }
  }
  const vm = items[items.length - 1]?.tempo_volta_min || 0, vk = items[items.length - 1]?.distancia_volta_km || 0
  c += vm; vira()
  t.push({ tipo: 'deslocamento', label: `Retorno oficina${ld(dia)}`, sublabel: `${fm(vm)} · ${vk}km`, horaInicio: fh(c), duracao: fm(vm), icon: 'arrow-left', color: '#52525B' })
  t.push({ tipo: 'retorno', label: dia > 0 ? `Chegada${ld(dia)}` : 'Chegada', sublabel: dia > 0 ? `${dia + 1} dias` : `Total: ${fm(c - S)}`, horaInicio: fh(c), icon: dia > 0 ? 'moon' : 'pin', color: dia > 0 ? '#DC2626' : '#18181B' })
  return { trechos: t, retornoHora: fh(c), totalForaMin: c - S, passaDia: dia > 0, diasExtras: dia }
}

// ── Styles ──
const INP: React.CSSProperties = { fontSize: 14, padding: '9px 12px', border: '1px solid #D4D4D8', borderRadius: 8, outline: 'none', width: '100%', background: '#fff', boxSizing: 'border-box', color: '#18181B' }
const LBL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#3F3F46', marginBottom: 5, display: 'block' }
const COLORS = ['#6366F1', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6']

// ── Component ──
export default function BlocoVisaoGeral({ tecnicos, ordens, caminhos }: { tecnicos: Tecnico[]; ordens: OrdemServico[]; caminhos: Caminho[] }) {
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [calculando, setCalculando] = useState<Record<number, boolean>>({})
  const [cronoAberto, setCronoAberto] = useState<Record<string, boolean>>({})
  const [salvando, setSalvando] = useState<Record<number, boolean>>({})
  const [addTec, setAddTec] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<'os' | 'manual'>('os')
  const [buscaOS, setBuscaOS] = useState('')
  const [form, setForm] = useState({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })

  const tecs = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])

  // ── API ──
  const calcRota = useCallback(async (row: AgendaRow) => {
    setCalculando(p => ({ ...p, [row.id]: true }))
    try { const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, calcular: true }) }); if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === row.id ? u : a)) } } catch { }
    setCalculando(p => ({ ...p, [row.id]: false }))
  }, [])

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/pos/agenda-visao?data=${hoje}`)
    if (r.ok) { const rows = await r.json(); setAgenda(rows); return rows as AgendaRow[] }
    return []
  }, [hoje])

  // Refs para acessar valores atuais sem recriar callbacks
  const tecsRef = useRef(tecs)
  const ordensRef = useRef(ordens)
  tecsRef.current = tecs
  ordensRef.current = ordens

  const sincronizar = useCallback(async () => {
    const t = tecsRef.current
    const o = ordensRef.current
    if (!t.length) return
    setSyncing(true)
    try {
      const payload = t.map(tec => {
        const os = o.filter(ord =>
          ord.Status === 'Execução' &&
          (match(tec.tecnico_nome, ord.Os_Tecnico) || match(tec.tecnico_nome, ord.Os_Tecnico2))
        )
        return {
          nome: tec.tecnico_nome,
          ordens: os.filter(ord => match(tec.tecnico_nome, ord.Os_Tecnico)).map(ord => ({
            id: ord.Id_Ordem, cliente: ord.Os_Cliente, cnpj: ord.Cnpj_Cliente,
            endereco: ord.Endereco_Cliente, cidade: ord.Cidade_Cliente,
            servico: ord.Serv_Solicitado,
            qtdHoras: parseFloat(String(ord.Qtd_HR || 0)) || 2,
            observacoes: extrairSolicitacao(ord.Serv_Solicitado || ''),
          })),
        }
      }).filter(x => x.ordens.length > 0)

      if (payload.length > 0) {
        const r = await fetch('/api/pos/agenda-visao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: hoje, tecnicos: payload }) })
        if (r.ok) { const rows = await r.json() as AgendaRow[]; setAgenda(rows); rows.filter(r => r.tempo_ida_min === 0 && r.endereco).forEach(r => calcRota(r)) }
      } else {
        await carregar()
      }
    } finally {
      setSyncing(false)
    }
  }, [hoje, carregar, calcRota])

  // Sincroniza quando técnicos e ordens estão disponíveis
  useEffect(() => {
    if (!tecs.length || !ordens.length) return
    sincronizar()
  }, [tecs.length, ordens.length, sincronizar])

  // ── Computed ──
  const porTec = useMemo(() => { const m: Record<string, AgendaRow[]> = {}; tecs.forEach(t => { m[t.tecnico_nome] = agenda.filter(a => a.tecnico_nome === t.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia) }); return m }, [tecs, agenda])
  const camPorTec = useMemo(() => { const m: Record<string, Caminho | null> = {}; tecs.forEach(t => { m[t.tecnico_nome] = caminhos.find(c => c.tecnico_nome === t.tecnico_nome && c.status === 'em_transito') || null }); return m }, [tecs, caminhos])
  const oficina = (items: AgendaRow[]) => items.length === 0 || items.every(a => (a.cliente || '').toLowerCase().includes('nova tratores'))

  // Ordens em execução por técnico
  const ordensPorTec = useMemo(() => {
    const m: Record<string, OrdemServico[]> = {}
    tecs.forEach(t => {
      m[t.tecnico_nome] = ordens.filter(o =>
        o.Status === 'Execução' &&
        (match(t.tecnico_nome, o.Os_Tecnico) || match(t.tecnico_nome, o.Os_Tecnico2))
      )
    })
    return m
  }, [tecs, ordens])

  // Todas as ordens em execução (para busca geral no painel adicionar)
  const todasOrdensExecucao = useMemo(() =>
    ordens.filter(o => o.Status === 'Execução'),
    [ordens]
  )

  // ── Actions ──
  const salvarCampo = async (id: number, campo: string, valor: any) => {
    setSalvando(p => ({ ...p, [id]: true }))
    const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, [campo]: valor }) })
    if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === id ? u : a)) }
    setSalvando(p => ({ ...p, [id]: false }))
  }

  const remover = async (id: number) => {
    const r = await fetch('/api/pos/agenda-visao', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (r.ok) setAgenda(p => p.filter(a => a.id !== id))
  }

  const adicionarOS = async (tecNome: string, os: OrdemServico) => {
    const horas = parseFloat(String(os.Qtd_HR || 0)) || 2
    setSalvando(p => ({ ...p, [-1]: true }))
    const r = await fetch('/api/pos/agenda-visao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: hoje, tecnicos: [{ nome: tecNome, ordens: [{ id: os.Id_Ordem, cliente: os.Os_Cliente, cnpj: os.Cnpj_Cliente, endereco: os.Endereco_Cliente, cidade: os.Cidade_Cliente, servico: os.Serv_Solicitado, qtdHoras: horas, observacoes: extrairSolicitacao(os.Serv_Solicitado || '') }] }] }),
    })
    if (r.ok) {
      const rows = await r.json() as AgendaRow[]
      setAgenda(rows)
      rows.filter(x => x.tempo_ida_min === 0 && x.endereco && x.tecnico_nome === tecNome).forEach(x => calcRota(x))
    }
    setSalvando(p => ({ ...p, [-1]: false }))
  }

  const adicionarManual = async (tecNome: string) => {
    if (!form.cliente) return
    setSalvando(p => ({ ...p, [-1]: true }))
    const di = form.dataInicio || hoje
    const df = form.dataFim || di
    const inicio = new Date(di + 'T00:00:00')
    const fim = new Date(df + 'T00:00:00')
    const dias = Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 86400000) + 1)

    for (let d = 0; d < dias; d++) {
      const dt = new Date(inicio.getTime() + d * 86400000).toISOString().split('T')[0]
      const r = await fetch('/api/pos/agenda-visao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dt, tecnicos: [{ nome: tecNome, ordens: [{ id: `AG-${Date.now()}-${d}`, cliente: form.cliente, cnpj: '', endereco: form.endereco, cidade: form.cidade, servico: form.servico, qtdHoras: form.horas, observacoes: form.obs }] }] }),
      })
      if (r.ok && dt === hoje) {
        const rows = await r.json() as AgendaRow[]
        setAgenda(rows)
        rows.filter(x => x.tempo_ida_min === 0 && x.endereco && x.tecnico_nome === tecNome).forEach(x => calcRota(x))
      }
    }

    setAddTec(null)
    setForm({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
    setSalvando(p => ({ ...p, [-1]: false }))
  }

  const abrirAdd = (tecNome: string) => {
    setAddTec(tecNome)
    setAddMode('os')
    setBuscaOS('')
    setForm({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
  }

  const fecharAdd = () => {
    setAddTec(null)
    setBuscaOS('')
    setForm({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
  }

  // ── Render ──
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#18181B' }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 2 }}>{tecs.length} técnicos ativos</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="/tv-painel" target="_blank" rel="noopener" style={{
            fontSize: 11, fontWeight: 500, color: '#71717A', textDecoration: 'none',
            border: '1px solid #E4E4E7', borderRadius: 6, padding: '4px 12px',
          }}>TV</a>
          <button onClick={sincronizar} disabled={syncing} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: '#18181B', color: '#fff', border: 'none', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Sincronizar
          </button>
        </div>
      </div>

      {/* Grid de técnicos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 20 }}>
        {tecs.map((tec, tecIdx) => {
          const items = porTec[tec.tecnico_nome] || []
          const cam = camPorTec[tec.tecnico_nome]
          const naOfi = !cam && oficina(items)
          const ext = items.filter(a => !(a.cliente || '').toLowerCase().includes('nova tratores'))
          const crono = ext.length > 0 && ext.every(a => a.tempo_ida_min > 0) ? cronograma(ext) : null
          const ordsTec = ordensPorTec[tec.tecnico_nome] || []
          const idsNaAgenda = new Set(items.map(a => a.id_ordem).filter(Boolean))
          const ordsDisponiveis = ordsTec.filter(o => !idsNaAgenda.has(o.Id_Ordem))
          const tecColor = COLORS[tecIdx % COLORS.length]
          const isAdding = addTec === tec.tecnico_nome

          let statusLabel = '', statusDot = ''
          if (cam) { statusLabel = 'Em trânsito'; statusDot = '#D97706' }
          else if (naOfi) { statusLabel = 'Na oficina'; statusDot = '#A1A1AA' }
          else if (ext.length > 0) { statusLabel = 'Em campo'; statusDot = '#18181B' }

          // Filtro de busca para o painel de adicionar OS
          const buscaLower = buscaOS.toLowerCase()
          const ordsFiltradas = isAdding && addMode === 'os'
            ? (buscaOS
                ? todasOrdensExecucao.filter(o =>
                    !idsNaAgenda.has(o.Id_Ordem) && (
                      o.Id_Ordem.toLowerCase().includes(buscaLower) ||
                      o.Os_Cliente.toLowerCase().includes(buscaLower) ||
                      (o.Cidade_Cliente || '').toLowerCase().includes(buscaLower) ||
                      (o.Serv_Solicitado || '').toLowerCase().includes(buscaLower) ||
                      (o.Tipo_Servico || '').toLowerCase().includes(buscaLower)
                    )
                  )
                : ordsDisponiveis
              )
            : []

          return (
            <div key={tec.user_id} style={{
              background: '#fff', borderRadius: 12, border: '1px solid #E4E4E7', overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Header técnico — colorido */}
              <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `3px solid ${tecColor}`, background: '#FAFAFA' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: tecColor,
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 700, flexShrink: 0, position: 'relative',
                }}>
                  {tec.tecnico_nome.charAt(0)}
                  {cam && <div style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: '50%', background: '#F59E0B', border: '2px solid #fff' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#18181B' }}>{tec.tecnico_nome}</div>
                  <div style={{ fontSize: 13, color: '#52525B', display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    {statusLabel && (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot, display: 'inline-block' }} />
                        <span style={{ fontWeight: 600 }}>{statusLabel}</span>
                        <span style={{ color: '#D4D4D8' }}>·</span>
                      </>
                    )}
                    <span>{ordsTec.length} em execução</span>
                    {items.length > 0 && <><span style={{ color: '#D4D4D8' }}>·</span><span>{items.length} na agenda</span></>}
                  </div>
                </div>
                {crono && (
                  <div style={{ textAlign: 'right', flexShrink: 0, background: crono.passaDia ? '#FEF2F2' : '#fff', padding: '8px 14px', borderRadius: 10, border: `1px solid ${crono.passaDia ? '#FECACA' : '#E4E4E7'}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: crono.passaDia ? '#DC2626' : '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {crono.passaDia ? `+${crono.diasExtras}d` : 'Retorno'}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: crono.passaDia ? '#DC2626' : '#18181B', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                      {crono.retornoHora}
                    </div>
                  </div>
                )}
                {ext.some(a => calculando[a.id]) && !crono && <Loader2 size={16} color="#71717A" className="animate-spin" />}
              </div>

              {/* ── Lista de itens da agenda ── */}
              <div style={{ padding: '12px 16px' }}>
                {items.map((row, idx) => {
                  const isExt = !(row.cliente || '').toLowerCase().includes('nova tratores')
                  return (
                    <div key={row.id} style={{
                      padding: '16px 18px', marginBottom: idx < items.length - 1 ? 10 : 0, borderRadius: 10,
                      border: '1px solid #E4E4E7', background: '#FAFBFC',
                    }}>
                      {/* Topo: OS + rota + delete */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            fontSize: 12, fontWeight: 700, color: '#fff', background: tecColor,
                            padding: '4px 10px', borderRadius: 6,
                          }}>
                            {row.id_ordem || 'Manual'}
                          </span>
                          {row.tempo_ida_min > 0 && (
                            <span style={{ fontSize: 13, fontWeight: 500, color: '#3F3F46' }}>
                              {fm(row.tempo_ida_min)} · {row.distancia_ida_km}km
                            </span>
                          )}
                          {!row.tempo_ida_min && isExt && (
                            <span style={{ fontSize: 13, color: '#A1A1AA' }}>Sem rota</span>
                          )}
                          {!isExt && (
                            <span style={{ fontSize: 13, color: '#71717A' }}>Oficina</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {salvando[row.id] && <Loader2 size={12} className="animate-spin" color="#71717A" />}
                          {calculando[row.id] && <span style={{ fontSize: 12, color: '#71717A' }}>Calculando...</span>}
                          <button onClick={() => remover(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A1A1AA', padding: 3 }}><Trash2 size={14} /></button>
                        </div>
                      </div>

                      {/* Campos editáveis — layout espaçoso */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '12px 16px' }}>
                        <div>
                          <label style={LBL}>Cliente</label>
                          <input defaultValue={row.cliente} onBlur={e => { if (e.target.value !== row.cliente) salvarCampo(row.id, 'cliente', e.target.value) }} style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Horas</label>
                          <input type="number" step="0.5" min="0.5" defaultValue={row.qtd_horas} onBlur={e => { const v = parseFloat(e.target.value) || 2; if (v !== row.qtd_horas) salvarCampo(row.id, 'qtd_horas', v) }} style={INP} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 12 }}>
                        <div>
                          <label style={LBL}>Endereço / Fazenda</label>
                          <input defaultValue={row.endereco || ''} placeholder="Endereço..." onBlur={e => { const v = e.target.value; if (v !== (row.endereco || '')) salvarCampo(row.id, 'endereco', v) }} style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Cidade</label>
                          <input defaultValue={row.cidade || ''} placeholder="Cidade..." onBlur={e => { const v = e.target.value; if (v !== (row.cidade || '')) salvarCampo(row.id, 'cidade', v) }} style={INP} />
                        </div>
                      </div>

                      {/* Observações */}
                      <div style={{ marginTop: 12 }}>
                        <label style={LBL}>Observações</label>
                        <input defaultValue={row.observacoes || ''} placeholder="Obs..." onBlur={e => { if (e.target.value !== (row.observacoes || '')) salvarCampo(row.id, 'observacoes', e.target.value) }} style={INP} />
                      </div>
                    </div>
                  )
                })}

                {items.length === 0 && !isAdding && (
                  <div style={{ textAlign: 'center', padding: '28px 0', color: '#A1A1AA', fontSize: 14 }}>
                    Nenhuma OS em execução
                  </div>
                )}
              </div>

              {/* ── Painel de adicionar ── */}
              {isAdding ? (
                <div style={{ borderTop: '1px solid #E4E4E7', background: '#FAFAFA' }}>
                  {/* Tabs OS / Manual */}
                  <div style={{ display: 'flex', borderBottom: '1px solid #E4E4E7' }}>
                    <button onClick={() => setAddMode('os')} style={{
                      flex: 1, padding: '10px 0', fontSize: 12, fontWeight: addMode === 'os' ? 600 : 400, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: addMode === 'os' ? '#18181B' : '#A1A1AA',
                      borderBottom: addMode === 'os' ? '2px solid #18181B' : '2px solid transparent', marginBottom: -1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}>
                      <FileText size={12} /> Ordens de Serviço
                      {ordsDisponiveis.length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 500, background: '#18181B', color: '#fff', padding: '1px 6px', borderRadius: 8 }}>
                          {ordsDisponiveis.length}
                        </span>
                      )}
                    </button>
                    <button onClick={() => setAddMode('manual')} style={{
                      flex: 1, padding: '10px 0', fontSize: 12, fontWeight: addMode === 'manual' ? 600 : 400, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: addMode === 'manual' ? '#18181B' : '#A1A1AA',
                      borderBottom: addMode === 'manual' ? '2px solid #18181B' : '2px solid transparent', marginBottom: -1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}>
                      <Plus size={12} /> Entrada manual
                    </button>
                  </div>

                  {/* ── Tab OS: lista de ordens do técnico ── */}
                  {addMode === 'os' && (
                    <div style={{ padding: '12px 14px' }}>
                      {/* Busca */}
                      <div style={{ position: 'relative', marginBottom: 10 }}>
                        <Search size={14} color="#A1A1AA" style={{ position: 'absolute', left: 10, top: 9 }} />
                        <input
                          value={buscaOS}
                          onChange={e => setBuscaOS(e.target.value)}
                          placeholder="Buscar OS, cliente, cidade, serviço..."
                          style={{ ...INP, paddingLeft: 32 }}
                        />
                      </div>

                      {/* Lista de OS */}
                      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {ordsFiltradas.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '16px 0', color: '#D4D4D8', fontSize: 12 }}>
                            {buscaOS ? 'Nenhuma OS encontrada' : 'Todas as ordens já estão na agenda'}
                          </div>
                        ) : (
                          ordsFiltradas.map(os => {
                            const horas = parseFloat(String(os.Qtd_HR || 0)) || 2
                            const isTecPrimario = match(tec.tecnico_nome, os.Os_Tecnico)
                            return (
                              <div key={os.Id_Ordem} style={{
                                padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                                border: '1px solid #F4F4F5', background: '#fff', cursor: 'pointer',
                                transition: 'border-color 0.15s',
                              }}
                                onMouseEnter={e => (e.currentTarget.style.borderColor = '#D4D4D8')}
                                onMouseLeave={e => (e.currentTarget.style.borderColor = '#F4F4F5')}
                              >
                                {/* Linha 1: ID + tipo + botão */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#18181B' }}>{os.Id_Ordem}</span>
                                    {os.Tipo_Servico && (
                                      <span style={{ fontSize: 10, fontWeight: 500, color: '#71717A', background: '#F4F4F5', padding: '1px 6px', borderRadius: 4 }}>
                                        {os.Tipo_Servico}
                                      </span>
                                    )}
                                    {!isTecPrimario && (
                                      <span style={{ fontSize: 9, fontWeight: 500, color: '#A1A1AA', background: '#FAFAFA', padding: '1px 5px', borderRadius: 3 }}>
                                        2o técn.
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => adicionarOS(tec.tecnico_nome, os)}
                                    disabled={!!salvando[-1]}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 4,
                                      background: '#18181B', color: '#fff', border: 'none', borderRadius: 5,
                                      padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                                    }}
                                  >
                                    {salvando[-1] ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Adicionar
                                  </button>
                                </div>

                                {/* Linha 2: Cliente */}
                                <div style={{ fontSize: 13, fontWeight: 500, color: '#3F3F46', marginBottom: 2 }}>
                                  {os.Os_Cliente}
                                </div>

                                {/* Linha 3: Detalhes */}
                                <div style={{ fontSize: 11, color: '#A1A1AA', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {os.Cidade_Cliente && <span>{os.Cidade_Cliente}</span>}
                                  {os.Cidade_Cliente && horas > 0 && <span style={{ color: '#E4E4E7' }}>·</span>}
                                  <span>{horas}h</span>
                                  {os.Serv_Solicitado && (
                                    <>
                                      <span style={{ color: '#E4E4E7' }}>·</span>
                                      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {os.Serv_Solicitado}
                                      </span>
                                    </>
                                  )}
                                  {os.Previsao_Execucao && (
                                    <>
                                      <span style={{ color: '#E4E4E7' }}>·</span>
                                      <span>Prev: {new Date(os.Previsao_Execucao + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                                    </>
                                  )}
                                </div>

                                {/* Endereço */}
                                {os.Endereco_Cliente && (
                                  <div style={{ fontSize: 11, color: '#D4D4D8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <MapPin size={10} /> {os.Endereco_Cliente}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Tab Manual ── */}
                  {addMode === 'manual' && (
                    <div style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 8 }}>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={LBL}>Cliente</label>
                          <input value={form.cliente} onChange={e => setForm(p => ({ ...p, cliente: e.target.value }))} placeholder="Nome do cliente..." style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Endereço / Fazenda</label>
                          <input value={form.endereco} onChange={e => setForm(p => ({ ...p, endereco: e.target.value }))} placeholder="Endereço..." style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Cidade</label>
                          <input value={form.cidade} onChange={e => setForm(p => ({ ...p, cidade: e.target.value }))} placeholder="Cidade..." style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Serviço</label>
                          <input value={form.servico} onChange={e => setForm(p => ({ ...p, servico: e.target.value }))} placeholder="Tipo de serviço..." style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Horas/dia</label>
                          <input type="number" step="0.5" min="0.5" value={form.horas} onChange={e => setForm(p => ({ ...p, horas: parseFloat(e.target.value) || 1 }))} style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Data Início</label>
                          <input type="date" value={form.dataInicio || hoje} onChange={e => setForm(p => ({ ...p, dataInicio: e.target.value }))} style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Data Fim</label>
                          <input type="date" value={form.dataFim || hoje} onChange={e => setForm(p => ({ ...p, dataFim: e.target.value }))} style={INP} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={LBL}>Observações</label>
                          <input value={form.obs} onChange={e => setForm(p => ({ ...p, obs: e.target.value }))} placeholder="Obs..." style={INP} />
                        </div>
                      </div>

                      {form.dataInicio && form.dataFim && form.dataFim >= form.dataInicio && (
                        <div style={{ fontSize: 11, color: '#A1A1AA', marginBottom: 10 }}>
                          {Math.round((new Date(form.dataFim + 'T00:00:00').getTime() - new Date((form.dataInicio || hoje) + 'T00:00:00').getTime()) / 86400000) + 1} dia(s) · Total: {form.horas * Math.max(1, Math.round((new Date(form.dataFim + 'T00:00:00').getTime() - new Date(form.dataInicio + 'T00:00:00').getTime()) / 86400000) + 1)}h
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => adicionarManual(tec.tecnico_nome)} disabled={!form.cliente || salvando[-1]}
                          style={{
                            flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 500, borderRadius: 6, border: 'none', cursor: 'pointer',
                            background: form.cliente ? '#18181B' : '#E4E4E7', color: form.cliente ? '#fff' : '#A1A1AA',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}>
                          {salvando[-1] ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Adicionar
                        </button>
                        <button onClick={fecharAdd}
                          style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #E4E4E7', background: '#fff', cursor: 'pointer', color: '#A1A1AA', fontSize: 13 }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Botão fechar no rodapé */}
                  {addMode === 'os' && (
                    <div style={{ padding: '8px 14px', borderTop: '1px solid #F4F4F5', textAlign: 'center' }}>
                      <button onClick={fecharAdd} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#A1A1AA', fontSize: 12, fontWeight: 500,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        <X size={11} /> Fechar
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => abrirAdd(tec.tecnico_nome)}
                  style={{
                    width: '100%', padding: '10px 0', fontSize: 12, fontWeight: 500, color: '#A1A1AA',
                    background: 'none', border: 'none', borderTop: '1px solid #F4F4F5', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                  <Plus size={12} /> Adicionar
                </button>
              )}

              {/* ── Cronograma ── */}
              {crono && (
                <>
                  <button onClick={() => setCronoAberto(p => ({ ...p, [tec.tecnico_nome]: !p[tec.tecnico_nome] }))} style={{
                    width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 500, color: '#A1A1AA',
                    background: 'none', border: 'none', borderTop: '1px solid #F4F4F5', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                    <Clock size={11} /> {cronoAberto[tec.tecnico_nome] ? 'Ocultar cronograma' : 'Ver cronograma'}
                    <ChevronDown size={12} style={{ transform: cronoAberto[tec.tecnico_nome] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                  {cronoAberto[tec.tecnico_nome] && (
                    <div style={{ padding: '10px 16px 14px', background: '#FAFAFA', borderTop: '1px solid #F4F4F5' }}>
                      {crono.trechos.map((tr, i) => (
                        <div key={i}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                            <div style={{
                              width: 22, height: 22, borderRadius: 6, background: '#F4F4F5',
                              color: tr.tipo === 'proximo_dia' ? '#DC2626' : '#71717A',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              {IC[tr.icon]}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: '#18181B' }}>{tr.label}</div>
                              <div style={{ fontSize: 11, color: '#A1A1AA' }}>{tr.sublabel}</div>
                            </div>
                            <div style={{
                              fontSize: tr.tipo === 'retorno' ? 14 : 12, fontWeight: 600,
                              color: tr.tipo === 'proximo_dia' || tr.tipo === 'retorno' ? '#18181B' : '#71717A',
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              {tr.horaInicio}
                            </div>
                          </div>
                          {i < crono.trechos.length - 1 && <div style={{ marginLeft: 11, borderLeft: '1px dashed #E4E4E7', height: 4 }} />}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
