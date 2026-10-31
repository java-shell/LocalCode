import { app, crashReporter } from 'electron';
import { startNativeCrashReporter } from './nativeCrashReporter';

// Imported first by main.ts so Crashpad starts before other application modules load.
startNativeCrashReporter(app, crashReporter);