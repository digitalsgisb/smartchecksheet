import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, History, MapPin, Package, RefreshCw, RotateCcw, Search, ShieldCheck, User, Wrench, X } from 'lucide-react';
import { api, lineUrl } from './api.js';
import { filterOrders, finished, needsDowntimeReason, plantLabel, stamp, statuses } from './workOrderView.js';

const statusClass = status => Object.hasOwn(statuses, status) ? status : 'unknown';
function Status({ status }) { return <span className={`cmms-status status-${statusClass(status)}`}><i/>{statuses[status] || status}</span>; }
function Place({ order }) { return <span className="cmms-place"><MapPin size={15}/><span>{[plantLabel(order.plantId), order.location, order.area].filter(Boolean).join(' · ')}</span></span>; }

export function WorkOrderBoard({ data, busy, onRefresh, onOpen }) {
  const [view, setView] = useState('active'), [search, setSearch] = useState(''), [plant, setPlant] = useState(''), [location, setLocation] = useState(''), [status, setStatus] = useState('');
  const all = data?.orders || [];
  const orders = filterOrders(all, { view, search, plant, location, status });
  const locations = [...new Set(all.filter(o => !plant || o.plantId === plant).map(o => o.location).filter(Boolean))].sort();
  const views = [
    { id: 'active', label: 'Active jobs', count: all.filter(o => !finished(o.status)).length, icon: Wrench },
    { id: 'verify', label: 'To verify', count: all.filter(o => o.status === 'resolved').length, icon: ShieldCheck },
    { id: 'history', label: 'History', count: all.filter(o => finished(o.status)).length, icon: History },
    { id: 'all', label: 'All jobs', count: all.length, icon: Package }
  ];
  return <section className="cmms-board" aria-label="Work order cards">
    <div className="cmms-view-tabs" role="group" aria-label="Work order views">{views.map(({ id, label, count, icon: Icon }) => <button key={id} aria-pressed={view === id} className={view === id ? 'selected' : ''} onClick={() => { setView(id); setStatus(''); }}><Icon size={18}/>{label}<b>{count}</b></button>)}</div>
    <div className="panel cmms-controls"><div className="cmms-toolbar"><label className="cmms-search"><Search size={18}/><input aria-label="Search work orders" placeholder="Search job, equipment, place or reporter" value={search} onChange={e => setSearch(e.target.value)}/></label><button className="btn secondary" disabled={busy} onClick={onRefresh}><RefreshCw size={17}/>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
      <div className="cmms-filters"><label><span>Plant</span><select value={plant} onChange={e => { setPlant(e.target.value); setLocation(''); }}><option value="">All plants</option>{(data?.plants || []).map(p => <option key={p} value={p}>{plantLabel(p)}</option>)}</select></label><label><span>Section / place</span><select value={location} onChange={e => setLocation(e.target.value)}><option value="">All places</option>{locations.map(place => <option key={place}>{place}</option>)}</select></label><label><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(statuses).filter(([key]) => view === 'all' || (view === 'history' ? finished(key) : view === 'verify' ? key === 'resolved' : !finished(key))).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    </div>
    <div className="cmms-results"><span>{orders.length} {orders.length === 1 ? 'job' : 'jobs'} · {views.find(v => v.id === view).label}</span><small>{data ? `Updated ${stamp(data.fetchedAt)} · Auto-refresh 15s` : busy ? 'Connecting to CMMS…' : 'Connection setup required'}</small></div>
    <div className="cmms-card-grid">{orders.map(order => <button key={order.id} className={`cmms-job-card status-${statusClass(order.status)}`} onClick={() => onOpen(order)} aria-label={`Open ${order.number}, ${statuses[order.status] || order.status}, ${order.machineName}`}>
      <div className="cmms-card-top"><span className="cmms-job-number">{order.number}</span><span className={`cmms-priority priority-${order.priority}`}>{order.priority} priority</span></div>
      <Status status={order.status}/><h2>{order.machineName || order.title || 'Equipment not recorded'}</h2><Place order={order}/><p className="cmms-card-issue">{order.issueDescription || order.title}</p>
      <div className="cmms-card-people"><span><User size={15}/>{order.reportedByName || 'Reporter not recorded'}</span>{order.issueCategoryName && <span><Wrench size={15}/>{order.issueCategoryName}</span>}</div>
      <div className="cmms-card-foot"><span><Clock3 size={14}/>{stamp(view === 'history' ? order.closedAt || order.updatedAt : order.createdAt)}</span><strong>{order.status === 'resolved' ? 'Review & verify' : view === 'history' ? 'View history' : 'View job'}<ArrowUpRight size={16}/></strong></div>
    </button>)}</div>
    {data && !orders.length && <div className="panel empty"><Wrench size={32}/><h3>{view === 'verify' ? 'No repairs awaiting verification' : view === 'history' ? 'No completed jobs here yet' : 'No matching work orders'}</h3><p>{all.length ? 'Try another view, place or search.' : 'Jobs issued by the connected CMMS requester will appear here.'}</p>{(search || plant || location || status) && <button className="btn secondary" onClick={() => { setSearch(''); setPlant(''); setLocation(''); setStatus(''); }}>Clear filters</button>}</div>}
  </section>;
}

export function WorkOrderDetailDialog({ order, line, canVerify, loading, error, onClose, onUpdated, onRefresh }) {
  const ref = useRef(null), alive = useRef(true), verifying = useRef(false);
  const [tab, setTab] = useState('overview'), [note, setNote] = useState(''), [reason, setReason] = useState(''), [checks, setChecks] = useState({ location: false, repair: false, operation: false });
  const [action, setAction] = useState(''), [verifyError, setVerifyError] = useState('');
  useEffect(() => { alive.current = true; ref.current.showModal(); return () => { alive.current = false; }; }, []);
  useEffect(() => { setNote(''); setReason(''); setChecks({ location: false, repair: false, operation: false }); setVerifyError(''); }, [order.id, order.status]);
  const requiresReason = needsDowntimeReason(order);
  const ready = Object.values(checks).every(Boolean) && (!requiresReason || reason.trim());
  const close = () => { if (!verifying.current) onClose(); };
  async function verify(status) {
    if (verifying.current) return;
    if (status === 'closed' && !ready) { setVerifyError('Complete the inspection checks and required downtime reason.'); return; }
    if (status === 'returned' && !note.trim()) { setVerifyError('Explain what still needs attention in the verification note.'); return; }
    verifying.current = true; setAction(status); setVerifyError('');
    try {
      const result = await api(`/cmms/work-orders/${encodeURIComponent(order.id)}/verification?line=${encodeURIComponent(line)}`, { status, expectedUpdatedAt: order.updatedAt, note, checks, productionDowntimeReason: reason }, 'PATCH');
      if (alive.current) onUpdated(result.order);
    } catch (e) { if (alive.current) { setVerifyError(`${e.message} Refresh this job to confirm its current status before retrying.`); } }
    finally { verifying.current = false; if (alive.current) setAction(''); }
  }
  const activities = [...(order.activities || [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <dialog ref={ref} className="panel cmms-dialog cmms-detail-dialog" aria-labelledby="cmms-detail-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="cmms-dialog-head"><div><span className="eyebrow">WORK ORDER · {order.number}</span><h2 id="cmms-detail-title">{order.machineName || order.title}</h2></div><button className="btn secondary" disabled={!!action} aria-label="Close work order details" onClick={close}><X size={18}/></button></div>
    <div className="cmms-detail-status"><Status status={order.status}/><span className={`cmms-priority priority-${order.priority}`}>{order.priority} priority</span></div><Place order={order}/>
    <div className="cmms-detail-tabs" role="group" aria-label="Work order details">{[['overview', 'Job & verification'], ['history', `History (${activities.length})`], ['photos', `Photos (${order.photos?.length || 0})`]].map(([key, label]) => <button aria-pressed={tab === key} className={tab === key ? 'selected' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {loading && <p role="status">Loading maintenance details…</p>}{error && <p className="form-error" role="alert">{error} Details may be outdated.</p>}
    {tab === 'overview' && <>
      <div className="cmms-detail-section"><span className="eyebrow">REPORTED ISSUE</span><p className="cmms-description">{order.issueDescription}</p></div>
      <dl className="cmms-facts">{[['Plant', plantLabel(order.plantId)], ['Section / place', order.location], ['Area', order.area], ['Equipment', order.machineName], ['Assigned technician', order.assignedTo || 'Awaiting assignment'], ['Reported by', order.reportedByName], ['Issue category', order.issueCategoryName], ['Shift group', order.shiftGroup], ['Reported', stamp(order.createdAt)], ['Resolved', stamp(order.resolvedAt)], ['Closed', stamp(order.closedAt)], ['Last updated', stamp(order.updatedAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl>
      <section className="cmms-repair-summary"><h3>Repair summary</h3><p className="cmms-description">{order.completionNote || 'Maintenance has not recorded a repair summary yet.'}</p>{order.maintenanceActualMinutes != null && <p>Maintenance actual time: <strong>{order.maintenanceActualMinutes} minutes</strong></p>}<button className="text-btn" onClick={() => setTab('photos')}>Review before & after photos<ArrowUpRight size={16}/></button></section>
      {order.productionDowntimeReason && <div className="cmms-detail-section"><h3>Downtime explanation</h3><p className="cmms-description">{order.productionDowntimeReason}</p></div>}
      {order.status === 'resolved' && <section className="cmms-verification" aria-labelledby="cmms-verify-title"><div className="cmms-verification-heading"><ShieldCheck size={24}/><div><h3 id="cmms-verify-title">Verify the completed repair</h3><p>Inspect the equipment at its location, review the repair evidence, then close or return this job.</p></div></div>
        {canVerify ? <><fieldset disabled={!!action || loading || !!error}><legend>Confirm your inspection</legend>{[['location', 'I checked the correct equipment at the plant, section and area shown above.'], ['repair', 'I reviewed the repair summary and completion photos.'], ['operation', 'I checked the equipment condition and confirmed it is ready for use.']].map(([key, label]) => <label key={key} className="cmms-check"><input type="checkbox" checked={checks[key]} onChange={e => setChecks(c => ({ ...c, [key]: e.target.checked }))}/><span>{label}</span></label>)}
          <label className="field"><span>Verification note · required when returning</span><textarea rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="What did you check? If returning, explain what still needs repair."/></label>
          {requiresReason && <label className="field"><span>Why did this work order take 60 minutes or more? · required to close</span><textarea rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Confirm the delay reason with maintenance."/></label>}
          <div className="cmms-verify-actions"><button className="btn cmms-close-job" disabled={!ready || !!action} onClick={() => verify('closed')}><CheckCircle2 size={18}/>{action === 'closed' ? 'Closing…' : 'Verify & Close'}</button><button className="btn cmms-return-job" disabled={!note.trim() || !!action} onClick={() => verify('returned')}><RotateCcw size={18}/>{action === 'returned' ? 'Returning…' : 'Return to Maintenance'}</button></div>
        </fieldset><p className="hint">Your Checksheet name and line are recorded in CMMS history.</p></> : <p className="notice">An operator, management user or developer must verify this repair.</p>}
        {verifyError && <div className="form-error" role="alert">{verifyError}<button className="text-btn" disabled={!!action} onClick={onRefresh}><RefreshCw size={16}/>Refresh job</button></div>}
      </section>}
      {order.status === 'closed' && <div className="cmms-completed"><CheckCircle2 size={22}/><div><strong>Repair verified and closed</strong><p>{stamp(order.closedAt || order.updatedAt)} · See History for verification notes.</p></div></div>}
      {order.status === 'returned' && <div className="notice"><RotateCcw size={20}/>Returned to maintenance for further work. See History for the return reason.</div>}
    </>}
    {tab === 'history' && <section className="cmms-detail-section"><h3>Job history</h3><p>Latest activity first · all times in Malaysia time.</p><ol className="cmms-history">{activities.map(a => <li key={a.id}><span className={`cmms-timeline-dot status-${statusClass(a.status)}`}/><div><span className="cmms-history-action">{statuses[a.status] || a.action?.replaceAll('_', ' ') || 'Update'}</span><p className="cmms-description">{a.message || a.action}</p><small>{stamp(a.createdAt)}</small></div></li>)}</ol>{!activities.length && <p className="hint">{loading ? 'Loading history…' : 'No activity history was returned by CMMS.'}</p>}</section>}
    {tab === 'photos' && <section className="cmms-detail-section"><h3>Repair evidence</h3><p>Review the issue and completion photos before verifying.</p><div className="cmms-photos">{order.photos?.map(p => <figure key={p.id}><a href={lineUrl(`/cmms/work-orders/${encodeURIComponent(order.id)}/photos/${encodeURIComponent(p.id)}`, line)} target="_blank" rel="noreferrer" aria-label={`Open ${p.kind.replaceAll('_', ' ')} photo`}><img src={lineUrl(`/cmms/work-orders/${encodeURIComponent(order.id)}/photos/${encodeURIComponent(p.id)}`, line)} alt={p.originalName || p.kind} loading="lazy"/></a><figcaption>{p.kind === 'issue' ? 'Reported issue' : p.kind === 'after' ? 'Completed repair' : p.kind.replaceAll('_', ' ')}</figcaption></figure>)}</div>{!order.photos?.length && <p className="hint">{loading ? 'Loading photos…' : 'No photos were returned by CMMS.'}</p>}</section>}
  </dialog>;
}
