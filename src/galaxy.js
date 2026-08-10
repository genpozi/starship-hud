import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * GALAXY-3D // Procedural deep-space scene (premium pass)
 * Renders a rotating spiral galaxy with knot-clumped arms, a far starfield,
 * baked spiral nebula, and ringed planets behind the HUD. Upgrades:
 *  - ACES tone mapping + UnrealBloom postprocessing (guarded)
 *  - Hot-core + halo point shader with per-particle twinkle & flares
 *  - Knot clumping + rarity star population (yellow giants, orange/blue knots)
 *  - Depth/distance fade, baked fBm+Worley spiral nebula plane
 *  - Frame-rate independent camera parallax + autonomous sway
 *  - Adaptive quality watchdog (density -> pixelRatio -> bloom)
 */

const WIDTH = () => window.innerWidth
const HEIGHT = () => window.innerHeight
const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

// ---- Hot-core + halo point shader (galaxy disc AND far starfield) ---- //
const STAR_VERT = `
attribute float aSize;
attribute float aPhase;
attribute float aSpd;
attribute float aTwinkle;
attribute vec3 aColor;
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform float uScale;
varying vec3 vColor;
varying float vDist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = sin(uTime * aSpd + aPhase);
  float tw = 0.6 + 0.4 * s;
  if (aTwinkle > 0.5) {
    float flare = pow(max(0.0, sin(uTime * aSpd * 0.35 + aPhase * 3.1)), 24.0);
    tw += flare * 3.0;
  } else {
    tw = 0.9 + 0.1 * s;
  }
  float psize = aSize * uSize * uPixelRatio * (uScale / max(1.0, -mv.z)) * (0.65 + 0.45 * tw);
  gl_PointSize = psize;
  vColor = aColor * tw;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const STAR_FRAG = `
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vColor;
varying float vDist;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float halo = pow(max(0.0, 1.0 - d), 2.2) * 0.65;
  float core = exp(-d * d * 18.0);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDist);
  gl_FragColor = vec4(vColor * (halo + core) * fade, 1.0);
}
`

export function createGalaxy(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  })
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(WIDTH(), HEIGHT())
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, WIDTH() / HEIGHT(), 0.1, 3000)
  const CAM_BASE = new THREE.Vector3(0, 6, 14)
  camera.position.copy(CAM_BASE)
  camera.lookAt(0, 0, 0)

  const disc = new THREE.Group()
  scene.add(disc)

  function makeStarMaterial(size, fadeNear, fadeFar) {
    return new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: size },
        uPixelRatio: { value: pixelRatio },
        uScale: { value: renderer.domElement.clientHeight * 0.5 },
        uFadeNear: { value: fadeNear },
        uFadeFar: { value: fadeFar }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  }

  // ---- Far starfield (kept at infinity: static against camera parallax) ---- //
  const starfieldMat = makeStarMaterial(2.2, 1200, 2000)
  const starPalette = [
    0.9, 0.9, 1.0, 0.8, 0.9, 1.0, 1.0, 0.95, 0.85, 0.7, 0.8, 1.0, 1.0, 1.0, 1.0
  ]

  function buildStarfield() {
    const STAR_COUNT = 6000
    const pos = new Float32Array(STAR_COUNT * 3)
    const col = new Float32Array(STAR_COUNT * 3)
    const size = new Float32Array(STAR_COUNT)
    const phase = new Float32Array(STAR_COUNT)
    const spd = new Float32Array(STAR_COUNT)
    const twinkle = new Float32Array(STAR_COUNT)
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = 300 + Math.random() * 700
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      pos[i * 3 + 2] = r * Math.cos(phi)
      const ci = Math.floor(Math.random() * 5) * 3
      const b = 0.7 + Math.random() * 0.6
      col[i * 3] = starPalette[ci] * b
      col[i * 3 + 1] = starPalette[ci + 1] * b
      col[i * 3 + 2] = starPalette[ci + 2] * b
      size[i] = 0.6 + Math.random() * 0.9
      phase[i] = Math.random() * Math.PI * 2
      spd[i] = 0.3 + Math.random() * 1.5
      twinkle[i] = Math.random() < 0.5 ? 1 : 0.4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    geo.setAttribute('aSpd', new THREE.BufferAttribute(spd, 1))
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1))
    return new THREE.Points(geo, starfieldMat)
  }

  let starfield = buildStarfield()
  scene.add(starfield)

  // ---- Baked spiral nebula (one additive plane, fBm + Worley) ---- //
  const NEBULA_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
  const NEBULA_FRAG = `
uniform vec2 uRes;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return v;
}
float worley(vec2 p){
  vec2 i = floor(p);
  float md = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y));
      vec2 fp = i + off + hash(i + off) - p;
      md = min(md, dot(fp, fp));
    }
  }
  return md;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * 2.0;
  float rad = length(p);
  float ang = atan(p.y, p.x);
  float w1 = fbm(p * 3.0 + vec2(1.7, 9.2));
  float w2 = fbm(p * 3.0 + vec2(8.3, 2.8));
  vec2 wp = p + vec2(w1, w2) * 0.35;
  float phase = ang * 2.0 + rad * 7.0 + w1 * 4.0;
  float arm = pow(abs(sin(phase)), 1.2);
  float dens = fbm(wp * 3.2 + arm * 1.8);
  float neb = smoothstep(0.48, 0.75, dens) * arm;
  float core = exp(-rad * 3.2);
  float dsc = 1.0 - smoothstep(0.4, 1.0, rad);
  float knot = smoothstep(0.015, 0.05, worley(p * 16.0)) * (1.0 - smoothstep(0.35, 0.85, rad));
  float knotI = knot * (0.8 + 0.6 * hash(floor(p * 16.0)));
  vec3 amber = vec3(1.0, 0.7, 0.28);
  vec3 cyan = vec3(0.0, 0.9, 1.0);
  vec3 col = mix(amber, cyan, smoothstep(0.0, 1.0, rad * 0.85));
  vec3 knotCol = mix(vec3(1.0, 0.45, 0.6), vec3(0.55, 0.75, 1.0), fract(p.x * 13.7 + p.y * 7.3));
  vec3 rgb = col * (neb * 0.55 + core * 1.2 * dsc) + knotCol * knotI * 0.9;
  gl_FragColor = vec4(rgb, 1.0);
}
`
  function bakeNebula() {
    const size = 2048
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false
    })
    const mat = new THREE.ShaderMaterial({
      uniforms: { uRes: { value: new THREE.Vector2(size, size) } },
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      depthTest: false,
      depthWrite: false
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    quad.frustumCulled = false
    const bakeScene = new THREE.Scene()
    bakeScene.add(quad)
    renderer.setRenderTarget(rt)
    renderer.render(bakeScene, camera)
    renderer.setRenderTarget(null)
    mat.dispose()
    quad.geometry.dispose()
    return rt
  }

  const nebulaRt = bakeNebula()
  const nebula = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({
      map: nebulaRt.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  nebula.rotation.x = 1.05
  disc.add(nebula)

  // ---- Spiral galaxy: knot-clumped procedural particle arms ---- //
  const galaxyMat = makeStarMaterial(0.08, 8, 32)
  const colorInner = new THREE.Color('#ffb347')
  const colorOuter = new THREE.Color('#00e5ff')
  const rareYellow = new THREE.Color('#fff6c8')
  const rareOrange = new THREE.Color('#ff8a4d')
  const rareBlue = new THREE.Color('#6aa6ff')
  const rareHII = new THREE.Color('#ff5a7a')
  const scratch = new THREE.Color()

  function buildGalaxy(count) {
    const arms = 4
    const innerR = 1.2
    const outerR = 7.5
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const phase = new Float32Array(count)
    const spd = new Float32Array(count)
    const twinkle = new Float32Array(count)

    const clusterCount = Math.max(40, Math.round(count / 200))
    const clusters = new Float32Array(clusterCount * 3)
    for (let c = 0; c < clusterCount; c++) {
      const r = innerR + Math.pow(Math.random(), 0.72) * (outerR - innerR)
      const branch = (Math.floor(Math.random() * arms) / arms) * Math.PI * 2
      const angle = branch + r * 1.15 + (Math.random() - 0.5) * 0.35
      const rr = r + (Math.random() - 0.5) * 0.8
      clusters[c * 3] = Math.cos(angle) * rr
      clusters[c * 3 + 1] = (Math.random() - 0.5) * 0.4
      clusters[c * 3 + 2] = Math.sin(angle) * rr
    }

    for (let i = 0; i < count; i++) {
      let x, y, z, r
      if (Math.random() < 0.8) {
        const c = (Math.random() * clusterCount) | 0
        x = clusters[c * 3] + (Math.random() + Math.random() - 1) * 0.45
        y = clusters[c * 3 + 1] + (Math.random() + Math.random() - 1) * 0.16
        z = clusters[c * 3 + 2] + (Math.random() + Math.random() - 1) * 0.45
        r = Math.sqrt(x * x + z * z)
      } else {
        const radius = innerR + Math.pow(Math.random(), 1.4) * (outerR - innerR)
        const branch = (i % arms) / arms * Math.PI * 2
        const spin = radius * 1.15
        const rx = (Math.random() - 0.5) * 0.6
        const ry = (Math.random() - 0.5) * 0.18
        const rz = (Math.random() - 0.5) * 0.6
        const angle = branch + spin + rx
        x = Math.cos(angle) * radius + rx * 0.5
        y = ry
        z = Math.sin(angle) * radius + rz * 0.5
        r = radius
      }

      pos[i * 3] = x
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = z

      const t = Math.max(0, Math.min(1, (r - innerR) / (outerR - innerR)))
      const rarity = Math.random()
      let c, bright, sz
      if (rarity < 0.003) {
        c = rareYellow
        bright = 2.6
        sz = 1.9
      } else if (rarity < 0.027) {
        const k = Math.random()
        c = k < 0.5 ? rareOrange : k < 0.8 ? rareBlue : rareHII
        bright = 2.3
        sz = 1.45
      } else {
        scratch.copy(colorInner).lerp(colorOuter, t)
        c = scratch
        bright = 0.6 + Math.random() * 0.6
        sz = 0.75 + Math.random() * 0.55
      }
      col[i * 3] = c.r * bright
      col[i * 3 + 1] = c.g * bright
      col[i * 3 + 2] = c.b * bright
      size[i] = sz
      phase[i] = Math.random() * Math.PI * 2
      spd[i] = 0.4 + Math.random() * 1.8
      twinkle[i] = Math.random() < 0.75 ? 1 : 0.4
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    geo.setAttribute('aSpd', new THREE.BufferAttribute(spd, 1))
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1))
    const points = new THREE.Points(geo, galaxyMat)
    points.rotation.x = 1.05
    return points
  }

  const GALAXY_TARGET = 68000
  const STAR_TARGET = 6000
  let galaxy = buildGalaxy(GALAXY_TARGET)
  disc.add(galaxy)

  // ---- Core glow ---- //
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

  const core = makeGlowSprite(9, '255,200,120', 0.85)
  core.position.y = 0.1
  disc.add(core)

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
    scene.add(planet)

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
      scene.add(ringMesh)
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
  planets.forEach((p, i) => {
    p.userData.base = p.position.clone()
    p.userData.i = i
  })

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

  // ---- Postprocessing: bloom + ACES (guarded) ---- //
  let composer = null
  let useBloom = true
  if (!REDUCED_MOTION) {
    try {
      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(WIDTH(), HEIGHT()), 0.1, 0.32, 0.42))
      composer.addPass(new OutputPass())
    } catch (err) {
      composer = null
    }
  }

  // ---- Adaptive quality watchdog ---- //
  let quality = 0
  let frameEma = 16.7
  let slowFrames = 0

  function setDensity(galaxyCount, starCount) {
    disc.remove(galaxy)
    galaxy.geometry.dispose()
    scene.remove(starfield)
    starfield.geometry.dispose()
    galaxy = buildGalaxy(galaxyCount)
    disc.add(galaxy)
    starfield = buildStarfield()
    scene.add(starfield)
  }

  function applyQuality() {
    if (quality === 1) {
      setDensity(Math.round(GALAXY_TARGET / 2), Math.round(STAR_TARGET / 2))
    } else if (quality === 2) {
      pixelRatio = 1
      renderer.setPixelRatio(1)
      renderer.setSize(WIDTH(), HEIGHT())
    } else if (quality === 3) {
      useBloom = false
    }
  }

  // ---- Interaction: mouse parallax (camera offset, damped) ---- //
  const mouse = { x: 0, y: 0 }
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX / window.innerWidth - 0.5
    mouse.y = e.clientY / window.innerHeight - 0.5
  })

  // ---- Resize ---- //
  function onResize() {
    camera.aspect = WIDTH() / HEIGHT()
    camera.updateProjectionMatrix()
    renderer.setSize(WIDTH(), HEIGHT())
    if (composer) composer.setSize(WIDTH(), HEIGHT())
    const uScale = renderer.domElement.clientHeight * 0.5
    starfieldMat.uniforms.uScale.value = uScale
    galaxyMat.uniforms.uScale.value = uScale
    starfieldMat.uniforms.uPixelRatio.value = pixelRatio
    galaxyMat.uniforms.uPixelRatio.value = pixelRatio
    if (REDUCED_MOTION) renderer.render(scene, camera)
  }
  window.addEventListener('resize', onResize)

  const clock = new THREE.Clock()
  const camOff = new THREE.Vector3()

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime

    const k = 1 - Math.exp(-dt * 5)
    camOff.x += (mouse.x * 2.2 - camOff.x) * k
    camOff.y += (-mouse.y * 1.4 - camOff.y) * k
    const swayX = Math.sin(t * 0.14) * 0.5
    const swayY = Math.cos(t * 0.11) * 0.3
    camera.position.set(
      CAM_BASE.x + camOff.x + swayX,
      CAM_BASE.y + camOff.y + swayY,
      CAM_BASE.z
    )
    camera.lookAt(0, 0, 0)

    disc.rotation.y += dt * 0.013
    core.scale.setScalar(1 + Math.sin(t * 1.5) * 0.04)

    for (let i = 0; i < planets.length; i++) {
      const p = planets[i]
      const base = p.userData.base
      p.position.y = base.y + Math.sin(t * 0.4 + i) * 0.02
      p.position.x = base.x + Math.sin(t * 0.25 + i * 2) * 0.008
      p.position.z = base.z + Math.cos(t * 0.3 + i) * 0.008
      p.rotation.y += dt * 0.08
    }

    starfieldMat.uniforms.uTime.value = t
    galaxyMat.uniforms.uTime.value = t

    // Adaptive quality watchdog: EMA of frame time
    const frameMs = dt * 1000
    frameEma = frameEma * 0.95 + frameMs * 0.05
    slowFrames = frameEma > 40 ? slowFrames + 1 : 0
    if (slowFrames > 120 && quality < 3) {
      quality++
      applyQuality()
    }

    if (composer && useBloom) composer.render()
    else renderer.render(scene, camera)

    requestAnimationFrame(tick)
  }

  if (REDUCED_MOTION) {
    renderer.render(scene, camera)
  } else {
    tick()
  }

  return { renderer, scene, camera }
}
