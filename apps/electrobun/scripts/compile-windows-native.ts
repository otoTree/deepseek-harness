/** Compile a Windows C helper with Zig or the active Visual Studio toolchain. */
import { execFileSync } from 'node:child_process'
import { basename, dirname, extname, join } from 'node:path'

/** Compile one x64 Windows helper and link its required system libraries.
 * @param source - absolute C source path.
 * @param output - absolute `.exe` output path.
 * @param libraries - Windows SDK libraries required by the helper.
 * @param defines - Build-owned preprocessor symbols; enterprise callers omit them.
 */
export function compileWindowsNative(source: string, output: string, libraries: string[] = [], defines: readonly string[] = []): void {
  const zig = process.env.ZIG ?? 'zig'
  if (process.env.ZIG) {
    compileWithZig(zig, source, output, libraries, defines)
    return
  }
  try {
    compileWithZig(zig, source, output, libraries, defines)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    const object = join(dirname(output), `${basename(output, extname(output))}.obj`)
    try {
      execFileSync('cl.exe', [
        '/nologo', '/O2', '/W4', '/WX', '/MT', '/std:c17', '/DUNICODE', '/D_UNICODE',
        ...defines.map(symbol => `/D${symbol}`), `/Fo${object}`, `/Fe${output}`, source, '/link', ...libraries,
      ], { stdio: 'inherit' })
    } catch (compilerError) {
      if ((compilerError as NodeJS.ErrnoException).code !== 'ENOENT') throw compilerError
      throw new Error('Windows native helpers require Zig or Visual Studio C++ Build Tools in PATH', { cause })
    }
  }
}

function compileWithZig(zig: string, source: string, output: string, libraries: string[], defines: readonly string[]): void {
  execFileSync(zig, [
    'cc', '-target', 'x86_64-windows-gnu', '-Os', '-Wall', '-Wextra', '-Werror', '-municode',
    ...defines.map(symbol => `-D${symbol}`), source, ...libraries.map(library => `-l${library.replace(/\.lib$/i, '')}`), '-o', output,
  ], { stdio: 'inherit' })
}
