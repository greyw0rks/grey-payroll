import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'

export function PayrollScene() {
  const hostRef = useRef<HTMLDivElement>(null)
  const replayRef = useRef<() => void>(() => {})
  const [ready, setReady] = useState(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let dispose = () => {}
    setReady(false)

    async function mount() {
      const [T] = await Promise.all([import('three'), document.fonts.ready])
      if (cancelled || !host) return
      let renderer: InstanceType<typeof T.WebGLRenderer>
      try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }) } catch { return }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
      renderer.setClearColor(0x000000, 0)
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = T.PCFSoftShadowMap
      renderer.outputColorSpace = T.SRGBColorSpace
      host.appendChild(renderer.domElement)
      const scene = new T.Scene()
      const camera = new T.PerspectiveCamera(36, 1, 0.1, 40)
      camera.position.set(0, 1.1, 9.5)
      camera.lookAt(0, 0, 0)
      scene.add(new T.HemisphereLight(0xffffff, 0x89928b, 3))
      const light = new T.DirectionalLight(0xffffff, 5)
      light.position.set(-3, 6, 6)
      light.castShadow = true
      light.shadow.mapSize.set(1024, 1024)
      light.shadow.radius = 4
      light.shadow.camera.left = -6; light.shadow.camera.right = 6
      light.shadow.camera.top = 6; light.shadow.camera.bottom = -6
      scene.add(light)
      const fill = new T.DirectionalLight(0xffffff, 2)
      fill.position.set(4, 0, 3)
      scene.add(fill)
      const group = new T.Group()
      scene.add(group)
      const slab = new T.Group()
      slab.position.set(0, 0.65, 0)
      slab.rotation.set(-0.12, -0.3, -0.18)
      group.add(slab)

      function roundedShape(w: number, h: number, r: number) {
        const s = new T.Shape()
        const x = -w / 2, y = -h / 2
        s.moveTo(x + r, y); s.lineTo(x + w - r, y)
        s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r)
        s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h)
        s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r)
        s.quadraticCurveTo(x, y, x + r, y)
        return s
      }
      const shape = roundedShape(4, 2.5, 0.2)
      const geometry = new T.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 0.045, bevelThickness: 0.04, curveSegments: 20 })
      const uv = geometry.attributes.uv
      const position = geometry.attributes.position
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (position.getX(i) + 2) / 4, (position.getY(i) + 1.25) / 2.5)
      const faceCanvas = document.createElement('canvas')
      faceCanvas.width = 1200; faceCanvas.height = 750
      const ctx = faceCanvas.getContext('2d')!
      ctx.fillStyle = '#3DDC84'; ctx.fillRect(0, 0, 1200, 750)
      ctx.fillStyle = '#16181C'
      ctx.font = '600 58px "Space Grotesk"'; ctx.fillText('grey', 80, 115)
      ctx.font = '500 28px "DM Sans"'; ctx.fillText('PAYROLL ON ARC', 830, 108)
      ctx.font = '400 32px "DM Sans"'; ctx.fillText('Team payroll', 80, 310)
      ctx.font = '500 102px "Space Grotesk"'; ctx.fillText('7,400.00', 75, 435)
      ctx.font = '500 32px "DM Sans"'; ctx.fillText('USDC', 825, 430)
      ctx.strokeStyle = '#16181C55'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(80, 550); ctx.lineTo(1120, 550); ctx.stroke()
      ctx.font = '400 30px "DM Sans"'; ctx.fillText('3 recipients', 80, 645); ctx.fillText('One approval', 875, 645)
      const texture = new T.CanvasTexture(faceCanvas)
      texture.colorSpace = T.SRGBColorSpace
      const front = new T.MeshBasicMaterial({ map: texture })
      const edge = new T.MeshStandardMaterial({ color: 0x28aa66, roughness: 0.32, metalness: 0.25 })
      const mainSlab = new T.Mesh(geometry, [front, edge])
      mainSlab.castShadow = true
      slab.add(mainSlab)
      for (let i = 0; i < 2; i++) {
        const backing = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: i === 0 ? 0xe1e4da : 0x16181c, roughness: 0.45, metalness: 0.15 }))
        backing.position.set((i + 1) * 0.13, (i + 1) * 0.16, -(i + 1) * 0.25)
        backing.castShadow = true
        slab.add(backing)
      }
      const paths: InstanceType<typeof T.CubicBezierCurve3>[] = []
      const particles: InstanceType<typeof T.Mesh>[] = []
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 1.6
        const end = new T.Vector3(x, -1.62, 0.15)
        const path = new T.CubicBezierCurve3(new T.Vector3(0, -0.4, 0.15), new T.Vector3(0, -1.15, 0.15), new T.Vector3(x, -0.8, 0.15), end)
        paths.push(path)
        group.add(new T.Mesh(new T.TubeGeometry(path, 32, 0.018, 8, false), new T.MeshStandardMaterial({ color: 0xa2aaa1, roughness: 0.6 })))
        const node = new T.Mesh(new T.CylinderGeometry(0.38, 0.38, 0.13, 48), new T.MeshStandardMaterial({ color: i === 1 ? 0x3ddc84 : 0xe5e8df, roughness: 0.27, metalness: 0.55 }))
        node.rotation.x = Math.PI / 2; node.position.copy(end); node.castShadow = true
        group.add(node)
        const inset = new T.Mesh(new T.TorusGeometry(0.23, 0.018, 8, 32), new T.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5 }))
        inset.position.copy(end); inset.position.z += 0.08; group.add(inset)
        const particle = new T.Mesh(new T.SphereGeometry(0.07, 12, 12), new T.MeshStandardMaterial({ color: 0x16181c }))
        group.add(particle); particles.push(particle)
      }
      const ground = new T.Mesh(new T.PlaneGeometry(20, 20), new T.ShadowMaterial({ opacity: 0.09 }))
      ground.rotation.x = -Math.PI / 2; ground.position.y = -2.3; ground.receiveShadow = true
      scene.add(ground)
      let contextIsLost = false

      let frame = 0, visible = true, elapsed = reduce ? 6 : 0, last = 0
      let targetX = 0, targetY = 0
      const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
      function tick(now: number) {
        frame = 0
        if (!visible || document.hidden || cancelled) return
        const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60
        last = now; elapsed += dt
        const smooth = 1 - Math.exp(-8 * dt)
        group.rotation.y += (targetX - group.rotation.y) * smooth
        group.rotation.x += (targetY - group.rotation.x) * smooth
        group.position.y = reduce ? 0 : 0.32 * Math.exp(-elapsed * 3)
        particles.forEach((p, i) => {
          const progress = Math.max(0, Math.min(1, (elapsed - 0.6 - i * 0.12) / 2))
          p.position.copy(paths[i].getPoint(progress)); p.visible = !reduce && elapsed < 3.2 && progress > 0 && progress < 1
        })
        renderer.render(scene, camera)
        if (elapsed < 4 || Math.abs(targetX - group.rotation.y) > 0.0001 || Math.abs(targetY - group.rotation.x) > 0.0001) schedule()
      }
      function schedule() { if (!frame && visible && !document.hidden && !cancelled && !contextIsLost) frame = requestAnimationFrame(tick) }
      function pointer(e: PointerEvent) {
        if (reduce || !finePointer || e.pointerType !== 'mouse') return
        const rect = host!.getBoundingClientRect()
        targetX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.2
        targetY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.1
        schedule()
      }
      function leave() { targetX = targetY = 0; schedule() }
      function visibility() { last = 0; if (document.hidden) { cancelAnimationFrame(frame); frame = 0 } else schedule() }
      function contextLost(e: Event) { e.preventDefault(); contextIsLost = true; cancelAnimationFrame(frame); frame = 0; setReady(false) }
      const resize = new ResizeObserver(() => { renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); schedule() })
      resize.observe(host)
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; last = 0; if (visible) schedule(); else { cancelAnimationFrame(frame); frame = 0 } })
      intersection.observe(host)
      host.addEventListener('pointermove', pointer); host.addEventListener('pointerleave', leave)
      document.addEventListener('visibilitychange', visibility)
      renderer.domElement.addEventListener('webglcontextlost', contextLost)
      replayRef.current = () => { elapsed = 0; last = 0; schedule() }
      setReady(true); schedule()
      dispose = () => {
        cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect()
        host.removeEventListener('pointermove', pointer); host.removeEventListener('pointerleave', leave)
        document.removeEventListener('visibilitychange', visibility)
        renderer.domElement.removeEventListener('webglcontextlost', contextLost)
        scene.traverse(obj => {
          if (!(obj instanceof T.Mesh)) return
          const mesh = obj as import('three').Mesh<import('three').BufferGeometry, import('three').Material | import('three').Material[]>
          mesh.geometry.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach(m => { m.dispose() })
        })
        texture.dispose(); renderer.dispose(); renderer.domElement.remove()
      }
    }
    mount().catch(() => { if (!cancelled) setReady(false) })
    return () => { cancelled = true; dispose(); replayRef.current = () => {} }
  }, [reduce])

  return <figure className="payroll-scene" aria-label="Illustration of one payroll reaching three recipient wallets">
    <div className="scene-host" ref={hostRef} aria-hidden="true" />
    {!ready && <div className="scene-fallback" aria-hidden="true"><span>grey / payroll</span><span>Team payroll</span><strong>7,400.00 <small>USDC</small></strong><span>3 recipients · One approval</span></div>}
    <figcaption><span>One payday. A whole team.<small>Illustrative payroll</small></span>{ready && !reduce && <button onClick={() => replayRef.current()} aria-label="Replay payroll illustration"><RotateCcw size={16} aria-hidden="true" /></button>}</figcaption>
  </figure>
}
