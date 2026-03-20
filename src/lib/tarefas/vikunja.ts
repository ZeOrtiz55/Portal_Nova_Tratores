// Vikunja API client — server-only (used by API routes)

let cachedToken: string | null = null
let tokenExpiry = 0

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const res = await fetch(`${process.env.VIKUNJA_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.VIKUNJA_USERNAME,
      password: process.env.VIKUNJA_PASSWORD,
    }),
  })

  if (!res.ok) throw new Error('Vikunja login failed: ' + (await res.text()))
  const data = await res.json()
  cachedToken = data.token
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000 // 23h
  return cachedToken!
}

export async function vikunjaFetch(path: string, options: RequestInit = {}) {
  let token = await getToken()
  const base = process.env.VIKUNJA_BASE_URL

  let res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })

  // Token expirou — re-login
  if (res.status === 401) {
    cachedToken = null
    token = await getToken()
    res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    })
  }

  return res
}

// ---------- Helpers ----------

const projectId = () => process.env.VIKUNJA_PROJECT_ID || '17'
const viewId = () => process.env.VIKUNJA_VIEW_ID || '81'

export async function fetchAllTasks() {
  const res = await vikunjaFetch(
    `/projects/${projectId()}/views/${viewId()}/tasks?per_page=200&filter=done = false || done = true`
  )
  if (!res.ok) throw new Error('Failed to fetch tasks')
  return res.json()
}

export async function fetchTask(id: number) {
  const res = await vikunjaFetch(`/tasks/${id}`)
  if (!res.ok) throw new Error('Failed to fetch task')
  return res.json()
}

export async function createTask(body: {
  title: string
  description?: string
  due_date?: string
  priority?: number
  assignees?: { id: number }[]
}) {
  const res = await vikunjaFetch(`/projects/${projectId()}/tasks`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to create task: ' + (await res.text()))
  return res.json()
}

export async function updateTask(id: number, body: Record<string, unknown>) {
  const res = await vikunjaFetch(`/tasks/${id}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to update task: ' + (await res.text()))
  return res.json()
}

export async function assignUserToTask(taskId: number, vikunjaUserId: number) {
  const res = await vikunjaFetch(`/tasks/${taskId}/assignees`, {
    method: 'PUT',
    body: JSON.stringify({ user_id: vikunjaUserId }),
  })
  if (!res.ok) throw new Error('Failed to assign user')
  return res.json()
}

export async function fetchProjectUsers() {
  const res = await vikunjaFetch(`/projects/${projectId()}/projectusers?s=`)
  if (!res.ok) throw new Error('Failed to fetch project users')
  return res.json()
}
