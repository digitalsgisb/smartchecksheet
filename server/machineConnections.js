export function createMachineConnections({ mode, lines, machines, workspaceFor }) {
  return (req, res) => {
    if (req.user?.role !== 'developer') return res.status(403).json({ error: 'Developer access required.' });
    return res.json({ mode, checkedAt: new Date().toISOString(), lines: lines().filter(line => req.user.lines.includes(line)).map(line => {
      const config = machines.get(line);
      if (!config) return { line, configured: false, status: 'manual', connected: false, brokerConnected: false, lastTelemetryAt: null, broker: null, reason: mode === 'attendance' ? 'App is in manual recording mode.' : 'No machine connection configured for this line.' };
      const status = workspaceFor(line).connectionStatus();
      return { line, configured: true, ...status, status: status.connected ? 'connected' : 'disconnected', broker: new URL(config.mqttUrl).host, reason: status.connected ? 'Receiving fresh machine data.' : status.brokerConnected ? 'Broker connected; waiting for fresh machine data.' : 'MQTT broker disconnected.' };
    }) });
  };
}
