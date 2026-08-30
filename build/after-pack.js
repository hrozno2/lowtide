'use strict';
/*
 * Ad-hoc sign the macOS bundle when no Developer ID is available.
 *
 * Apple Silicon refuses to run an arm64 binary whose signature is missing or
 * broken, and reports it as "damaged" — which reads like a corrupt download
 * rather than a security prompt. electron-builder leaves the bundle unsigned
 * when there is no identity, so the seal never covers the app's resources.
 *
 * An ad-hoc signature does not make the app trusted: macOS still warns that the
 * developer is unidentified, and the user still has to right-click and choose
 * Open. But the app launches, which it otherwise cannot. Proper notarisation
 * needs a paid Apple Developer account and would remove the warning entirely.
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  // A real identity, if one exists, has already been used by electron-builder.
  let hasIdentity = false;
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'],
      { encoding: 'utf8' });
    hasIdentity = !/0 valid identities found/.test(out);
  } catch {
    hasIdentity = false;
  }
  if (hasIdentity) {
    console.log('  • a signing identity is present; leaving the signature alone');
    return;
  }

  console.log(`  • ad-hoc signing ${appName} so Apple Silicon will launch it`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
