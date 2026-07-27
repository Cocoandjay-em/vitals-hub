import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import type { BiomarkerReading } from '@/types/biomarker'
import type { ClinicalReport } from '@/types/report'
import {
  buildRegions,
  FLAG_COLOR,
  regionColor,
  regionHasData,
  type RegionId,
  type RegionState,
} from '@/components/BodyMap'
import { OrganInfo } from '@/components/OrganInfo'
import { cn } from '@/lib/utils'

/**
 * Interactive 3D anatomical hologram — real Visible Human anatomy
 * (HuBMAP CCF 3D Reference Object Library, CC BY 4.0), male and female
 * model sets; the profile's sex picks which body is shown: skin shell
 * rendered as glowing cyan wireframe/point-cloud scan, with the actual
 * brain, heart, liver, kidneys, lungs, gut and blood vessels inside, each
 * lighting up in its flag colour. Drag to rotate, click an organ for its card.
 *
 * All models share one coordinate frame (meters, y-up, front +Z, left +X).
 * The whole group is normalised to 1.81 units tall, feet at y=0.
 */

/** Which Visible Human body the hologram shows — comes from the user profile. */
export type BodySex = 'male' | 'female'

const MODEL_KEYS = ['skin', 'brain', 'heart', 'liver', 'kidneyL', 'kidneyR', 'lung', 'gutSmall', 'gutLarge', 'vessels'] as const
type ModelKey = (typeof MODEL_KEYS)[number]

const FILE_NAMES: Record<ModelKey, string> = {
  skin: 'skin.glb',
  brain: 'brain.glb',
  heart: 'heart.glb',
  liver: 'liver.glb',
  kidneyL: 'kidney-l.glb',
  kidneyR: 'kidney-r.glb',
  lung: 'lung.glb',
  gutSmall: 'gut-small.glb',
  gutLarge: 'gut-large.glb',
  vessels: 'vasculature.glb',
}

const MODEL_SETS: Record<BodySex, Record<ModelKey, string>> = {
  male: Object.fromEntries(MODEL_KEYS.map((k) => [k, `./models/anatomy/male/${FILE_NAMES[k]}`])) as Record<ModelKey, string>,
  female: Object.fromEntries(MODEL_KEYS.map((k) => [k, `./models/anatomy/female/${FILE_NAMES[k]}`])) as Record<ModelKey, string>,
}

const BODY_HEIGHT = 1.81

/** Organ scenes grouped by body-map region (thyroid glow sprite handled separately). */
const REGION_MODELS: Partial<Record<RegionId, ModelKey[]>> = {
  brain: ['brain'], // nervous system — driven by clinical reports, not blood panels
  neck: [], // thyroid: no mesh in the atlas, rendered as a glow sprite instead
  heart: ['heart'],
  liver: ['liver'],
  kidney: ['kidneyL', 'kidneyR'],
  lungs: ['lung'],
  gut: ['gutSmall', 'gutLarge'],
  systemic: ['vessels'],
}

/** Soft radial glow texture shared by the thyroid sprite. */
function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

function setMaterial(root: THREE.Object3D, mat: THREE.Material) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) mesh.material = mat
  })
}

function toPoints(root: THREE.Object3D, mat: THREE.Material): THREE.Object3D {
  const clone = root.clone(true)
  const swaps: { mesh: THREE.Mesh; parent: THREE.Object3D }[] = []
  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.parent) swaps.push({ mesh, parent: mesh.parent })
  })
  for (const { mesh, parent } of swaps) {
    const p = new THREE.Points(mesh.geometry, mat)
    p.position.copy(mesh.position)
    p.quaternion.copy(mesh.quaternion)
    p.scale.copy(mesh.scale)
    parent.add(p)
    parent.remove(mesh)
  }
  return clone
}

interface AnatomyBuild {
  group: THREE.Group
  /** hotspot anchor per region, in normalised space */
  anchors: Record<RegionId, [number, number, number]>
}

/**
 * Smooth fresnel rim-glow — the silhouette and grazing angles glow, the rest
 * stays transparent. Unlike a wireframe it shows NO polygon edges, and it
 * rasterises only the rim fragments, so it is much lighter than drawing every
 * triangle edge of a dense mesh.
 */
function fresnelMaterial(color: string, opacity: number, power = 2.4): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uPower: { value: power },
    },
    vertexShader: /* glsl */ `
      varying float vRim;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 v = normalize(-mv.xyz);
        vRim = pow(1.0 - abs(dot(n, v)), 2.4);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vRim;
      void main() {
        gl_FragColor = vec4(uColor, vRim * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  })
}

function buildAnatomy(scenes: Record<ModelKey, THREE.Group>, regions: RegionState[], dimmed: boolean): AnatomyBuild {
  const regionById = new Map(regions.map((r) => [r.def.id, r]))
  const group = new THREE.Group()

  /* ---------------- skin: glass volume + rim glow + point scan ----------------
   * No wireframe — the fresnel rim defines the silhouette without any
   * polygon edges. Point opacity stays LOW: additive layers stack along the
   * view depth, and 0.2+ saturates to white almost immediately. */
  const volumeMat = new THREE.MeshBasicMaterial({
    color: dimmed ? '#155e75' : '#0c4a6e',
    transparent: true,
    opacity: dimmed ? 0.06 : 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const rimMat = fresnelMaterial(dimmed ? '#4b6b78' : '#22d3ee', dimmed ? 0.35 : 0.65)
  const pointsMat = new THREE.PointsMaterial({
    color: dimmed ? '#5d7d89' : '#22d3ee',
    size: 0.0035,
    transparent: true,
    opacity: dimmed ? 0.07 : 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const skinVolume = scenes.skin.clone(true)
  setMaterial(skinVolume, volumeMat)
  const skinRim = scenes.skin.clone(true)
  setMaterial(skinRim, rimMat)
  group.add(skinVolume, skinRim, toPoints(scenes.skin, pointsMat))

  /* ------------- organs: glass volume + soft rim, flag colours ------------- */
  for (const [regionId, keys] of Object.entries(REGION_MODELS) as [RegionId, ModelKey[]][]) {
    const region = regionById.get(regionId)
    const noData = !region || !regionHasData(region) || dimmed
    const color = region ? regionColor(region) : FLAG_COLOR.unknown
    const intensity = region?.intensity ?? 0
    for (const key of keys) {
      // translucent volumes: overlapping organs (the gut fills the whole
      // abdomen) must stay see-through; the rim carries each organ's shape
      const volOpacity = noData ? 0.03 : 0.13 + intensity * 0.18
      const rimOpacity = noData ? 0.12 : 0.35 + intensity * 0.3
      const vol = scenes[key].clone(true)
      setMaterial(vol, new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: volOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }))
      const rim = scenes[key].clone(true)
      setMaterial(rim, fresnelMaterial(color, rimOpacity, 2.0))
      group.add(vol, rim)
    }
  }

  /* ------------- normalise to 1.81 units, feet at y=0 ------------- */
  const box = new THREE.Box3().setFromObject(group)
  const size = box.getSize(new THREE.Vector3())
  const s = size.y > 0 ? BODY_HEIGHT / size.y : 1
  group.scale.setScalar(s)
  const center = box.getCenter(new THREE.Vector3())
  group.position.set(-center.x * s, -box.min.y * s, -center.z * s)

  /* ------------- anchors from real organ bounding boxes ------------- */
  const tx = (c: THREE.Vector3): [number, number, number] => [
    (c.x - center.x) * s,
    (c.y - box.min.y) * s,
    (c.z - center.z) * s,
  ]
  const centerOf = (keys: ModelKey[]): THREE.Vector3 => {
    const b = new THREE.Box3()
    for (const key of keys) b.expandByObject(scenes[key])
    return b.getCenter(new THREE.Vector3())
  }
  const anchors = {} as Record<RegionId, [number, number, number]>
  anchors.brain = tx(centerOf(['brain']))
  anchors.neck = [0, 1.53, 0.13] // thyroid — no organ mesh in the atlas set
  anchors.heart = tx(centerOf(['heart']))
  anchors.lungs = tx(centerOf(['lung']))
  anchors.liver = tx(centerOf(['liver']))
  anchors.gut = tx(centerOf(['gutSmall', 'gutLarge']))
  anchors.kidney = tx(centerOf(['kidneyL'])) // viewer-right kidney
  anchors.systemic = [-0.3, 0.92, 0.06] // inner forearm — blood draw site
  return { group, anchors }
}

/** Pulsing glow sprite (used for the thyroid, which has no organ mesh). */
function OrganGlow({
  position,
  color,
  intensity,
  index,
}: {
  position: [number, number, number]
  color: string
  intensity: number
  index: number
}) {
  const matRef = useRef<THREE.SpriteMaterial>(null)
  const spriteRef = useRef<THREE.Sprite>(null)
  const texture = useMemo(makeGlowTexture, [])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.2 + index * 1.3)
    if (matRef.current) matRef.current.opacity = (0.35 + intensity * 0.45) * pulse
    if (spriteRef.current) {
      const sc = 0.16 + intensity * 0.1 + 0.02 * Math.sin(t * 2.2 + index * 1.3)
      spriteRef.current.scale.setScalar(sc)
    }
  })
  return (
    <sprite ref={spriteRef} position={position}>
      <spriteMaterial
        ref={matRef}
        map={texture}
        color={color}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </sprite>
  )
}

function LoadedBody({ sex, regions, dimmed, selectedRegion, activeId, onToggleRegion, onAnchors }: {
  sex: BodySex
  regions: RegionState[]
  dimmed: boolean
  selectedRegion: RegionId | null
  activeId: RegionId | null
  onToggleRegion: (id: RegionId) => void
  onAnchors: (a: Record<RegionId, [number, number, number]>) => void
}) {
  // memoised: useGLTF keys its cache by URL string, but a stable array keeps
  // the loader from re-suspending on unrelated re-renders
  const urls = useMemo(() => MODEL_KEYS.map((k) => MODEL_SETS[sex][k]), [sex])
  // one call loads the whole set for the current profile sex; a sex change
  // swaps every URL, so Suspense re-triggers and only that set is fetched
  const gltfs = useGLTF(urls) as unknown as Array<{ scene: THREE.Group }>

  // rebuild when data flags change (organ colours), dimmed toggles or sex switches
  const flagSig = regions.map((r) => `${r.def.id}:${r.worst}:${r.intensity.toFixed(2)}`).join('|')
  const urlsSig = urls.join('|')
  const build = useMemo(() => {
    const scenes = Object.fromEntries(MODEL_KEYS.map((k, i) => [k, gltfs[i].scene])) as Record<ModelKey, THREE.Group>
    return buildAnatomy(scenes, regions, dimmed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsSig, flagSig, dimmed])

  // publish anchors for the camera-focus target (outside this Suspense subtree)
  useEffect(() => onAnchors(build.anchors), [build, onAnchors])

  return (
    <>
      <primitive object={build.group} />
      {!dimmed &&
        regions.map((r, i) => (
          <Hotspot
            key={r.def.id}
            region={r}
            position={build.anchors[r.def.id] ?? [0, BODY_HEIGHT / 2, 0]}
            index={i}
            active={selectedRegion === r.def.id || activeId === r.def.id}
            hidden={activeId !== null && activeId !== r.def.id}
            onClick={() => onToggleRegion(r.def.id)}
          />
        ))}
    </>
  )
}

/** One interactive hotspot: optional glow sprite + DOM dot/chip tracking a 3D point. */
function Hotspot({
  region,
  position,
  index,
  active,
  hidden,
  onClick,
}: {
  region: RegionState
  position: [number, number, number]
  index: number
  active: boolean
  hidden: boolean
  onClick: () => void
}) {
  const noData = !regionHasData(region)
  const color = regionColor(region)
  const spriteOnly = region.def.id === 'neck' // organs glow via their real meshes
  return (
    <group position={position}>
      {(!noData || spriteOnly) && (
        <OrganGlow position={[0, 0, 0]} color={color} intensity={noData ? 0.1 : region.intensity + (active ? 0.3 : 0)} index={index} />
      )}
      <Html center zIndexRange={[30, 10]} style={{ transition: 'opacity 300ms', opacity: hidden ? 0 : 1 }}>
        <button
          onClick={onClick}
          title={
            noData
              ? `${region.def.title} — no markers yet; click for info`
              : `${region.label} — click for details`
          }
          className={cn(
            'group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80',
            hidden && 'pointer-events-none',
          )}
          style={{ pointerEvents: hidden ? 'none' : 'auto' }}
        >
          <span className={cn('relative block h-3 w-3', noData && 'opacity-50')}>
            {!noData && (
              <span
                className="hud-ping absolute inset-0 rounded-full"
                style={{ border: `1.5px solid ${color}` }}
              />
            )}
            <span
              className={cn(
                'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform group-hover:scale-125',
                noData ? 'h-[5px] w-[5px] border bg-transparent' : 'h-[7px] w-[7px]',
              )}
              style={
                noData
                  ? { borderColor: `${color}AA` }
                  : { background: color, boxShadow: `0 0 8px ${color}, 0 0 3px ${color}` }
              }
            />
            {active && (
              <span className="absolute -inset-1.5 rounded-full border" style={{ borderColor: `${color}99` }} />
            )}
          </span>
          <span
            className={cn(
              'hud-mono pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm border px-1.5 py-px text-[9px] tracking-wider transition-opacity',
              noData && 'opacity-40',
            )}
            style={{
              color,
              borderColor: `${color}55`,
              background: 'rgba(2,8,23,0.82)',
              boxShadow: `0 0 10px ${color}30`,
            }}
          >
            {region.label}
          </span>
        </button>
      </Html>
    </group>
  )
}

const INITIAL_POS = new THREE.Vector3(0, BODY_HEIGHT / 2 + 0.1, 3.2)
const INITIAL_TGT = new THREE.Vector3(0, BODY_HEIGHT / 2, 0)

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

const INITIAL_SPH = (() => {
  const off = INITIAL_POS.clone().sub(INITIAL_TGT)
  const radius = off.length()
  return {
    theta: Math.atan2(off.x, off.z),
    phi: Math.acos(THREE.MathUtils.clamp(off.y / radius, -1, 1)),
    radius,
  }
})()

/**
 * Single-source camera controller: drag to orbit around the body's exact
 * centre, wheel to zoom, smooth glide to a clicked organ and back home,
 * gentle idle auto-rotate. No OrbitControls — nothing else ever touches
 * the camera, so drag and render can never disagree.
 */
function CameraControls({
  target,
  autoRotate,
}: {
  target: [number, number, number] | null
  autoRotate: boolean
}) {
  const { camera, gl } = useThree()
  const sphState = useRef({ ...INITIAL_SPH })
  const tgtRef = useRef(INITIAL_TGT.clone())
  const anim = useRef<null | {
    t: number
    dur: number
    fromPos: THREE.Vector3
    toPos: THREE.Vector3
    fromTgt: THREE.Vector3
    toTgt: THREE.Vector3
  }>(null)
  const dragging = useRef(false)
  const lastPointer = useRef<[number, number]>([0, 0])
  const lastInteract = useRef(0)
  const autoRef = useRef(autoRotate)
  autoRef.current = autoRotate

  /* -------- focus transitions: glide to organ, glide home -------- */
  const targetKey = target ? target.map((n) => n.toFixed(3)).join(',') : 'home'
  const prevKey = useRef('home')
  useEffect(() => {
    if (prevKey.current === targetKey) return
    prevKey.current = targetKey
    const toTgt = target ? new THREE.Vector3(...target) : INITIAL_TGT.clone()
    const toPos = target
      ? camera.position.clone().sub(toTgt).normalize().multiplyScalar(1.4).add(toTgt)
      : INITIAL_POS.clone()
    anim.current = {
      t: 0,
      dur: 1.1,
      fromPos: camera.position.clone(),
      toPos,
      fromTgt: tgtRef.current.clone(),
      toTgt,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, camera])

  /* -------- manual orbit / zoom input -------- */
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      dragging.current = true
      lastPointer.current = [e.clientX, e.clientY]
      lastInteract.current = performance.now()
      anim.current = null
    }
    const move = (e: PointerEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastPointer.current[0]
      const dy = e.clientY - lastPointer.current[1]
      lastPointer.current = [e.clientX, e.clientY]
      const s = sphState.current
      s.theta -= dx * 0.006
      s.phi = THREE.MathUtils.clamp(s.phi - dy * 0.006, 0.35, Math.PI - 0.35)
      lastInteract.current = performance.now()
    }
    const up = () => {
      dragging.current = false
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = sphState.current
      s.radius = THREE.MathUtils.clamp(s.radius * Math.exp(e.deltaY * 0.0012), 1.0, 5.5)
      lastInteract.current = performance.now()
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl])

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05)
    const a = anim.current
    if (a) {
      a.t += d
      const k = easeInOutCubic(Math.min(1, a.t / a.dur))
      camera.position.lerpVectors(a.fromPos, a.toPos, k)
      tgtRef.current.lerpVectors(a.fromTgt, a.toTgt, k)
      if (a.t >= a.dur) {
        anim.current = null
        const off = camera.position.clone().sub(tgtRef.current)
        const s = sphState.current
        s.radius = off.length()
        s.phi = Math.acos(THREE.MathUtils.clamp(off.y / s.radius, -1, 1))
        s.theta = Math.atan2(off.x, off.z)
        lastInteract.current = performance.now()
      }
    } else {
      const s = sphState.current
      if (!dragging.current && autoRef.current && performance.now() - lastInteract.current > 4000) {
        s.theta += 0.12 * d
      }
      const t = tgtRef.current
      camera.position.set(
        t.x + s.radius * Math.sin(s.phi) * Math.sin(s.theta),
        t.y + s.radius * Math.cos(s.phi),
        t.z + s.radius * Math.sin(s.phi) * Math.cos(s.theta),
      )
    }
    camera.lookAt(tgtRef.current)
    ;(window as unknown as { __cam?: unknown }).__cam = {
      theta: sphState.current.theta,
      radius: sphState.current.radius,
      animating: !!anim.current,
      pos: [camera.position.x, camera.position.y, camera.position.z].map((n) => +n.toFixed(3)),
    }
  })
  return null
}

export interface BodyScan3DProps {
  markers: BiomarkerReading[] | null
  date?: string
  selected: string | null
  onSelectMarker: (name: string) => void
  /** body model from the user profile — defaults to the male Visible Human */
  sex?: BodySex
  /** clinical reports, distributed across the organ regions they belong to */
  reports?: ClinicalReport[]
  onDeleteReport?: (id: string) => void
  onRestageReport?: (id: string, stage: string) => void
}

export function BodyScan3D({
  markers,
  date,
  selected,
  onSelectMarker,
  sex = 'male',
  reports,
  onDeleteReport,
  onRestageReport,
}: BodyScan3DProps) {
  const regions = useMemo(() => buildRegions(markers ?? [], reports ?? []), [markers, reports])
  const [activeId, setActiveId] = useState<RegionId | null>(null)
  // anchors live in STATE (not a ref): they are published by LoadedBody after
  // the anatomy build, so the camera-focus target re-renders with real values
  const [anchors, setAnchors] = useState<Record<RegionId, [number, number, number]> | null>(null)
  // a report with no blood panel is still data — the body must not stay dimmed
  const empty = (!markers || markers.length === 0) && (reports?.length ?? 0) === 0

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const active = useMemo(
    () => regions.find((r) => r.def.id === activeId) ?? null,
    [regions, activeId],
  )

  const selectedRegion = useMemo(() => {
    if (!selected || !markers) return null
    const m = markers.find((x) => x.name === selected)
    if (!m) return null
    return regions.find((r) => r.def.categories.includes(m.category))?.def.id ?? null
  }, [selected, markers, regions])

  useEffect(() => {
    if (!activeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId])

  const anchorFor = (id: RegionId): [number, number, number] =>
    anchors?.[id] ?? [0, BODY_HEIGHT / 2, 0]

  return (
    <div className="relative h-full w-full">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [INITIAL_POS.x, INITIAL_POS.y, INITIAL_POS.z], fov: 38 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <Suspense fallback={null}>
          <LoadedBody
            sex={sex}
            regions={regions}
            dimmed={empty}
            selectedRegion={selectedRegion}
            activeId={activeId}
            onToggleRegion={(id) => setActiveId((cur) => (cur === id ? null : id))}
            onAnchors={setAnchors}
          />
        </Suspense>
        <CameraControls target={active ? anchorFor(active.def.id) : null} autoRotate={!reducedMotion && !activeId} />
      </Canvas>

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <span className="hud-mono rounded-sm border border-cyan-400/30 bg-[#020817]/80 px-3 py-2 text-[11px] tracking-[0.18em] text-cyan-200/80 shadow-[0_0_18px_rgba(34,211,238,0.2)]">
            BODY MAP OFFLINE
          </span>
          <span className="hud-mono text-[10px] tracking-wider text-cyan-100/45">
            Upload a test to activate the body scan
          </span>
        </div>
      )}

      {active && (
        <div className="absolute right-2 top-2 z-40 w-64 max-w-[80%]">
          <OrganInfo
            region={active}
            date={date}
            onClose={() => setActiveId(null)}
            onSelectMarker={onSelectMarker}
            onDeleteReport={onDeleteReport}
            onRestageReport={onRestageReport}
          />
        </div>
      )}

      {!empty && !active && (
        <p className="hud-mono pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] tracking-[0.2em] text-cyan-100/35">
          DRAG TO ROTATE · SCROLL TO ZOOM · CLICK AN ORGAN · ESC TO CLOSE
        </p>
      )}
    </div>
  )
}

// preload the default (male) set; the female set loads lazily on first use
useGLTF.preload(Object.values(MODEL_SETS.male))
