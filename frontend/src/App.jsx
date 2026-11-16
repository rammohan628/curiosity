import { useEffect, useRef, useState } from 'react'
import { Download, Menu, PanelLeftClose, Settings, LayoutGrid, LogOut, Play, Square, Paperclip, SendHorizontal, Clock, Sparkles, Users, Plus, Copy, Check, X, GraduationCap, MessageSquare, BarChart3, RefreshCw, KeyRound, DollarSign } from 'lucide-react'
import { api, setToken } from './api'
import { downloadPdf, fmt, initials, tone, ENG, PL, useNow, Md, Pill, Chip, Err, Avatar, Back, Ring, Bar, Empty } from './ui'
import { ForcePassword, ChangePasswordModal, UsersPage, CostReport, ActivityCost, ActivitySettings, SettingsPage } from './Admin'

function Login({ onDone }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const go = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api('/login', { method: 'POST', json: { username, password } }); setToken(r.token); onDone(r.user) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <main className="login"><div className="login-art"><GraduationCap size={44} /><h1>Curiosity</h1><p>Turn every activity PDF into a private AI tutor — and see how deeply each student really learns.</p></div>
      <form className="card login-form" onSubmit={go}>
        <h2>Sign in</h2><p className="muted">Use the username and password given to you</p>
        <label>Username<input value={username} onChange={e => setUsername(e.target.value)} required maxLength={60} autoFocus autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        <Err msg={err} /><button className="primary" disabled={busy || !username.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form></main>
  )
}

function CreateModal({ close, onCreated }) {
  const [f, setF] = useState({ title: '', description: '', duration_min: 30, max_prompts: 0, allow_download: true }), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    const fd = new FormData(); Object.entries(f).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file)
    try { await api('/activities', { method: 'POST', form: fd }); onCreated(); close() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <form className="modal card" onSubmit={submit}>
        <div className="row between"><h2>New activity</h2><button type="button" className="icon" onClick={close} aria-label="Close"><X size={18} /></button></div>
        <label>Title<input required maxLength={200} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label>Note for students <small>(optional)</small><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        <label>Duration (minutes)<input type="number" min={1} max={600} required value={f.duration_min} onChange={e => setF({ ...f, duration_min: e.target.value })} /></label>
        <label>Prompt limit per student <small>(0 = unlimited)</small><input type="number" min={0} max={500} value={f.max_prompts} onChange={e => setF({ ...f, max_prompts: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.allow_download} onChange={e => setF({ ...f, allow_download: e.target.checked })} />Students can download the PDF</label>
        <label>Activity PDF<input type="file" accept="application/pdf" required onChange={e => setFile(e.target.files[0])} /></label>
        <Err msg={err} />
        <div className="row end"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy || !file}>{busy ? 'Uploading to OpenAI…' : 'Create activity'}</button></div>
      </form>
    </div>
  )
}

function Home({ user, open }) {
  const [list, setList] = useState(null), [err, setErr] = useState(''), [modal, setModal] = useState(false)
  const load = () => api('/activities').then(setList).catch(x => setErr(x.message))
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])
  const act = async (id, what) => { try { await api(`/activities/${id}/${what}`, { method: 'POST' }); load() } catch (x) { setErr(x.message) } }
  const teacher = user.role !== 'student'
  const dl = async a => { try { await downloadPdf(a) } catch (x) { setErr(x.message) } }
  return (
    <>
      <div className="page-head"><div><h1>Activities</h1><p className="muted">{teacher ? 'Create activities, start them, and review every student conversation.' : 'Open an activity to ask questions about its material.'}</p></div>
        {teacher && <button className="primary" onClick={() => setModal(true)}><Plus size={16} />New activity</button>}</div>
      <Err msg={err} />
      {!list ? <p className="muted">Loading…</p> : !list.length ? <Empty icon={<Paperclip size={28} />} title={teacher ? 'No activities yet' : 'Nothing assigned yet'} text={teacher ? 'Create one with a PDF to get started.' : 'Your teacher will start an activity soon.'} /> :
        <div className="grid">{list.map(a => (
          <article className="card activity" key={a.id}>
            <div className="row between"><span className="file-ic"><Paperclip size={18} /></span><Pill s={a.status} /></div>
            <h3>{a.title}</h3>
            <p className="muted clamp">{a.description || 'No note from the teacher.'}</p>
            <p className="meta"><Clock size={13} /> {a.duration_min} min · {a.file_name}{a.max_prompts ? <> · {a.max_prompts} prompts max</> : null}</p>
            <div className="row">
              {teacher ? <>
                {a.status === 'Scheduled' && <button className="primary" onClick={() => act(a.id, 'start')}><Play size={15} />Start</button>}
                {a.status === 'In Progress' && <button onClick={() => act(a.id, 'stop')}><Square size={14} />Stop</button>}
                <button onClick={() => open(a.id)}><Users size={15} />Conversations</button>
              </> : a.status === 'Scheduled' ? <button disabled>Waiting for teacher</button>
                : <button className="primary" onClick={() => open(a.id)}><MessageSquare size={15} />{a.status === 'In Progress' ? 'Open chat' : 'View chat'}</button>}
              {a.has_file && (teacher || a.allow_download) && <button onClick={() => dl(a)}><Download size={15} />PDF</button>}
            </div>
          </article>))}</div>}
      {modal && <CreateModal close={() => setModal(false)} onCreated={load} />}
    </>
  )
}

function Bubble({ m, name, tag }) {
  const ai = m.role === 'assistant'
  return (
    <div className={'msg ' + (ai ? 'ai' : 'me')}>
      {ai ? <span className="avatar bot"><Sparkles size={15} /></span> : <Avatar name={name} />}
      <div className="msg-main">
        <div className="who"><b>{ai ? 'AI Assistant' : name}</b>{ai && <span className="ref"><Paperclip size={11} />Attachment referenced</span>}<time>{fmt(m.created_at)}</time></div>
        <div className="body">{ai ? <Md>{m.content}</Md> : <p>{m.content}</p>}</div>
        {tag && <div className="tag"><Chip t={PL[tag.label][0]} c={PL[tag.label][1]} />{tag.note && <span>{tag.note}</span>}</div>}
      </div>
    </div>
  )
}

const STARTERS = ['Summarise the key ideas in this activity', 'Explain the hardest concept, step by step', 'Quiz me with a challenging question']

function StudentChat({ id, user, back }) {
  const [st, setSt] = useState(null), [text, setText] = useState(''), [sending, setSending] = useState(false), [err, setErr] = useState(''), [pending, setPending] = useState(null)
  const end = useRef(), now = useNow()
  const dl = async a => { try { await downloadPdf(a) } catch (x) { setErr(x.message) } }
  useEffect(() => { api(`/activities/${id}/chat`).then(setSt).catch(x => setErr(x.message)) }, [id])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [st?.messages.length, pending])
  if (!st) return <><Back back={back} /><Err msg={err} /></>
  const a = st.activity, left = a.ends_at ? Math.max(0, Math.floor((new Date(a.ends_at) - now) / 1000)) : 0
  const live = st.can_send && left > 0 && !st.limit_reached
  const send = async (e, override) => {
    e?.preventDefault(); const t = (override ?? text).trim(); if (!t || sending) return
    setSending(true); setErr(''); setPending(t); setText('')
    try { setSt(await api(`/activities/${id}/chat`, { method: 'POST', json: { message: t } })) }
    catch (x) { setErr(x.message); setText(t) } finally { setSending(false); setPending(null) }
  }
  return (
    <div className="chat-page">
      <Back back={back} />
      <div className="card chat-card">
        <div className="chat-head"><div><h2>{a.title}</h2><p className="meta"><Paperclip size={13} /> {a.file_name} · {a.duration_min} min{st.max_prompts ? <> · <b>{st.prompts_left}</b> of {st.max_prompts} prompts left</> : null}
          {a.has_file && a.allow_download && <button className="link inline" onClick={() => dl(a)}><Download size={13} />Download PDF</button>}</p></div>
          <div className="right"><Pill s={left === 0 && a.status === 'In Progress' ? 'Time Elapsed' : a.status} />{live && <div className="timer"><Clock size={14} />{String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</div>}</div></div>
        <div className="thread" aria-live="polite">
          {!st.messages.length && !pending && (live ? <div className="welcome"><Sparkles size={26} /><h3>Ask anything about this activity</h3><p>Your conversation is private. Go beyond definitions — ask why and how.</p>
            <div className="starters">{STARTERS.map(s => <button key={s} onClick={() => send(null, s)}>{s}</button>)}</div></div> : <Empty icon={<MessageSquare size={28} />} title="No chat history" text="You didn't chat during this activity." />)}
          {st.messages.map(m => <Bubble key={m.id} m={m} name={user.name} />)}
          {pending && <><Bubble m={{ role: 'student', content: pending, created_at: new Date().toISOString() }} name={user.name} />
            <div className="msg ai"><span className="avatar bot"><Sparkles size={15} /></span><div className="body typing"><i /><i /><i /></div></div></>}
          <div ref={end} />
        </div>
        <Err msg={err} />
        {live ? <form className="composer" onSubmit={send}>
          <textarea rows={1} value={text} placeholder="Ask about this activity…  (Shift+Enter for a new line)" maxLength={4000} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }} />
          <button className="primary send" disabled={sending || !text.trim()} aria-label="Send"><SendHorizontal size={18} /></button></form>
          : <p className="banner">{st.can_send && left > 0 && st.limit_reached ? `You've used all ${st.max_prompts} prompts for this activity.` : 'Session ended. Chat history is read-only.'}</p>}
      </div>
    </div>
  )
}

function Analysis({ s }) {
  const an = s.analysis, [copied, setCopied] = useState(false)
  if (!an) return <div className="card side-panel"><Empty icon={<BarChart3 size={26} />} title="Not analysed yet" text="Run “Analyse prompts” to score this student's questions." /></div>
  const copy = () => { navigator.clipboard?.writeText(an.feedback_to_student); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const List = ({ t, items, c }) => items.length ? <div className="sec"><h4>{t}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null
  const Chips = ({ t, items, c }) => items.length ? <div className="sec"><h4>{t}</h4><div className="chips">{items.map((x, i) => <Chip key={i} t={x} c={c} />)}</div></div> : null
  return (
    <div className="card side-panel">
      {s.stale && <p className="stale">New messages since this analysis. Re-run to refresh.</p>}
      <div className="score-top"><Ring v={an.overall} size={76} /><div><Chip t={ENG[an.engagement][0]} c={ENG[an.engagement][1]} /><p className="muted small">Overall prompt quality</p></div></div>
      <Bar label="Relevance to assignment" v={an.relevance} /><Bar label="Depth of inquiry" v={an.depth} /><Bar label="Focus on task" v={an.focus} />
      <p className="summary">{an.summary}</p>
      <List t="Strengths" items={an.strengths} /><List t="Concerns" items={an.concerns} />
      <Chips t="Concepts explored" items={an.concepts_explored} c="good" /><Chips t="Not yet touched" items={an.concepts_missed} c="mid" />
      {an.feedback_to_student && <div className="sec fb"><div className="row between"><h4>Suggested feedback to student</h4><button className="icon" onClick={copy} aria-label="Copy feedback">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><p>{an.feedback_to_student}</p></div>}
    </div>
  )
}

function Monitor({ id, back }) {
  const [d, setD] = useState(null), [showSet, setShowSet] = useState(false), [sel, setSel] = useState(null), [tab, setTab] = useState('overview'), [busy, setBusy] = useState(''), [rep, setRep] = useState(''), [err, setErr] = useState('')
  const load = () => api(`/activities/${id}/sessions`).then(setD).catch(x => setErr(x.message))
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [id])
  const analyse = async force => { setBusy('an'); setErr(''); try { const r = await api(`/activities/${id}/analysis${force ? '?force=true' : ''}`, { method: 'POST' }); setD(r); if (r.errors?.length) setErr('Some analyses failed: ' + r.errors[0]) } catch (x) { setErr(x.message) } finally { setBusy('') } }
  const report = async () => { setBusy('rep'); setErr(''); try { setRep((await api(`/activities/${id}/insights`)).report) } catch (x) { setErr(x.message) } finally { setBusy('') } }
  if (!d) return <><Back back={back} /><Err msg={err} /></>
  const ss = d.sessions, cur = ss.find(s => s.session_id === sel) || ss[0]
  const scored = ss.filter(s => s.analysis), avg = scored.length ? scored.reduce((t, s) => t + s.analysis.overall, 0) / scored.length : null
  const pending = ss.filter(s => !s.analysis || s.stale).length
  const ranked = [...ss].sort((a, b) => (b.analysis?.overall ?? -1) - (a.analysis?.overall ?? -1))
  const go = s => { setSel(s.session_id); setTab('chats') }
  return (
    <>
      <Back back={back} />
      <div className="page-head"><div><h1>{d.activity.title}</h1><p className="muted"><Pill s={d.activity.status} /> <span className="dot" /> {ss.length} student{ss.length === 1 ? '' : 's'} chatting</p></div>
        <div className="row"><button onClick={() => setShowSet(true)}><Settings size={15} />Settings</button><button className="primary" onClick={() => analyse(false)} disabled={busy || !ss.length || !pending}>{busy === 'an' ? <><RefreshCw size={15} className="spin" />Analysing…</> : <><BarChart3 size={15} />Analyse prompts{pending ? ` (${pending})` : ''}</>}</button></div></div>
      <div className="tabs">{[['overview', 'Overview'], ['chats', 'Conversations'], ['cost', 'AI cost']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <Err msg={err} />
      {!ss.length ? <Empty icon={<Users size={28} />} title="No conversations yet" text="Students will appear here as soon as they send their first question." /> : tab === 'cost' ? <ActivityCost id={id} /> : tab === 'overview' ? <>
        <div className="stats">
          <div className="card stat"><span>Students</span><b>{ss.length}</b></div>
          <div className="card stat"><span>Average prompt quality</span><b>{avg == null ? '—' : avg.toFixed(1)}<small>/10</small></b></div>
          <div className="card stat"><span>Deep learners</span><b>{scored.filter(s => s.analysis.engagement === 'deep').length}</b></div>
          <div className="card stat warn"><span>Need attention</span><b>{scored.filter(s => ['off_task', 'surface'].includes(s.analysis.engagement)).length}</b></div>
        </div>
        <div className="card table-card"><table><thead><tr><th>Student</th><th>Messages</th><th>Relevance</th><th>Depth</th><th>Focus</th><th>Score</th><th>Engagement</th><th /></tr></thead>
          <tbody>{ranked.map(s => { const a = s.analysis; return (
            <tr key={s.session_id}><td><div className="row"><Avatar name={s.student} size={30} />{s.student}</div></td><td>{s.message_count}</td>
              {a ? <><td>{a.relevance}</td><td>{a.depth}</td><td>{a.focus}</td><td><Chip t={a.overall.toFixed(1)} c={tone(a.overall)} /></td><td><Chip t={ENG[a.engagement][0]} c={ENG[a.engagement][1]} />{s.stale && <small className="muted"> outdated</small>}</td></> : <td colSpan={5} className="muted">Not analysed</td>}
              <td><button onClick={() => go(s)}>Open</button></td></tr>) })}</tbody></table></div>
        <div className="card report"><div className="row between"><h3>Class topic summary</h3><button onClick={report} disabled={busy}>{busy === 'rep' ? 'Summarising…' : 'Generate'}</button></div>
          {rep ? <Md>{rep}</Md> : <p className="muted">Which topics students asked about, what confused them, and suggested follow-up.</p>}</div>
      </> : (
        <div className="monitor">
          <nav className="members card"><h4>Members</h4>{ranked.map(s => <button key={s.session_id} className={s === cur ? 'on' : ''} onClick={() => setSel(s.session_id)}>
            <Avatar name={s.student} size={32} /><span className="mname"><b>{s.student}</b><small>{s.message_count} messages</small></span>{s.analysis && <Chip t={s.analysis.overall.toFixed(1)} c={tone(s.analysis.overall)} />}</button>)}</nav>
          <div className="card transcript"><div className="t-head"><Avatar name={cur.student} /><div><b>{cur.student}</b><p className="meta">{cur.message_count} messages</p></div></div>
            <div className="thread">{(() => { let n = 0; return cur.messages.map(m => { const tag = m.role === 'student' ? cur.analysis?.prompts.find(p => p.n === ++n) : null; return <Bubble key={m.id} m={m} name={cur.student} tag={tag} /> }) })()}</div></div>
          <Analysis s={cur} />
        </div>)}
      {showSet && <ActivitySettings a={d.activity} close={() => setShowSet(false)} done={() => { setShowSet(false); load() }} />}
    </>
  )
}

export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } })
  const [page, setPage] = useState('activities'), [view, setView] = useState(null), [pw, setPw] = useState(false)
  const [hidden, setHidden] = useState(() => localStorage.getItem('menu-hidden') === '1')
  const toggle = () => setHidden(h => { localStorage.setItem('menu-hidden', h ? '0' : '1'); return !h })
  const clear = () => { setToken(null); localStorage.removeItem('user'); setUser(null); setView(null); setPage('activities'); setPw(false) }
  const logout = async () => { try { await api('/logout', { method: 'POST' }) } catch {} clear() }
  useEffect(() => { window.addEventListener('auth-expired', clear); return () => window.removeEventListener('auth-expired', clear) }, [])
  const saveUser = u => { localStorage.setItem('user', JSON.stringify(u)); setUser(u) }
  if (!user) return <Login onDone={saveUser} />
  if (user.must_change_password) return <ForcePassword user={user} onDone={saveUser} onLogout={logout} />
  const staff = user.role !== 'student', admin = user.role === 'admin', go = p => { setPage(p); setView(null) }
  const nav = [['activities', 'Activities', <LayoutGrid size={18} />], ...(staff ? [['users', admin ? 'Users' : 'Students', <Users size={18} />], ['costs', 'AI cost report', <DollarSign size={18} />]] : []), ...(admin ? [['settings', 'Settings', <Settings size={18} />]] : [])]
  return (
    <div className={'app' + (hidden ? ' collapsed' : '')}>
      <aside className="side">
        <div className="brand"><span><GraduationCap size={20} /></span>Curiosity<button className="icon" onClick={toggle} aria-label="Hide menu" title="Hide menu"><PanelLeftClose size={18} /></button></div>
        <nav>{nav.map(([k, l, ic]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => go(k)}>{ic}{l}</button>)}</nav>
        <div className="me"><Avatar name={user.name} /><div><b>{user.name}</b><small>{user.role}</small></div>
          <button className="icon" onClick={() => setPw(true)} aria-label="Change password" title="Change password"><KeyRound size={17} /></button>
          <button className="icon" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div>
      </aside>
      <main className={'content' + (view && page === 'activities' ? ' full' : '')}>
        {hidden && <div className="topbar"><button className="icon" onClick={toggle} aria-label="Show menu" title="Show menu"><Menu size={20} /></button><b>Curiosity</b></div>}
        {page === 'users' ? <UsersPage me={user} /> : page === 'costs' ? <CostReport /> : page === 'settings' ? <SettingsPage /> :
          view ? (staff ? <Monitor id={view} back={() => setView(null)} /> : <StudentChat id={view} user={user} back={() => setView(null)} />) : <Home user={user} open={setView} />}
      </main>
      {pw && <ChangePasswordModal close={() => setPw(false)} onDone={u => { saveUser(u); setPw(false) }} />}
    </div>
  )
}
