import { useEffect, useMemo, useState } from 'react'
import { Plus, Upload, KeyRound, Download, ChevronDown, ChevronRight, GraduationCap, Copy, Check } from 'lucide-react'
import { api } from './api'
import { Modal, Chip, Err, Avatar, Empty, Pill, usd, num, downloadCsv, fmt } from './ui'

/* ---------- passwords ---------- */
function PwForm({ onDone, onCancel, currentLabel = 'Current password' }) {
  const [cur, setCur] = useState(''), [nw, setNw] = useState(''), [cf, setCf] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const ok = cur && nw.length >= 8 && nw === cf
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try { onDone((await api('/me/password', { method: 'POST', json: { current_password: cur, new_password: nw } })).user) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>{currentLabel}<input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" autoFocus /></label>
      <label>New password <small>(at least 8 characters)</small><input type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password" /></label>
      <label>Confirm new password<input type="password" value={cf} onChange={e => setCf(e.target.value)} autoComplete="new-password" /></label>
      {cf && nw !== cf && <p className="err">Passwords do not match</p>}
      <Err msg={err} />
      <div className="row end">{onCancel && <button type="button" onClick={onCancel}>Cancel</button>}<button className="primary" disabled={!ok || busy}>{busy ? 'Saving…' : 'Update password'}</button></div>
    </form>
  )
}
export const ChangePasswordModal = ({ close, onDone }) => <Modal title="Change password" close={close}><PwForm onDone={onDone} onCancel={close} /></Modal>
export const ForcePassword = ({ user, onDone, onLogout }) => (
  <main className="login single"><div className="card login-form">
    <GraduationCap size={34} color="#2563eb" /><h2>Set a new password</h2>
    <p className="muted">Hi {user.name.split(' ')[0]}, for your security please replace your temporary password before continuing.</p>
    <PwForm onDone={onDone} currentLabel="Temporary password" />
    <button className="link" onClick={onLogout}>Sign out</button>
  </div></main>
)

/* ---------- users ---------- */
function Credentials({ title, rows, skipped = [], close }) {
  const [copied, setCopied] = useState(-1)
  const copy = (i, r) => { navigator.clipboard?.writeText(`Username: ${r.username}\nPassword: ${r.password}`); setCopied(i); setTimeout(() => setCopied(-1), 1500) }
  return (
    <Modal title={title} close={close} wide>
      <p className="note">Passwords are shown <b>only once</b>. Each user must choose a new password at first sign-in. Download the list now.</p>
      {rows.length > 0 && <div className="table-card scroll"><table><thead><tr><th>Name</th><th>Username</th><th>Temporary password</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.name}</td><td className="mono">{r.username}</td><td className="mono">{r.password}</td><td><button className="icon" onClick={() => copy(i, r)} aria-label="Copy credentials">{copied === i ? <Check size={16} /> : <Copy size={16} />}</button></td></tr>)}</tbody></table></div>}
      {skipped.length > 0 && <div className="skipped"><h4>Skipped ({skipped.length})</h4><ul>{skipped.map((s, i) => <li key={i}>Row {s.row}{s.name && ` · ${s.name}`}: {s.reason}</li>)}</ul></div>}
      <div className="row end"><button onClick={close}>Done</button>
        {rows.length > 0 && <button className="primary" onClick={() => downloadCsv('curiosity-credentials.csv', [['name', 'username', 'temporary_password'], ...rows.map(r => [r.name, r.username, r.password])])}><Download size={15} />Download CSV</button>}</div>
    </Modal>
  )
}

function AddUser({ me, close, done }) {
  const [f, setF] = useState({ name: '', username: '', role: 'student', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api('/users', { method: 'POST', json: f }); done([{ name: r.user.name, username: r.user.username, password: r.password }]) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Add user" close={close}><form className="stack" onSubmit={submit}>
      <label>Full name<input required value={f.name} maxLength={120} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></label>
      {me.role === 'admin' && <label>Role<select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Administrator</option></select></label>}
      <label>Username <small>(optional — generated from the name)</small><input value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
      <label>Temporary password <small>(optional — generated if empty)</small><input value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
      <Err msg={err} /><div className="row end"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy || !f.name.trim()}>{busy ? 'Creating…' : 'Create user'}</button></div>
    </form></Modal>
  )
}

function UploadStudents({ close, done }) {
  const [file, setFile] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    const fd = new FormData(); fd.append('file', file)
    try { done(await api('/users/upload', { method: 'POST', form: fd })) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Upload students (CSV)" close={close}><form className="stack" onSubmit={submit}>
      <p className="note">Columns: <b>name</b> (required), <b>username</b> and <b>password</b> (both optional — generated when blank). Up to 500 rows.</p>
      <button type="button" onClick={() => downloadCsv('students-template.csv', [['name', 'username', 'password'], ['Asha Rao', '', ''], ['Ben Cole', 'ben.cole', '']])}><Download size={15} />Download template</button>
      <label>CSV file<input type="file" accept=".csv,text/csv" required onChange={e => setFile(e.target.files[0])} /></label>
      <Err msg={err} /><div className="row end"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy || !file}>{busy ? 'Uploading…' : 'Create accounts'}</button></div>
    </form></Modal>
  )
}

export function UsersPage({ me }) {
  const isAdmin = me.role === 'admin'
  const [list, setList] = useState(null), [role, setRole] = useState(''), [q, setQ] = useState(''), [err, setErr] = useState(''), [modal, setModal] = useState(null), [creds, setCreds] = useState(null)
  const load = () => api('/users?' + new URLSearchParams({ role, q })).then(setList).catch(x => setErr(x.message))
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [role, q])
  const toggle = async x => { try { await api('/users/' + x.id, { method: 'PATCH', json: { active: !x.active } }); load() } catch (e) { setErr(e.message) } }
  const reset = async x => {
    if (!confirm(`Reset the password for ${x.name}? They will be signed out and must choose a new password.`)) return
    try { const r = await api(`/users/${x.id}/reset-password`, { method: 'POST' }); setCreds({ title: 'Password reset', rows: [r] }) } catch (e) { setErr(e.message) }
  }
  const created = (rows, skipped = []) => { setModal(null); setCreds({ title: rows.length === 1 && !skipped.length ? 'Account created' : `${rows.length} account${rows.length === 1 ? '' : 's'} created`, rows, skipped }); load() }
  return (
    <>
      <div className="page-head"><div><h1>{isAdmin ? 'Users' : 'Students'}</h1><p className="muted">{isAdmin ? 'Manage administrators, teachers and students.' : 'Create student accounts and reset passwords.'}</p></div>
        <div className="row"><button onClick={() => setModal('upload')}><Upload size={15} />Upload students</button><button className="primary" onClick={() => setModal('add')}><Plus size={16} />Add {isAdmin ? 'user' : 'student'}</button></div></div>
      <div className="toolbar">
        {isAdmin && <div className="tabs-pill">{[['', 'All'], ['admin', 'Admins'], ['teacher', 'Teachers'], ['student', 'Students']].map(([k, l]) => <button key={k} className={role === k ? 'on' : ''} onClick={() => setRole(k)}>{l}</button>)}</div>}
        <input className="search" placeholder="Search name or username…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <Err msg={err} />
      {!list ? <p className="muted">Loading…</p> : !list.length ? <Empty icon={<GraduationCap size={28} />} title="No users found" text="Add an account or upload a CSV of students." /> :
        <div className="card table-card"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>{list.map(x => <tr key={x.id}>
            <td><div className="row"><Avatar name={x.name} size={30} />{x.name}</div></td><td className="mono">{x.username}</td>
            <td><Chip t={x.role} c={x.role === 'admin' ? 'low' : x.role === 'teacher' ? 'info' : 'good'} /></td>
            <td>{x.active ? <Chip t="Active" c="good" /> : <Chip t="Disabled" c="mid" />}{x.must_change_password && <small className="muted"> · temp password</small>}</td>
            <td className="muted">{fmt(x.created_at)}</td>
            <td className="actions">{x.id !== me.id && <><button onClick={() => reset(x)}><KeyRound size={14} />Reset password</button><button onClick={() => toggle(x)}>{x.active ? 'Disable' : 'Enable'}</button></>}</td></tr>)}</tbody></table></div>}
      {modal === 'add' && <AddUser me={me} close={() => setModal(null)} done={created} />}
      {modal === 'upload' && <UploadStudents close={() => setModal(null)} done={r => created(r.created, r.skipped)} />}
      {creds && <Credentials {...creds} close={() => setCreds(null)} />}
    </>
  )
}

/* ---------- AI cost ---------- */
const Note = ({ p }) => <p className="note">Costs use the current price list ({Object.entries(p.models).map(([m, x]) => `${m}: ${usd(x.input_per_m)} in · ${usd(x.cached_per_m)} cached · ${usd(x.output_per_m)} out`).join(' | ')} per 1M tokens), so editing prices in Settings re-prices the whole report. The PDF is sent once per student; later turns read it from the prompt cache at the cached rate. Actual invoices may differ.</p>
const Stats = ({ t, extra }) => (
  <div className="stats">
    <div className="card stat"><span>Total AI cost</span><b>{usd(t.cost)}</b></div>
    <div className="card stat"><span>Input tokens</span><b>{num(t.input_tokens)}</b></div>
    <div className="card stat"><span>Output tokens</span><b>{num(t.output_tokens)}</b></div>
    <div className="card stat"><span>Cache hit rate</span><b>{t.input_tokens ? Math.round(100 * t.cached_tokens / t.input_tokens) + '%' : '—'}</b></div>
    {extra}
  </div>
)

function CostRows({ rows }) {
  const sorted = [...rows].sort((a, b) => b.cost - a.cost)
  return (
    <div className="table-card scroll"><table><thead><tr><th>User</th><th>Model</th><th className="num">Prompts</th><th className="num">Input tokens</th><th className="num">Cached</th><th className="num">Output tokens</th><th className="num">Chat</th><th className="num">Analysis</th><th className="num">Total</th></tr></thead>
      <tbody>{sorted.map((r, i) => <tr key={i} className={r.user_id ? '' : 'muted'}><td>{r.user_id ? <><b>{r.user}</b> <small className="muted">{r.username}</small></> : <i>Class summary</i>}</td>
        <td><span className="mono">{r.model}</span>{!r.priced && <> <Chip t="no price" c="low" /></>}</td>
        <td className="num">{r.messages || '—'}</td><td className="num">{num(r.input_tokens)}</td><td className="num">{r.input_tokens ? Math.round(100 * r.cached_tokens / r.input_tokens) + '%' : '—'}</td><td className="num">{num(r.output_tokens)}</td>
        <td className="num">{usd(r.chat_cost)}</td><td className="num">{usd(r.analysis_cost)}</td><td className="num"><b>{usd(r.cost)}</b></td></tr>)}</tbody></table></div>
  )
}
const exportRows = rows => [['activity', 'user', 'username', 'model', 'prompts', 'input_tokens', 'cached_tokens', 'output_tokens', 'chat_cost_usd', 'analysis_cost_usd', 'total_cost_usd'],
  ...rows.map(r => [r.activity, r.user, r.username, r.model, r.messages, r.input_tokens, r.cached_tokens, r.output_tokens, r.chat_cost.toFixed(6), r.analysis_cost.toFixed(6), r.cost.toFixed(6)])]

export function ActivityCost({ id }) {
  const [d, setD] = useState(null), [err, setErr] = useState('')
  useEffect(() => { api(`/activities/${id}/costs`).then(setD).catch(x => setErr(x.message)) }, [id])
  if (!d) return <Err msg={err} />
  const students = new Set(d.rows.filter(r => r.user_id).map(r => r.user_id)).size
  return (
    <>
      <Stats t={d.totals} extra={<div className="card stat"><span>Avg cost per student</span><b>{students ? usd(d.rows.filter(r => r.user_id).reduce((t, r) => t + r.cost, 0) / students) : '—'}</b></div>} />
      {d.rows.length ? <><div className="card table-card"><CostRows rows={d.rows} /></div>
        <div className="row between"><Note p={d.pricing} /><button onClick={() => downloadCsv('curiosity-activity-costs.csv', exportRows(d.rows))}><Download size={15} />Export CSV</button></div></>
        : <Empty icon={<GraduationCap size={28} />} title="No AI usage yet" text="Costs appear as soon as students chat." />}
    </>
  )
}

export function CostReport() {
  const [d, setD] = useState(null), [open, setOpen] = useState({}), [err, setErr] = useState('')
  useEffect(() => { api('/reports/costs').then(setD).catch(x => setErr(x.message)) }, [])
  const groups = useMemo(() => {
    const m = {}
    ;(d?.rows || []).forEach(r => { const g = m[r.activity_id] ||= { id: r.activity_id, title: r.activity, rows: [], cost: 0, i: 0, o: 0, users: new Set(), models: new Set() }; g.rows.push(r); g.cost += r.cost; g.i += r.input_tokens; g.o += r.output_tokens; g.models.add(r.model); if (r.user_id) g.users.add(r.user_id) })
    return Object.values(m).sort((a, b) => b.cost - a.cost)
  }, [d])
  if (!d) return <Err msg={err} />
  return (
    <>
      <div className="page-head"><div><h1>AI cost report</h1><p className="muted">Spend per activity and per student, from every AI call.</p></div>
        <button onClick={() => downloadCsv('curiosity-cost-report.csv', exportRows(d.rows))} disabled={!d.rows.length}><Download size={15} />Export CSV</button></div>
      <Stats t={d.totals} extra={<div className="card stat"><span>AI calls</span><b>{num(d.totals.calls)}</b></div>} />
      {!groups.length ? <Empty icon={<GraduationCap size={28} />} title="No AI usage yet" text="Costs appear as soon as students start chatting." /> :
        <div className="stack">{groups.map(g => (
          <div className="card cost-group" key={g.id}>
            <button className="group-head" onClick={() => setOpen({ ...open, [g.id]: !open[g.id] })}>
              {open[g.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<span className="gt"><b>{g.title}</b><small>{g.users.size} student{g.users.size === 1 ? '' : 's'} · {num(g.i)} in / {num(g.o)} out tokens · {[...g.models].join(', ')}</small></span><Chip t={usd(g.cost)} c="info" />
            </button>
            {open[g.id] && <CostRows rows={g.rows} />}
          </div>))}</div>}
      <Note p={d.pricing} />
    </>
  )
}

/* ---------- per-activity settings ---------- */
export function ActivitySettings({ a, close, done }) {
  const [lim, setLim] = useState(a.max_prompts || 0), [dl, setDl] = useState(a.allow_download), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await api(`/activities/${a.id}`, { method: 'PATCH', json: { max_prompts: Math.max(0, parseInt(lim) || 0), allow_download: dl } }); done() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Activity settings" close={close}><form className="stack" onSubmit={submit}>
      <label>Prompt limit per student <small>(0 = unlimited)</small><input type="number" min={0} max={500} value={lim} onChange={e => setLim(e.target.value)} /></label>
      <p className="note">Each student can send at most this many prompts. Lower limits keep AI cost predictable.</p>
      <label className="check"><input type="checkbox" checked={dl} onChange={e => setDl(e.target.checked)} />Students can download the activity PDF</label>
      <Err msg={err} /><div className="row end"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form></Modal>
  )
}

/* ---------- admin: model + prices ---------- */
export function SettingsPage() {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState('')
  useEffect(() => { api('/settings').then(setD).catch(x => setErr(x.message)) }, [])
  if (!d) return <Err msg={err} />
  const set = p => setD({ ...d, ...p }), setPrice = (i, k, v) => set({ prices: d.prices.map((p, j) => j === i ? { ...p, [k]: v } : p) })
  const names = [...new Set([d.model, ...d.prices.map(p => p.model.trim())].filter(Boolean))]
  const save = async () => {
    setBusy('save'); setErr(''); setMsg('')
    try { setD(await api('/settings', { method: 'PUT', json: { model: d.model, max_output_tokens: parseInt(d.max_output_tokens) || 0, reasoning_effort: d.reasoning_effort,
      prices: d.prices.map(p => ({ model: p.model.trim(), input_per_m: +p.input_per_m || 0, cached_per_m: +p.cached_per_m || 0, output_per_m: +p.output_per_m || 0 })) } })); setMsg('Settings saved') }
    catch (x) { setErr(x.message) } finally { setBusy('') }
  }
  const test = async () => { setBusy('test'); setErr(''); setMsg(''); try { const r = await api('/settings/test?model=' + encodeURIComponent(d.model), { method: 'POST' }); r.ok ? setMsg(`✓ ${d.model} responded`) : setErr(r.message) } catch (x) { setErr(x.message) } finally { setBusy('') } }
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Choose the AI model and keep prices current so the cost report stays accurate.</p></div>
        <button className="primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button></div>
      <Err msg={err} />{msg && <p className="ok">{msg}</p>}
      <div className="stack">
        <div className="card stack"><h3>Active model</h3>
          <div className="row"><select value={d.model} onChange={e => set({ model: e.target.value })} style={{ maxWidth: 320 }}>{names.map(n => <option key={n}>{n}</option>)}</select>
            <button onClick={test} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test model'}</button></div>
          <p className="note">Used for every new chat, prompt analysis and summary. Existing conversations simply continue on the new model. The cost report shows which model each call used.</p></div>
        <div className="card stack"><h3>Price list <small className="muted">(USD per 1M tokens)</small></h3>
          <div className="table-card"><table><thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead>
            <tbody>{d.prices.map((p, i) => <tr key={i}><td><input className="mono" value={p.model} onChange={e => setPrice(i, 'model', e.target.value)} /></td>
              {['input_per_m', 'cached_per_m', 'output_per_m'].map(k => <td key={k}><input type="number" min={0} step="0.001" value={p[k]} onChange={e => setPrice(i, k, e.target.value)} /></td>)}</tr>)}</tbody></table></div>
          <div className="row between"><button onClick={() => set({ prices: [...d.prices, { model: '', input_per_m: 0, cached_per_m: 0, output_per_m: 0 }] })}><Plus size={15} />Add model</button>
            <p className="note">Editing a price re-prices the whole report, including past usage.</p></div></div>
        <div className="card stack"><h3>Cost controls</h3>
          <label>Max output tokens per chat reply <small>(0 = no limit)</small><input type="number" min={0} max={128000} value={d.max_output_tokens} onChange={e => set({ max_output_tokens: e.target.value })} style={{ maxWidth: 220 }} /></label>
          <label>Reasoning effort for chat replies <small>(lower = cheaper &amp; faster)</small><select value={d.reasoning_effort} onChange={e => set({ reasoning_effort: e.target.value })} style={{ maxWidth: 220 }}>
            {[['', 'Model default'], ['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <p className="note">Reasoning tokens count as output. If the output limit is too low for a reasoning model, replies can be cut off — raise it if you see that error. Not every model accepts every effort level; use “Test model” after changing models.</p></div>
      </div>
    </>
  )
}
