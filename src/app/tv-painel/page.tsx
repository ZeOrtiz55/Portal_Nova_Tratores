'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  MapPin, Car, Navigation, Clock, Users, RefreshCw, AlertTriangle, ExternalLink, Zap
} from 'lucide-react'

// ── Types ──
interface OrdemServico { Id_Ordem: string; Status: string; Os_Cliente: string; Cnpj_Cliente: string; Os_Tecnico: string; Os_Tecnico2: string; Previsao_Execucao: string | null; Previsao_Faturamento: string | null; Serv_Solicitado: string; Endereco_Cliente: string; Cidade_Cliente: string; Tipo_Servico: string; Qtd_HR?: string | number | null; Servico_Oficina?: boolean; Hora_Inicio_Exec?: string; Hora_Fim_Exec?: string }
interface Tecnico { user_id: string; tecnico_nome: string; mecanico_role: 'tecnico' | 'observador' }
interface AgendaRow { id: number; data: string; tecnico_nome: string; id_ordem: string | null; cliente: string; servico: string; endereco: string; cidade: string; coordenadas: { lat: number; lng: number } | null; tempo_ida_min: number; distancia_ida_km: number; tempo_volta_min: number; distancia_volta_km: number; qtd_horas: number; ordem_sequencia: number; status: string; observacoes: string }
interface Caminho { id: number; tecnico_nome: string; destino: string; cidade: string; status: string }
interface VinculoVeiculo { id: number; tecnico_nome: string; adesao_id: number; placa: string; descricao: string }
interface EventoGPS { tipo: string; horario: string; lat: number; lng: number; na_loja: boolean; destino_nome?: string; destino_cnpj?: string }
interface ViagemGPS { adesao_id: number; placa: string; descricao: string; data: string; saida_loja: string | null; chegada_cliente: string | null; saida_cliente: string | null; retorno_loja: string | null; eventos: EventoGPS[]; posicoes_total: number; ultima_posicao: { dt: string; lat: number; lng: number; ignicao: number; velocidade: number } | null }
interface VisitaGPS { saida: string | null; chegada: string | null; saidaCliente: string | null; retorno: string | null; almoco?: boolean; passagemRapida?: boolean; destino_nome?: string; destino_cnpj?: string }
interface EstimadoCliente { saida: number; chegada: number; fimServico: number; retorno: number | null }

// ── Helpers ──
function normNome(n: string): string[] { return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2) }
function match(a: string, b: string) { if (!a || !b) return false; const pA = normNome(a), pB = normNome(b); if (!pA.length || !pB.length || pA[0] !== pB[0]) return false; if (pA.length === 1 || pB.length === 1) return true; const s = new Set(pA.slice(1)); return pB.slice(1).some(p => s.has(p)) }
function extrairSolicitacao(s: string): string { if (!s) return ''; const i = s.indexOf('Solicitação do cliente:'); if (i === -1) return ''; const a = s.substring(i + 'Solicitação do cliente:'.length); const f = a.indexOf('Serviço Realizado'); return (f > -1 ? a.substring(0, f) : a).replace(/\n/g, ' ').trim() }
function fh(m: number) { const clamped = Math.min(m, 1439); return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(Math.round(clamped % 60)).padStart(2, '0')}` }
function fHora(iso: string | null): string { if (!iso) return '--:--'; const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function isoToMin(iso: string): number { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
function agora(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1); const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isEnderecoOficina(endereco: string, cliente: string, servicoOficina?: boolean): boolean {
  if (servicoOficina) return true
  const low = (endereco + ' ' + cliente).toLowerCase()
  return low.includes('nova tratores') || low.includes('piraju') && low.includes('comercio de maquinas')
}

function agruparVisitasGPS(eventos: EventoGPS[]): VisitaGPS[] {
  const v: VisitaGPS[] = []; let c: VisitaGPS = { saida: null, chegada: null, saidaCliente: null, retorno: null }; let has = false
  for (const ev of eventos) {
    if (ev.tipo === 'parada' || ev.tipo === 'inicio_movimento') continue
    if (ev.tipo === 'saida_loja') { if (has) { v.push({ ...c }); c = { saida: null, chegada: null, saidaCliente: null, retorno: null } }; c.saida = ev.horario; has = true }
    else if (ev.tipo === 'chegada_cliente') {
      if (c.saidaCliente) { v.push({ ...c }); c = { saida: c.saidaCliente, chegada: ev.horario, saidaCliente: null, retorno: null, destino_nome: ev.destino_nome, destino_cnpj: ev.destino_cnpj } }
      else { c.chegada = ev.horario; c.destino_nome = ev.destino_nome; c.destino_cnpj = ev.destino_cnpj }
      has = true
    }
    else if (ev.tipo === 'saida_cliente') { c.saidaCliente = ev.horario; has = true }
    else if (ev.tipo === 'retorno_loja') { c.retorno = ev.horario; v.push({ ...c }); c = { saida: null, chegada: null, saidaCliente: null, retorno: null }; has = false }
  }
  if (has) v.push(c)
  return v.map(vis => {
    const isAlmoco = vis.chegada && (() => { const m = isoToMin(vis.chegada!); return m >= 660 && m < 780 })()
    if (isAlmoco && (!vis.saidaCliente || (() => { const m = isoToMin(vis.saidaCliente!); return m >= 660 && m < 780 })())) return { ...vis, almoco: true }
    // Passagem rápida: chegou e saiu do cliente em menos de 10 minutos — não é serviço real
    if (vis.chegada && vis.saidaCliente) {
      const diff = isoToMin(vis.saidaCliente) - isoToMin(vis.chegada)
      if (diff >= 0 && diff < 10) return { ...vis, passagemRapida: true }
    }
    return vis
  })
}

function visitasReais(visitas: VisitaGPS[]): VisitaGPS[] { return visitas.filter(v => !v.almoco && !v.passagemRapida) }

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

function matchVisitaGPS(reais: VisitaGPS[], item: AgendaRow, ordsTec: OrdemServico[], usados: Set<number>): VisitaGPS | undefined {
  const clienteAgenda = item.cliente || ''
  const os = item.id_ordem ? ordsTec.find(o => o.Id_Ordem === item.id_ordem) : null
  const cnpjOS = os?.Cnpj_Cliente || ''
  if (cnpjOS) {
    const idx = reais.findIndex((v, j) => !usados.has(j) && v.destino_cnpj && v.destino_cnpj === cnpjOS)
    if (idx >= 0) { usados.add(idx); return reais[idx] }
  }
  if (clienteAgenda) {
    const idx = reais.findIndex((v, j) => !usados.has(j) && v.destino_nome && match(v.destino_nome, clienteAgenda))
    if (idx >= 0) { usados.add(idx); return reais[idx] }
  }
  const idx = reais.findIndex((_, j) => !usados.has(j))
  if (idx >= 0) { usados.add(idx); return reais[idx] }
  return undefined
}

function estimativasHibridas(estimados: EstimadoCliente[], reais: VisitaGPS[], items: AgendaRow[], ordsTec?: OrdemServico[]): EstimadoCliente[] {
  if (estimados.length === 0) return estimados
  const aj: EstimadoCliente[] = []
  let cursor = S
  let almocoContado = false
  const usados = new Set<number>()

  for (let i = 0; i < estimados.length; i++) {
    const gps = ordsTec ? matchVisitaGPS(reais, items[i], ordsTec, usados) : reais[i]
    const ida = items[i]?.tempo_ida_min || 0
    const sv = (items[i]?.qtd_horas || 2) * 60
    const volta = items[i]?.tempo_volta_min || 0

    const saida = gps?.saida ? isoToMin(gps.saida) : cursor
    cursor = saida

    const chegada = gps?.chegada ? isoToMin(gps.chegada) : cursor + ida
    cursor = chegada

    if (!almocoContado && cursor >= AI && cursor < AI + 120) { cursor += AD; almocoContado = true }

    const fimServico = gps?.saidaCliente ? isoToMin(gps.saidaCliente) : cursor + sv
    cursor = fimServico

    if (!almocoContado && cursor >= AI && cursor < AI + 120) { cursor += AD; almocoContado = true }

    let retorno: number | null = null
    if (i === estimados.length - 1) {
      if (gps?.retorno) { retorno = isoToMin(gps.retorno) }
      else { retorno = cursor + volta }
      cursor = retorno
    }

    aj.push({ saida, chegada, fimServico, retorno })
  }
  return aj
}

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
    geoCache[key] = result; return result
  } catch { return '' }
}

const ENDERECO_OFICINA = 'AV SÃO SEBASTIÃO, PIRAJU (SP)'

const CSS = `
@keyframes tv-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,.4) } 50% { box-shadow: 0 0 0 10px rgba(34,197,94,0) } }
@keyframes tv-blink { 0%,100% { opacity:1 } 50% { opacity:.4 } }
.tv-car-moving { animation: tv-pulse 1.5s ease infinite; }
.tv-car-blink { animation: tv-blink 1.2s ease-in-out infinite; }
`

// ── Component ──
export default function TVPainel() {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [caminhos, setCaminhos] = useState<Caminho[]>([])
  const [vinculos, setVinculos] = useState<VinculoVeiculo[]>([])
  const [viagensPorTec, setViagensPorTec] = useState<Record<string, ViagemGPS>>({})
  const [carAddr, setCarAddr] = useState<Record<string, string>>({})
  const [hora, setHora] = useState(new Date())
  const hojeStr = new Date().toISOString().split('T')[0]

  const carregar = useCallback(async () => {
    const [{ data: tecs }, { data: ords }, { data: rows }, { data: cams }, { data: vincs }] = await Promise.all([
      supabase.from('portal_permissoes').select('user_id, mecanico_role, mecanico_tecnico_nome').not('mecanico_role', 'is', null).not('mecanico_tecnico_nome', 'is', null),
      supabase.from('Ordem_Servico').select('*').eq('Status', 'Execução'),
      supabase.from('agenda_visao').select('*').eq('data', hojeStr).order('ordem_sequencia'),
      supabase.from('tecnico_caminhos').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('tecnico_veiculos').select('*'),
    ])
    setTecnicos(((tecs || []) as any[]).map(t => ({ user_id: t.user_id, tecnico_nome: t.mecanico_tecnico_nome, mecanico_role: t.mecanico_role })).sort((a: Tecnico, b: Tecnico) => a.tecnico_nome.localeCompare(b.tecnico_nome)))
    setOrdens((ords || []) as OrdemServico[])
    setAgenda((rows || []) as AgendaRow[])
    setCaminhos((cams || []) as Caminho[])
    setVinculos((vincs || []) as VinculoVeiculo[])
  }, [hojeStr])

  const carregarGPS = useCallback(async (vincs: VinculoVeiculo[]) => {
    if (vincs.length === 0) return
    const map: Record<string, ViagemGPS> = {}
    for (const v of vincs) {
      try {
        const r = await fetch(`/api/pos/rastreamento?acao=viagens&adesao_id=${v.adesao_id}`)
        if (r.ok) { const vs: ViagemGPS[] = await r.json(); const h = vs.find(vi => vi.data === hojeStr); if (h) map[v.tecnico_nome] = h }
      } catch { }
    }
    setViagensPorTec(map)
    for (const [nome, viagem] of Object.entries(map)) {
      if (viagem.ultima_posicao) {
        reverseGeocode(viagem.ultima_posicao.lat, viagem.ultima_posicao.lng).then(addr => { if (addr) setCarAddr(p => ({ ...p, [nome]: addr })) })
      }
    }
  }, [hojeStr])

  useEffect(() => {
    carregar().then(() => {
      supabase.from('tecnico_veiculos').select('*').then(({ data }) => { if (data && data.length > 0) carregarGPS(data as VinculoVeiculo[]) })
    })
    const iv1 = setInterval(() => carregar().then(() => { supabase.from('tecnico_veiculos').select('*').then(({ data }) => { if (data && data.length > 0) carregarGPS(data as VinculoVeiculo[]) }) }), 60000)
    const iv2 = setInterval(() => setHora(new Date()), 30000)
    const ch = supabase.channel('tv_agenda').on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_visao' }, () => carregar()).subscribe()
    return () => { clearInterval(iv1); clearInterval(iv2); ch.unsubscribe() }
  }, [carregar, carregarGPS])

  const tecAtivos = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])

  // ── Computed card data (igual ao Monitor) ──
  const cardData = useMemo(() => {
    return tecAtivos.map(tec => {
      const items = agenda.filter(a => a.tecnico_nome === tec.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia)
      const ordsTec = ordens.filter(o => match(tec.tecnico_nome, o.Os_Tecnico) || match(tec.tecnico_nome, o.Os_Tecnico2))
      const cam = caminhos.find(c => c.tecnico_nome === tec.tecnico_nome && c.status === 'em_transito') || null
      const naOfi = !cam && (items.length === 0 || items.every(a => {
        const os = a.id_ordem ? ordsTec.find(o => o.Id_Ordem === a.id_ordem) : null
        if (os?.Servico_Oficina) return true
        return (a.cliente || '').toLowerCase().includes('nova tratores')
      }))
      const ext = items.filter(a => {
        const os = a.id_ordem ? ordsTec.find(o => o.Id_Ordem === a.id_ordem) : null
        if (os?.Servico_Oficina) return false
        return !(a.cliente || '').toLowerCase().includes('nova tratores')
      })
      const vinculo = vinculos.find(v => v.tecnico_nome === tec.tecnico_nome) || null
      const viagem = viagensPorTec[tec.tecnico_nome] || null
      const visitasGPS = viagem ? agruparVisitasGPS(viagem.eventos) : []
      const estimadosPuros = ext.length > 0 && ext.every(a => a.tempo_ida_min > 0) ? estimativasPorCliente(ext) : []
      const reaisParaHibrido = visitasReais(visitasGPS)
      const estimados = estimadosPuros.length > 0 ? estimativasHibridas(estimadosPuros, reaisParaHibrido, ext, ordsTec) : []
      const lastEst = estimados.length > 0 ? estimados[estimados.length - 1] : null
      // Usa a última visita agrupada para determinar se está fora da loja (não o campo top-level)
      const ultimaVisita = visitasGPS.length > 0 ? visitasGPS[visitasGPS.length - 1] : null
      const foraLoja = !!(ultimaVisita && ultimaVisita.saida && !ultimaVisita.retorno)
      const completedVisits = visitasReais(visitasGPS).filter(v => v.saidaCliente).length
      const pos = viagem?.ultima_posicao || null
      let curIdx = ordsTec.length > 0 ? osAtualIdx(visitasGPS, estimados, ordsTec.length) : -1

      // Se está a caminho e ainda não chegou em nenhum cliente, detecta pelo mais próximo
      const reaisTv = visitasReais(visitasGPS)
      if (pos && foraLoja && ext.length > 1 && reaisTv.filter(v => v.chegada).length === 0) {
        let melhorIdx = curIdx, melhorDist = Infinity
        for (let ei = 0; ei < ext.length; ei++) {
          const coord = ext[ei].coordenadas
          if (!coord) continue
          const dist = distanciaKm(pos.lat, pos.lng, coord.lat, coord.lng)
          if (dist < melhorDist) {
            melhorDist = dist
            const osMatch = ordsTec.findIndex(o => o.Id_Ordem === ext[ei].id_ordem)
            if (osMatch >= 0) melhorIdx = osMatch
          }
        }
        if (melhorIdx !== curIdx) curIdx = melhorIdx
      }

      const curOS = curIdx >= 0 ? ordsTec[curIdx] : null
      const curAgItem = curOS ? items.find(a => a.id_ordem === curOS.Id_Ordem) : null
      const curEst = curIdx >= 0 ? estimados[curIdx] : null
      const curGPS = curIdx >= 0 ? visitasReais(visitasGPS)[curIdx] : null

      let status: 'oficina' | 'caminho' | 'cliente' | 'retornando' | 'retornou' = 'oficina'
      if (ultimaVisita?.retorno) status = 'retornou'
      else if (curGPS?.chegada && !curGPS?.saidaCliente) status = 'cliente'
      else if (foraLoja) status = 'caminho'
      else if (curGPS?.saidaCliente && curIdx === ordsTec.length - 1) status = 'retornando'

      const enderecoCarro = carAddr[tec.tecnico_nome] || ''
      const solicitacao = curOS ? extrairSolicitacao(curOS.Serv_Solicitado || '') : ''
      const tipoServico = curOS?.Tipo_Servico || ''

      let previsaoLabel = '', previsaoHora = ''
      if (status === 'caminho' && curEst) { previsaoLabel = 'Chega'; previsaoHora = fh(curEst.chegada) }
      else if (status === 'cliente' && curEst) { previsaoLabel = 'Sai'; previsaoHora = fh(curEst.fimServico) }
      else if (lastEst?.retorno && !ultimaVisita?.retorno) { previsaoLabel = 'Retorno'; previsaoHora = fh(lastEst.retorno) }
      else if (ultimaVisita?.retorno) { previsaoLabel = 'Voltou'; previsaoHora = fHora(ultimaVisita.retorno) }

      const isOficina = curAgItem?.endereco === ENDERECO_OFICINA || !!curOS?.Servico_Oficina
      const cidadeDestino = isOficina ? 'PIRAJU (SP) — Oficina' : curOS?.Cidade_Cliente || ''
      const hasOS = ordsTec.length > 0 || !!viagem

      return { tec, items, ext, ordsTec, vinculo, viagem, visitasGPS, estimados, lastEst, foraLoja, naOfi, completedVisits, pos, curIdx, curOS, curAgItem, curEst, curGPS, status, enderecoCarro, previsaoLabel, previsaoHora, solicitacao, tipoServico, isOficina, cidadeDestino, hasOS }
    }).sort((a, b) => {
      const oa = a.ordsTec.length, ob = b.ordsTec.length
      if (ob !== oa) return ob - oa
      const va = a.viagem ? 1 : 0, vb = b.viagem ? 1 : 0
      return vb - va
    })
  }, [tecAtivos, agenda, ordens, caminhos, vinculos, viagensPorTec, carAddr])

  const stats = useMemo(() => {
    let fora = 0, ofi = 0, totalOS = 0, done = 0
    cardData.forEach(d => { totalOS += d.ordsTec.length; done += d.completedVisits; if (d.foraLoja) fora++; else ofi++ })
    return { fora, ofi, totalOS, done }
  }, [cardData])

  const metade = Math.ceil(cardData.length / 2)

  return (
    <div style={{ minHeight: '100vh', background: '#F4F3EF', color: '#111', padding: '36px 40px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <style>{CSS}</style>

      {/* ══ TOP BAR ══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 28, paddingBottom: 20, borderBottom: '4px solid #111' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 60, fontWeight: 900, color: '#111' }}>{stats.fora}</span>
          <span style={{ fontSize: 32, fontWeight: 700, color: '#111' }}>em campo</span>
        </div>
        <div style={{ width: 3, height: 48, background: '#111' }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 60, fontWeight: 900, color: '#111' }}>{stats.done}</span>
          <span style={{ fontSize: 32, fontWeight: 700, color: '#111' }}>/{stats.totalOS} visitas</span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 28, fontWeight: 600, color: '#111' }}>
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <span style={{ fontSize: 64, fontWeight: 900, color: '#111', fontVariantNumeric: 'tabular-nums' }}>
          {hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* ══ CARDS — 2 FILEIRAS ══ */}
      {[0, 1].map(row => {
        const slice = row === 0 ? cardData.slice(0, metade) : cardData.slice(metade)
        return (
          <div key={row} style={{ display: 'flex', gap: 28, marginBottom: row === 0 ? 28 : 0, overflowX: 'auto', paddingBottom: 4 }}>
            {slice.map(d => {
              const { tec, ordsTec, foraLoja, status, previsaoHora, previsaoLabel, completedVisits, curOS, pos, solicitacao, tipoServico, isOficina, cidadeDestino, enderecoCarro, hasOS, curEst } = d
              const nome = tec.tecnico_nome.split(' ')
              const primeiroNome = nome[0]
              const sobrenome = nome.length > 1 ? nome[1] : ''
              const iniciais = nome.length > 1 ? (nome[0][0] + nome[nome.length - 1][0]).toUpperCase() : nome[0].substring(0, 2).toUpperCase()
              const statusLabel = status === 'oficina' ? 'Oficina' : status === 'caminho' ? 'A caminho' : status === 'cliente' ? 'No cliente' : status === 'retornando' ? 'Voltando' : status === 'retornou' ? 'Retornou' : ''

              return (
                <div key={tec.user_id} style={{
                  borderRadius: 24, flex: '1 1 0', minWidth: 440,
                  background: '#fff', border: `4px solid ${foraLoja ? '#222' : '#E5E3DD'}`,
                  boxShadow: '0 6px 24px rgba(0,0,0,.08)',
                  overflow: 'hidden',
                }}>
                  {/* TOPO: NOME + STATUS */}
                  <div style={{
                    background: hasOS ? 'linear-gradient(135deg, #8B0000 0%, #B22222 100%)' : '#E8E6E1',
                    padding: '22px 30px 20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                      <div style={{
                        width: 80, height: 80, borderRadius: '50%', flexShrink: 0,
                        background: hasOS ? 'rgba(255,255,255,.12)' : '#D5D3CE',
                        border: `4px solid ${hasOS ? 'rgba(255,255,255,.25)' : '#C0BDB7'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 38, fontWeight: 900, color: hasOS ? '#fff' : '#111' }}>{iniciais}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 38, fontWeight: 900, color: hasOS ? '#fff' : '#111', letterSpacing: '-.03em', lineHeight: 1.1, textTransform: 'uppercase' }}>
                          {primeiroNome} {sobrenome && <span style={{ fontSize: 28, fontWeight: 700, opacity: .7 }}>{sobrenome}</span>}
                        </div>
                      </div>
                      {hasOS && (
                        <div style={{
                          fontSize: 22, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em',
                          color: '#fff', background: status === 'oficina' ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.25)',
                          padding: '8px 20px', borderRadius: 24, flexShrink: 0,
                        }}>
                          {statusLabel}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* DESTINO */}
                  {cidadeDestino && (
                    <div style={{ background: isOficina ? '#FEF2F2' : '#F7F6F3', padding: '16px 30px 18px', borderBottom: '3px solid #E0DDD8' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Destino</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <MapPin size={26} color={isOficina ? '#B91C1C' : '#111'} />
                        <span style={{ fontSize: 30, fontWeight: 800, color: isOficina ? '#B91C1C' : '#111' }}>{cidadeDestino}</span>
                      </div>
                    </div>
                  )}

                  {/* LOCALIZAÇÃO GPS */}
                  {enderecoCarro && (
                    <div className={pos?.ignicao && pos.velocidade > 0 ? 'tv-car-blink' : ''} style={{
                      padding: '16px 30px 18px', borderBottom: '3px solid #E0DDD8',
                      background: pos?.ignicao && pos.velocidade > 0 ? '#F0FDF4' : '#FAFAF8',
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Localização</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div className={pos?.ignicao && pos.velocidade > 0 ? 'tv-car-moving' : ''} style={{
                          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                          background: pos?.ignicao && pos.velocidade > 0 ? '#22C55E' : '#DDD',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Car size={24} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 26, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {enderecoCarro}
                          </div>
                          <div style={{ fontSize: 22, color: '#111', marginTop: 4 }}>
                            {pos?.ignicao ? (
                              <span>
                                <span style={{ color: pos.velocidade > 0 ? '#16A34A' : '#111', fontWeight: 700 }}>
                                  {pos.velocidade > 0 ? `${pos.velocidade} km/h` : 'Parado'}
                                </span>
                                <span style={{ marginLeft: 12 }}>às {fHora(pos.dt)}</span>
                              </span>
                            ) : <span style={{ fontWeight: 600 }}>Ignição OFF</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CONTEÚDO */}
                  {hasOS ? (
                    <div style={{ padding: '24px 32px 26px' }}>
                      {/* OS Atual */}
                      {curOS && (
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <span style={{ fontSize: 24, fontWeight: 800, color: '#111', letterSpacing: '.05em' }}>OS</span>
                            <span style={{ fontSize: 38, fontWeight: 900, color: '#111', letterSpacing: '-.02em' }}>{curOS.Id_Ordem}</span>
                            {tipoServico && <span style={{ fontSize: 22, fontWeight: 700, color: '#111', background: '#F0EFEB', padding: '6px 16px', borderRadius: 8 }}>{tipoServico}</span>}
                          </div>
                          <div style={{ fontSize: 30, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>
                            {curOS.Os_Cliente?.split(' ').slice(0, 5).join(' ')}
                          </div>
                          {/* Horas */}
                          {curOS.Qtd_HR && (
                            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                              {(curOS.Hora_Inicio_Exec || curOS.Hora_Fim_Exec) && (
                                <span style={{ fontWeight: 800, color: '#1E3A5F', background: '#DBEAFE', padding: '6px 16px', borderRadius: 8, fontSize: 24 }}>
                                  {curOS.Hora_Inicio_Exec || '--:--'} → {curOS.Hora_Fim_Exec || '--:--'}
                                </span>
                              )}
                              <span style={{ fontSize: 24, fontWeight: 700, color: '#111' }}>{curOS.Qtd_HR}h serviço</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Solicitação */}
                      {solicitacao && (
                        <div style={{
                          fontSize: 24, fontWeight: 600, color: '#111', lineHeight: 1.4, marginBottom: 18,
                          padding: '16px 22px', background: '#FFFDF5', borderRadius: 12,
                          borderLeft: '6px solid #E8C94A',
                          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {solicitacao}
                        </div>
                      )}

                      {/* Est. row */}
                      {curEst && (
                        <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontVariantNumeric: 'tabular-nums', marginBottom: 18, background: '#FEF9C3', padding: '10px 18px', borderRadius: 10, border: '3px solid #FDE68A' }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: '#92400E', marginRight: 12 }}>Est.</span>
                          <span style={{ fontWeight: 800, color: '#92400E' }}>{fh(curEst.saida)}</span>
                          <span style={{ margin: '0 8px', color: '#92400E' }}>→</span>
                          <span style={{ fontWeight: 800, color: '#92400E' }}>{fh(curEst.chegada)}</span>
                          <span style={{ margin: '0 8px', color: '#92400E' }}>→</span>
                          <span style={{ fontWeight: 800, color: '#92400E' }}>{fh(curEst.fimServico)}</span>
                          {curEst.retorno && <><span style={{ margin: '0 8px', color: '#92400E' }}>→</span><span style={{ fontWeight: 800, color: '#92400E' }}>{fh(curEst.retorno)}</span></>}
                        </div>
                      )}

                      {/* Previsão + progress */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderTop: '4px solid #E0DDD8', paddingTop: 20 }}>
                        {previsaoHora ? (
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 28, color: '#111', fontWeight: 700 }}>{previsaoLabel}</span>
                            <span style={{ fontSize: 52, fontWeight: 900, color: '#111', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{previsaoHora}</span>
                          </div>
                        ) : <div />}
                        <div style={{ flex: 1 }} />
                        {ordsTec.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {ordsTec.map((_, i) => (
                              <div key={i} style={{
                                width: 22, height: 22, borderRadius: '50%',
                                background: i < completedVisits ? '#111' : i === d.curIdx ? '#999' : '#E0DDD8',
                                transition: 'background .3s',
                              }} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                      <span style={{ fontSize: 30, color: '#111', fontWeight: 600 }}>Na oficina / sem OS</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
