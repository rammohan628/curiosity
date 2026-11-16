import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, X } from 'lucide-react'
import { apiBlob } from './api'

export const fmt = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
export const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
export const tone = v => v >= 7 ? 'good' : v >= 4 ? 'mid' : 'low'
export const ENG = { deep: ['Deep learner', 'good'], engaged: ['Engaged', 'info'], surface: ['Surface-level', 'mid'], off_task: ['Off-task', 'low'] }
export const PL = { deep: ['Deep', 'good'], relevant: ['Relevant', 'info'], casual: ['Casual', 'mid'], off_topic: ['Off-topic', 'low'] }
export const useNow = () => { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t) }, []); return n }

export const Md = ({ children }) => <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: p => <a {...p} target="_blank" rel="noreferrer" /> }}>{children}</ReactMarkdown></div>
export const Pill = ({ s }) => <span className={'pill ' + s.replace(' ', '-').toLowerCase()}>{s}</span>
export const Chip = ({ t, c }) => <span className={'chip ' + c}>{t}</span>
export const Err = ({ msg }) => msg ? <p className="err" role="alert">{msg}</p> : null
export const Avatar = ({ name, size = 34 }) => <span className="avatar" style={{ width: size, height: size, fontSize: size * .38 }}>{initials(name)}</span>
export const Back = ({ back, label = 'Activities' }) => <button className="link" onClick={back}><ArrowLeft size={16} />{label}</button>
export const Ring = ({ v, size = 64 }) => { const r = size / 2 - 6, c = 2 * Math.PI * r, m = size / 2; return (
  <svg width={size} height={size} className={'ring ' + tone(v)} aria-label={`Score ${v} out of 10`}><circle cx={m} cy={m} r={r} className="trk" /><circle cx={m} cy={m} r={r} className="val" strokeDasharray={c} strokeDashoffset={c * (1 - v / 10)} transform={`rotate(-90 ${m} ${m})`} /><text x={m} y={m + 5} textAnchor="middle">{v.toFixed(1)}</text></svg>) }
export const Bar = ({ label, v }) => <div className="bar"><div><span>{label}</span><b>{v}/10</b></div><i><u className={tone(v)} style={{ width: v * 10 + '%' }} /></i></div>
export const Empty = ({ icon, title, text }) => <div className="empty">{icon}<h3>{title}</h3><p>{text}</p></div>

export const usd = v => '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2))
export const num = v => (v || 0).toLocaleString('en-IN')
export const Modal = ({ title, close, children, wide }) => (
  <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
    <div className={'modal card' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <div className="row between"><h2>{title}</h2><button type="button" className="icon" onClick={close} aria-label="Close"><X size={18} /></button></div>
      {children}
    </div>
  </div>
)
export const downloadCsv = (name, rows) => {
  const esc = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"' }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }))
  a.download = name; a.click(); URL.revokeObjectURL(a.href)
}
export async function downloadPdf(a) {
  const url = URL.createObjectURL(await apiBlob(`/activities/${a.id}/file`))
  const el = document.createElement('a'); el.href = url; el.download = a.file_name; el.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
