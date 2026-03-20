import { NextResponse } from 'next/server'
import { fetchProjectUsers } from '@/lib/tarefas/vikunja'

export async function GET() {
  try {
    const users = await fetchProjectUsers()
    return NextResponse.json(users)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
