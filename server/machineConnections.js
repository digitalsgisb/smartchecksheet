export function createMachineConnections({ mode, lines, machines, workspaceFor, registry = null }) {
  return (req, res) => {
    if (req.user?.role !== 'developer') return res.status(403).json({ error: 'Developer access required.' });
    const appLines = registry?.lines() || [];
    return res.json({ mode, checkedAt: new Date().toISOString(), canConnect: mode !== 'demo', lines: lines().filter(line => req.user.lines.includes(line)).map(line => {
      const config = machines.get(line), settings = registry?.settings(line) || null, removable = appLines.includes(line) && !settings;
      if (!config) return { line, configured: false, status: 'manual', connected: false, brokerConnected: false, lastTelemetryAt: null, broker: null, settings, removable, reason: settings && !settings.readable ? 'Saved Pi login cannot be read on this PC. Enter the broker password again.' : 'No Pi connected. This line uses manual recording.' };
      const status = workspaceFor(line).connectionStatus();
      return { line, configured: true, ...status, status: status.connected ? 'connected' : 'disconnected', broker: new URL(config.mqttUrl).host, settings, removable, reason: status.connected ? 'Receiving fresh machine data.' : status.brokerConnected ? 'Broker connected; waiting for fresh machine data.' : 'Cannot reach the Pi broker.' };
    }) });
  };
}
