export function machineStatus(live, connected, timer) {
  if (!connected) return { key: 'disconnected', label: 'Disconnected' };
  const status = String(live.status || '').toLowerCase();
  const mode = String(live.mode || '').toLowerCase();
  if (timer?.status === 'running' || /down|fault|stop/.test(status) || /down|stop/.test(mode)) return { key: 'down', label: 'Down' };
  if (status.includes('model') || mode.includes('model')) return { key: 'change', label: 'Model change' };
  if (status === 'rest' || mode === 'rest') return { key: 'rest', label: 'Rest' };
  if (status === 'loading') return { key: 'loading', label: 'Loading' };
  if (status === 'running') return { key: 'running', label: 'Running' };
  return { key: 'waiting', label: 'Waiting' };
}
