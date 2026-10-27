import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Search, Wrench, X } from 'lucide-react';
import { api, lineUrl } from './api.js';
import './work-orders.css';

const statuses = { open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In progress', pending_material: 'Pending material', on_hold: 'On hold', resolved: 'Awaiting verification', closed: 'Closed', returned: 'Returned', cancelled: 'Cancelled' };
const finished = status => ['closed', 'cancelled'].includes(status);
const stamp = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const emptyForm = () => ({ requestId: crypto.randomUUID(), machineId: '', issueCategoryId: '', issueDescription: '', shiftGroup: 'A', priority: 'medium', photo: null });

function Dialog({ titleId, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="panel cmms-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}

export default function WorkOrders({ line, canCreate }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('active'), [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState(null), [saving, setSaving] = useState(false), [submitted, setSubmitted] = useState(false), [formError, setFormError] = useState('');
  const [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(''), [detailBusy, setDetailBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!form) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form]);
  useEffect(() => {
    let disposed = false, timer, controller;
    async function load() {
      controller = new AbortController(); setBusy(true);
      try {
        const response = await fetch(`/api/cmms/work-orders?line=${encodeURIComponent(line)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const next = await response.json();
        if (disposed) return;
        if (!response.ok) { if ([401, 403].includes(response.status)) setData(null); throw new Error(next.error || 'Could not load work orders.'); }
        setData(next); setError('');
      } catch (e) { if (!disposed) setError(e.message); }
      finally { if (!disposed) { setBusy(false); timer = setTimeout(load, 15000); } }
    }
    load(); return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [line, attempt]);
  const detailId = detail?.id;
  useEffect(() => {
    if (!detailId) return;
    let disposed = false, timer;
    async function load() {
      try { const next = await api(`/cmms/work-orders/${encodeURIComponent(detailId)}?line=${encodeURIComponent(line)}`); if (!disposed) { setDetail(next); setDetailError(''); } }
      catch (e) { if (!disposed) setDetailError(e.message); }
      finally { if (!disposed) timer = setTimeout(load, 15000); }
    }
    load(); return () => { disposed = true; clearTimeout(timer); };
  }, [detailId, line]);
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  function closeForm() {
    if (!saving && window.confirm(submitted ? 'Close this submission? Check the work-order list before issuing another request.' : 'Discard this unsaved work order?')) setForm(null);
  }
  async function choosePhoto(file) {
    if (!file) return;
    setFormError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setFormError('Choose a JPEG, PNG or WebP photo up to 8 MB.'); return; }
    try {
      const result = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      if (mounted.current) set('photo', { name: file.name, type: file.type, data: result });
    } catch { setFormError('Unable to read that photo. Choose it again.'); }
  }
  async function submit(event) {
    event.preventDefault(); if (saving) return;
    if (!form.photo) { setFormError('Add an issue photo before submitting.'); return; }
    setSaving(true); setSubmitted(true); setFormError('');
    try {
      const result = await api(`/cmms/work-orders?line=${encodeURIComponent(line)}`, form);
      if (mounted.current) { setForm(null); setDetail(result.order); setAttempt(v => v + 1); }
    } catch (e) { if (mounted.current) { setFormError(e.message); if (e.status === 400) setSubmitted(false); } }
    finally { if (mounted.current) setSaving(false); }
  }
  async function show(order) {
    setDetail(order); setDetailBusy(true); setDetailError('');
    try { const next = await api(`/cmms/work-orders/${encodeURIComponent(order.id)}?line=${encodeURIComponent(line)}`); if (mounted.current) setDetail(current => current?.id === order.id ? next : current); }
    catch (e) { if (mounted.current) setDetailError(e.message); }
    finally { if (mounted.current) setDetailBusy(false); }
  }
  const orders = (data?.orders || []).filter(o => (filter === 'all' || (filter === 'active' ? !finished(o.status) : finished(o.status))) && `${o.number} ${o.machineName} ${o.issueDescription}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="cmms-page">
    <div className="page-intro"><div><span className="eyebrow">SUGIHARA CMMS · {line}</span><h1>Work orders<span>.</span></h1><p>Report a machine issue and follow maintenance progress.</p></div><button className="btn primary" disabled={!canCreate || !data?.machines.length || !data?.issueCategories.length || !!error} onClick={() => { setForm(emptyForm()); setSubmitted(false); setFormError(''); }}><Plus size={18}/>Issue work order</button></div>
    {error && <div className="notice cmms-error" role="alert">{error}{data && ' Displayed records may be outdated.'}<button className="text-btn" onClick={() => setAttempt(v => v + 1)}>Retry</button></div>}
    <section className="panel cmms-list"><div className="cmms-toolbar"><label className="cmms-search"><Search size={18}/><input aria-label="Search work orders" placeholder="Search number, machine or issue" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Work order status" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active jobs</option><option value="finished">Closed / cancelled</option><option value="all">All jobs</option></select><button className="btn secondary" disabled={busy} onClick={() => setAttempt(v => v + 1)}><RefreshCw size={17}/>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
      <p className="hint">{data ? `Updated ${stamp(data.fetchedAt)} · Refreshes every 15 seconds` : busy ? 'Connecting to CMMS…' : 'Connection setup required.'}</p>
      {orders.map(order => <button className="cmms-order" key={order.id} onClick={() => show(order)}><Wrench size={21}/><div><strong>{order.number} · {order.machineName}</strong><p>{order.issueDescription}</p><small>{order.reportedByName} · {stamp(order.createdAt)}</small></div><div className="cmms-order-tags"><span className={`badge ${order.status === 'resolved' ? 'success' : 'neutral'}`}>{statuses[order.status] || order.status}</span><small>{order.priority} priority</small></div></button>)}
      {data && !orders.length && <div className="empty"><Wrench size={32}/><h3>No matching work orders</h3><p>{data.machines.length ? 'Jobs for the mapped machines on this line will appear here.' : 'No active machines match this line’s CMMS mapping. Ask your administrator to check the machine IDs.'}</p></div>}
    </section>
    {form && <Dialog titleId="cmms-form-title" onClose={closeForm}><div className="cmms-dialog-head"><h2 id="cmms-form-title">Issue work order · {line}</h2><button type="button" className="btn secondary" disabled={saving} aria-label="Close work order form" onClick={closeForm}><X size={18}/></button></div><form onSubmit={submit}>
      <fieldset disabled={saving || submitted}><div className="form-grid"><label className="field"><span>Machine / equipment</span><select required value={form.machineId} onChange={e => set('machineId', e.target.value)}><option value="">Select machine</option>{data.machines.map(m => <option key={m.id} value={m.id}>{m.name} · {m.area}</option>)}</select></label><label className="field"><span>Issue category</span><select required value={form.issueCategoryId} onChange={e => set('issueCategoryId', e.target.value)}><option value="">Select category</option>{data.issueCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>Shift group</span><select value={form.shiftGroup} onChange={e => set('shiftGroup', e.target.value)}><option>A</option><option>B</option></select></label><label className="field"><span>Priority</span><select value={form.priority} onChange={e => set('priority', e.target.value)}>{['low', 'medium', 'high', 'critical'].map(p => <option key={p}>{p}</option>)}</select></label></div><label className="field"><span>Describe the issue</span><textarea required maxLength={4000} rows={4} value={form.issueDescription} onChange={e => set('issueDescription', e.target.value)} placeholder="What happened, where, and what needs attention?"/></label><label className="field"><span>Issue photo · JPEG, PNG or WebP, up to 8 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => choosePhoto(e.target.files[0])}/></label>{form.photo && <p className="hint">Selected: {form.photo.name}</p>}</fieldset>
      {formError && <p className="form-error" role="alert">{formError}</p>}<p className="hint">Maintenance will receive this in CMMS. Your name and production line are recorded with the request.</p><button className="btn primary" disabled={saving || !form.photo}>{saving ? 'Submitting to CMMS…' : submitted ? 'Retry same submission' : 'Send work order'}</button>
    </form></Dialog>}
    {detail && !form && <Dialog titleId="cmms-detail-title" onClose={() => setDetail(null)}><div className="cmms-dialog-head"><div><span className="eyebrow">{detail.machineName}</span><h2 id="cmms-detail-title">{detail.number}</h2></div><button className="btn secondary" aria-label="Close work order details" onClick={() => setDetail(null)}><X size={18}/></button></div><span className="badge neutral">{statuses[detail.status] || detail.status}</span><p className="cmms-description">{detail.issueDescription}</p>{detailBusy && <p>Loading maintenance details…</p>}{detailError && <p className="form-error" role="alert">{detailError} Details may be outdated.</p>}<dl className="cmms-facts"><div><dt>Assigned technician</dt><dd>{detail.assignedTo || 'Awaiting assignment'}</dd></div><div><dt>Reported by</dt><dd>{detail.reportedByName}</dd></div><div><dt>Priority</dt><dd>{detail.priority}</dd></div><div><dt>Last updated</dt><dd>{stamp(detail.updatedAt)}</dd></div></dl>{detail.completionNote && <><h3>Repair summary</h3><p className="cmms-description">{detail.completionNote}</p></>}{detail.productionDowntimeReason && <><h3>Downtime reason</h3><p>{detail.productionDowntimeReason}</p></>}<div className="cmms-photos">{detail.photos?.map(p => <figure key={p.id}><img src={lineUrl(`/cmms/work-orders/${encodeURIComponent(detail.id)}/photos/${encodeURIComponent(p.id)}`, line)} alt={p.originalName || p.kind} loading="lazy"/><figcaption>{p.kind.replaceAll('_', ' ')}</figcaption></figure>)}</div><h3>Maintenance history</h3><ol className="cmms-history">{detail.activities?.map(a => <li key={a.id}><strong>{a.message || a.action}</strong><small>{stamp(a.createdAt)}</small></li>)}</ol></Dialog>}
  </div>;
}
