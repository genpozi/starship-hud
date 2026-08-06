import * as THREE from 'three'

/**
 * GALAXY-3D // Procedural deep-space scene
 * Renders a rotating spiral galaxy, dust nebula, planets with rings,
 * and a far starfield behind the HUD. Slow auto-rotation with
 * subtle mouse parallax for immersion.
 */

const WIDTH = () => window.innerWidth
const HEIGHT = () => window.innerHeight

export function createGalaxy(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(WIDTH(), HEIGHT())

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, WIDTH() / HEIGHT(), 0.1, 2000)
  camera.position.set(0, 6, 14)
  camera.lookAt(0, 0, 0)

  const group = new THREE.Group()
  scene.add(group)

  // ---- Stars: layered starfield, depth sorted ---- //
  const starsGeo = new THREE.BufferGeometry()
  const STAR_COUNT = 4200
  const starsPos = new Float32Array(STAR_COUNT * 3)
  const starsColor = new Float32Array(STAR_COUNT * 3)
  const starPalette = [0.9, 0.9, 1.0, 0.8, 0.9, 1.0, 1.0, 0.95, 0.85, 0.7, 0.8, 1.0, 1.0, 1.0, 1.0]
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = 300 + Math.random() * 700
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    starsPos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    starsPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    starsPos[i * 3 + 2] = r * Math.cos(phi)
    const ci = Math.floor(Math.random() * 5) * 3
    starsColor[i * 3] = starPalette[ci]
    starsColor[i * 3 + 1] = starPalette[ci + 1]
    starsColor[i * 3 + 2] = starPalette[ci + 2]
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3))
  starsGeo.setAttribute('color', new THREE.BufferAttribute(starsColor, 3))
  const starsMat = new THREE.PointsMaterial({
    size: 1.4,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  })
  group.add(new THREE.Points(starsGeo, starsMat))

  // ---- Nebula glow: large soft sprites ---- //
  function makeGlowSprite(radius, color, opacity) {
    const size = 1024
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, `rgba(${color},1)`)
    grad.addColorStop(0.25, `rgba(${color},0.35)`)
    grad.addColorStop(1, `rgba(${color},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(c)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(radius, radius, 1)
    return sprite
  }

  const nebula1 = makeGlowSprite(90, '38,80,255', 0.14)
  nebula1.position.set(-40, 20, -90)
  group.add(nebula1)
  const nebula2 = makeGlowSprite(120, '255,60,160', 0.09)
  nebula2.position.set(60, -30, -140)
  group.add(nebula2)
  const nebula3 = makeGlowSprite(70, '0,229,255', 0.10)
  nebula3.position.set(10, 50, -60)
  group.add(nebula3)

  // ---- Spiral galaxy: procedural particle arms ---- //
  function createGalaxyDisc() {
    const count = 26000
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const arms = 4
    const innerR = 1.2
    const outerR = 7.5
    const colorInner = new THREE.Color('#ffb347')
    const colorOuter = new THREE.Color('#00e5ff')

    for (let i = 0; i < count; i++) {
      const radius = innerR + Math.pow(Math.random(), 1.4) * (outerR - innerR)
      const branch = (i % arms) / arms * Math.PI * 2
      const spin = radius * 1.15
      const rand = Math.random()
      const randX = rand > 0.7 ? (Math.random() - 0.5) * 1.4 : (Math.random() - 0.5) * 0.35
      const randY = rand > 0.7 ? (Math.random() - 0.5) * 0.55 : (Math.random() - 0.5) * 0.14
      const randZ = rand > 0.7 ? (Math.random() - 0.5) * 1.4 : (Math.random() - 0.5) * 0.35
      const angle = branch + spin + randX

      pos[i * 3] = Math.cos(angle) * radius + randX * 0.5
      pos[i * 3 + 1] = randY
      pos[i * 3 + 2] = Math.sin(angle) * radius + randZ * 0.5

      const t = (radius - innerR) / (outerR - innerR)
      const c = colorInner.clone().lerp(colorOuter, t)
      const tw = 0.7 + Math.random() * 0.5
      col[i * 3] = c.r * tw
      col[i * 3 + 1] = c.g * tw
      col[i * 3 + 2] = c.b * tw
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const mat = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    })
    return new THREE.Points(geo, mat)
  }

  const galaxy = createGalaxyDisc()
  galaxy.rotation.x = 1.05
  group.add(galaxy)

  // ---- Core glow ---- //
  const core = makeGlowSprite(9, '255,200,120', 0.85)
  core.position.y = 0.1
  group.add(core)

  // ---- Planets with rings ---- //
  function createPlanet({ radius, color, pos, ring = null, glow }) {
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 48),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.15,
        emissive: new THREE.Color(color).multiplyScalar(glow || 0.12)
      })
    )
    planet.position.set(...pos)
    group.add(planet)

    if (ring) {
      const ringGeo = new THREE.RingGeometry(ring.inner, ring.outer, 96)
      const ringMat = new THREE.MeshBasicMaterial({
        color: ring.color,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const ringMesh = new THREE.Mesh(ringGeo, ringMat)
      ringMesh.rotation.x = Math.PI / 2 + ring.tilt || 0
      ringMesh.position.set(...pos)
      group.add(ringMesh)
    }
    return planet
  }

  const planets = [
    createPlanet({ radius: 0.9, color: 0xff7a3d, pos: [-6.5, 1.6, -4], glow: 0.2 }),
    createPlanet({
      radius: 1.5,
      color: 0x4f7cff,
      pos: [9, -1.8, -8],
      ring: { inner: 2.0, outer: 3.2, color: 0x00e5ff, tilt: 0.35 },
      glow: 0.15
    }),
    createPlanet({ radius: 0.65, color: 0x39ff88, pos: [4.5, 3.2, 2], glow: 0.25 }),
    createPlanet({ radius: 2.1, color: 0xb455ff, pos: [-11, -2.6, -14], ring: { inner: 2.6, outer: 3.9, color: 0xff4fd8, tilt: -0.2 }, glow: 0.12 }),
    createPlanet({ radius: 0.5, color: 0xffb347, pos: [-2.5, -3.4, 3], glow: 0.3 }),
    createPlanet({ radius: 1.1, color: 0x2bd4c8, pos: [7, 2.4, -3.5], glow: 0.2 })
  ]

  // ---- Lighting ---- //
  scene.add(new THREE.AmbientLight(0x334466, 1.4))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
  keyLight.position.set(10, 12, 8)
  scene.add(keyLight)
  const accentLight = new THREE.PointLight(0x00e5ff, 12, 60)
  accentLight.position.set(-8, 4, -6)
  scene.add(accentLight)
  const warmLight = new THREE.PointLight(0xffb347, 8, 40)
  warmLight.position.set(8, -2, -4)
  scene.add(warmLight)

  // ---- Interaction: mouse parallax ---- //
  let targetRot = { x: 0, y: 0 }
  let curRot = { x: 0, y: 0 }
  window.addEventListener('mousemove', (e) => {
    targetRot.x = (e.clientY / window.innerHeight - 0.5) * 0.35
    targetRot.y = (e.clientX / window.innerWidth - 0.5) * 0.5
  })

  // ---- Resize ---- //
  window.addEventListener('resize', () => {
    camera.aspect = WIDTH() / HEIGHT()
    camera.updateProjectionMatrix()
    renderer.setSize(WIDTH(), HEIGHT())
  })

  const clock = new THREE.Clock()

  function tick() {
    const dt = clock.getDelta()
    const t = clock.elapsedTime

    galaxy.rotation.y += dt * 0.04
    core.scale.setScalar(1 + Math.sin(t * 1.5) * 0.04)

    planets.forEach((p, i) => {
      const base = p.position.clone()
      base.y += Math.sin(t * 0.4 + i) * 0.02
      base.x += Math.sin(t * 0.25 + i * 2) * 0.008
      base.z += Math.cos(t * 0.3 + i) * 0.008
      p.position.copy(base)
      p.rotation.y += dt * 0.08
    })

    group.rotation.x += (targetRot.x - group.rotation.x) * 0.02
    group.rotation.y += (targetRot.y - group.rotation.y) * 0.02

    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }

  tick()

  return { renderer, scene, camera }
}
