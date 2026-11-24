import { useEffect, useState } from 'react';
import { Check, ClipboardPaste, DownloadCloud, RefreshCw, Save, Users, Boxes, X, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { PageSkeleton } from './ui.jsx';
import { peopleRoles, parsePeopleTable, parseModelsTable, diffPeople, diffModels, mergePeople, mergeModels } from '../shared/lineLists.js';
import LineStaff from './LineStaff.jsx';
import './line-lists.css';

const when = value => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });
const num = value => { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
// Paste rows become numbers here; a row without a usable cycle time is left out with a note, as the Models sheet did.
function modelRows(rows) {
  const models = [], notes = [];
  for (const row of rows) {
    const cycle = num(row.cycle), pcsHr = row.pcsHr === '' ? 0 : num(row.pcsHr), slabWidth = row.slabWidth === '' ? 0 : num(row.slabWidth), slabLength = row.slabLength === '' ? 0 : num(row.slabLength);
    if (!(cycle > 0)) { notes.push(`${row.name}: no cycle time; left out.`); continue; }
    if ([pcsHr, slabWidth, slabLength].some(v => !(v >= 0))) { notes.push(`${row.name}: Pcs/hr or slab size is not a number; left out.`); continue; }
    if (models.some(m => m.name === row.name)) { notes.push(`${row.name}: listed twice; first row kept.`); continue; }
    models.push({ name: row.name, cycle, pcsHr, ...(slabWidth ? { slabWidth } : {}), ...(slabLength ? { slabLength } : {}) });
  }
  return { models, notes };
}
const Saved = ({ list }) => list ? <span className="list-source saved"><Check size={14}/>Saved by {list.updatedBy} · {when(list.updatedAt)}</span> : <span className="list-source google">Still read from the Google link</span>;

function ListEditor({ line, kind, list, onSaved }) {
  const people = kind === 'people';
  const [text, setText] = useState(''), [preview, setPreview] = useState(null), [remove, setRemove] = useState([]);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const current = list?.data || (people ? null : []);
  // Direct editing: a copy of the saved list, changed in place and saved as a whole.
  const [draft, setDraft] = useState(null);
  const text2 = value => value ? String(value) : '';
  function startEdit() { reset(); setText(''); setDraft(people ? Object.fromEntries(Object.keys(peopleRoles).map(role => [role, [...(list?.data[role] || [])]])) : (list?.data || []).map(m => ({ name: m.name, cycle: text2(m.cycle), pcsHr: text2(m.pcsHr), slabWidth: text2(m.slabWidth), slabLength: text2(m.slabLength) }))); }
  const editRole = (role, change) => setDraft(d => ({ ...d, [role]: change(d[role]) }));
  const editModel = (index, field, value) => setDraft(d => d.map((m, i) => i === index ? { ...m, [field]: value } : m));
  async function saveDraft() {
    if (busy) return; setError(''); setMessage('');
    let body;
    if (people) body = { people: Object.fromEntries(Object.entries(draft).map(([role, names]) => [role, names.map(n => n.trim()).filter(Boolean)])) };
    else {
      const rows = draft.map(m => ({ ...m, name: m.name.trim() })).filter(m => m.name);
      const bad = rows.find(m => !(num(m.cycle) > 0)) || rows.find(m => ['pcsHr', 'slabWidth', 'slabLength'].some(f => m[f].trim() && !(num(m[f]) >= 0)));
      if (bad) return setError(num(bad.cycle) > 0 ? `${bad.name}: Pcs/hr and slab size must be numbers.` : `${bad.name}: enter a cycle time above 0.`);
      const twice = rows.find((m, i) => rows.findIndex(other => other.name === m.name) !== i);
      if (twice) return setError(`${twice.name} is listed twice.`);
      body = { models: rows.map(m => ({ name: m.name, cycle: num(m.cycle), pcsHr: num(m.pcsHr) || 0, slabWidth: num(m.slabWidth) || 0, slabLength: num(m.slabLength) || 0 })) };
    }
    setBusy('save');
    try { const saved = await api(`/admin/line-lists/${encodeURIComponent(line)}/${kind}`, body, 'PUT'); onSaved(saved); setDraft(null); setMessage('Saved.'); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  const reset = () => { setPreview(null); setRemove([]); setError(''); setMessage(''); };
  function show(next, ignored = [], notes = []) {
    const diff = people ? diffPeople(current, next) : diffModels(current, next);
    setPreview({ next, diff, ignored, notes }); setRemove([]);
  }
  function read() {
    reset();
    try {
      if (people) { const { people: next, ignored } = parsePeopleTable(text); show(next, ignored); }
      else { const { models: rows, ignored } = parseModelsTable(text, line); const { models: next, notes } = modelRows(rows); if (!next.length) throw new Error('No model rows with a cycle time.'); show(next, ignored, notes); }
    } catch (e) { setError(e.message); }
  }
  async function fromGoogle() {
    if (busy) return; reset(); setBusy('import');
    try { const result = await api(`/admin/line-lists/${encodeURIComponent(line)}/${kind}/import`, {}, 'POST'); show(people ? result.people : result.models); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  async function save() {
    if (busy || !preview) return; setBusy('save'); setError('');
    const data = people ? mergePeople(current, preview.next, remove) : mergeModels(current, preview.next, remove);
    try { const saved = await api(`/admin/line-lists/${encodeURIComponent(line)}/${kind}`, people ? { people: data } : { models: data }, 'PUT'); onSaved(saved); setText(''); setPreview(null); setRemove([]); setMessage(people ? 'Saved. Start shift now shows these names.' : 'Saved. The Model list now shows these models.'); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  const toggle = id => setRemove(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  const changes = preview && (people ? Object.values(preview.diff).reduce((n, d) => n + d.added.length, 0) + remove.length : preview.diff.added.length + preview.diff.changed.length + remove.length);
  const dirty = !!text.trim() || !!preview;
  const hint = people ? 'Copy from your names sheet with the header row: supervisors, spvPic, lineLeaders, leaderPic, formingOperators, waterjetOperators, assemblyOperators, qualityOperators. Picture columns are skipped for now.' : 'Copy with the header row: Model, Cycle time (min/pc), Pcs/hr, Slab width, Slab length. Your old Models sheet (line, model, targetPerHour, cycleMinutes, active) also works.';
  return <section className="panel list-editor" aria-labelledby={`list-${kind}`} aria-busy={!!busy}>
    <header><div className="list-title">{people ? <Users size={21}/> : <Boxes size={21}/>}<h2 id={`list-${kind}`}>{people ? 'Names' : 'Models'}</h2></div><div className="list-head-actions"><Saved list={list}/>{!draft && !preview && <button className="btn secondary" type="button" disabled={!!busy} onClick={startEdit}><Pencil size={16}/>{list ? 'Edit' : 'Add by hand'}</button>}</div></header>
    {draft ? <form className="list-edit" data-update-blocked="true" onSubmit={e => { e.preventDefault(); saveDraft(); }}>
      {people ? <div className="people-grid editing">{Object.entries(peopleRoles).map(([role, label]) => <div key={role}><h3>{label} <small>{draft[role].filter(n => n.trim()).length}</small></h3><ul>{draft[role].map((name, i) => <li key={i}><input value={name} maxLength={120} autoFocus={!name && i === draft[role].length - 1} aria-label={`${label} name ${i + 1}`} onChange={e => editRole(role, names => names.map((n, j) => j === i ? e.target.value : n))}/><button type="button" className="icon-btn" aria-label={`Remove ${name || 'blank name'}`} onClick={() => editRole(role, names => names.filter((_, j) => j !== i))}><Trash2 size={16}/></button></li>)}</ul><button type="button" className="text-btn list-add" onClick={() => editRole(role, names => [...names, ''])}><Plus size={16}/>Add {label.toLowerCase()}</button></div>)}</div>
        : <><div className="model-table-wrap editing"><table className="model-table"><thead><tr><th>Model</th><th>Cycle (min/pc)</th><th>Pcs/hr</th><th>Slab W</th><th>Slab L</th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>{draft.map((m, i) => <tr key={i}>{['name', 'cycle', 'pcsHr', 'slabWidth', 'slabLength'].map(field => <td key={field}><input value={m[field]} maxLength={field === 'name' ? 120 : 12} inputMode={field === 'name' ? undefined : 'decimal'} autoFocus={field === 'name' && !m.name && i === draft.length - 1} aria-label={`${field === 'name' ? 'Model' : field} row ${i + 1}`} onChange={e => editModel(i, field, e.target.value)}/></td>)}<td><button type="button" className="icon-btn" aria-label={`Remove ${m.name || 'blank model'}`} onClick={() => setDraft(d => d.filter((_, j) => j !== i))}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div><button type="button" className="text-btn list-add" onClick={() => setDraft(d => [...d, { name: '', cycle: '', pcsHr: '', slabWidth: '', slabLength: '' }])}><Plus size={16}/>Add model</button></>}
      <div className="list-actions"><button className="btn secondary" type="button" disabled={!!busy} onClick={() => { setDraft(null); setError(''); }}><X size={17}/>Cancel</button><button className="btn primary" type="submit" disabled={!!busy}><Save size={17}/>{busy === 'save' ? 'Saving…' : 'Save changes'}</button></div>
    </form> : <>
    {people ? (list ? <div className="people-grid">{Object.entries(peopleRoles).map(([role, label]) => <div key={role}><h3>{label} <small>{list.data[role].length}</small></h3><ul>{list.data[role].map(name => <li key={name}>{name}</li>)}</ul></div>)}</div> : null)
      : (list ? <div className="model-table-wrap"><table className="model-table"><thead><tr><th>Model</th><th>Cycle (min/pc)</th><th>Pcs/hr</th><th>Slab W</th><th>Slab L</th></tr></thead><tbody>{list.data.map(m => <tr key={m.name}><td>{m.name}</td><td>{m.cycle}</td><td>{m.pcsHr || '–'}</td><td>{m.slabWidth || '–'}</td><td>{m.slabLength || '–'}</td></tr>)}</tbody></table></div> : null)}
    <form className="list-paste" data-update-blocked={dirty || !!busy} onSubmit={e => { e.preventDefault(); read(); }}>
      <label className="field"><span>Paste from Google Sheet</span><textarea rows={6} spellCheck={false} disabled={!!busy} value={text} onChange={e => { setText(e.target.value); reset(); }} placeholder={people ? 'supervisors\tspvPic\tlineLeaders\t…' : 'Model\tCycle time\tPcs/hr\tSlab width\tSlab length'}/></label>
      <p className="hint">{hint}</p>
      <div className="list-actions"><button className="btn secondary" type="button" disabled={!!busy} onClick={fromGoogle}><DownloadCloud size={17}/>{busy === 'import' ? 'Reading…' : 'Import from Google link'}</button><button className="btn primary" type="submit" disabled={!!busy || !text.trim()}><ClipboardPaste size={17}/>Check paste</button></div>
    </form></>}
    <div aria-live="polite">{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="list-success"><Check size={16}/>{message}</p>}</div>
    {preview && <div className="list-preview">
      <h3>Check before saving</h3>
      {preview.ignored.length > 0 && <p className="hint">Columns skipped: {preview.ignored.join(', ')}</p>}
      {preview.notes.map(note => <p className="hint" key={note}>{note}</p>)}
      {people ? Object.entries(peopleRoles).map(([role, label]) => { const d = preview.diff[role]; return <div className="diff-role" key={role}><h4>{label} <small>{preview.next[role].length} in paste</small></h4>{!d.added.length && !d.missing.length && <p className="diff-none">No change</p>}{d.added.map(n => <span className="chip added" key={n}>+ {n}</span>)}{d.missing.map(n => <label className={`chip missing ${remove.includes(`${role}:${n}`) ? 'removing' : ''}`} key={n}><input type="checkbox" checked={remove.includes(`${role}:${n}`)} onChange={() => toggle(`${role}:${n}`)}/>{n}</label>)}</div>; })
        : <>{preview.diff.added.length > 0 && <div className="diff-role"><h4>New models</h4>{preview.diff.added.map(m => <span className="chip added" key={m.name}>+ {m.name} · {m.cycle} min/pc</span>)}</div>}
          {preview.diff.changed.length > 0 && <div className="diff-role"><h4>Changed</h4>{preview.diff.changed.map(({ before, after }) => <span className="chip changed" key={after.name}>{after.name}: {before.cycle} → {after.cycle} min/pc{Number(before.pcsHr || 0) !== Number(after.pcsHr || 0) ? `, ${before.pcsHr || 0} → ${after.pcsHr || 0} pcs/hr` : ''}</span>)}</div>}
          {preview.diff.missing.length > 0 && <div className="diff-role"><h4>Not in paste</h4>{preview.diff.missing.map(m => <label className={`chip missing ${remove.includes(m.name) ? 'removing' : ''}`} key={m.name}><input type="checkbox" checked={remove.includes(m.name)} onChange={() => toggle(m.name)}/>{m.name}</label>)}</div>}
          {!preview.diff.added.length && !preview.diff.changed.length && !preview.diff.missing.length && <p className="diff-none">No change</p>}</>}
      {(people ? Object.values(preview.diff).some(d => d.missing.length) : preview.diff.missing.length > 0) && <p className="hint">Names or models not in the paste are kept. Tick one to remove it.</p>}
      <div className="list-actions"><button className="btn secondary" type="button" disabled={!!busy} onClick={reset}><X size={17}/>Cancel</button><button className="btn primary" type="button" disabled={!!busy || (!changes && !!list)} onClick={save}><Save size={17}/>{busy === 'save' ? 'Saving…' : list ? `Save ${changes} change${changes === 1 ? '' : 's'}` : 'Save list'}</button></div>
    </div>}
  </section>;
}

export default function LineLists({ line }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  useEffect(() => {
    let disposed = false; setError(''); setData(null);
    api(`/admin/line-lists/${encodeURIComponent(line)}`).then(next => { if (!disposed) setData(next); }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [line, attempt]);
  return <div className="line-lists"><div className="page-intro"><div><h1>Names &amp; models · {line}</h1><p>Names come from Employees. The model list replaces this line’s Google link once saved.</p></div></div>
    {error && <div className="notice" role="alert">{error}<button className="text-btn" onClick={() => retry(v => v + 1)}><RefreshCw size={16}/>Retry</button></div>}
    {!data && !error && <PageSkeleton variant="cards" label="Loading lists"/>}
    {data && <div className="line-lists-grid"><LineStaff line={line}/><ListEditor line={line} kind="models" list={data.models} onSaved={saved => setData(d => ({ ...d, models: saved }))}/></div>}
  </div>;
}
