'use client'
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  MapPin, Truck, ArrowRight, ArrowLeft, Briefcase, Coffee, Moon,
  Navigation, Clock, Users
} from 'lucide-react'

interface AgendaRow {
  id: number
  data: string
  tecnico_nome: string
  id_ordem: string | null
  cliente: string
  servico: string
  endereco: string
  cidade: string
  coordenadas: { lat: number; lng: number } | null
  tempo_ida_min: number
  distancia_ida_km: number
  tempo_volta_min: number
  distancia_volta_km: number
  qtd_horas: number
  ordem_sequencia: number
  status: string
  observacoes: string
}

interface Tecnico {
  user_id: string
  tecnico_nome: string
  mecanico_role: 'tecnico' | 'observador'
}

interface Caminho {
  id: number
  tecnico_nome: string
  destino: string
  cidade: string
  status: string
}

// ── Helpers ──
function formatMin(min: number): string {
  if (min < 60) return `${Math.round(min)}min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h${m}min` : `${h}h`
}

function formatHora(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = Math.round(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function normalizarNome(nome: string): string[] {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2)
}
function nomesBatem(nomeA: string, nomeB: string): boolean {
  if (!nomeA || !nomeB) return false
  const pA = normalizarNome(nomeA), pB = normalizarNome(nomeB)
  if (!pA.length || !pB.length || pA[0] !== pB[0]) return false
  if (pA.length === 1 || pB.length === 1) return true
  const set = new Set(pA.slice(1))
  return pB.slice(1).some(p => set.has(p))
}

const SAIDA = 8 * 60 + 30
const ALMOCO_INI = 11 * 60
const ALMOCO_FIM = 12 * 60 + 30
const ALMOCO_DUR = 90
const FIM_EXP = 18 * 60

function calcRetorno(items: AgendaRow[]): { hora: string; totalMin: number; passaDia: boolean; diasExtras: number } {
  let cursor = SAIDA
  let almoco = false
  let dia = 0
  const virar = () => {
    while (cursor >= FIM_EXP) { dia++; cursor = SAIDA; almoco = false }
  }
  for (const row of items) {
    cursor += row.tempo_ida_min || 0
    virar()
    const svc = (row.qtd_horas || 2) * 60
    if (!almoco && cursor < ALMOCO_FIM && (cursor + svc) > ALMOCO_INI) {
      if (cursor >= ALMOCO_INI) { cursor += ALMOCO_DUR; almoco = true }
    }
    let rest = svc
    while (rest > 0) {
      const disp = FIM_EXP - cursor
      if (rest <= disp) { cursor += rest; rest = 0 } else { rest -= Math.max(0, disp); cursor = FIM_EXP; virar() }
      if (!almoco && cursor < ALMOCO_FIM && (cursor + rest) > ALMOCO_INI && cursor >= ALMOCO_INI) { cursor += ALMOCO_DUR; almoco = true }
    }
    if (!almoco && cursor >= ALMOCO_INI && cursor <= ALMOCO_FIM + 30) { cursor += ALMOCO_DUR; almoco = true }
  }
  cursor += items[items.length - 1]?.tempo_volta_min || 0
  virar()
  return { hora: formatHora(cursor), totalMin: (dia * (FIM_EXP - SAIDA - ALMOCO_DUR)) + (cursor - SAIDA), passaDia: dia > 0, diasExtras: dia }
}

export default function TVPainel() {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [caminhos, setCaminhos] = useState<Caminho[]>([])
  const [hora, setHora] = useState(new Date())
  const hojeStr = new Date().toISOString().split('T')[0]

  const carregar = async () => {
    const [{ data: tecs }, { data: rows }, { data: cams }] = await Promise.all([
      supabase.from('portal_permissoes')
        .select('user_id, mecanico_role, mecanico_tecnico_nome')
        .not('mecanico_role', 'is', null).not('mecanico_tecnico_nome', 'is', null),
      supabase.from('agenda_visao').select('*').eq('data', hojeStr).order('ordem_sequencia'),
      supabase.from('tecnico_caminhos').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    setTecnicos(((tecs || []) as any[]).map(t => ({ user_id: t.user_id, tecnico_nome: t.mecanico_tecnico_nome, mecanico_role: t.mecanico_role })).sort((a, b) => a.tecnico_nome.localeCompare(b.tecnico_nome)))
    setAgenda((rows || []) as AgendaRow[])
    setCaminhos((cams || []) as Caminho[])
  }

  useEffect(() => {
    carregar()
    const interval = setInterval(carregar, 60000) // refresh every 1 min
    const clockInterval = setInterval(() => setHora(new Date()), 30000)
    // Realtime
    const ch = supabase.channel('tv_agenda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_visao' }, () => carregar())
      .subscribe()
    return () => { clearInterval(interval); clearInterval(clockInterval); ch.unsubscribe() }
  }, []) // eslint-disable-line

  const tecAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')

  const agendaPorTec = useMemo(() => {
    const m: Record<string, AgendaRow[]> = {}
    tecAtivos.forEach(t => { m[t.tecnico_nome] = agenda.filter(a => a.tecnico_nome === t.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia) })
    return m
  }, [tecAtivos, agenda])

  const caminhoPorTec = useMemo(() => {
    const m: Record<string, Caminho | null> = {}
    tecAtivos.forEach(t => { m[t.tecnico_nome] = caminhos.find(c => c.tecnico_nome === t.tecnico_nome && c.status === 'em_transito') || null })
    return m
  }, [tecAtivos, caminhos])

  function estaNaOficina(items: AgendaRow[]): boolean {
    return items.length === 0 || items.every(a => (a.cliente || '').toLowerCase().includes('nova tratores'))
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0B1120', color: '#fff', padding: '24px 28px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Users size={20} color="#3B82F6" />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>Painel Técnico</span>
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 600 }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#3B82F6', fontVariantNumeric: 'tabular-nums' }}>
          {hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Grid técnicos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {tecAtivos.map(tec => {
          const items = agendaPorTec[tec.tecnico_nome] || []
          const cam = caminhoPorTec[tec.tecnico_nome]
          const naOficina = !cam && estaNaOficina(items)
          const externos = items.filter(a => !(a.cliente || '').toLowerCase().includes('nova tratores'))

          const retorno = externos.length > 0 && externos.every(a => a.tempo_ida_min > 0)
            ? calcRetorno(externos) : null

          let statusLabel = '', statusColor = '', statusBg = ''
          if (cam) { statusLabel = 'Em trânsito'; statusColor = '#60A5FA'; statusBg = '#1E3A5F' }
          else if (naOficina) { statusLabel = 'Na oficina'; statusColor = '#34D399'; statusBg = '#064E3B' }
          else if (externos.length > 0) { statusLabel = 'Em campo'; statusColor = '#93C5FD'; statusBg = '#1E3A5F' }

          const accent = cam ? '#3B82F6' : naOficina ? '#10B981' : '#3B82F6'

          return (
            <div key={tec.user_id} style={{
              background: '#141C2E', borderRadius: 14, overflow: 'hidden',
              border: '1px solid #1E293B',
            }}>
              {/* Header */}
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                  background: `linear-gradient(135deg, ${accent}, ${accent}99)`,
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 17, fontWeight: 800, position: 'relative',
                }}>
                  {tec.tecnico_nome.charAt(0)}
                  {cam && (
                    <div style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: '50%', background: '#10B981', border: '2px solid #141C2E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Navigation size={7} color="#fff" />
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#F1F5F9' }}>
                    {tec.tecnico_nome.split(' ').slice(0, 2).join(' ')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {statusLabel && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: 4 }}>
                        {statusLabel}
                      </span>
                    )}
                    {cam && <span style={{ fontSize: 10, color: '#64748B' }}>→ {cam.cidade}</span>}
                  </div>
                </div>
                {retorno && (
                  <div style={{
                    textAlign: 'center', flexShrink: 0, padding: '6px 12px', borderRadius: 8,
                    background: retorno.passaDia ? '#3B1111' : '#0F172A',
                    border: `1px solid ${retorno.passaDia ? '#7F1D1D' : '#1E293B'}`,
                  }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: retorno.passaDia ? '#F87171' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {retorno.passaDia ? `+${retorno.diasExtras} dia${retorno.diasExtras > 1 ? 's' : ''}` : 'Retorno'}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: retorno.passaDia ? '#F87171' : '#F1F5F9', lineHeight: 1.1 }}>
                      {retorno.hora}
                    </div>
                    <div style={{ fontSize: 9, color: '#475569' }}>
                      {retorno.passaDia ? `${retorno.diasExtras + 1} dias` : formatMin(retorno.totalMin)}
                    </div>
                  </div>
                )}
              </div>

              {/* Items */}
              {externos.length > 0 && (
                <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {externos.map(row => (
                    <div key={row.id} style={{
                      padding: '8px 10px', borderRadius: 8, background: '#0F172A',
                      border: '1px solid #1E293B',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: accent, padding: '1px 6px', borderRadius: 4 }}>
                          {row.id_ordem}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(row.cliente || '').split(' ').slice(0, 4).join(' ')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                        <MapPin size={9} color="#475569" />
                        <span style={{ fontSize: 10, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.cidade || row.endereco || 'Sem endereço'}
                        </span>
                      </div>
                      {row.tempo_ida_min > 0 && (
                        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#475569', fontWeight: 600 }}>
                          <span><ArrowRight size={9} style={{ verticalAlign: 'middle' }} /> {formatMin(row.tempo_ida_min)} · {row.distancia_ida_km}km</span>
                          <span><Briefcase size={9} style={{ verticalAlign: 'middle' }} /> {row.qtd_horas}h</span>
                        </div>
                      )}
                      {row.observacoes && (
                        <div style={{ fontSize: 10, color: '#64748B', marginTop: 3, fontStyle: 'italic' }}>
                          {row.observacoes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Na oficina */}
              {naOficina && items.length > 0 && (
                <div style={{ padding: '0 16px 14px' }}>
                  {items.map(row => (
                    <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B', padding: '3px 0' }}>
                      <Briefcase size={10} color="#10B981" />
                      <span style={{ fontWeight: 600, color: '#E2E8F0' }}>{row.id_ordem}</span>
                      <span>· {(row.cliente || '').split(' ').slice(0, 3).join(' ')}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10 }}>{row.qtd_horas}h</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
