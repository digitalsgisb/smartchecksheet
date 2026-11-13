import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// A number that ticks briefly when its value changes, so a new count is noticed without reading it twice.
export function Num({ value }) {
  const previous = useRef(value), changes = useRef(0);
  if (previous.current !== value) { previous.current = value; changes.current++; }
  // <data> rather than <span>: older rules style every span inside the count tiles.
  return <data key={changes.current} value={value} className={changes.current ? 'num-tick' : undefined}>{value}</data>;
}

export function Skeleton({ w, h = 16, r, className = '', i = 0 }) { return <span className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: r, '--i': i }} aria-hidden="true"/>; }
const many = (count, render) => Array.from({ length: count }, (_, i) => render(i));
function Block({ h, i, children }) { return <div className="skeleton-block" style={{ minHeight: h, '--i': i }} aria-hidden="true">{children}</div>; }
function Lines({ widths = ['40%', '90%', '70%'], i = 0 }) { return <>{widths.map((w, n) => <Skeleton key={n} w={w} h={n ? 12 : 18} i={i}/>)}</>; }

const layouts = {
  checksheet: () => <><Skeleton w="100%" h={56} r={10}/><Block h={60}><Lines widths={['35%', '20%']}/></Block><div className="skeleton-grid cols-2">{many(2, i => <Block key={i} h={54} i={i}><Lines widths={['30%', '55%']} i={i}/></Block>)}</div><Block h={110} i={1}><Lines widths={['25%', '100%', '100%']} i={1}/></Block><div className="skeleton-grid cols-3">{many(3, i => <Block key={i} h={64} i={i + 1}><Lines widths={['50%', '40%']} i={i + 1}/></Block>)}</div><div className="skeleton-grid cols-2">{many(4, i => <Skeleton key={i} w="100%" h={72} r={12} i={i + 2}/>)}</div></>,
  table: () => <><Lines widths={['32%', '48%']}/><div className="skeleton-grid cols-4">{many(4, i => <Block key={i} h={104} i={i}><Lines widths={['55%', '40%', '75%']} i={i}/></Block>)}</div><Block h={300} i={2}>{many(6, i => <Skeleton key={i} w="100%" h={30} r={6} i={i + 2}/>)}</Block></>,
  board: () => <><Lines widths={['30%']}/><div className="skeleton-grid cols-2">{many(4, i => <Skeleton key={i} w="100%" h={230} r={16} i={i}/>)}</div></>,
  cards: () => <><Lines widths={['32%', '48%']}/><div className="skeleton-grid cols-auto">{many(6, i => <Block key={i} h={150} i={i}><Lines i={i}/></Block>)}</div></>,
  grid: () => <div className="skeleton-grid cols-auto">{many(6, i => <Block key={i} h={150} i={i}><Lines i={i}/></Block>)}</div>,
  people: () => <><div className="skeleton-grid cols-2">{many(2, i => <Block key={i} h={84} i={i}><Lines widths={['40%', '25%']} i={i}/></Block>)}</div><div className="skeleton-grid cols-auto">{many(8, i => <Block key={i} h={92} i={i + 1}><div className="skeleton-row"><Skeleton w={56} h={56} r={12} i={i + 1}/><div><Lines widths={['70%', '45%']} i={i + 1}/></div></div></Block>)}</div></>,
  list: () => <>{many(4, i => <Block key={i} h={58} i={i}><Lines widths={['45%', '80%']} i={i}/></Block>)}</>,
  rows: () => <>{many(5, i => <Skeleton key={i} w="100%" h={30} r={6} i={i}/>)}</>
};
// Stands in for content that is still loading; the label is announced to screen readers only.
export function PageSkeleton({ variant = 'cards', label = 'Loading' }) { return <div className={`skeleton-page skeleton-${variant}`} role="status" aria-busy="true"><span className="sr-only">{label}</span>{(layouts[variant] || layouts.cards)()}</div>; }

// Cross-fades (with blur) between two states of a control, so the old and new label or icon overlap instead of snapping.
export function Swap({ id, children }) {
  const last = useRef({ id, node: children }), changes = useRef(0);
  const [leaving, setLeaving] = useState(null);
  if (last.current.id !== id) { const old = last.current; last.current = { id, node: children }; changes.current++; setLeaving({ ...old, n: changes.current }); }
  else last.current.node = children;
  useEffect(() => { if (!leaving) return; const timer = setTimeout(() => setLeaving(null), 260); return () => clearTimeout(timer); }, [leaving]);
  // Custom tags, not spans: older rules restyle every span inside banners, tabs and tiles.
  return <swap-box>{leaving && <swap-item key={`out-${leaving.n}`} data-state="out" aria-hidden="true">{leaving.node}</swap-item>}<swap-item key={`in-${changes.current}`} data-state={changes.current ? "in" : undefined}>{children}</swap-item></swap-box>;
}

// Positions a sliding highlight behind the selected item of a group (mode switch, tabs, filters, menu).
// Put the returned ref on the group and give it the class "slide-group"; CSS draws and animates the bar.
export function useIndicator(selector = '[aria-pressed=true],[aria-selected=true],[aria-current=page],.active,.selected') {
  const ref = useRef(null);
  const place = useCallback(() => {
    const box = ref.current; if (!box) return;
    const item = box.querySelector(selector);
    box.dataset.indicator = item ? 'on' : 'off';
    if (item) for (const [name, value] of [['x', item.offsetLeft], ['y', item.offsetTop], ['w', item.offsetWidth], ['h', item.offsetHeight]]) box.style.setProperty(`--ind-${name}`, `${value}px`);
  }, [selector]);
  useLayoutEffect(place);
  useEffect(() => {
    const box = ref.current; if (!box) return;
    const observer = new ResizeObserver(place); observer.observe(box);
    const frame = requestAnimationFrame(() => { box.dataset.ready = 'true'; }); // no slide on first paint
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [place]);
  return ref;
}

export function SlideGroup({ as: Tag = 'div', selector, className = '', children, ...rest }) { const ref = useIndicator(selector); return <Tag ref={ref} className={`slide-group ${className}`} {...rest}>{children}</Tag>; }

// Shared-element transition: the control that was pressed grows into the dialog or page it opens, and shrinks back on close.
// Falls back to a plain update where the browser has no View Transitions or the user prefers reduced motion.
let pressed = null, pressedAt = 0, home = null;
if (typeof document !== 'undefined') document.addEventListener('click', event => { pressed = event.target.closest?.('button,a'); pressedAt = performance.now(); }, true);
export function morph(update, mode) {
  if (typeof document === 'undefined' || !document.startViewTransition || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  const surface = () => document.querySelector('.modal,.downtime-page');
  let source = null;
  if (mode === 'open') { source = !surface() && performance.now() - pressedAt < 600 && pressed?.isConnected ? pressed : null; home = source; if (source) source.style.viewTransitionName = 'morph'; }
  if (mode === 'back') source = home;
  const transition = document.startViewTransition(() => {
    if (mode === 'open' && source) source.style.viewTransitionName = '';
    flushSync(update);
    if (mode === 'back' && source?.isConnected && !surface()) source.style.viewTransitionName = 'morph';
  });
  transition.ready.catch(() => {}); // a skipped animation is fine: the update itself still runs
  transition.finished.catch(() => {}).finally(() => { if (source) source.style.viewTransitionName = ''; });
}
