import { NextRequest, NextResponse } from 'next/server'
import { fetchAllTasks, createTask, assignUserToTask } from '@/lib/tarefas/vikunja'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const filter = searchParams.get('filter') || 'todas' // minhas | enviadas | todas
    const vikunjaUserId = searchParams.get('vikunjaUserId') // Vikunja user ID

    const allTasks = await fetchAllTasks()

    let tasks = allTasks
    if (vikunjaUserId && filter === 'minhas') {
      const vid = parseInt(vikunjaUserId)
      tasks = allTasks.filter((t: any) =>
        t.assignees?.some((a: any) => a.id === vid)
      )
    } else if (vikunjaUserId && filter === 'enviadas') {
      const vid = parseInt(vikunjaUserId)
      tasks = allTasks.filter((t: any) => t.created_by?.id === vid)
    }

    // Enriquecer com status calculado
    const now = new Date()
    const enriched = tasks.map((t: any) => {
      let status = 'pendente'
      if (t.done) status = 'concluida'
      else if (t.due_date && t.due_date !== '0001-01-01T00:00:00Z' && new Date(t.due_date) < now) {
        status = 'atrasada'
      }
      return { ...t, computed_status: status }
    })

    // Ordenar: atrasadas primeiro, depois por due_date
    enriched.sort((a: any, b: any) => {
      const order = { atrasada: 0, pendente: 1, concluida: 2 }
      const diff = (order[a.computed_status as keyof typeof order] ?? 1) - (order[b.computed_status as keyof typeof order] ?? 1)
      if (diff !== 0) return diff
      const aDate = a.due_date === '0001-01-01T00:00:00Z' ? '9999' : a.due_date
      const bDate = b.due_date === '0001-01-01T00:00:00Z' ? '9999' : b.due_date
      return aDate.localeCompare(bDate)
    })

    return NextResponse.json(enriched)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, description, due_date, priority, assignee_vikunja_id } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Título obrigatório' }, { status: 400 })
    }

    const taskBody: any = {
      title: title.trim(),
      description: description || '',
      priority: priority || 0,
    }

    if (due_date) {
      taskBody.due_date = new Date(due_date).toISOString()
    }

    const created = await createTask(taskBody)

    // Atribuir o usuário
    if (assignee_vikunja_id && created.id) {
      try {
        await assignUserToTask(created.id, assignee_vikunja_id)
      } catch (e) {
        console.error('Erro ao atribuir usuário à tarefa:', e)
      }
    }

    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
