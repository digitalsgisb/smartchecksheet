import { pathToFileURL } from 'node:url';
import { attendanceConfig, attendanceFailure, createAttendanceSource } from './attendance.js';

const guidance = {
  ATTENDANCE_AUTH_FAILED: 'Attendance rejected the configured token. Match ATTENDANCE_TOKEN to the Attendance read-only integration token, then recreate Checksheet.',
  ATTENDANCE_HTTP_ERROR: 'The configured Attendance server returned an HTTP error. Check Attendance health and its server logs.',
  ATTENDANCE_NOT_JSON: 'The configured address returned a page instead of employee JSON. Check ATTENDANCE_API_URL and any proxy routing.',
  ATTENDANCE_SCOPE_INVALID: 'The server did not return the read-only integration feed. Check the Attendance version and use its integration token, not an admin or kiosk token.',
  ATTENDANCE_TIMEOUT: 'Attendance did not respond within five seconds. Check container connectivity and Attendance health.',
  ATTENDANCE_CONNECTION_FAILED: 'Checksheet cannot connect to the configured Attendance server. Check Docker networking, the hostname and the published port.',
  ATTENDANCE_RESPONSE_FAILED: 'Attendance could not be read. Check the Attendance server logs.',
};

export async function diagnoseAttendance(env = process.env, fetcher = fetch) {
  let config;
  try { config = attendanceConfig(env); }
  catch { return { ok: false, code: 'ATTENDANCE_CONFIG_INVALID', next: 'Check ATTENDANCE_API_URL and ATTENDANCE_GROUPS in the running container configuration.' }; }
  if (!config.url || !config.token || !config.groups.length) return { ok: false, code: 'ATTENDANCE_NOT_CONFIGURED', next: 'Set ATTENDANCE_API_URL, ATTENDANCE_TOKEN and ATTENDANCE_GROUPS, then recreate Checksheet.' };
  try {
    await createAttendanceSource(config, fetcher)();
    return { ok: true, code: 'ATTENDANCE_SOURCE_OK', next: 'The private feed works from this container. If the public page still returns HTML 502, check the Checksheet logs and public proxy/tunnel routing for /api/attendance.' };
  } catch (error) {
    const code = attendanceFailure(error);
    return { ok: false, code, next: guidance[code] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await diagnoseAttendance();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
