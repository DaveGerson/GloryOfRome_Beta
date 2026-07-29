import path from 'path';
import { execFileSync } from 'node:child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Windows Credential Manager target for the owner's dev-server key
 * (generic credential; store via the Credential Manager UI or
 * `cmdkey /generic:GloryOfRome:GEMINI_API_KEY /user:api /pass:<key>`).
 */
const CREDMAN_TARGET = 'GloryOfRome:GEMINI_API_KEY';

/**
 * Reads a generic credential's secret from Windows Credential Manager.
 * Runs in the DEV SERVER's Node process only - the browser can never
 * reach the OS credential store, so this is the one seam where the key
 * can be sourced without a plaintext .env file. Same D34 boundary as the
 * .env path: the caller gates on `command === 'serve'`, so the secret
 * never reaches `vite build` output.
 *
 * The blob is decoded as UTF-16LE because that is how both the
 * Credential Manager UI and `cmdkey` store generic-credential secrets.
 * Every failure mode (non-Windows, credential absent, empty blob,
 * PowerShell unavailable) returns undefined so the priority chain falls
 * through silently - absence of the credential is the normal state on
 * any machine not opted into this convenience.
 */
function readWindowsGenericCredential(target: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  // CredReadW via P/Invoke: stock Windows PowerShell 5.1, no modules.
  // The C# is a plain single-quoted PS string (no interpolation), and
  // `target` is a compile-time constant - nothing user-controlled is
  // spliced into the script.
  const script = `
$def = '
using System;
using System.Runtime.InteropServices;
public static class GorCredRead {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
}
'
Add-Type -TypeDefinition $def
$ptr = [IntPtr]::Zero
if ([GorCredRead]::CredReadW('${target}', 1, 0, [ref]$ptr)) {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][GorCredRead+CREDENTIAL])
  if ($cred.CredentialBlobSize -gt 0) {
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    [Console]::Out.Write([System.Text.Encoding]::Unicode.GetString($bytes))
  }
  [GorCredRead]::CredFree($ptr)
}
`;
  try {
    const secret = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true },
    ).trim();
    return secret.length > 0 ? secret : undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, '.', '');
    // Owner dev-key priority: an explicit .env beats the machine-global
    // credential store; the in-app configuration-menu key (localStorage)
    // beats both at runtime in App.tsx. Resolved only for `serve` so no
    // credential read ever happens during a build.
    const devGeminiKey = command === 'serve'
      ? (env.GEMINI_API_KEY || readWindowsGenericCredential(CREDMAN_TARGET))
      : undefined;
    if (command === 'serve' && !env.GEMINI_API_KEY && devGeminiKey) {
      console.log(`[gor] GEMINI_API_KEY sourced from Windows Credential Manager (${CREDMAN_TARGET})`);
    }
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // DESIGN_DECISIONS.md D34 - bring-your-own-key is the default path;
      // no server component, no build-time key injection into a
      // production bundle (that was the deploy blocker/billing leak this
      // ruling closes). `command === 'serve'` is true only for the local
      // dev server, never for `vite build` - so this convenience (reading
      // GEMINI_API_KEY from .env for the owner's own local play) never
      // reaches shipped output. App.tsx's dev-only read of this seam is
      // itself guarded by `import.meta.env.DEV` so a prod build never even
      // evaluates a `process` reference.
      define: command === 'serve' ? {
        'process.env.API_KEY': JSON.stringify(devGeminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(devGeminiKey)
      } : {},
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // Task 4b (bundle-triage.md, FIX_NOW_DEFECT): split slow-changing
      // node_modules code into stable, package-keyed vendor chunks so a
      // first-party code deploy doesn't invalidate the vendor cache for
      // returning players. Build-output shaping only; no import, lazy-load,
      // or runtime behavior change.
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('node_modules/react-dom')) {
                  return 'vendor-react-dom';
                }
                if (id.includes('node_modules/react')) {
                  return 'vendor-react';
                }
                if (id.includes('node_modules/@google/genai')) {
                  return 'vendor-genai';
                }
                return 'vendor-other';
              }
            },
          },
        },
      },
    };
});
