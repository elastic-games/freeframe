/** Portable camera bookmark. The review version and content digest are mandatory anchors. */
export type ModelView = {
  schema: 'freeframe-model-view/v1'
  versionId: string
  sha256: string
  objectMatrix: number[]
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  fov: number
  near: number
  far: number
  aspect: number
  clip: number
  time: number
}
export function isModelView(value: unknown): value is ModelView {
  if (!value || typeof value !== 'object') return false
  const v = value as ModelView
  const vector = (p: unknown) =>
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9)
  const valid =
    v.schema === 'freeframe-model-view/v1' &&
    typeof v.versionId === 'string' &&
    /^[0-9a-f-]{36}$/.test(v.versionId) &&
    /^[a-f0-9]{64}$/.test(v.sha256) &&
    Array.isArray(v.objectMatrix) &&
    v.objectMatrix.length === 16 &&
    v.objectMatrix.every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9,
    ) &&
    v.objectMatrix[3] === 0 &&
    v.objectMatrix[7] === 0 &&
    v.objectMatrix[11] === 0 &&
    v.objectMatrix[15] === 1 &&
    vector(v.position) &&
    vector(v.target) &&
    vector(v.up) &&
    Number.isFinite(v.fov) &&
    v.fov >= 10 &&
    v.fov <= 100 &&
    Number.isFinite(v.near) &&
    v.near > 0 &&
    Number.isFinite(v.far) &&
    v.far > v.near &&
    v.far <= 1e12 &&
    Number.isFinite(v.aspect) &&
    v.aspect >= 0.1 &&
    v.aspect <= 10 &&
    Number.isInteger(v.clip) &&
    v.clip >= -1 &&
    v.clip <= 999 &&
    Number.isFinite(v.time) &&
    v.time >= 0 &&
    v.time <= 86400
  if (!valid) return false
  const m = v.objectMatrix
  const determinant =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  return (
    Math.abs(determinant) >= 1e-18 &&
    v.position.reduce((sum, n, i) => sum + (n - v.target[i]) ** 2, 0) >= 1e-12 &&
    v.up.reduce((sum, n) => sum + n * n, 0) >= 1e-12 &&
    (v.clip !== -1 || v.time === 0)
  )
}

export const maxModelBytes = 16 * 1024 * 1024
/** Validate before GLTFLoader sees any URI. Unsupported codecs never fetch remote decoders. */
export function validateModel(bytes: ArrayBuffer): Record<string, unknown> {
  if (bytes.byteLength < 20 || bytes.byteLength > maxModelBytes)
    throw new Error('GLB must be between 20 bytes and 16 MiB.')
  const view = new DataView(bytes)
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error('Invalid GLB 2.0 header.')
  let offset = 12
  let document: Record<string, unknown> | undefined
  const kinds = new Set<number>()
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error('Invalid GLB chunk.')
    const size = view.getUint32(offset, true),
      kind = view.getUint32(offset + 4, true)
    if (size % 4 || offset + 8 + size > bytes.byteLength || kinds.has(kind))
      throw new Error('Invalid GLB chunk.')
    if (offset === 12) {
      if (kind !== 0x4e4f534a || size > 1048576) throw new Error('Invalid GLB metadata.')
      document = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, offset + 8, size)),
      )
    }
    kinds.add(kind)
    offset += size + 8
  }
  const asset = document?.asset as { version?: string } | undefined
  if (!document || asset?.version !== '2.0') throw new Error('GLB 2.0 is required.')
  const limits: Record<string, number> = {
    nodes: 10000,
    meshes: 10000,
    accessors: 20000,
    images: 256,
    buffers: 1,
    animations: 256,
  }
  for (const [key, max] of Object.entries(limits)) {
    const list = document[key]
    if (
      list !== undefined &&
      (!Array.isArray(list) ||
        list.length > max ||
        list.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
    )
      throw new Error('Model exceeds inspection limits.')
  }
  for (const buffer of (document.buffers ?? []) as { uri?: string }[])
    if (buffer.uri !== undefined) throw new Error('Use a self-contained GLB with embedded buffers.')
  for (const image of (document.images ?? []) as { uri?: string }[])
    if (
      image.uri !== undefined &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(image.uri)
    )
      throw new Error('Use embedded PNG, JPEG or WebP textures.')
  if (
    Array.isArray(document.extensionsRequired) &&
    document.extensionsRequired.some((x) =>
      [
        'KHR_draco_mesh_compression',
        'KHR_texture_basisu',
        'EXT_meshopt_compression',
        'KHR_meshopt_compression',
      ].includes(x),
    )
  )
    throw new Error('Export an uncompressed GLB for browser inspection.')
  // Cyclic node graphs recurse indefinitely in loaders. Also reject invalid references.
  for (const accessor of (document.accessors ?? []) as { count?: number }[])
    if (!Number.isInteger(accessor.count) || accessor.count! < 0 || accessor.count! > 2000000)
      throw new Error('Model accessor exceeds inspection limits.')
  const nodes = (document.nodes ?? []) as { children?: number[] }[]
  const visiting = new Set<number>(),
    complete = new Set<number>()
  const visit = (i: number, depth: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= nodes.length || visiting.has(i) || depth > 256)
      throw new Error('Invalid model node graph.')
    if (complete.has(i)) return
    visiting.add(i)
    if (nodes[i].children !== undefined && !Array.isArray(nodes[i].children))
      throw new Error('Invalid model node graph.')
    for (const child of nodes[i].children ?? []) visit(child, depth + 1)
    visiting.delete(i)
    complete.add(i)
  }
  nodes.forEach((_, i) => visit(i, 0))
  return document
}
