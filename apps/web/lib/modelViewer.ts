import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { isModelView, validateModel, type ModelView } from './modelView'

export type ModelViewer = {
  reset: () => void
  lock: (locked: boolean) => void
  capture: () => ModelView
  restore: (view: ModelView) => boolean
  clipNames: string[]
  setPose: (clip: number, time: number) => void
  duration: (clip: number) => number
  destroy: () => void
}
/** All rendering is local; the caller owns authenticated loading, request cancellation and digest verification. */
export async function createModelViewer(
  host: HTMLElement,
  bytes: ArrayBuffer,
  versionId: string,
  sha256: string,
): Promise<ModelViewer> {
  validateModel(bytes)
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (!url.startsWith('blob:') && !/^data:image\/(png|jpeg|webp);base64,/.test(url))
      throw new Error('External model resources are disabled.')
    return url
  })
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, '')
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x26282c)
  const model = gltf.scene
  scene.add(model)
  const disposeModel = () => {
    const textures = new Set<THREE.Texture>()
    model.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      if (mesh.material)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value)
          material.dispose()
        }
    })
    for (const texture of Array.from(textures)) {
      const source = texture.source.data
      if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
      texture.dispose()
    }
  }
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  } catch (e) {
    disposeModel()
    throw e
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  host.appendChild(renderer.domElement)
  renderer.domElement.setAttribute(
    'aria-label',
    'Interactive 3D model. Drag to orbit, right drag to pan, scroll to zoom.',
  )
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.tabIndex = 0
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666a78, 3))
  const light = new THREE.DirectionalLight(0xffffff, 3)
  light.position.set(3, 5, 4)
  scene.add(light)
  const bounds = new THREE.Box3().setFromObject(model)
  if (
    bounds.isEmpty() ||
    ![bounds.min, bounds.max].every((v) => [v.x, v.y, v.z].every(Number.isFinite))
  ) {
    renderer.dispose()
    renderer.domElement.remove()
    disposeModel()
    throw new Error('Model has no inspectable geometry.')
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.001)
  const camera = new THREE.PerspectiveCamera(45, 1, radius / 1000, radius * 1000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.minDistance = radius * 0.02
  controls.maxDistance = radius * 100
  const mixer = new THREE.AnimationMixer(model)
  let clip = -1,
    time = 0,
    dead = false
  const render = () => {
    if (!dead) renderer.render(scene, camera)
  }
  const size = () => {
    if (dead) return
    const width = host.clientWidth,
      height = host.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    render()
  }
  const reset = () => {
    camera.up.set(0, 1, 0)
    camera.fov = 45
    const distance =
      (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) *
      Math.max(1, 1 / camera.aspect) *
      1.12
    camera.position
      .copy(center)
      .add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance))
    controls.target.copy(center)
    camera.updateProjectionMatrix()
    controls.update()
    render()
  }
  const setPose = (index: number, seconds: number) => {
    if (
      !Number.isInteger(index) ||
      index < -1 ||
      index >= gltf.animations.length ||
      !Number.isFinite(seconds) ||
      seconds < 0
    )
      return
    mixer.stopAllAction()
    clip = index
    time = index === -1 ? 0 : Math.min(seconds, gltf.animations[index].duration)
    if (index !== -1) {
      const action = mixer.clipAction(gltf.animations[index])
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
      mixer.setTime(time)
    }
    render()
  }
  controls.addEventListener('change', render)
  const observer = new ResizeObserver(size)
  observer.observe(host)
  size()
  reset()
  return {
    reset,
    setPose,
    clipNames: gltf.animations.map((c, i) => c.name || `Animation ${i + 1}`),
    duration: (index) => gltf.animations[index]?.duration ?? 0,
    lock: (locked) => {
      controls.enabled = !locked
    },
    capture: () => ({
      schema: 'freeframe-model-view/v1',
      versionId,
      sha256,
      objectMatrix: model.matrix.toArray(),
      position: camera.position.toArray() as ModelView['position'],
      target: controls.target.toArray() as ModelView['target'],
      up: camera.up.toArray() as ModelView['up'],
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
      aspect: camera.aspect,
      clip,
      time,
    }),
    restore: (view) => {
      if (
        !isModelView(view) ||
        view.versionId !== versionId ||
        view.sha256 !== sha256 ||
        view.clip >= gltf.animations.length
      )
        return false
      model.matrixAutoUpdate = false
      model.matrix.fromArray(view.objectMatrix)
      model.matrixWorldNeedsUpdate = true
      camera.position.fromArray(view.position)
      controls.target.fromArray(view.target)
      camera.up.fromArray(view.up)
      camera.near = view.near
      camera.far = view.far
      camera.fov = view.fov
      camera.aspect = view.aspect
      camera.updateProjectionMatrix()
      setPose(view.clip, view.time)
      controls.update()
      render()
      return true
    },
    destroy: () => {
      if (dead) return
      dead = true
      observer.disconnect()
      controls.dispose()
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      disposeModel()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
