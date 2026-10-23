/** Verify the Windows setup executable and its adjacent installer payload. */
import { open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const zstandardMagic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

interface InstallerMetadata {
  identifier: string
  name: string
  channel: string
  hash: string
}

/** Reject a setup executable that is not a valid x64 Windows PE image.
 * @param contents - Setup executable bytes.
 */
export function verifyWindowsSetupExecutable(contents: Buffer): void {
  if (contents.length < 512 || contents.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('Windows setup executable is missing or invalid')
  }
  const peOffset = contents.readUInt32LE(0x3c)
  if (peOffset > contents.length - 6
    || contents.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
    || contents.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error('Windows setup executable is not an x64 PE file')
  }
}

/** Verify the files required to run the packaged Windows installer.
 * @param extractedRoot - Directory produced by expanding the installer ZIP.
 * @param appName - Accepted package name or names, including explicitly supported legacy names.
 * @param identifier - Application identifier recorded in the installer metadata.
 * @returns Verified setup executable path inside the extracted directory.
 */
export async function verifyWindowsInstallerContents(
  extractedRoot: string,
  appName: string | readonly string[],
  identifier: string,
): Promise<string> {
  const rootEntries = await readdir(extractedRoot, { withFileTypes: true })
  const names = typeof appName === 'string' ? [appName] : appName
  const selectedName = names.find(name => rootEntries.some(entry => entry.name === name + '-Setup.exe' && entry.isFile()))
  const setupName = selectedName + '-Setup.exe'
  const metadataName = selectedName + '-Setup.metadata.json'
  const archiveName = selectedName + '-Setup.tar.zst'
  if (!selectedName || rootEntries.length !== 2
    || !rootEntries.some(entry => entry.name === setupName && entry.isFile())
    || !rootEntries.some(entry => entry.name === '.installer' && entry.isDirectory())) {
    throw new Error('Windows setup ZIP is missing its setup executable or installer payload directory')
  }
  verifyWindowsSetupExecutable(await readFile(join(extractedRoot, setupName)))

  const payloadRoot = join(extractedRoot, '.installer')
  const payloadEntries = await readdir(payloadRoot, { withFileTypes: true })
  if (payloadEntries.length !== 2
    || !payloadEntries.some(entry => entry.name === metadataName && entry.isFile())
    || !payloadEntries.some(entry => entry.name === archiveName && entry.isFile())) {
    throw new Error('Windows installer payload is missing its metadata or compressed application')
  }
  const metadata = JSON.parse(await readFile(join(payloadRoot, metadataName), 'utf8')) as unknown
  if (!isInstallerMetadata(metadata)
    || metadata.identifier !== identifier
    || metadata.name !== selectedName
    || metadata.channel !== 'stable') {
    throw new Error('Windows installer metadata does not match this application')
  }
  const archive = await open(join(payloadRoot, archiveName), 'r')
  try {
    const magic = Buffer.alloc(zstandardMagic.length)
    const { bytesRead } = await archive.read(magic, 0, magic.length, 0)
    if (bytesRead !== magic.length || !magic.equals(zstandardMagic)) {
      throw new Error('Windows installer application payload is not a Zstandard archive')
    }
  } finally {
    await archive.close()
  }
  return join(extractedRoot, setupName)
}

function isInstallerMetadata(value: unknown): value is InstallerMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const metadata = value as Record<string, unknown>
  return typeof metadata.identifier === 'string'
    && typeof metadata.name === 'string'
    && typeof metadata.channel === 'string'
    && typeof metadata.hash === 'string'
    && metadata.hash.length > 0
}
