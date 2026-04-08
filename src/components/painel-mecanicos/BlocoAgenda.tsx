'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, X, Search, MapPin, Trash2, FileText, Truck, Edit3, StickyNote } from 'lucide-react'

interface Tecnico { user_id: string; tecnico_nome: string; tecnico_email: string; mecanico_role: 'tecnico' | 'observador' }
interface OrdemServico {
  Id_Ordem: string; Status: string; Os_Cliente: string; Os_Tecnico: string; Os_Tecnico2: string
  Previsao_Execucao: string | null; Tipo_Servico: string; Cidade_Cliente: string
  Endereco_Cliente: string; Cnpj_Cliente: string; Serv_Solicitado: string; Qtd_HR?: string | number | null
}
interface AgendaRow {
  id: number; data: string; tecnico_nome: string; id_ordem: string | null
  cliente: string; servico: string; endereco: string; cidade: string
  coordenadas: { lat: number; lng: number } | null
  tempo_ida_min: number; distancia_ida_km: number; qtd_horas: number
  ordem_sequencia: number; status: string; observacoes: string
}
interface ClienteOption { chave: string; display: string }

function normNome(n: string): string[] { return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2) }
function matchNome(a: string, b: string) { if (!a || !b) return false; const pA = normNome(a), pB = normNome(b); if (!pA.length || !pB.length || pA[0] !== pB[0]) return false; if (pA.length === 1 || pB.length === 1) return true; const s = new Set(pA.slice(1)); return pB.slice(1).some(p => s.has(p)) }
function extrairSolicitacao(serv: string): string {
  if (!serv) return ''
  const idx = serv.indexOf('Solicitação do cliente:')
  if (idx === -1) return ''
  const after = serv.substring(idx + 'Solicitação do cliente:'.length)
  const fim = after.indexOf('Serviço Realizado')
  return (fim > -1 ? after.substring(0, fim) : after).replace(/\n/g, ' ').trim()
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const COLORS = ['#B22222', '#0E7490', '#7C3AED', '#059669', '#D97706', '#6366F1', '#DC2626', '#0891B2']

function getSegunda(offset: number): Date {
  const d = new Date(); const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset * 7
  const seg = new Date(d.getFullYear(), d.getMonth(), diff); seg.setHours(0, 0, 0, 0); return seg
}
function getDiasSemana(offset: number): string[] {
  const seg = getSegunda(offset)
  return Array.from({ length: 6 }, (_, i) => { const d = new Date(seg); d.setDate(seg.getDate() + i); return d.toISOString().split('T')[0] })
}
function calcDiasExecucao(qtdHR: string | number | null | undefined): number {
  const h = parseFloat(String(qtdHR || 0)) || 0; return h <= 0 ? 1 : Math.max(1, Math.ceil(h / 8))
}
function proximosDiasUteis(diaInicial: string, qtd: number, diasDisponiveis: string[]): string[] {
  const idx = diasDisponiveis.indexOf(diaInicial); return idx === -1 ? [diaInicial] : diasDisponiveis.slice(idx, idx + qtd)
}

const CSS = `
.ag-tab{padding:12px 0;cursor:pointer;border:none;background:none;text-align:center;flex:1;transition:all .15s;position:relative;border-radius:14px 14px 0 0}
.ag-tab:hover{background:#F5F5F5}
.ag-tab.active{background:#fff;box-shadow:0 -2px 8px rgba(0,0,0,.04)}
.ag-tab.active::after{content:'';position:absolute;bottom:0;left:20%;right:20%;height:3px;background:#B22222;border-radius:3px 3px 0 0}
.ag-tec-card{border-radius:14px;overflow:hidden;transition:box-shadow .2s;border:1px solid #EFEFEF}
.ag-tec-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06)}
.ag-os-item{padding:14px 16px;border-radius:10px;background:#fff;border:1px solid #F0F0F0;transition:all .15s}
.ag-os-item:hover{border-color:#DDD;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.ag-note-btn{display:inline-flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;padding:5px 10px;border-radius:6px;border:none;background:none;color:#BBB;transition:all .15s}
.ag-note-btn:hover{background:#F0F0FF;color:#6366F1}
.ag-note-btn.has{color:#6366F1;background:#EEF2FF}
.ag-add-btn{display:flex;align-items:center;justify-content:center;gap:5px;padding:10px;border-radius:10px;border:2px dashed #E8E8E8;color:#CCC;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;background:none;width:100%}
.ag-add-btn:hover{border-color:#BBB;color:#888;background:#FAFAFA}
.ag-fade-in{animation:agFade .2s ease}
@keyframes agFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
`

export default function BlocoAgenda({ tecnicos, ordens }: { tecnicos: Tecnico[]; ordens: OrdemServico[] }) {
  const [semanaOffset, setSemanaOffset] = useState(0)
  const [agendaSemana, setAgendaSemana] = useState<AgendaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [notaSalvando, setNotaSalvando] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null) // "tec|dia" or "obs-{id}"
  const [addKey, setAddKey] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<'os' | 'manual'>('os')
  const [buscaOS, setBuscaOS] = useState('')
  const [addSalvando, setAddSalvando] = useState(false)
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [clienteFilter, setClienteFilter] = useState('')
  const [clienteSelecionado, setClienteSelecionado] = useState<{ chave: string; nome: string; endereco: string; cidade: string } | null>(null)
  const [addHoras, setAddHoras] = useState(2)
  const [addObs, setAddObs] = useState('')
  const [carregandoCliente, setCarregandoCliente] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const tecs = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])
  const dias = useMemo(() => getDiasSemana(semanaOffset), [semanaOffset])
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [diaSel, setDiaSel] = useState('')

  // Inicializar dia selecionado como hoje
  useEffect(() => {
    if (dias.includes(hoje)) setDiaSel(hoje)
    else setDiaSel(dias[0])
  }, [dias, hoje])

  const ordensExecucao = useMemo(() => ordens.filter(o => o.Status === 'Execução'), [ordens])
  const ordensPorTec = useMemo(() => {
    const m: Record<string, OrdemServico[]> = {}
    tecs.forEach(t => { m[t.tecnico_nome] = ordens.filter(o => o.Status !== 'Concluída' && o.Status !== 'Cancelada' && (matchNome(t.tecnico_nome, o.Os_Tecnico) || matchNome(t.tecnico_nome, o.Os_Tecnico2))) })
    return m
  }, [tecs, ordens])

  useEffect(() => { fetch('/api/pos/clientes').then(r => r.ok ? r.json() : []).then(setClientes).catch(() => {}) }, [])
  const clientesFiltrados = useMemo(() => {
    if (!clienteFilter) return []; const terms = clienteFilter.toLowerCase().split(/\s+/).filter(Boolean)
    return clientes.filter(c => { const d = c.display.toLowerCase(); return terms.every(t => d.includes(t)) }).slice(0, 12)
  }, [clienteFilter, clientes])

  const carregarSemana = useCallback(async () => {
    setLoading(true)
    try { const results = await Promise.all(dias.map(d => fetch(`/api/pos/agenda-visao?data=${d}`).then(r => r.ok ? r.json() : []))); setAgendaSemana(results.flat()) } catch { }
    setLoading(false)
  }, [dias])

  const carregarNotas = useCallback(async () => {
    try {
      const r = await fetch(`/api/pos/agenda-notas?datas=${dias.join(',')}`)
      if (r.ok) { const rows = await r.json() as { tecnico_nome: string; data: string; nota: string }[]; const map: Record<string, string> = {}; rows.forEach(n => { if (n.nota) map[`${n.tecnico_nome}|${n.data}`] = n.nota }); setNotas(map) }
    } catch { }
  }, [dias])

  useEffect(() => { carregarSemana(); carregarNotas() }, [carregarSemana, carregarNotas])

  const salvarObs = async (id: number, obs: string) => {
    try { await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, observacoes: obs }) }); setAgendaSemana(p => p.map(a => a.id === id ? { ...a, observacoes: obs } : a)) } catch { }
    setEditingNote(null)
  }

  const salvarNota = async (tecNome: string, dia: string, nota: string) => {
    const key = `${tecNome}|${dia}`; setNotaSalvando(key)
    try { const r = await fetch('/api/pos/agenda-notas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tecnico_nome: tecNome, data: dia, nota }) }); if (r.ok) setNotas(p => nota ? { ...p, [key]: nota } : (() => { const n = { ...p }; delete n[key]; return n })()) } catch { }
    setNotaSalvando(null); setEditingNote(null)
  }

  const remover = async (id: number) => { const r = await fetch('/api/pos/agenda-visao', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (r.ok) setAgendaSemana(p => p.filter(a => a.id !== id)) }

  const selecionarCliente = async (c: ClienteOption) => {
    setCarregandoCliente(true); setClienteFilter(c.display.split('[')[0].trim())
    try { const r = await fetch(`/api/pos/clientes?id=${encodeURIComponent(c.chave)}`); if (r.ok) { const data = await r.json(); setClienteSelecionado({ chave: c.chave, nome: data.nome, endereco: data.endereco || '', cidade: data.cidade || '' }) } } catch { }
    setCarregandoCliente(false)
  }

  const getUltimaLocalizacao = (tecNome: string, dia: string) => {
    const itemsDia = agendaSemana.filter(a => a.data === dia && a.tecnico_nome === tecNome && a.coordenadas).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia)
    return itemsDia[itemsDia.length - 1] || null
  }

  const adicionarOS = async (tecNome: string, diaInicial: string, os: OrdemServico) => {
    setAddSalvando(true)
    try {
      const totalHoras = parseFloat(String(os.Qtd_HR || 0)) || 2; const diasExec = calcDiasExecucao(os.Qtd_HR); const diasP = proximosDiasUteis(diaInicial, diasExec, dias)
      for (let d = 0; d < diasP.length; d++) {
        const diaA = diasP[d]; const hDia = d < diasP.length - 1 ? 8 : Math.min(8, totalHoras - d * 8); const ultimo = getUltimaLocalizacao(tecNome, diaA)
        const r = await fetch('/api/pos/agenda-visao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: diaA, tecnicos: [{ nome: tecNome, ordens: [{ id: os.Id_Ordem, cliente: os.Os_Cliente, cnpj: os.Cnpj_Cliente, endereco: os.Endereco_Cliente, cidade: os.Cidade_Cliente, servico: os.Serv_Solicitado, qtdHoras: Math.max(1, hDia), observacoes: diasExec > 1 ? `Dia ${d + 1}/${diasExec} · ${extrairSolicitacao(os.Serv_Solicitado || '')}` : extrairSolicitacao(os.Serv_Solicitado || '') }] }] }) })
        if (r.ok) {
          const rows = await r.json() as AgendaRow[]; setAgendaSemana(prev => [...prev.filter(a => a.data !== diaA), ...rows])
          if (d === 0) await fetch('/api/pos/agenda-visao/caminho', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tecnico_nome: tecNome, destino: os.Os_Cliente, cidade: os.Cidade_Cliente || '', motivo: os.Id_Ordem }) }).catch(() => {})
          const ni = rows.find(row => row.tecnico_nome === tecNome && row.id_ordem === os.Id_Ordem && row.tempo_ida_min === 0)
          if (ni) { const cb: Record<string, any> = { id: ni.id, calcular: true }; if (ultimo?.coordenadas) { cb.origemLat = ultimo.coordenadas.lat; cb.origemLng = ultimo.coordenadas.lng }; fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cb) }).then(async r2 => { if (r2.ok) { const u = await r2.json(); setAgendaSemana(p => p.map(a => a.id === u.id ? u : a)) } }) }
        }
      }
    } catch { }
    fecharAdd(); setAddSalvando(false); carregarSemana()
  }

  const adicionarManual = async (tecNome: string, dia: string) => {
    if (!clienteSelecionado) return; setAddSalvando(true)
    try {
      const ultimo = getUltimaLocalizacao(tecNome, dia)
      const r = await fetch('/api/pos/agenda-visao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dia, tecnicos: [{ nome: tecNome, ordens: [{ id: `AG-${Date.now()}`, cliente: clienteSelecionado.nome, cnpj: '', endereco: clienteSelecionado.endereco, cidade: clienteSelecionado.cidade, servico: '', qtdHoras: addHoras, observacoes: addObs }] }] }) })
      if (r.ok) {
        const rows = await r.json() as AgendaRow[]; setAgendaSemana(prev => [...prev.filter(a => a.data !== dia), ...rows])
        await fetch('/api/pos/agenda-visao/caminho', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tecnico_nome: tecNome, destino: clienteSelecionado.nome, cidade: clienteSelecionado.cidade, motivo: addObs || 'Serviço agendado' }) }).catch(() => {})
        const ni = rows.find(row => row.tecnico_nome === tecNome && row.tempo_ida_min === 0 && row.endereco && !agendaSemana.some(exist => exist.id === row.id))
        if (ni) { const cb: Record<string, any> = { id: ni.id, calcular: true }; if (ultimo?.coordenadas) { cb.origemLat = ultimo.coordenadas.lat; cb.origemLng = ultimo.coordenadas.lng }; fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cb) }).then(async r2 => { if (r2.ok) { const u = await r2.json(); setAgendaSemana(p => p.map(a => a.id === u.id ? u : a)) } }) }
      }
    } catch { }
    fecharAdd(); setAddSalvando(false)
  }

  const abrirAdd = (tecNome: string, dia: string) => { setAddKey(`${tecNome}|${dia}`); setAddMode('os'); setBuscaOS(''); setClienteFilter(''); setClienteSelecionado(null); setAddHoras(2); setAddObs('') }
  const fecharAdd = () => { setAddKey(null); setBuscaOS(''); setClienteFilter(''); setClienteSelecionado(null); setAddHoras(2); setAddObs('') }

  // Contadores por dia
  const countByDay = useMemo(() => {
    const m: Record<string, number> = {}
    dias.forEach(d => { m[d] = agendaSemana.filter(a => a.data === d).length })
    return m
  }, [dias, agendaSemana])

  if (!diaSel) return null

  const diaObj = new Date(diaSel + 'T12:00:00')
  const isHoje = diaSel === hoje
  const diaPassado = diaSel < hoje

  return (
    <div>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setSemanaOffset(p => p - 1)} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #E0E0E0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronLeft size={18} color="#555" />
          </button>
          <button onClick={() => setSemanaOffset(p => p + 1)} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #E0E0E0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronRight size={18} color="#555" />
          </button>
          {!semanaOffset ? null : (
            <button onClick={() => setSemanaOffset(0)} style={{ fontSize: 13, fontWeight: 600, color: '#B22222', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 16px', cursor: 'pointer' }}>Hoje</button>
          )}
        </div>
        {loading && <Loader2 size={18} color="#999" className="animate-spin" />}
      </div>

      {/* ── TABS DOS DIAS ── */}
      <div style={{ display: 'flex', gap: 4, background: '#F5F5F3', borderRadius: '14px 14px 0 0', padding: '4px 4px 0' }}>
        {dias.map(dia => {
          const d = new Date(dia + 'T12:00:00')
          const isActive = dia === diaSel
          const isH = dia === hoje
          const cnt = countByDay[dia] || 0
          return (
            <button key={dia} className={`ag-tab${isActive ? ' active' : ''}`} onClick={() => setDiaSel(dia)}
              style={{ opacity: dia < hoje && !isActive ? 0.6 : 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: isH ? '#B22222' : isActive ? '#555' : '#AAA', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {DIAS_SEMANA[d.getDay()]}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: isH ? '#B22222' : isActive ? '#111' : '#999', margin: '2px 0' }}>
                {d.getDate()}
              </div>
              {cnt > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#111' : '#BBB' }}>{cnt} serv.</div>
              )}
              {isH && !isActive && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#B22222', margin: '4px auto 0' }} />}
            </button>
          )
        })}
      </div>

      {/* ── CONTEÚDO DO DIA ── */}
      <div key={diaSel} className="ag-fade-in" style={{ background: '#fff', borderRadius: '0 0 14px 14px', border: '1px solid #EFEFEF', borderTop: 'none', padding: '20px 24px', minHeight: 300 }}>

        {/* Técnicos */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {tecs.map((tec, tecIdx) => {
            const tecColor = COLORS[tecIdx % COLORS.length]
            const items = agendaSemana.filter(a => a.data === diaSel && a.tecnico_nome === tec.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia)
            const ordsAtivas = ordensPorTec[tec.tecnico_nome] || []
            const cellKey = `${tec.tecnico_nome}|${diaSel}`
            const isAdding = addKey === cellKey
            const notaKey = cellKey
            const notaValue = notas[notaKey] || ''
            const isEditingNote = editingNote === notaKey
            const primeiroNome = tec.tecnico_nome.split(' ')[0]

            const idsNaAgenda = new Set(items.map(a => a.id_ordem).filter(Boolean))
            const ordsTec = ordsAtivas.filter(o => !idsNaAgenda.has(o.Id_Ordem))
            const buscaLower = buscaOS.toLowerCase()
            const ordsFiltradas = isAdding && addMode === 'os'
              ? (buscaOS ? ordensExecucao.filter(o => !idsNaAgenda.has(o.Id_Ordem) && (o.Id_Ordem.toLowerCase().includes(buscaLower) || o.Os_Cliente.toLowerCase().includes(buscaLower) || (o.Cidade_Cliente || '').toLowerCase().includes(buscaLower))) : ordsTec)
              : []

            return (
              <div key={tec.user_id} className="ag-tec-card" style={{ background: '#FAFAFA' }}>
                {/* Tec header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: tecColor }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 }}>
                    {primeiroNome.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{tec.tecnico_nome.split(' ').slice(0, 2).join(' ')}</div>
                  </div>
                  {items.length > 0 && <span style={{ fontSize: 24, fontWeight: 900, color: 'rgba(255,255,255,.4)' }}>{items.length}</span>}
                </div>

                {/* Ordens */}
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.length === 0 && !isAdding && !isEditingNote && !notaValue && (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#CCC', fontSize: 14 }}>Sem serviço agendado</div>
                  )}

                  {items.map(row => {
                    const isEditObs = editingNote === `obs-${row.id}`
                    return (
                      <div key={row.id} className="ag-os-item" style={{ borderLeft: `4px solid ${tecColor}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: tecColor, padding: '2px 8px', borderRadius: 5 }}>
                              {row.id_ordem?.startsWith('AG-') ? 'Manual' : (row.id_ordem || 'Manual')}
                            </span>
                            <span style={{ fontSize: 13, color: '#AAA', fontWeight: 600 }}>{row.qtd_horas}h</span>
                          </div>
                          <button onClick={() => remover(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DDD', padding: 2 }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')} onMouseLeave={e => (e.currentTarget.style.color = '#DDD')}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#111', lineHeight: 1.3, marginBottom: 4 }}>{row.cliente || '—'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                          {row.cidade && <span style={{ fontSize: 13, color: '#777', display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={12} /> {row.cidade}</span>}
                          {row.tempo_ida_min > 0 && <span style={{ fontSize: 12, color: '#AAA', display: 'flex', alignItems: 'center', gap: 3 }}><Truck size={12} /> {Math.round(row.tempo_ida_min)}min · {row.distancia_ida_km}km</span>}
                        </div>

                        {/* Anotação da OS */}
                        {isEditObs ? (
                          <textarea ref={noteRef} autoFocus defaultValue={row.observacoes || ''} placeholder="Anotação..."
                            onBlur={e => salvarObs(row.id, e.target.value.trim())}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); salvarObs(row.id, (e.target as HTMLTextAreaElement).value.trim()) } if (e.key === 'Escape') setEditingNote(null) }}
                            style={{ width: '100%', fontSize: 14, padding: '8px 12px', borderRadius: 8, border: '1px solid #C7D2FE', background: '#EEF2FF', outline: 'none', resize: 'vertical', minHeight: 44, boxSizing: 'border-box', color: '#111', lineHeight: 1.4 }}
                          />
                        ) : (
                          <button className={`ag-note-btn${row.observacoes ? ' has' : ''}`} onClick={() => setEditingNote(`obs-${row.id}`)}>
                            <Edit3 size={12} />
                            {row.observacoes || 'Adicionar anotação...'}
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Nota do dia do técnico */}
                  {isEditingNote ? (
                    <textarea ref={noteRef} autoFocus defaultValue={notaValue} placeholder={`Nota para ${primeiroNome}...`}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== notaValue) salvarNota(tec.tecnico_nome, diaSel, v); else setEditingNote(null) }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = (e.target as HTMLTextAreaElement).value.trim(); salvarNota(tec.tecnico_nome, diaSel, v) } if (e.key === 'Escape') setEditingNote(null) }}
                      style={{ width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid #C7D2FE', background: '#EEF2FF', outline: 'none', resize: 'vertical', minHeight: 48, boxSizing: 'border-box', color: '#111', lineHeight: 1.4, opacity: notaSalvando === notaKey ? 0.5 : 1 }}
                    />
                  ) : notaValue ? (
                    <div onClick={() => setEditingNote(notaKey)} style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 10, background: '#EEF2FF', border: '1px solid #DDD6FE', fontSize: 14, color: '#4338CA', lineHeight: 1.4, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <StickyNote size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{notaValue}</span>
                    </div>
                  ) : (
                    <button className="ag-note-btn" onClick={() => setEditingNote(notaKey)} style={{ width: '100%', justifyContent: 'center' }}>
                      <StickyNote size={13} /> Nota do dia...
                    </button>
                  )}

                  {/* Botão adicionar */}
                  {!isAdding && (
                    <button className="ag-add-btn" onClick={() => abrirAdd(tec.tecnico_nome, diaSel)}>
                      <Plus size={16} /> Adicionar serviço
                    </button>
                  )}

                  {/* ── POPUP ADICIONAR ── */}
                  {isAdding && (
                    <div className="ag-fade-in" style={{ background: '#fff', borderRadius: 14, border: '1px solid #E4E4E7', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: `3px solid ${tecColor}` }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>{primeiroNome}</div>
                        <button onClick={fecharAdd} style={{ background: '#F4F4F5', border: 'none', borderRadius: 8, cursor: 'pointer', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} color="#777" /></button>
                      </div>
                      <div style={{ display: 'flex', borderBottom: '1px solid #E4E4E7' }}>
                        {(['os', 'manual'] as const).map(mode => (
                          <button key={mode} onClick={() => setAddMode(mode)} style={{
                            flex: 1, padding: '12px 0', fontSize: 14, fontWeight: addMode === mode ? 700 : 400,
                            border: 'none', cursor: 'pointer', background: 'transparent',
                            color: addMode === mode ? '#111' : '#AAA',
                            borderBottom: addMode === mode ? `3px solid ${tecColor}` : '3px solid transparent', marginBottom: -1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}>
                            {mode === 'os' ? <><FileText size={14} /> Ordens {ordsTec.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, background: tecColor, color: '#fff', padding: '2px 8px', borderRadius: 8 }}>{ordsTec.length}</span>}</> : <><Plus size={14} /> Cliente</>}
                          </button>
                        ))}
                      </div>

                      {addMode === 'os' && (
                        <div style={{ padding: '14px 16px' }}>
                          <div style={{ position: 'relative', marginBottom: 12 }}>
                            <Search size={15} color="#AAA" style={{ position: 'absolute', left: 12, top: 11 }} />
                            <input value={buscaOS} onChange={e => setBuscaOS(e.target.value)} placeholder="Buscar OS, cliente..." style={{ fontSize: 14, padding: '10px 14px 10px 36px', border: '1px solid #E4E4E7', borderRadius: 10, outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#111' }} />
                          </div>
                          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {ordsFiltradas.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '20px 0', color: '#CCC', fontSize: 14 }}>{buscaOS ? 'Nenhuma OS' : 'Todas já na agenda'}</div>
                            ) : ordsFiltradas.map(os => (
                              <div key={os.Id_Ordem} className="ag-os-item" style={{ cursor: 'pointer' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{os.Id_Ordem}</span>
                                  <button onClick={e => { e.stopPropagation(); adicionarOS(tec.tecnico_nome, diaSel, os) }} disabled={addSalvando}
                                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: tecColor, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                    {addSalvando ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Adicionar
                                  </button>
                                </div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{os.Os_Cliente}</div>
                                <div style={{ fontSize: 13, color: '#999', display: 'flex', gap: 8, marginTop: 2 }}>
                                  {os.Cidade_Cliente && <span>{os.Cidade_Cliente}</span>}
                                  <span>{parseFloat(String(os.Qtd_HR || 0)) || 2}h</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {addMode === 'manual' && (
                        <div style={{ padding: '14px 16px' }}>
                          <div style={{ marginBottom: 12, position: 'relative' }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#999', marginBottom: 6, display: 'block', textTransform: 'uppercase' }}>Cliente</label>
                            <div style={{ position: 'relative' }}>
                              <Search size={15} color="#AAA" style={{ position: 'absolute', left: 12, top: 11 }} />
                              <input value={clienteFilter} onChange={e => { setClienteFilter(e.target.value); setClienteSelecionado(null) }} placeholder="Buscar cliente..."
                                style={{ fontSize: 14, padding: '10px 14px 10px 36px', border: '1px solid #E4E4E7', borderRadius: 10, outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#111' }} />
                            </div>
                            {clienteFilter && !clienteSelecionado && clientesFiltrados.length > 0 && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 110, background: '#fff', border: '1px solid #E4E4E7', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                                {clientesFiltrados.map(c => (
                                  <div key={c.chave} onClick={() => selecionarCliente(c)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #F4F4F5' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#F4F4F5')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                    <div style={{ fontWeight: 600, color: '#111' }}>{c.display.split('[')[0].trim()}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {carregandoCliente && <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#999', fontSize: 13, marginBottom: 10 }}><Loader2 size={14} className="animate-spin" /> Carregando...</div>}
                          {clienteSelecionado && (
                            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
                              <div style={{ fontSize: 14, color: '#111', fontWeight: 600 }}>{clienteSelecionado.endereco || 'Sem endereço'}</div>
                              {clienteSelecionado.cidade && <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>{clienteSelecionado.cidade}</div>}
                            </div>
                          )}
                          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, marginBottom: 12 }}>
                            <div>
                              <label style={{ fontSize: 12, fontWeight: 600, color: '#999', marginBottom: 4, display: 'block', textTransform: 'uppercase' }}>Horas</label>
                              <input type="number" step="0.5" min="0.5" value={addHoras} onChange={e => setAddHoras(parseFloat(e.target.value) || 1)}
                                style={{ fontSize: 14, padding: '10px 12px', border: '1px solid #E4E4E7', borderRadius: 10, outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#111' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 12, fontWeight: 600, color: '#999', marginBottom: 4, display: 'block', textTransform: 'uppercase' }}>Observação</label>
                              <input value={addObs} onChange={e => setAddObs(e.target.value)} placeholder="Ex: Levar peças..."
                                style={{ fontSize: 14, padding: '10px 12px', border: '1px solid #E4E4E7', borderRadius: 10, outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#111' }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => adicionarManual(tec.tecnico_nome, diaSel)} disabled={!clienteSelecionado || addSalvando}
                              style={{ flex: 1, padding: '11px 0', fontSize: 14, fontWeight: 700, borderRadius: 10, border: 'none', cursor: 'pointer', background: clienteSelecionado ? tecColor : '#E4E4E7', color: clienteSelecionado ? '#fff' : '#AAA', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              {addSalvando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar
                            </button>
                            <button onClick={fecharAdd} style={{ padding: '11px 18px', borderRadius: 10, border: '1px solid #E4E4E7', background: '#fff', cursor: 'pointer', color: '#777', fontSize: 14 }}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
