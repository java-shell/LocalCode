import { app, crashReporter } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { startNativeCrashReporter } from '../../backend/nativeCrashReporter';

// Dedicated, opt-in test process: never load LocalCode or its real user profile.
const profile = process.argv[2];
if (!profile) throw new Error('An isolated test profile is required');
const dumps = path.join(profile, 'Crashpad');
fs.mkdirSync(dumps, { recursive: true, mode: 0o700 });
app.setPath('userData', profile);
app.setPath('crashDumps', dumps);
if (!startNativeCrashReporter(app, crashReporter)) app.exit(2);

// Linux self-signals SIGTRAP to exercise the reported signal specifically;
// Electron's process.crash() uses SIGSEGV here, so use it only on other platforms.
app.whenReady().then(() => {
	if (process.platform === 'linux') process.kill(process.pid, 'SIGTRAP');
	else process.crash();
});