import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export default function SmoothSelect({ items, value, onChange, required = true, disabled = false, placeholder = 'Select…', ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState(ariaLabel || placeholder);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const trigger = useRef(null), panel = useRef(null), search = useRef({ text: '', time: 0 });
  const id = useId();
  const options = items.map(item => typeof item === 'object' ? item : { value: item, label: item });
  const selected = options.findIndex(item => String(item.value) === String(value));
  useEffect(() => {
    setLabel(ariaLabel || trigger.current.closest('label')?.querySelector(':scope > span')?.textContent || placeholder);
  }, [ariaLabel, placeholder]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
    const up = below < 200 && above > below;
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), width: rect.width,
      maxHeight: Math.max(80, Math.min(300, up ? above : below)),
      ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!trigger.current.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false); };
    const moved = event => { if (!panel.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', moved, true); window.removeEventListener('resize', moved); };
  }, [open]);
  useEffect(() => {
    if (open) panel.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  function expand() { setActive(Math.max(0, selected)); setOpen(true); }
  function choose(index) {
    const item = options[index];
    if (!item || disabled) return;
    onChange(item.value); setOpen(false); trigger.current.focus();
  }
  function keyDown(event) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { expand(); return; }
      setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (open) choose(active); else expand();
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    } else if (event.key === 'Tab') setOpen(false);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now(); search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
      const match = options.findIndex(item => String(item.label).toLowerCase().startsWith(search.current.text));
      if (!open) expand();
      if (match >= 0) setActive(match);
    }
  }
  return <span className="smooth-select">
    <button ref={trigger} type="button" className="smooth-select-trigger" role="combobox" aria-label={label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={id} aria-required={required}
      aria-activedescendant={open && options.length ? `${id}-${active}` : undefined}
      disabled={disabled} onClick={() => open ? setOpen(false) : expand()} onKeyDown={keyDown}>
      <span>{selected >= 0 ? options[selected].label : placeholder}</span><ChevronDown size={18}/>
    </button>
    <select className="smooth-select-validation" aria-hidden="true" tabIndex={-1} required={required} disabled={disabled}
      value={value ?? ''} onChange={event => onChange(event.target.value)} onInvalid={event => { event.preventDefault(); trigger.current.focus(); expand(); }}>
      <option value=""/>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    {createPortal(<div ref={panel} id={id} role="listbox" aria-label={label} aria-hidden={!open} inert={!open}
      className="smooth-select-panel" data-open={open} style={position}>
      {options.map((item, index) => <div key={item.value} id={`${id}-${index}`} role="option" aria-selected={index === selected}
        data-active={index === active} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{item.label}</span>{index === selected && <Check size={17}/>}</div>)}
    </div>, document.body)}
  </span>;
}
