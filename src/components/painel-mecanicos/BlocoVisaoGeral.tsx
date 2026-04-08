'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  MapPin, Clock, Truck, ArrowRight, RefreshCw, Timer, Car, Activity, Zap, Home,
  AlertTriangle, Edit3, Check, X, ExternalLink, Navigation, ArrowDown
} from 'lucide-react'

// ── Types ──
interface OrdemServico { Id_Ordem: string; Status: string; Os_Cliente: string; Cnpj_Cliente: string; Os_Tecnico: string; Os_Tecnico2: string; Previsao_Execucao: string | null; Previsao_Faturamento: string | null; Serv_Solicitado: string; Endereco_Cliente: string; Cidade_Cliente: string; Tipo_Servico: string; Qtd_HR?: string | number | null }
interface Tecnico { user_id: string; tecnico_nome: string; tecnico_email: string; mecanico_role: 'tecnico' | 'observador' }
interface Caminho { id: number; tecnico_nome: string; destino: string; cidade: string; motivo: string; data_saida: string; status: string }
interface AgendaRow { id: number; data: string; tecnico_nome: string; id_ordem: string | null; id_caminho: number | null; cliente: string; servico: string; endereco: string; cidade: string; endereco_opcoes: { label: string; fonte: string; endereco: string }[]; coordenadas: { lat: number; lng: number } | null; tempo_ida_min: number; distancia_ida_km: number; tempo_volta_min: number; distancia_volta_km: number; qtd_horas: number; ordem_sequencia: number; status: string; observacoes: string }
interface Veiculo { id: number; placa: string; descricao: string }
interface VinculoVeiculo { id: number; tecnico_nome: string; adesao_id: number; placa: string; descricao: string }
interface EventoGPS { tipo: string; horario: string; lat: number; lng: number; na_loja: boolean }
interface ViagemGPS { adesao_id: number; placa: string; descricao: string; data: string; saida_loja: string | null; chegada_cliente: string | null; saida_cliente: string | null; retorno_loja: string | null; eventos: EventoGPS[]; posicoes_total: number; ultima_posicao: { dt: string; lat: number; lng: number; ignicao: number; velocidade: number } | null }
interface VisitaGPS { saida: string | null; chegada: string | null; saidaCliente: string | null; retorno: string | null; almoco?: boolean }
interface EstimadoCliente { saida: number; chegada: number; fimServico: number; retorno: number | null }

// ── Helpers ──
function normNome(n: string): string[] { return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2) }
function match(a: string, b: string) { if (!a || !b) return false; const pA = normNome(a), pB = normNome(b); if (!pA.length || !pB.length || pA[0] !== pB[0]) return false; if (pA.length === 1 || pB.length === 1) return true; const s = new Set(pA.slice(1)); return pB.slice(1).some(p => s.has(p)) }
function extrairSolicitacao(s: string): string { if (!s) return ''; const i = s.indexOf('Solicitação do cliente:'); if (i === -1) return ''; const a = s.substring(i + 'Solicitação do cliente:'.length); const f = a.indexOf('Serviço Realizado'); return (f > -1 ? a.substring(0, f) : a).replace(/\n/g, ' ').trim() }
function fm(m: number) { if (m < 60) return `${Math.round(m)}min`; const h = Math.floor(m / 60); const r = Math.round(m % 60); return r > 0 ? `${h}h${r}` : `${h}h` }
function fh(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}` }
function fHora(iso: string | null): string { if (!iso) return '--:--'; const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function isoToMin(iso: string): number { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
function agora(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

// Endereço da oficina (Nova Tratores)
const ENDERECO_OFICINA = 'AV SÃO SEBASTIÃO, PIRAJU (SP)'

// Detecta se endereço é da oficina (Nova Tratores)
function isEnderecoOficina(endereco: string, cliente: string): boolean {
  const low = (endereco + ' ' + cliente).toLowerCase()
  return low.includes('nova tratores') || low.includes('piraju') && low.includes('comercio de maquinas')
}

function isHorarioAlmoco(iso: string | null): boolean {
  if (!iso) return false
  const m = isoToMin(iso)
  return m >= 660 && m < 780 // 11:00 até 13:00
}

function agruparVisitasGPS(eventos: EventoGPS[]): VisitaGPS[] {
  const v: VisitaGPS[] = []; let c: VisitaGPS = { saida: null, chegada: null, saidaCliente: null, retorno: null }; let has = false
  for (const ev of eventos) {
    if (ev.tipo === 'parada' || ev.tipo === 'inicio_movimento') continue
    if (ev.tipo === 'saida_loja') { if (has) { v.push({ ...c }); c = { saida: null, chegada: null, saidaCliente: null, retorno: null } }; c.saida = ev.horario; has = true }
    else if (ev.tipo === 'chegada_cliente') { if (c.saidaCliente) { v.push({ ...c }); c = { saida: c.saidaCliente, chegada: ev.horario, saidaCliente: null, retorno: null } } else { c.chegada = ev.horario }; has = true }
    else if (ev.tipo === 'saida_cliente') { c.saidaCliente = ev.horario; has = true }
    else if (ev.tipo === 'retorno_loja') { c.retorno = ev.horario; v.push({ ...c }); c = { saida: null, chegada: null, saidaCliente: null, retorno: null }; has = false }
  }
  if (has) v.push(c)
  // Marca visitas no horário de almoço (11:00-13:00)
  return v.map(vis => {
    if (isHorarioAlmoco(vis.chegada) && (!vis.saidaCliente || isHorarioAlmoco(vis.saidaCliente))) {
      return { ...vis, almoco: true }
    }
    return vis
  })
}

const S = 510, AI = 660, AD = 90
function estimativasPorCliente(items: AgendaRow[]): EstimadoCliente[] {
  const r: EstimadoCliente[] = []; let cur = S; let al = false
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; const ida = it.tempo_ida_min || 0; const sv = (it.qtd_horas || 2) * 60
    const saida = cur; cur += ida; const chegada = cur
    if (!al && cur >= AI && cur < AI + 120) { cur += AD; al = true }
    cur += sv; const fim = cur
    if (!al && cur >= AI && cur < AI + 120) { cur += AD; al = true }
    let ret: number | null = null
    if (i === items.length - 1) { cur += (it.tempo_volta_min || 0); ret = cur }
    r.push({ saida, chegada, fimServico: fim, retorno: ret })
  }; return r
}

function visitasReais(visitas: VisitaGPS[]): VisitaGPS[] { return visitas.filter(v => !v.almoco) }

function osAtualIdx(visitasGPS: VisitaGPS[], estimados: EstimadoCliente[], totalOS: number): number {
  const reais = visitasReais(visitasGPS)
  const concluidos = reais.filter(v => v.saidaCliente).length
  const emCliente = reais.findIndex(v => v.chegada && !v.saidaCliente)
  if (emCliente >= 0) return emCliente
  if (concluidos < totalOS) return concluidos
  if (reais.length === 0 && estimados.length > 0) {
    const now = agora()
    for (let i = 0; i < estimados.length; i++) { if (now < estimados[i].fimServico) return i }
    return estimados.length - 1
  }
  return Math.min(concluidos, totalOS - 1)
}

// Reverse geocode
const geoCache: Record<string, string> = {}
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  if (geoCache[key]) return geoCache[key]
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`, { headers: { 'Accept-Language': 'pt-BR' } })
    if (!r.ok) return ''
    const data = await r.json()
    const addr = data.address || {}
    const parts = [addr.road, addr.suburb || addr.neighbourhood, addr.city || addr.town || addr.village].filter(Boolean)
    const result = parts.join(', ') || data.display_name?.split(',').slice(0, 3).join(',') || ''
    geoCache[key] = result
    return result
  } catch { return '' }
}

const EVENTO_LABEL: Record<string, string> = {
  saida_loja: 'Saiu da oficina', chegada_cliente: 'Chegou no cliente',
  saida_cliente: 'Saiu do cliente', retorno_loja: 'Retornou à oficina',
}

const CSS = `
@keyframes vg-blink { 0%,100% { opacity:1; } 50% { opacity:.3; } }
@keyframes vg-fade-in { from { opacity:0 } to { opacity:1 } }
@keyframes vg-slide-up { from { opacity:0; transform:translateY(20px) scale(.98) } to { opacity:1; transform:translateY(0) scale(1) } }
@keyframes vg-card-drop {
  0% { opacity:0; transform: translateY(-30px) rotate(-2deg) scale(.9); }
  60% { opacity:1; transform: translateY(6px) rotate(.5deg) scale(1.02); }
  80% { transform: translateY(-2px) rotate(-.3deg) scale(.99); }
  100% { opacity:1; transform: translateY(0) rotate(0) scale(1); }
}
@keyframes vg-shine { 0% { left:-80% } 100% { left:120% } }
@keyframes vg-pulse-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(0,0,0,.1) } 50% { box-shadow: 0 0 0 8px rgba(0,0,0,0) } }
@keyframes vg-mov-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,.4) } 50% { box-shadow: 0 0 0 6px rgba(34,197,94,0) } }
@keyframes vg-mov-blink { 0%,100% { opacity:1 } 50% { opacity:.4 } }
.vg-car-moving { animation: vg-mov-pulse 1.5s ease infinite; }
.vg-car-blink { animation: vg-mov-blink 1.2s ease-in-out infinite; }
.vg-figurinha {
  cursor:pointer; animation: vg-card-drop .5s cubic-bezier(.22,.68,.36,1.2) both;
  transition: transform .2s cubic-bezier(.22,.68,.36,1.2), box-shadow .2s;
}
.vg-figurinha:hover { transform: translateY(-6px) scale(1.03) rotate(-.5deg); box-shadow: 0 16px 40px rgba(0,0,0,.15) !important; z-index:5; }
.vg-pulse-glow { animation: vg-pulse-glow 2s ease infinite; }
.vg-fora { animation: vg-blink 1.5s ease-in-out infinite; }
.vg-edit-input:focus { border-color: #111 !important; }
.vg-modal-overlay { animation: vg-fade-in .15s ease-out; }
.vg-modal-body { animation: vg-slide-up .25s cubic-bezier(.4,0,.2,1); }
.vg-os-section { transition: background .15s; }
.vg-os-section:hover { background: #F8F8F8 !important; }
.vg-timeline-dot { transition: transform .15s; }
.vg-timeline-dot:hover { transform: scale(1.5); }
.vg-btn { transition: all .1s; }
.vg-btn:hover { opacity:.85; transform: scale(1.02); }
`

// ── Component ──
export default function BlocoVisaoGeral({ tecnicos, ordens, caminhos }: { tecnicos: Tecnico[]; ordens: OrdemServico[]; caminhos: Caminho[] }) {
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  const [vinculos, setVinculos] = useState<VinculoVeiculo[]>([])
  const [viagensPorTec, setViagensPorTec] = useState<Record<string, ViagemGPS>>({})
  const [gpsLoading, setGpsLoading] = useState(false)
  const [editingAddr, setEditingAddr] = useState<{ id: number; value: string } | null>(null)
  const [savingAddr, setSavingAddr] = useState(false)
  const [modalTec, setModalTec] = useState<string | null>(null)
  const [carAddr, setCarAddr] = useState<Record<string, string>>({})
  const [eventAddrs, setEventAddrs] = useState<Record<string, string>>({})
  const [addrMismatch, setAddrMismatch] = useState<Record<string, { osId: string; agendaId: number; gpsAddr: string; isOficina: boolean }>>({})
  const autoUpdatedRef = useRef<Set<string>>(new Set())

  const tecs = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])

  // ── API ──
  const calcRota = useCallback(async (row: AgendaRow) => {
    try { const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, calcular: true }) }); if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === row.id ? u : a)) } } catch { }
  }, [])
  const carregar = useCallback(async () => { const r = await fetch(`/api/pos/agenda-visao?data=${hoje}`); if (r.ok) { const rows = await r.json(); setAgenda(rows); return rows as AgendaRow[] }; return [] }, [hoje])

  const tecsRef = useRef(tecs); const ordensRef = useRef(ordens); tecsRef.current = tecs; ordensRef.current = ordens
  const sincronizar = useCallback(async () => {
    const t = tecsRef.current, o = ordensRef.current; if (!t.length) return; setSyncing(true)
    try {
      const payload = t.map(tec => ({ nome: tec.tecnico_nome, ordens: o.filter(ord => ord.Status === 'Execução' && match(tec.tecnico_nome, ord.Os_Tecnico)).map(ord => ({ id: ord.Id_Ordem, cliente: ord.Os_Cliente, cnpj: ord.Cnpj_Cliente, endereco: ord.Endereco_Cliente, cidade: ord.Cidade_Cliente, servico: ord.Serv_Solicitado, qtdHoras: parseFloat(String(ord.Qtd_HR || 0)) || 2, observacoes: extrairSolicitacao(ord.Serv_Solicitado || '') })) }))
      if (payload.length > 0) { const r = await fetch('/api/pos/agenda-visao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: hoje, tecnicos: payload }) }); if (r.ok) { const rows = await r.json() as AgendaRow[]; setAgenda(rows); rows.filter(r => r.tempo_ida_min === 0 && r.endereco).forEach(r => calcRota(r)) } } else { await carregar() }
    } finally { setSyncing(false) }
  }, [hoje, carregar, calcRota])

  const carregarVeiculos = useCallback(async () => { try { const r = await fetch('/api/pos/rastreamento?acao=veiculos'); if (r.ok) setVeiculos(await r.json()) } catch { } }, [])
  const carregarVinculos = useCallback(async () => { const { data } = await supabase.from('tecnico_veiculos').select('*'); if (data) setVinculos(data as VinculoVeiculo[]) }, [])
  const carregarGPS = useCallback(async (vincs: VinculoVeiculo[]) => {
    if (vincs.length === 0) return; setGpsLoading(true)
    const map: Record<string, ViagemGPS> = {}
    for (const v of vincs) { try { const r = await fetch(`/api/pos/rastreamento?acao=viagens&adesao_id=${v.adesao_id}`); if (r.ok) { const viagens: ViagemGPS[] = await r.json(); const h = viagens.find(vi => vi.data === hoje); if (h) map[v.tecnico_nome] = h } } catch { } }
    setViagensPorTec(map); setGpsLoading(false)
    // Reverse geocode car positions + event locations
    for (const [nome, viagem] of Object.entries(map)) {
      if (viagem.ultima_posicao) {
        reverseGeocode(viagem.ultima_posicao.lat, viagem.ultima_posicao.lng).then(addr => {
          if (addr) setCarAddr(p => ({ ...p, [nome]: addr }))
        })
      }
      // Reverse geocode each chegada_cliente event
      viagem.eventos.filter(ev => ev.tipo === 'chegada_cliente').forEach((ev, idx) => {
        reverseGeocode(ev.lat, ev.lng).then(addr => {
          if (addr) setEventAddrs(p => ({ ...p, [`${nome}_${idx}`]: addr }))
        })
      })
    }
  }, [hoje])

  const vincularVeiculo = useCallback(async (tecNome: string, adesaoId: number) => {
    const vei = veiculos.find(v => v.id === adesaoId); if (!vei) return
    const { data: ex } = await supabase.from('tecnico_veiculos').select('id').eq('tecnico_nome', tecNome).single()
    if (ex) await supabase.from('tecnico_veiculos').update({ adesao_id: adesaoId, placa: vei.placa, descricao: vei.descricao }).eq('id', ex.id)
    else await supabase.from('tecnico_veiculos').insert({ tecnico_nome: tecNome, adesao_id: adesaoId, placa: vei.placa, descricao: vei.descricao })
    await carregarVinculos()
    try { const r = await fetch(`/api/pos/rastreamento?acao=viagens&adesao_id=${adesaoId}`); if (r.ok) { const vs: ViagemGPS[] = await r.json(); const h = vs.find(v => v.data === hoje); if (h) { setViagensPorTec(p => ({ ...p, [tecNome]: h })); if (h.ultima_posicao) reverseGeocode(h.ultima_posicao.lat, h.ultima_posicao.lng).then(a => { if (a) setCarAddr(p => ({ ...p, [tecNome]: a })) }) } else setViagensPorTec(p => { const n = { ...p }; delete n[tecNome]; return n }) } } catch { }
  }, [veiculos, hoje, carregarVinculos])
  const desvincularVeiculo = useCallback(async (tecNome: string) => { await supabase.from('tecnico_veiculos').delete().eq('tecnico_nome', tecNome); await carregarVinculos(); setViagensPorTec(p => { const n = { ...p }; delete n[tecNome]; return n }) }, [carregarVinculos])

  const salvarEndereco = useCallback(async () => {
    if (!editingAddr) return; setSavingAddr(true)
    try { const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingAddr.id, endereco: editingAddr.value }) }); if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === editingAddr.id ? u : a)) } } catch { }
    setSavingAddr(false); setEditingAddr(null)
  }, [editingAddr])

  const autoUpdateAddr = useCallback(async (agendaId: number, newAddr: string) => {
    const key = `${agendaId}`
    if (autoUpdatedRef.current.has(key)) return
    autoUpdatedRef.current.add(key)
    try { const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agendaId, endereco: newAddr }) }); if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === agendaId ? u : a)) } } catch { }
  }, [])

  const aplicarEnderecoGPS = useCallback(async (agendaId: number, gpsAddr: string, tecNome: string) => {
    try { const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agendaId, endereco: gpsAddr }) }); if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === agendaId ? u : a)) } } catch { }
    setAddrMismatch(p => { const n = { ...p }; delete n[tecNome]; return n })
  }, [])

  useEffect(() => {
    if (!tecs.length || !ordens.length) return
    sincronizar(); carregarVeiculos()
    carregarVinculos().then(async () => { const { data } = await supabase.from('tecnico_veiculos').select('*'); if (data && data.length > 0) carregarGPS(data as VinculoVeiculo[]) })
  }, [tecs.length, ordens.length, sincronizar, carregarVeiculos, carregarVinculos, carregarGPS])

  // ── Computed ──
  const porTec = useMemo(() => { const m: Record<string, AgendaRow[]> = {}; tecs.forEach(t => { m[t.tecnico_nome] = agenda.filter(a => a.tecnico_nome === t.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia) }); return m }, [tecs, agenda])
  const camPorTec = useMemo(() => { const m: Record<string, Caminho | null> = {}; tecs.forEach(t => { m[t.tecnico_nome] = caminhos.find(c => c.tecnico_nome === t.tecnico_nome && c.status === 'em_transito') || null }); return m }, [tecs, caminhos])
  const oficina = (items: AgendaRow[]) => items.length === 0 || items.every(a => (a.cliente || '').toLowerCase().includes('nova tratores'))
  const ordensPorTec = useMemo(() => { const m: Record<string, OrdemServico[]> = {}; tecs.forEach(t => { m[t.tecnico_nome] = ordens.filter(o => o.Status === 'Execução' && (match(t.tecnico_nome, o.Os_Tecnico) || match(t.tecnico_nome, o.Os_Tecnico2))) }); return m }, [tecs, ordens])
  const vinculoPorTec = useMemo(() => { const m: Record<string, VinculoVeiculo | null> = {}; tecs.forEach(t => { m[t.tecnico_nome] = vinculos.find(v => v.tecnico_nome === t.tecnico_nome) || null }); return m }, [tecs, vinculos])
  const veiculosVinculados = useMemo(() => new Set(vinculos.map(v => v.adesao_id)), [vinculos])

  const tecsSorted = useMemo(() => {
    return [...tecs].sort((a, b) => {
      const oa = (ordensPorTec[a.tecnico_nome] || []).length
      const ob = (ordensPorTec[b.tecnico_nome] || []).length
      if (ob !== oa) return ob - oa
      const va = viagensPorTec[a.tecnico_nome] ? 1 : 0
      const vb = viagensPorTec[b.tecnico_nome] ? 1 : 0
      return vb - va
    })
  }, [tecs, ordensPorTec, viagensPorTec])

  const cardData = useMemo(() => {
    return tecsSorted.map(tec => {
      const items = porTec[tec.tecnico_nome] || []
      const cam = camPorTec[tec.tecnico_nome]
      const naOfi = !cam && oficina(items)
      const ext = items.filter(a => !(a.cliente || '').toLowerCase().includes('nova tratores'))
      const ordsTec = ordensPorTec[tec.tecnico_nome] || []
      const vinculo = vinculoPorTec[tec.tecnico_nome]
      const viagem = viagensPorTec[tec.tecnico_nome] || null
      const visitasGPS = viagem ? agruparVisitasGPS(viagem.eventos) : []
      const estimados = ext.length > 0 && ext.every(a => a.tempo_ida_min > 0) ? estimativasPorCliente(ext) : []
      const lastEst = estimados.length > 0 ? estimados[estimados.length - 1] : null
      const foraLoja = !!(viagem && !viagem.retorno_loja && viagem.saida_loja)
      const completedVisits = visitasReais(visitasGPS).filter(v => v.saidaCliente).length
      const pos = viagem?.ultima_posicao || null
      const reais = visitasReais(visitasGPS)
      const curIdx = ordsTec.length > 0 ? osAtualIdx(visitasGPS, estimados, ordsTec.length) : -1
      const curOS = curIdx >= 0 ? ordsTec[curIdx] : null
      const curAgItem = curOS ? items.find(a => a.id_ordem === curOS.Id_Ordem) : null
      const curEst = curIdx >= 0 ? estimados[curIdx] : null
      const curGPS = curIdx >= 0 ? reais[curIdx] : null

      let status: 'oficina' | 'caminho' | 'cliente' | 'retornando' | 'retornou' = 'oficina'
      if (viagem?.retorno_loja) status = 'retornou'
      else if (curGPS?.chegada && !curGPS?.saidaCliente) status = 'cliente'
      else if (foraLoja) status = 'caminho'
      else if (curGPS?.saidaCliente && curIdx === ordsTec.length - 1) status = 'retornando'

      let cardEndereco = ''
      if (status === 'cliente' || status === 'caminho') {
        cardEndereco = curAgItem?.endereco || curOS?.Endereco_Cliente || ''
      }
      if (!cardEndereco && carAddr[tec.tecnico_nome] && foraLoja) {
        cardEndereco = carAddr[tec.tecnico_nome]
      }

      let previsaoLabel = ''
      let previsaoHora = ''
      if (status === 'caminho' && curEst) { previsaoLabel = 'Chega'; previsaoHora = fh(curEst.chegada) }
      else if (status === 'cliente' && curEst) { previsaoLabel = 'Sai'; previsaoHora = fh(curEst.fimServico) }
      else if (lastEst?.retorno && !viagem?.retorno_loja) { previsaoLabel = 'Retorno'; previsaoHora = fh(lastEst.retorno) }
      else if (viagem?.retorno_loja) { previsaoLabel = 'Voltou'; previsaoHora = fHora(viagem.retorno_loja) }

      return { tec, items, ext, ordsTec, vinculo, viagem, visitasGPS, estimados, lastEst, foraLoja, naOfi, completedVisits, pos, curIdx, curOS, curAgItem, curEst, curGPS, status, cardEndereco, previsaoLabel, previsaoHora }
    })
  }, [tecsSorted, porTec, camPorTec, ordensPorTec, vinculoPorTec, viagensPorTec, carAddr])

  // ── Auto-update endereço / mismatch detection ──
  useEffect(() => {
    cardData.forEach(d => {
      if (!d.curAgItem || !d.foraLoja) return
      const gpsAddr = carAddr[d.tec.tecnico_nome]
      if (!gpsAddr) return
      const agendaEndereco = d.curAgItem.endereco || ''
      const osCliente = d.curOS?.Os_Cliente || ''
      const gpsCidade = (gpsAddr.split(',')[0] || '').toLowerCase().trim()

      // Se o usuário marcou como oficina → verifica se o técnico realmente está perto da oficina
      if (agendaEndereco === ENDERECO_OFICINA) {
        const gpsLow = gpsAddr.toLowerCase()
        const estaPertoOficina = gpsLow.includes('piraju') || gpsLow.includes('são sebastião') || gpsLow.includes('sao sebastiao')
        if (!estaPertoOficina && gpsCidade) {
          setAddrMismatch(p => {
            if (p[d.tec.tecnico_nome]?.gpsAddr === gpsAddr) return p
            return { ...p, [d.tec.tecnico_nome]: { osId: d.curOS!.Id_Ordem, agendaId: d.curAgItem!.id, gpsAddr, isOficina: true } }
          })
        }
        return
      }

      // Se o endereço original da OS é da oficina (nome do cliente etc) → atualiza com GPS real
      if (isEnderecoOficina(agendaEndereco, osCliente)) {
        if (d.curGPS?.chegada && !d.curGPS.saidaCliente) {
          autoUpdateAddr(d.curAgItem.id, gpsAddr)
        }
        return
      }

      // Compara endereço esperado vs localização GPS → mismatch
      if (gpsAddr && agendaEndereco) {
        const esperado = agendaEndereco.toLowerCase()
        if (gpsCidade && !esperado.includes(gpsCidade)) {
          setAddrMismatch(p => {
            if (p[d.tec.tecnico_nome]?.gpsAddr === gpsAddr) return p
            return { ...p, [d.tec.tecnico_nome]: { osId: d.curOS!.Id_Ordem, agendaId: d.curAgItem!.id, gpsAddr, isOficina: false } }
          })
        }
      }
    })
  }, [cardData, carAddr, autoUpdateAddr])

  const stats = useMemo(() => {
    let fora = 0, ofi = 0, totalOS = 0, done = 0
    cardData.forEach(d => { totalOS += d.ordsTec.length; done += d.completedVisits; if (d.foraLoja) fora++; else ofi++ })
    return { fora, ofi, totalOS, done }
  }, [cardData])

  return (
    <>
      <style>{CSS}</style>
      <div style={{ background: '#F4F3EF', minHeight: '100vh', margin: '-20px', padding: '20px', borderRadius: 12 }}>
        {/* ══ TOP BAR ══ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, padding: '8px 0', borderBottom: '1px solid #E5E3DD' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#111' }}>{stats.fora}</span>
            <span style={{ fontSize: 13, color: '#999' }}>em campo</span>
          </div>
          <div style={{ width: 1, height: 18, background: '#E5E5E5' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#111' }}>{stats.done}</span>
            <span style={{ fontSize: 13, color: '#999' }}>/{stats.totalOS} visitas</span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="vg-btn" onClick={sincronizar} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync
          </button>
        </div>

        {/* ══ FIGURINHAS — 2 fileiras ══ */}
        {[0, 1].map(row => {
          const metade = Math.ceil(cardData.length / 2)
          const items = row === 0 ? cardData.slice(0, metade) : cardData.slice(metade)
          return (
            <div key={row} style={{ display: 'flex', gap: 20, marginBottom: row === 0 ? 20 : 0, overflowX: 'auto', paddingBottom: 4 }}>
              {items.map((d, di) => {
            const { tec, ordsTec, foraLoja, status, previsaoHora, previsaoLabel, completedVisits, curOS, curAgItem, pos } = d
            const mismatch = addrMismatch[tec.tecnico_nome]
            const hasOS = ordsTec.length > 0 || !!d.viagem
            const nome = tec.tecnico_nome.split(' ')
            const primeiroNome = nome[0]
            const sobrenome = nome.length > 1 ? nome.slice(1).join(' ') : ''
            const iniciais = nome.length > 1 ? (nome[0][0] + nome[nome.length - 1][0]).toUpperCase() : nome[0].substring(0, 2).toUpperCase()
            const statusColor = status === 'cliente' ? '#111' : status === 'caminho' ? '#555' : status === 'retornou' ? '#999' : status === 'retornando' ? '#777' : '#DDD'
            const statusLabel = status === 'oficina' ? 'Oficina' : status === 'caminho' ? 'A caminho' : status === 'cliente' ? 'No cliente' : status === 'retornando' ? 'Voltando' : status === 'retornou' ? 'Retornou' : ''
            const enderecoCarro = carAddr[tec.tecnico_nome] || ''
            const solicitacao = curOS ? extrairSolicitacao(curOS.Serv_Solicitado || '') : ''
            const tipoServico = curOS?.Tipo_Servico || ''

            return (
              <div key={tec.user_id} className={`vg-figurinha ${foraLoja ? 'vg-pulse-glow' : ''}`}
                onClick={() => setModalTec(tec.tecnico_nome)}
                style={{
                  borderRadius: 20, flex: '1 1 0', minWidth: 280,
                  background: '#fff', border: `2px solid ${foraLoja ? '#222' : '#E5E3DD'}`,
                  boxShadow: '0 4px 16px rgba(0,0,0,.06)',
                  animationDelay: `${(row * Math.ceil(cardData.length / 2) + di) * .08}s`,
                }}>

                {/* ── TOPO: NOME + LOCALIZAÇÃO ── */}
                <div style={{
                  background: hasOS
                    ? 'linear-gradient(135deg, #8B0000 0%, #B22222 100%)'
                    : '#E8E6E1',
                  padding: '14px 20px 12px',
                  position: 'relative', borderRadius: '18px 18px 0 0',
                }}>
                  {/* Linha 1: avatar + nome + status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                      background: hasOS ? 'rgba(255,255,255,.12)' : '#D5D3CE',
                      border: `2px solid ${hasOS ? 'rgba(255,255,255,.25)' : '#C0BDB7'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: hasOS ? '#fff' : '#999' }}>{iniciais}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: hasOS ? '#fff' : '#999', letterSpacing: '-.03em', lineHeight: 1.1, textTransform: 'uppercase' }}>
                        {primeiroNome} {sobrenome && <span style={{ fontSize: 14, fontWeight: 600, opacity: .5 }}>{sobrenome.split(' ')[0]}</span>}
                      </div>
                    </div>
                    {hasOS && (
                      <div style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                        color: status === 'oficina' ? 'rgba(255,255,255,.35)' : '#fff',
                        background: status === 'oficina' ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.18)',
                        padding: '3px 10px', borderRadius: 20, flexShrink: 0,
                      }}>
                        {statusLabel}
                      </div>
                    )}
                  </div>
                  {/* Mismatch - só o ponto no header, balão fica embaixo */}
                </div>

                {/* ── DESTINO + LOCALIZAÇÃO ── */}
                <div>
                  {(() => {
                    const isOficina = curAgItem?.endereco === ENDERECO_OFICINA
                    const cidade = isOficina ? 'PIRAJU (SP) — Oficina' : curOS?.Cidade_Cliente
                    const endereco = isOficina ? ENDERECO_OFICINA : curOS?.Endereco_Cliente
                    return cidade ? (
                      <div style={{ background: isOficina ? '#FEF2F2' : '#F7F6F3', padding: '8px 20px 10px', borderBottom: '1px solid #ECEAE5' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Destino</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MapPin size={15} color={isOficina ? '#B91C1C' : '#B22222'} />
                          <span style={{ fontSize: 16, fontWeight: 800, color: isOficina ? '#B91C1C' : '#333' }}>{cidade}</span>
                          {endereco && !isOficina && (
                            <span style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{endereco}</span>
                          )}
                        </div>
                      </div>
                    ) : null
                  })()}
                  {enderecoCarro ? (
                    <div className={pos?.ignicao && pos.velocidade > 0 ? 'vg-car-blink' : ''} style={{
                      padding: '8px 20px 10px', borderBottom: '1px solid #ECEAE5',
                      background: pos?.ignicao && pos.velocidade > 0 ? '#F0FDF4' : '#FAFAF8',
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Localização Atual</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className={pos?.ignicao && pos.velocidade > 0 ? 'vg-car-moving' : ''} style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: pos?.ignicao && pos.velocidade > 0 ? '#22C55E' : '#DDD',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Car size={14} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {enderecoCarro}
                          </div>
                          <div style={{ fontSize: 12, color: '#999', marginTop: 1 }}>
                            {pos?.ignicao ? (
                              <span>
                                <span style={{ color: pos.velocidade > 0 ? '#16A34A' : '#999', fontWeight: 700 }}>
                                  {pos.velocidade > 0 ? `${pos.velocidade} km/h` : 'Parado'}
                                </span>
                                <span style={{ marginLeft: 8 }}>às {fHora(pos.dt)}</span>
                              </span>
                            ) : (
                              <span style={{ color: '#BBB' }}>Ignição OFF</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* ── MISMATCH BALÃO ── */}
                {mismatch && (
                  <div style={{ padding: '10px 20px', background: '#FFF8EE', borderBottom: '1px solid #FDE68A' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                        <AlertTriangle size={15} color="#fff" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
                          {mismatch.isOficina
                            ? 'O serviço é na oficina, mas o técnico está em outro lugar. Está certo?'
                            : 'O técnico está em um endereço diferente da OS. Está correto?'}
                        </div>
                        <div style={{ fontSize: 12, color: '#B45309', marginBottom: 8, lineHeight: 1.3 }}>
                          GPS: <span style={{ fontWeight: 600 }}>{mismatch.gpsAddr}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button className="vg-btn" onClick={() => aplicarEnderecoGPS(mismatch.agendaId, mismatch.gpsAddr, tec.tecnico_nome)}
                            style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Atualizar endereço
                          </button>
                          <button className="vg-btn" onClick={() => setAddrMismatch(p => { const n = { ...p }; delete n[tec.tecnico_nome]; return n })}
                            style={{ background: '#fff', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            Está correto
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── CONTEÚDO ── */}
                <div>
                {hasOS ? (
                  <div style={{ padding: '18px 24px 20px' }}>
                    {/* OS */}
                    {curOS && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#BBB', letterSpacing: '.05em' }}>OS</span>
                          <span style={{ fontSize: 20, fontWeight: 900, color: '#111', letterSpacing: '-.02em' }}>{curOS.Id_Ordem}</span>
                          {tipoServico && (
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#777', background: '#F0EFEB', padding: '3px 10px', borderRadius: 6 }}>{tipoServico}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#333', lineHeight: 1.3 }}>
                          {curOS.Os_Cliente?.split(' ').slice(0, 6).join(' ')}
                        </div>
                      </div>
                    )}

                    {/* Solicitação */}
                    {solicitacao && (
                      <div style={{
                        fontSize: 15, fontWeight: 500, color: '#444', lineHeight: 1.5, marginBottom: 14,
                        padding: '12px 16px', background: '#FFFDF5', borderRadius: 10,
                        borderLeft: '4px solid #E8C94A',
                        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {solicitacao}
                      </div>
                    )}

                    {/* Previsão + progress */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #ECEAE5', paddingTop: 14 }}>
                      {previsaoHora ? (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                          <span style={{ fontSize: 14, color: '#999', fontWeight: 600 }}>{previsaoLabel}</span>
                          <span style={{ fontSize: 22, fontWeight: 900, color: '#111', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{previsaoHora}</span>
                        </div>
                      ) : <div />}
                      <div style={{ flex: 1 }} />
                      {ordsTec.length > 0 && (
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          {ordsTec.map((_, i) => (
                            <div key={i} style={{
                              width: 12, height: 12, borderRadius: '50%',
                              background: i < completedVisits ? '#111' : i === d.curIdx ? '#999' : '#E0DDD8',
                              transition: 'background .3s',
                            }} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center' }}>
                    <span style={{ fontSize: 15, color: '#BBB', fontWeight: 600 }}>Na oficina / sem OS</span>
                  </div>
                )}
                </div>
              </div>
            )
          })}
            </div>
          )
        })}
      </div>

      {/* ══ MODAL ══ */}
      {modalTec && (() => {
        const d = cardData.find(c => c.tec.tecnico_nome === modalTec)
        if (!d) return null
        const { items, ordsTec, vinculo, viagem, visitasGPS, estimados, lastEst, foraLoja, pos } = d
        const addr = carAddr[modalTec]
        let chegadaCount = 0

        return (
          <div className="vg-modal-overlay" onClick={() => { setModalTec(null); setEditingAddr(null) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
            <div className="vg-modal-body" onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 660, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>

              {/* ── HEADER ── */}
              <div style={{ padding: '28px 32px 20px', background: 'linear-gradient(180deg, #FAFAFA 0%, #fff 100%)', borderBottom: '1px solid #F0F0F0' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ fontSize: 26, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-.02em' }}>{modalTec}</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                      {vinculo && <span style={{ fontSize: 14, fontWeight: 700, color: '#555', background: '#F0F0F0', padding: '3px 10px', borderRadius: 6 }}>{vinculo.placa}</span>}
                      <span style={{ fontSize: 14, color: '#999' }}>{ordsTec.length} OS</span>
                      <span style={{ fontSize: 14, color: '#999' }}>{d.completedVisits} concluidas</span>
                      {d.previsaoLabel && (
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{d.previsaoLabel} {d.previsaoHora}</span>
                      )}
                    </div>
                    {/* Progress dots big */}
                    {ordsTec.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, marginTop: 12 }}>
                        {ordsTec.map((_, i) => (
                          <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: i < d.completedVisits ? '#111' : i === d.curIdx ? '#999' : '#E0E0E0', transition: 'background .2s' }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="vg-btn" onClick={() => { setModalTec(null); setEditingAddr(null) }}
                    style={{ background: '#F0F0F0', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', flexShrink: 0 }}>
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* ── POSIÇÃO ATUAL ── */}
              {pos && (
                <div style={{ padding: '18px 32px', borderBottom: '1px solid #F0F0F0', background: '#FAFAFA' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Posição do veículo</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Navigation size={18} color="#555" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{addr || 'Buscando endereço...'}</div>
                      <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
                        {pos.ignicao ? <span style={{ color: '#111', fontWeight: 700 }}>{pos.velocidade} km/h</span> : <span>Ignição OFF</span>}
                        <span style={{ marginLeft: 10 }}>às {fHora(pos.dt)}</span>
                      </div>
                    </div>
                    <a href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`} target="_blank" rel="noopener noreferrer"
                      className="vg-btn" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: '#555', textDecoration: 'none', padding: '8px 14px', border: '1px solid #E5E5E5', borderRadius: 8, background: '#fff', flexShrink: 0 }}>
                      <ExternalLink size={13} /> Ver no mapa
                    </a>
                  </div>
                </div>
              )}

              {/* ── VEÍCULO ── */}
              <div style={{ padding: '12px 32px', borderBottom: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Car size={14} color="#BBB" />
                <select value={vinculo?.adesao_id || ''}
                  onChange={e => { const v = Number(e.target.value); if (v) vincularVeiculo(modalTec, v); else desvincularVeiculo(modalTec) }}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 14, border: '1px solid #E5E5E5', background: '#fff', color: '#333', outline: 'none', cursor: 'pointer' }}>
                  <option value="">Vincular veiculo...</option>
                  {veiculos.map(v => <option key={v.id} value={v.id} disabled={veiculosVinculados.has(v.id) && vinculo?.adesao_id !== v.id}>{v.placa} - {v.descricao || 'Sem desc'}</option>)}
                </select>
                {gpsLoading && vinculo && <RefreshCw size={13} color="#BBB" className="animate-spin" />}
              </div>

              {/* ── JORNADA GPS ── */}
              {viagem && viagem.eventos.filter(ev => EVENTO_LABEL[ev.tipo]).length > 0 && (() => {
                let ci = 0
                return (
                  <div style={{ padding: '20px 32px', borderBottom: '1px solid #F0F0F0' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Jornada</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
                      {/* Vertical line */}
                      <div style={{ position: 'absolute', left: 55, top: 12, bottom: 12, width: 2, background: '#EBEBEB' }} />
                      {viagem.eventos.filter(ev => EVENTO_LABEL[ev.tipo]).map((ev, i) => {
                        const isChegada = ev.tipo === 'chegada_cliente'
                        const isAlmocoEv = isHorarioAlmoco(ev.horario) && (ev.tipo === 'chegada_cliente' || ev.tipo === 'saida_cliente')
                        const evAddr = isChegada ? eventAddrs[`${modalTec}_${ci}`] : null
                        if (isChegada) ci++
                        const label = isAlmocoEv
                          ? (ev.tipo === 'chegada_cliente' ? 'Parou para almoço' : 'Voltou do almoço')
                          : EVENTO_LABEL[ev.tipo]
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '6px 0', position: 'relative' }}>
                            <span style={{ fontSize: 16, fontWeight: 800, color: isAlmocoEv ? '#B45309' : '#111', fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>{fHora(ev.horario)}</span>
                            <div className="vg-timeline-dot" style={{
                              width: 10, height: 10, borderRadius: '50%', marginTop: 5, flexShrink: 0, position: 'relative', zIndex: 1,
                              background: isAlmocoEv ? '#F59E0B' : ev.tipo.includes('loja') ? '#111' : '#999',
                              border: '2px solid #fff',
                            }} />
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 600, color: isAlmocoEv ? '#B45309' : '#333' }}>{label}</div>
                              {evAddr && !isAlmocoEv && (
                                <div style={{ fontSize: 13, color: '#999', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <MapPin size={11} style={{ flexShrink: 0 }} />
                                  {evAddr}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* ── ORDENS ── */}
              {ordsTec.length > 0 && (
                <div style={{ padding: '20px 32px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '.05em' }}>Ordens de serviço</div>
                </div>
              )}

              {ordsTec.map((os, osIdx) => {
                const agItem = items.find(a => a.id_ordem === os.Id_Ordem)
                const est = estimados[osIdx] || null
                const reaisModal = visitasReais(visitasGPS)
                const gps = reaisModal[osIdx] || null
                const isEditing = editingAddr !== null && editingAddr.id === agItem?.id
                const temAtraso = est && gps?.saidaCliente && (isoToMin(gps.saidaCliente) - est.fimServico > 30)
                const chegouAtrasado = est && gps?.chegada && (isoToMin(gps.chegada) - est.chegada > 30)
                const isCurrent = osIdx === d.curIdx
                const isDone = !!(gps?.saidaCliente)

                return (
                  <div key={os.Id_Ordem} className="vg-os-section" style={{
                    padding: '16px 32px', borderTop: '1px solid #F0F0F0',
                    background: isCurrent ? '#FAFAFA' : '#fff',
                    borderLeft: isCurrent ? '3px solid #111' : '3px solid transparent',
                  }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: isDone ? '#111' : isCurrent ? '#999' : '#E0E0E0', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#BBB', fontVariantNumeric: 'tabular-nums' }}>{os.Id_Ordem}</span>
                      <span style={{ fontSize: 17, fontWeight: 700, color: '#111' }}>{os.Os_Cliente?.split(' ').slice(0, 5).join(' ')}</span>
                      {os.Cidade_Cliente && <span style={{ fontSize: 13, color: '#BBB' }}>{os.Cidade_Cliente}</span>}
                      {os.Qtd_HR && <span style={{ fontSize: 13, color: '#BBB' }}>{os.Qtd_HR}h</span>}
                      <div style={{ flex: 1 }} />
                      {isDone && <span style={{ fontSize: 13, fontWeight: 700, color: '#111', background: '#F0F0F0', padding: '2px 10px', borderRadius: 4 }}>Concluido</span>}
                      {isCurrent && !isDone && gps?.chegada && <span style={{ fontSize: 13, fontWeight: 700, color: '#111', background: '#F0F0F0', padding: '2px 10px', borderRadius: 4 }}>No cliente</span>}
                      {isCurrent && !isDone && !gps?.chegada && foraLoja && <span style={{ fontSize: 13, fontWeight: 600, color: '#555' }}>A caminho</span>}
                      {temAtraso && <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', padding: '2px 8px', borderRadius: 4 }}>Excedeu tempo</span>}
                      {chegouAtrasado && <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', padding: '2px 8px', borderRadius: 4 }}>Atrasado</span>}
                    </div>

                    {/* Endereço editável */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: 20 }}>
                      <MapPin size={13} color="#DDD" />
                      {isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                          <input className="vg-edit-input" value={editingAddr!.value}
                            onChange={e => setEditingAddr({ id: editingAddr!.id, value: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') salvarEndereco(); if (e.key === 'Escape') setEditingAddr(null) }}
                            autoFocus style={{ flex: 1, padding: '8px 12px', borderRadius: 6, fontSize: 14, border: '1px solid #DDD', outline: 'none', color: '#111' }} />
                          <button className="vg-btn" onClick={salvarEndereco} disabled={savingAddr}
                            style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                            {savingAddr ? <RefreshCw size={12} className="animate-spin" /> : 'Salvar'}
                          </button>
                          <button className="vg-btn" onClick={() => setEditingAddr(null)}
                            style={{ background: '#F0F0F0', color: '#999', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}><X size={13} /></button>
                        </div>
                      ) : (
                        <>
                          <span style={{ fontSize: 14, color: '#999', flex: 1 }}>{agItem?.endereco || os.Endereco_Cliente || 'Sem endereco'}</span>
                          {agItem && (
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              <button className="vg-btn" onClick={async () => {
                                try {
                                  const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agItem.id, endereco: ENDERECO_OFICINA }) })
                                  if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === agItem.id ? u : a)) }
                                } catch { }
                              }}
                                style={{ background: '#111', border: 'none', cursor: 'pointer', color: '#fff', padding: '4px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 }}>
                                Oficina
                              </button>
                              <button className="vg-btn" onClick={() => setEditingAddr({ id: agItem.id, value: agItem.endereco || os.Endereco_Cliente || '' })}
                                style={{ background: '#F0F0F0', border: 'none', cursor: 'pointer', color: '#666', padding: '4px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                                <Edit3 size={11} /> Editar
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Endereço do veículo quando nesse cliente */}
                    {isCurrent && !isDone && gps?.chegada && pos && addr && (
                      <div style={{ marginLeft: 20, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#BBB', background: '#F8F8F8', padding: '6px 10px', borderRadius: 6 }}>
                        <Navigation size={12} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>Veículo: <span style={{ color: '#555', fontWeight: 600 }}>{addr}</span></span>
                        <a href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#999', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                          <ExternalLink size={10} /> mapa
                        </a>
                      </div>
                    )}

                    {/* Times */}
                    <div style={{ marginLeft: 20, background: '#F8F8F8', borderRadius: 8, padding: '10px 14px' }}>
                      {est && (
                        <div style={{ display: 'flex', alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums', marginBottom: 3, color: '#BBB' }}>
                          <span style={{ width: 38, fontSize: 12, fontWeight: 600 }}>Est.</span>
                          <span style={{ width: 50, fontWeight: 600, color: '#999' }}>{fh(est.saida)}</span>
                          <span style={{ width: 20, textAlign: 'center', color: '#DDD' }}>&rarr;</span>
                          <span style={{ width: 50, fontWeight: 600, color: '#999' }}>{fh(est.chegada)}</span>
                          <span style={{ width: 20, textAlign: 'center', color: '#DDD' }}>&rarr;</span>
                          <span style={{ width: 50, fontWeight: 600, color: '#999' }}>{fh(est.fimServico)}</span>
                          {est.retorno && <><span style={{ width: 20, textAlign: 'center', color: '#DDD' }}>&rarr;</span><span style={{ fontWeight: 600, color: '#999' }}>{fh(est.retorno)}</span></>}
                        </div>
                      )}
                      {gps && (gps.saida || gps.chegada) && (
                        <div style={{ display: 'flex', alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums', marginBottom: 3 }}>
                          <span style={{ width: 38, fontSize: 12, fontWeight: 700, color: '#555' }}>GPS</span>
                          <span style={{ width: 50, fontWeight: 800, color: '#111' }}>{fHora(gps.saida)}</span>
                          <span style={{ width: 20, textAlign: 'center', color: '#DDD' }}>&rarr;</span>
                          <span style={{ width: 50, fontWeight: 800, color: chegouAtrasado ? '#DC2626' : '#111' }}>{fHora(gps.chegada)}</span>
                          <span style={{ width: 20, textAlign: 'center', color: '#DDD' }}>&rarr;</span>
                          <span style={{ width: 50, fontWeight: 800, color: temAtraso ? '#DC2626' : '#111' }}>{fHora(gps.saidaCliente)}</span>
                          {gps.retorno && <><span style={{ width: 20, textAlign: 'center', color: '#DDD' }}>&rarr;</span><span style={{ fontWeight: 800, color: '#111' }}>{fHora(gps.retorno)}</span></>}
                        </div>
                      )}
                      {agItem && agItem.tempo_ida_min > 0 && !gps && (
                        <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{fm(agItem.tempo_ida_min)} / {agItem.distancia_ida_km}km</div>
                      )}
                      {est && gps && (gps.saida || gps.chegada) && (
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 13 }}>
                          {[
                            { label: 'Saida', e: est.saida, r: gps.saida },
                            { label: 'Chegada', e: est.chegada, r: gps.chegada },
                            { label: 'Saiu', e: est.fimServico, r: gps.saidaCliente },
                            ...(est.retorno && gps.retorno ? [{ label: 'Ret', e: est.retorno, r: gps.retorno }] : []),
                          ].map((dd, di) => {
                            if (!dd.r) return null
                            const diff = isoToMin(dd.r) - dd.e
                            if (Math.abs(diff) <= 5) return null
                            return <span key={di} style={{ fontWeight: 600, color: diff > 0 ? '#DC2626' : '#059669' }}>{dd.label} {diff > 0 ? '+' : '-'}{fm(Math.abs(diff))}</span>
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {viagem?.retorno_loja && lastEst?.retorno && (
                <div style={{ padding: '14px 32px', borderTop: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}>
                  <Home size={16} color="#555" />
                  <span style={{ fontWeight: 700, color: '#111' }}>Retornou {fHora(viagem.retorno_loja)}</span>
                  {(() => { const diff = isoToMin(viagem.retorno_loja!) - lastEst.retorno!; return diff > 5 ? <span style={{ color: '#DC2626', fontWeight: 600 }}>+{fm(diff)}</span> : diff < -5 ? <span style={{ color: '#059669', fontWeight: 600 }}>{fm(Math.abs(diff))} antes</span> : <span style={{ color: '#999' }}>pontual</span> })()}
                  <span style={{ color: '#CCC' }}>est. {fh(lastEst.retorno)}</span>
                </div>
              )}

              {vinculo && !viagem && !gpsLoading && (
                <div style={{ padding: '14px 32px', borderTop: '1px solid #F0F0F0', fontSize: 14, color: '#BBB' }}>{vinculo.placa} — Sem dados GPS hoje</div>
              )}

              <div style={{ height: 12 }} />
            </div>
          </div>
        )
      })()}
    </>
  )
}
