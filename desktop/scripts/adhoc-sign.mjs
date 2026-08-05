import { execFileSync } from 'node:child_process';
import path from 'node:path';

// electron-builder skips signing (identity: null), which leaves the app with
// only the Electron binary's linker signature. macOS on Apple silicon rejects
// that as damaged. Ad-hoc sign the packed bundle so the app launches.
export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  execFileSync('codesign', ['--verify', '--strict', appPath], {
    stdio: 'inherit',
  });
}
