let token = localStorage.getItem('token')
export const setToken = t => { token = t; t ? localStorage.setItem('token', t) : localStorage.removeItem('token') }
export async function api(path, { method = 'GET', json, form } = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: { ...(token && { Authorization: 'Bearer ' + token }), ...(json && { 'Content-Type': 'application/json' }) },
    body: form || (json && JSON.stringify(json)),
  })
  if (!r.ok) {
    let d = 'Something went wrong'
    try { d = (await r.json()).detail } catch {}
    if (r.status === 401 && path !== '/login') window.dispatchEvent(new Event('auth-expired'))
    const e = new Error(typeof d === 'string' ? d : 'Please check your input')
    e.status = r.status; throw e
  }
  return r.json()
}

export async function apiBlob(path) {
  const r = await fetch('/api' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
  if (!r.ok) {
    let d = 'Download failed'
    try { d = (await r.json()).detail } catch {}
    throw new Error(typeof d === 'string' ? d : 'Download failed')
  }
  return r.blob()
}
