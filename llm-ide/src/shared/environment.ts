// Single source of truth for the runtime environment block injected into
// system prompts (chat + orchestration). Both paths call this so the model
// always knows which OS it is running on and where its working directory is.

export function formatEnvironmentGuidance(workspaceDir?: string): string {
  const platform = process.platform;
  let osName: string;
  switch (platform) {
    case 'win32':
      osName = 'Windows';
      break;
    case 'darwin':
      osName = 'macOS';
      break;
    case 'linux':
      osName = 'Linux';
      break;
    default:
      osName = platform;
  }

  const dir = (workspaceDir && String(workspaceDir).trim()) || process.cwd();

  return [
    'Environment information:',
    `- Operating system: ${osName} (Node.js process.platform: ${platform})`,
    `- Working directory: ${dir}`,
    'Use native commands appropriate for this OS. On Windows, prefer cmd.exe/PowerShell syntax; on Linux/macOS, use Unix-style commands.'
  ].join('\n');
}
