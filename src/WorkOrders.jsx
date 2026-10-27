import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from './api.js';
import { WorkOrderBoard, WorkOrderDetailDialog } from './WorkOrderCards.jsx';
import { plantLabel } from './workOrderView.js';
import './work-orders.css';

const emptyForm = plant => ({ plant, requestId: crypto.randomUUID(), machineId: '', issueCategoryId: '', issueDescription: '', shiftGroup: 'A', priority: 'medium', photo: null });

function Dialog({ titleId, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="panel cmms-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}

export default function WorkOrders({ line, canCreate }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState(null), [saving, setSaving] = useState(false), [submitted, setSubmitted] = useState(false), [formError, setFormError] = useState('');
  const [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(''), [detailBusy, setDetailBusy] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
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
      setDetailBusy(true);
      try { const next = await api(`/cmms/work-orders/${encodeURIComponent(detailId)}?line=${encodeURIComponent(line)}`); if (!disposed) { setDetail(current => current?.id === next.id && (!current.updatedAt || Date.parse(next.updatedAt) >= Date.parse(current.updatedAt)) ? next : current); setDetailError(''); } }
      catch (e) { if (!disposed) setDetailError(e.message); }
      finally { if (!disposed) { setDetailBusy(false); timer = setTimeout(load, 15000); } }
    }
    load(); return () => { disposed = true; clearTimeout(timer); };
  }, [detailId, line, detailAttempt]);
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
  function show(order) { setDetail(order); setDetailBusy(true); setDetailError(''); }
  function updated(order) {
    setDetail(order); setDetailError('');
    setData(current => current ? { ...current, orders: current.orders.map(item => item.id === order.id ? order : item) } : current);
    setAttempt(value => value + 1);
  }
  return <div className="cmms-page">
    <div className="page-intro"><div><span className="eyebrow">SUGIHARA CMMS · {line}</span><h1>Work orders<span>.</span></h1><p>Work orders issued by {data?.requesterName || 'the connected CMMS requester account'} · shared across Checksheet lines.</p></div><button className="btn primary" disabled={!canCreate || !data?.machines.length || !data?.issueCategories.length || !!error} onClick={() => { setForm(emptyForm(data.plants[0])); setSubmitted(false); setFormError(''); }}><Plus size={18}/>Issue work order</button></div>
    {error && <div className="notice cmms-error" role="alert">{error}{data && ' Displayed records may be outdated.'}<button className="text-btn" onClick={() => setAttempt(v => v + 1)}>Retry</button></div>}
    <WorkOrderBoard data={data} busy={busy} onRefresh={() => setAttempt(v => v + 1)} onOpen={show}/>
    {form && <Dialog titleId="cmms-form-title" onClose={closeForm}><div className="cmms-dialog-head"><h2 id="cmms-form-title">Issue work order · {line}</h2><button type="button" className="btn secondary" disabled={saving} aria-label="Close work order form" onClick={closeForm}><X size={18}/></button></div><form onSubmit={submit}>
      <fieldset disabled={saving || submitted}><div className="form-grid">{data.plants.length > 1 && <label className="field"><span>Plant</span><select required value={form.plant} onChange={e => setForm(f => ({ ...f, plant: e.target.value, machineId: '', issueCategoryId: '' }))}>{data.plants.map(p => <option key={p} value={p}>{plantLabel(p)}</option>)}</select></label>}<label className="field"><span>Machine / equipment</span><select required value={form.machineId} onChange={e => set('machineId', e.target.value)}><option value="">Select machine</option>{data.machines.filter(m => m.plantId === form.plant).map(m => <option key={m.id} value={m.id}>{m.name} · {m.area}</option>)}</select></label><label className="field"><span>Issue category</span><select required value={form.issueCategoryId} onChange={e => set('issueCategoryId', e.target.value)}><option value="">Select category</option>{data.issueCategories.filter(c => c.plantId === form.plant).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>Shift group</span><select value={form.shiftGroup} onChange={e => set('shiftGroup', e.target.value)}><option>A</option><option>B</option></select></label><label className="field"><span>Priority</span><select value={form.priority} onChange={e => set('priority', e.target.value)}>{['low', 'medium', 'high', 'critical'].map(p => <option key={p}>{p}</option>)}</select></label></div><label className="field"><span>Describe the issue</span><textarea required maxLength={4000} rows={4} value={form.issueDescription} onChange={e => set('issueDescription', e.target.value)} placeholder="What happened, where, and what needs attention?"/></label><label className="field"><span>Issue photo · JPEG, PNG or WebP, up to 8 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => choosePhoto(e.target.files[0])}/></label>{form.photo && <p className="hint">Selected: {form.photo.name}</p>}</fieldset>
      {formError && <p className="form-error" role="alert">{formError}</p>}<p className="hint">Maintenance will receive this in CMMS. Your name and production line are recorded with the request.</p><button className="btn primary" disabled={saving || !form.photo}>{saving ? 'Submitting to CMMS…' : submitted ? 'Retry same submission' : 'Send work order'}</button>
    </form></Dialog>}
    {detail && !form && <WorkOrderDetailDialog key={detail.id} order={detail} line={line} canVerify={canCreate} loading={detailBusy} error={detailError} onClose={() => setDetail(null)} onUpdated={updated} onRefresh={() => setDetailAttempt(v => v + 1)}/>}
  </div>;
}
