export function modeRequestStatus(request, reportedMode, commands = []) {
  if (!request) return 'idle';
  if (reportedMode === request.mode) return 'confirmed';
  const command = commands.find(item => item.id === request.id);
  if (command && ['confirmed', 'rejected', 'failed', 'unconfirmed'].includes(command.status)) return command.status;
  return request.id ? 'pending' : 'sending';
}
