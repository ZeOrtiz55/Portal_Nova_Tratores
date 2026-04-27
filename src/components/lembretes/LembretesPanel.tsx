'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  X, Bell, Plus, Clock, Check, User, Calendar,
  AlertCircle, ChevronDown, Send, Repeat
} from 'lucide-react'

interface Lembrete {
  id: string
  criador_id: string
  criador_nome: string
  destinatario_id: string
  destinatario_nome: string
  titulo: string
  descricao: string
  data_hora: string
  status: string
  recorrencia?: string | null
  created_at: string
}

const RECORRENCIAS = [
  { value: '', label: 'Sem repetição' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quinzenal', label: 'Quinzenal' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'bimestral', label: 'Bimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
]

interface Usuario {
  id: string
  nome: string
  funcao: string
}

export default function LembretesPanel({
  open,
  onClose,
  userId,
  userName,
}: {
  open: boolean
  onClose: () => void
  userId: string
  userName: string
}) {
  const [lembretes, setLembretes] = useState<Lembrete[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState<'pendentes' | 'todos'>('pendentes')

  // Form state
  const [destId, setDestId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [dataHora, setDataHora] = useState('')
  const [recorrencia, setRecorrencia] = useState('')

  const carregarLembretes = useCallback(async () => {
    if (!userId) return
    const res = await fetch(`/api/lembretes?userId=${userId}&tipo=${filtro}`)
    const data = await res.json()
    if (Array.isArray(data)) setLembretes(data)
  }, [userId, filtro])

  useEffect(() => {
    if (!open) return
    carregarLembretes()
    // Carregar usuarios
    supabase.from('financeiro_usu').select('id, nome, funcao').order('nome').then(({ data }) => {
      if (data) setUsuarios(data)
    })
  }, [open, carregarLembretes])

  const criarLembrete = async () => {
    if (!destId || !titulo || !dataHora) return
    setLoading(true)
    const dest = usuarios.find(u => u.id === destId)
    await fetch('/api/lembretes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        criador_id: userId,
        criador_nome: userName,
        destinatario_id: destId,
        destinatario_nome: dest?.nome || '',
        titulo,
        descricao,
        data_hora: new Date(dataHora).toISOString(),
        ...(recorrencia ? { recorrencia } : {}),
      }),
    })
    // Notificar destinatário
    await supabase.from('portal_notificacoes').insert({
      user_id: destId,
      tipo: 'sistema',
      titulo: `${userName} criou um lembrete para você`,
      descricao: titulo,
      link: '/dashboard',
    })
    setTitulo('')
    setDescricao('')
    setDataHora('')
    setRecorrencia('')
    setDestId('')
    setShowForm(false)
    setLoading(false)
    carregarLembretes()
  }

  const concluirLembrete = async (id: string) => {
    await fetch('/api/lembretes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'concluido' }),
    })
    carregarLembretes()
  }

  if (!open) return null

  const agora = new Date()
  const vencidos = lembretes.filter(l => l.status === 'pendente' && new Date(l.data_hora) <= agora)
  const futuros = lembretes.filter(l => l.status === 'pendente' && new Date(l.data_hora) > agora)
  const concluidos = lembretes.filter(l => l.status === 'concluido')

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(6px)', zIndex: 40000,
        display: 'flex', justifyContent: 'flex-end'
      }}
    >
      <div style={{
        width: '440px', height: '100vh', background: '#fff',
        boxShadow: '-8px 0 30px rgba(0,0,0,0.1)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.3s ease-out'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #f0f0f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '12px',
              background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Bell size={20} color="#dc2626" />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Lembretes</h3>
              <p style={{ fontSize: '11px', color: '#a3a3a3', margin: 0 }}>{lembretes.filter(l => l.status === 'pendente').length} pendentes</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowForm(true)}
              style={{
                background: '#dc2626', color: '#fff', border: 'none',
                borderRadius: '10px', padding: '8px 14px', cursor: 'pointer',
                fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              <Plus size={14} /> Novo
            </button>
            <button
              onClick={onClose}
              style={{
                background: '#f5f5f5', border: 'none', borderRadius: '10px',
                width: '36px', height: '36px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', color: '#737373'
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filtro */}
        <div style={{ padding: '12px 24px', display: 'flex', gap: '8px', borderBottom: '1px solid #f5f5f5', flexShrink: 0 }}>
          {(['pendentes', 'todos'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              style={{
                padding: '6px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: '600', transition: 'all 0.2s',
                background: filtro === f ? '#dc2626' : '#f5f5f5',
                color: filtro === f ? '#fff' : '#737373'
              }}
            >
              {f === 'pendentes' ? 'Pendentes' : 'Todos'}
            </button>
          ))}
        </div>

        {/* Form novo lembrete */}
        {showForm && (
          <div style={{
            padding: '20px 24px', borderBottom: '1px solid #f0f0f0',
            background: '#fafafa', flexShrink: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a', letterSpacing: '0.5px' }}>NOVO LEMBRETE</span>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <select
                value={destId}
                onChange={e => setDestId(e.target.value)}
                style={{
                  padding: '10px 14px', borderRadius: '10px', border: '1px solid #e5e5e5',
                  fontSize: '13px', color: '#1a1a1a', background: '#fff', outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">Selecione o destinatário...</option>
                {usuarios.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.nome} {u.id === userId ? '(eu)' : `— ${u.funcao || ''}`}
                  </option>
                ))}
              </select>

              <input
                placeholder="Título do lembrete..."
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                style={{
                  padding: '10px 14px', borderRadius: '10px', border: '1px solid #e5e5e5',
                  fontSize: '13px', color: '#1a1a1a', outline: 'none'
                }}
              />

              <textarea
                placeholder="Descrição (opcional)..."
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                rows={2}
                style={{
                  padding: '10px 14px', borderRadius: '10px', border: '1px solid #e5e5e5',
                  fontSize: '13px', color: '#1a1a1a', outline: 'none', resize: 'none'
                }}
              />

              <input
                type="datetime-local"
                value={dataHora}
                onChange={e => setDataHora(e.target.value)}
                style={{
                  padding: '10px 14px', borderRadius: '10px', border: '1px solid #e5e5e5',
                  fontSize: '13px', color: '#1a1a1a', outline: 'none'
                }}
              />

              <select
                value={recorrencia}
                onChange={e => setRecorrencia(e.target.value)}
                style={{
                  padding: '10px 14px', borderRadius: '10px', border: '1px solid #e5e5e5',
                  fontSize: '13px', color: '#1a1a1a', background: '#fff', outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {RECORRENCIAS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>

              <button
                onClick={criarLembrete}
                disabled={!destId || !titulo || !dataHora || loading}
                style={{
                  padding: '12px', borderRadius: '10px', border: 'none',
                  background: (!destId || !titulo || !dataHora) ? '#e5e5e5' : '#dc2626',
                  color: (!destId || !titulo || !dataHora) ? '#a3a3a3' : '#fff',
                  fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}
              >
                <Send size={14} /> {loading ? 'Salvando...' : 'Criar Lembrete'}
              </button>
            </div>
          </div>
        )}

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* Vencidos */}
          {vencidos.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#ef4444', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <AlertCircle size={12} /> VENCIDOS ({vencidos.length})
              </span>
              {vencidos.map(l => (
                <LembreteCard key={l.id} lembrete={l} userId={userId} onConcluir={concluirLembrete} tipo="vencido" />
              ))}
            </div>
          )}

          {/* Futuros */}
          {futuros.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#737373', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <Clock size={12} /> AGENDADOS ({futuros.length})
              </span>
              {futuros.map(l => (
                <LembreteCard key={l.id} lembrete={l} userId={userId} onConcluir={concluirLembrete} tipo="futuro" />
              ))}
            </div>
          )}

          {/* Concluídos */}
          {filtro === 'todos' && concluidos.length > 0 && (
            <div>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#22c55e', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <Check size={12} /> CONCLUÍDOS ({concluidos.length})
              </span>
              {concluidos.map(l => (
                <LembreteCard key={l.id} lembrete={l} userId={userId} onConcluir={concluirLembrete} tipo="concluido" />
              ))}
            </div>
          )}

          {lembretes.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#d4d4d4' }}>
              <Bell size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
              <p style={{ fontSize: '14px', margin: 0 }}>Nenhum lembrete</p>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function LembreteCard({
  lembrete: l,
  userId,
  onConcluir,
  tipo,
}: {
  lembrete: Lembrete
  userId: string
  onConcluir: (id: string) => void
  tipo: 'vencido' | 'futuro' | 'concluido'
}) {
  const dt = new Date(l.data_hora)
  const isParaMim = l.destinatario_id === userId
  const isMeuProprio = l.criador_id === userId && l.destinatario_id === userId

  return (
    <div style={{
      padding: '14px 16px', borderRadius: '14px', marginBottom: '8px',
      background: tipo === 'vencido' ? '#fef2f2' : tipo === 'concluido' ? '#f0fdf4' : '#fff',
      border: `1px solid ${tipo === 'vencido' ? '#fecaca' : tipo === 'concluido' ? '#bbf7d0' : '#f0f0f0'}`,
      transition: 'all 0.2s'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <span style={{
          fontSize: '14px', fontWeight: '600',
          color: tipo === 'concluido' ? '#a3a3a3' : '#1a1a1a',
          textDecoration: tipo === 'concluido' ? 'line-through' : 'none'
        }}>
          {l.titulo}
        </span>
        {tipo !== 'concluido' && (
          <button
            onClick={() => onConcluir(l.id)}
            title="Concluir"
            style={{
              background: '#22c55e', color: '#fff', border: 'none',
              borderRadius: '8px', width: '28px', height: '28px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0
            }}
          >
            <Check size={14} />
          </button>
        )}
      </div>

      {l.descricao && (
        <p style={{ fontSize: '12px', color: '#737373', margin: '0 0 8px 0', lineHeight: '1.4' }}>{l.descricao}</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '11px', fontWeight: '600',
          color: tipo === 'vencido' ? '#ef4444' : '#737373',
          display: 'flex', alignItems: 'center', gap: '4px'
        }}>
          <Calendar size={11} />
          {dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {!isMeuProprio && (
          <span style={{ fontSize: '11px', color: '#a3a3a3', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <User size={11} />
            {isParaMim ? `de ${l.criador_nome}` : `para ${l.destinatario_nome}`}
          </span>
        )}
        {isMeuProprio && (
          <span style={{ fontSize: '10px', color: '#d4d4d4', fontStyle: 'italic' }}>para mim</span>
        )}
        {l.recorrencia && (
          <span style={{
            fontSize: '10px', color: '#8b5cf6', fontWeight: '600',
            display: 'flex', alignItems: 'center', gap: '3px',
            background: '#f5f3ff', padding: '2px 8px', borderRadius: '6px'
          }}>
            <Repeat size={10} /> {l.recorrencia}
          </span>
        )}
      </div>
    </div>
  )
}
