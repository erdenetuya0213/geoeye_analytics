const { execFileSync } = require('node:child_process')

/**
 * Electron's sandboxed Windows processes must be able to read the packaged
 * runtime. Some source-controlled/build folders do not inherit the standard
 * application-package ACL, which makes Electron stop at startup with
 * 0x80000003 before the renderer is created.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  execFileSync('icacls.exe', [
    context.appOutDir,
    '/grant',
    '*S-1-15-2-1:(OI)(CI)(RX)',
    '/T',
    '/C',
  ], { stdio: 'inherit' })
}
