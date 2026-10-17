import * as THREE from 'three';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PostPipeline } from './postfx';
import type { AudioLevels } from './audio';
import type { Cue, Section } from './data';

const MODEL_URL = './mmd/miku_v2.pmd';
const MOTION_URL = './mmd/wavefile_v2.vmd';
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TARGET_HEIGHT = 3.18;

export interface StageFrame {
  time: number;
  dt: number;
  section: Section;
  cue: Cue | null;
  levels: AudioLevels;
  started: boolean;
  playing: boolean;
}

export interface LoadProgress {
  progress: number;
  label: string;
  detail: string;
}

type ProgressCallback = (info: LoadProgress) => void;

interface CameraShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface StageMaterial extends THREE.Material {
  uniforms?: Record<string, THREE.IUniform>;
}

const SHOTS: CameraShot[] = [
  { position: new THREE.Vector3(0, 0.5, -1.45), target: new THREE.Vector3(0, 0.14, 0) },
  { position: new THREE.Vector3(-2.35, 0.12, 0.65), target: new THREE.Vector3(0.28, 0.04, 0) },
  { position: new THREE.Vector3(2.5, -0.12, 0.45), target: new THREE.Vector3(-0.22, 0.18, 0) },
  { position: new THREE.Vector3(0, 1.58, 0.35), target: new THREE.Vector3(0, -0.28, 0) },
  { position: new THREE.Vector3(-0.75, -0.24, -0.86), target: new THREE.Vector3(0.18, 0.3, 0) },
];

function shaderMaterial(
  uniforms: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
  options: THREE.ShaderMaterialParameters = {},
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    ...options,
  });
  material.userData.outlineParameters = { visible: false };
  return material;
}

function markOutlineInvisible(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh && !(child as THREE.Sprite).isSprite) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      material.userData.outlineParameters = { visible: false };
    }
  });
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.09)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeContactTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 20, 128, 128, 120);
    gradient.addColorStop(0, 'rgba(0,0,0,0.8)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.32)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class MMDTheatre {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly canvas: HTMLCanvasElement;
  private readonly outline: OutlineEffect;
  private readonly post: PostPipeline;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();

  private width = 1;
  private height = 1;
  private mobile = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private readonly accent = new THREE.Color('#63ffb6');
  private readonly accentTarget = new THREE.Color('#63ffb6');
  private readonly accent2 = new THREE.Color('#e4ff78');
  private readonly accent2Target = new THREE.Color('#e4ff78');

  private readonly lookTarget = new THREE.Vector3(0, 1.55, 0);
  private readonly desiredLook = new THREE.Vector3(0, 1.55, 0);
  private readonly pointer = new THREE.Vector2();
  private lastSectionId = '';
  private lastCueIndex = -1;
  private sectionStart = 0;
  private sectionCameraPhase = 0;
  private elapsed = 0;
  private realTime = 0;
  private impact = 0;
  private beatPulse = 0;
  private glitch = 0;
  private cutWeight = 0;
  private shotIndex = 0;
  private cutTargetOffset = new THREE.Vector3();
  private snapCamera = true;
  private freeCamera = false;

  private characterRoot: THREE.Group | null = null;
  private characterMesh: THREE.SkinnedMesh | null = null;
  private helper: MMDAnimationHelper | null = null;
  private action: THREE.AnimationAction | null = null;
  private clipDuration = 93.633;
  private loaded = false;
  private physicsEnabled = false;
  private updateSequence = 0;

  private backgroundMaterial!: THREE.ShaderMaterial;
  private floorMaterial!: THREE.ShaderMaterial;
  private platformMaterial!: THREE.ShaderMaterial;
  private gridWallMaterial!: THREE.ShaderMaterial;
  private ringMaterials: THREE.MeshBasicMaterial[] = [];
  private lightShaftMaterial!: THREE.LineBasicMaterial;
  private edgeMaterials: THREE.MeshBasicMaterial[] = [];
  private particleMaterial!: THREE.ShaderMaterial;
  private glyphMaterial!: THREE.PointsMaterial;
  private glyphGroup!: THREE.Points;
  private codeSprites: THREE.Sprite[] = [];
  private codeSpriteData: Array<{ base: THREE.Vector3; phase: number; baseOpacity: number }> = [];
  private pointsShellMaterial!: THREE.PointsMaterial;
  private circleMaterial!: THREE.MeshBasicMaterial;
  private sineMaterial!: THREE.LineBasicMaterial;
  private infinityMaterial!: THREE.LineBasicMaterial;
  private heartMaterial!: THREE.LineBasicMaterial;
  private heartGroup!: THREE.Group;
  private geometryGroup!: THREE.Group;
  private circleMesh!: THREE.Mesh;
  private sineLine!: THREE.Line;
  private infinityLine!: THREE.Line;
  private pointsShell!: THREE.Points;
  private arcMaterials: THREE.LineBasicMaterial[] = [];
  private arcLines: THREE.Line[] = [];
  private arcPositions: THREE.BufferAttribute[] = [];
  private arcTick = 0;
  private stageRings!: THREE.Group;
  private impactRings: THREE.Mesh[] = [];
  private ringPulse = 0;
  private lightShafts!: THREE.Group;
  private gridWall!: THREE.Mesh;
  private floorGlowMaterial!: THREE.MeshBasicMaterial;
  private haloMaterial!: THREE.SpriteMaterial;
  private haloRingMaterial!: THREE.MeshBasicMaterial;
  private haloGroup!: THREE.Group;
  private spotlights: THREE.SpotLight[] = [];
  private characterBaseY = 0.025;
  private characterScale = 1;
  private lastActionTime = 0;
  private audioEnergy = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.mobile = this.width < 800;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.width < 800 ? 1.4 : 1.55));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#030506');
    this.scene.fog = new THREE.FogExp2(0x030506, 0.026);

    this.camera = new THREE.PerspectiveCamera(35, this.width / this.height, 0.05, 80);
    this.camera.position.set(0.25, 2.1, 6);
    this.camera.lookAt(this.lookTarget);

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.0032,
      defaultColor: [0.003, 0.006, 0.006],
      defaultAlpha: 0.96,
      defaultKeepAlive: true,
    });

    this.post = new PostPipeline(this.renderer, this.scene, this.camera, this.outline, this.width, this.height);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.1;
    this.controls.maxDistance = 11;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.8;
    this.controls.target.copy(this.lookTarget);

    this.buildEnvironment();
    this.resize(this.width, this.height);
  }

  get isReady(): boolean {
    return this.loaded;
  }

  get characterReady(): boolean {
    return this.characterMesh !== null;
  }

  async load(onProgress: ProgressCallback): Promise<void> {
    onProgress({ progress: 5, label: 'BOOTING RENDER CORE', detail: 'creating WebGL context // post-processing // toon pass' });
    const hasPhysics = await this.setupAmmo(onProgress);
    this.physicsEnabled = hasPhysics;
    onProgress({
      progress: 19,
      label: 'MOUNTING MMD SKELETON',
      detail: hasPhysics ? 'PMD parser ready · Ammo.js physics online' : 'PMD parser ready · physics fallback',
    });

    const mmd = await this.loadMMD((fraction) => {
      const percent = 20 + fraction * 64;
      onProgress({
        progress: percent,
        label: 'MOUNTING MMD SKELETON',
        detail: `miku_v2.pmd // wavefile_v2.vmd // ${Math.round(percent)}%`,
      });
    });

    onProgress({ progress: 86, label: 'CALIBRATING STAGE', detail: 'IK solver // dance sync // stage composition' });
    this.attachMMD(mmd.mesh, mmd.animation);
    onProgress({ progress: 95, label: 'SYNCING LYRIC FEED', detail: '129 cues // 240 waveform buckets // MMD motion 93.6s' });
    this.loaded = true;
    this.syncTo(5.6);
    onProgress({ progress: 100, label: 'SIMULATION READY', detail: 'visual core online // waiting for execute()' });
  }

  private async setupAmmo(onProgress: ProgressCallback): Promise<boolean> {
    const ammoFactory = (window as unknown as { Ammo?: unknown }).Ammo;
    if (!ammoFactory) return false;
    onProgress({ progress: 9, label: 'LINKING PHYSICS', detail: 'Ammo.js // rigid bodies // hair + skirt simulation' });
    try {
      const ammo = typeof ammoFactory === 'function' ? await (ammoFactory as () => Promise<unknown>)() : ammoFactory;
      (window as unknown as { Ammo?: unknown }).Ammo = ammo;
      return Boolean(ammo);
    } catch (error) {
      console.warn('Ammo initialization failed. Continuing without MMD physics.', error);
      return false;
    }
  }

  private loadMMD(
    onProgress: (fraction: number) => void,
  ): Promise<{ mesh: THREE.SkinnedMesh; animation: THREE.AnimationClip }> {
    const loader = new MMDLoader();
    return new Promise((resolve, reject) => {
      loader.loadWithAnimation(
        MODEL_URL,
        [MOTION_URL],
        (mmd) => resolve({ mesh: mmd.mesh, animation: mmd.animation }),
        (xhr) => {
          if (xhr.lengthComputable && xhr.total > 0) {
            onProgress(Math.min(1, xhr.loaded / xhr.total));
          } else {
            onProgress(0.45);
          }
        },
        (error) => reject(error),
      );
    });
  }

  private attachMMD(mesh: THREE.SkinnedMesh, animation: THREE.AnimationClip): void {
    this.clipDuration = Math.max(1, animation.duration);
    this.characterMesh = mesh;
    this.characterRoot = new THREE.Group();
    this.characterRoot.name = 'Hatsune Miku // MMD character root';
    this.characterBaseY = 0.028;
    this.characterRoot.position.y = this.characterBaseY;

    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    mesh.position.set(0, 0, 0);

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      material.userData.outlineParameters = {
        thickness: 0.0032,
        color: [0.003, 0.006, 0.006],
        alpha: 0.96,
      };
      material.needsUpdate = true;
    }

    this.characterRoot.add(mesh);
    this.scene.add(this.characterRoot);

    const helper = new MMDAnimationHelper({ sync: false, afterglow: 0, resetPhysicsOnLoop: true });
    let physicsActive = this.physicsEnabled;
    try {
      helper.add(mesh, {
        animation,
        physics: physicsActive,
        warmup: 24,
        unitStep: 1 / 60,
        maxStepNum: 2,
      });
    } catch (error) {
      console.warn('MMD physics setup failed; falling back to IK only.', error);
      physicsActive = false;
      helper.remove(mesh);
      const fallback = new MMDAnimationHelper({ sync: false, afterglow: 0 });
      fallback.add(mesh, { animation, physics: false });
      this.physicsEnabled = false;
      this.helper = fallback;
      this.connectAction(mesh, animation);
      return;
    }

    this.physicsEnabled = physicsActive;
    this.helper = helper;
    this.connectAction(mesh, animation);
  }

  private connectAction(mesh: THREE.SkinnedMesh, animation: THREE.AnimationClip): void {
    const objects = (this.helper as unknown as { objects?: WeakMap<object, { mixer?: THREE.AnimationMixer }> }).objects;
    const mixer = objects?.get(mesh)?.mixer;
    if (!mixer) {
      console.warn('MMD mixer was not created.');
      return;
    }
    const action = mixer.clipAction(animation);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.enabled = true;
    action.play();
    action.time = Math.min(5.6, this.clipDuration - 0.1);
    action.timeScale = 0.11;
    this.action = action;
    this.lastActionTime = action.time;

    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const safeHeight = Math.max(size.y, 0.001);
    const scale = TARGET_HEIGHT / safeHeight;
    const center = box.getCenter(new THREE.Vector3());
    mesh.position.set(-center.x, -box.min.y, -center.z);
    this.characterScale = scale;
    this.characterRoot!.scale.setScalar(scale);
    this.characterRoot!.position.y = this.characterBaseY;
    this.createContactShadow();
    this.helper?.update(0);
    this.snapCamera = true;
  }

  private createContactShadow(): void {
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 1.7),
      new THREE.MeshBasicMaterial({
        map: makeContactTexture(),
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        color: 0x000000,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.028;
    contact.renderOrder = 4;
    contact.material.userData.outlineParameters = { visible: false };
    this.scene.add(contact);
  }

  private buildEnvironment(): void {
    this.buildBackground();
    this.buildFloor();
    this.buildStage();
    this.buildRings();
    this.buildLightShafts();
    this.buildParticles();
    this.buildGlyphs();
    this.buildCodeSprites();
    this.buildGeometry();
    this.buildArcs();
    this.buildGridWall();
    this.buildLights();
    this.markStageOutlinesInvisible();
  }

  private buildBackground(): void {
    this.backgroundMaterial = shaderMaterial(
      {
        uTime: { value: 0 },
        uAccent: { value: this.accent.clone() },
        uAccent2: { value: this.accent2.clone() },
      },
      /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      /* glsl */ `
        uniform float uTime;
        uniform vec3 uAccent;
        uniform vec3 uAccent2;
        varying vec3 vDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }

        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 lower = vec3(0.0025, 0.0038, 0.005) + uAccent * 0.006;
          vec3 upper = vec3(0.0006, 0.0009, 0.0012) + uAccent2 * 0.0025;
          vec3 color = mix(lower, upper, smoothstep(0.2, 0.82, h));
          float horizon = exp(-pow(abs(vDir.y) * 9.0, 2.0));
          color += uAccent * horizon * 0.06;

          float angle = atan(vDir.z, vDir.x);
          float curtain = smoothstep(0.72, 1.0, sin(angle * 16.0 + uTime * 0.08) * 0.5 + 0.5);
          color += uAccent2 * curtain * 0.002 * smoothstep(0.12, 0.8, h);
          color += uAccent * pow(1.0 - abs(vDir.y), 7.0) * 0.008;

          vec3 cell = floor(vDir * 780.0);
          float seed = hash21(cell.xz + cell.y * 1.7);
          float star = step(0.99942, seed) * smoothstep(0.05, 0.38, h);
          float twinkle = 0.5 + 0.5 * sin(uTime * 1.6 + seed * 38.0);
          color += star * twinkle * mix(uAccent, uAccent2, 0.6) * 0.22;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      { side: THREE.BackSide, depthWrite: false, transparent: false },
    );
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(42, 48, 32), this.backgroundMaterial);
    sphere.userData.outlineParameters = { visible: false };
    this.scene.add(sphere);
  }

  private buildFloor(): void {
    this.floorMaterial = shaderMaterial(
      {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uAccent: { value: this.accent.clone() },
        uAccent2: { value: this.accent2.clone() },
      },
      /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      /* glsl */ `
        uniform float uTime;
        uniform float uEnergy;
        uniform vec3 uAccent;
        uniform vec3 uAccent2;
        varying vec2 vWorld;

        float lineGrid(vec2 p) {
          vec2 d = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(0.0001));
          return 1.0 - min(min(d.x, d.y), 1.0);
        }

        void main() {
          float distanceFromCenter = length(vWorld);
          float fade = smoothstep(31.0, 2.0, distanceFromCenter);
          float minor = lineGrid(vWorld);
          float major = lineGrid(vWorld * 0.2);
          float ripple = smoothstep(0.935, 1.0, sin(distanceFromCenter * 2.15 - uTime * 1.9)) * 0.55;
          float alpha = (minor * 0.035 + major * 0.1 + ripple * 0.045) * fade * (0.32 + uEnergy * 0.5);
          vec3 color = mix(uAccent, uAccent2, smoothstep(1.0, 15.0, distanceFromCenter));
          gl_FragColor = vec4(color * alpha * 1.65, alpha);
        }
      `,
      { blending: THREE.AdditiveBlending, side: THREE.DoubleSide },
    );
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), this.floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.13;
    floor.renderOrder = -3;
    this.scene.add(floor);
  }

  private buildStage(): void {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3.36, 3.5, 0.18, 96),
      new THREE.MeshStandardMaterial({
        color: 0x060a0c,
        metalness: 0.58,
        roughness: 0.34,
        emissive: 0x020606,
      }),
    );
    base.position.y = -0.095;
    base.receiveShadow = true;
    this.scene.add(base);

    this.platformMaterial = shaderMaterial(
      {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uImpact: { value: 0 },
        uAccent: { value: this.accent.clone() },
        uAccent2: { value: this.accent2.clone() },
      },
      /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      /* glsl */ `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uImpact;
        uniform vec3 uAccent;
        uniform vec3 uAccent2;
        varying vec2 vUv;

        float thinLine(float value, float width) {
          return 1.0 - min(abs(value) / max(width, 0.0001), 1.0);
        }

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float angle = atan(p.y, p.x);
          float radialCoord = r * 4.5;
          float ring = thinLine(fract(radialCoord) - 0.5, fwidth(radialCoord) * 1.35);
          float fineRing = thinLine(fract(r * 18.0) - 0.5, fwidth(r * 18.0) * 1.1) * 0.28;
          float spoke = thinLine(sin(angle * 18.0) * 0.08, fwidth(angle * 18.0) * 0.08) * 0.25;
          float glow = exp(-r * 4.0) * 0.32;
          float pulse = smoothstep(0.82, 1.0, sin(r * 8.0 - uTime * 2.2)) * 0.07 * (0.4 + uEnergy);
          float edge = smoothstep(1.0, 0.93, r);
          float fade = smoothstep(1.0, 0.06, r);
          float alpha = (ring * 0.23 + fineRing * 0.1 + spoke * 0.06 + glow + pulse) * edge * fade * (0.55 + uEnergy * 0.65);
          alpha += uImpact * smoothstep(0.96, 0.8, r) * 0.12;
          vec3 color = mix(uAccent, uAccent2, smoothstep(-0.8, 0.9, sin(angle + uTime * 0.1)));
          gl_FragColor = vec4(color * (alpha * 2.2 + 0.02), alpha * 0.9);
        }
      `,
      { blending: THREE.AdditiveBlending, side: THREE.DoubleSide },
    );
    const platform = new THREE.Mesh(new THREE.CircleGeometry(3.3, 128), this.platformMaterial);
    platform.rotation.x = -Math.PI / 2;
    platform.position.y = 0.016;
    platform.renderOrder = 1;
    this.scene.add(platform);

    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: this.accent.clone(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.edgeMaterials.push(edgeMaterial);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(3.34, 0.008, 4, 180), edgeMaterial);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.03;
    this.scene.add(edge);

    const innerEdgeMaterial = new THREE.MeshBasicMaterial({
      color: this.accent2.clone(),
      transparent: true,
      opacity: 0.17,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.edgeMaterials.push(innerEdgeMaterial);
    const innerEdge = new THREE.Mesh(new THREE.TorusGeometry(2.86, 0.005, 4, 160), innerEdgeMaterial);
    innerEdge.rotation.x = Math.PI / 2;
    innerEdge.position.y = 0.024;
    this.scene.add(innerEdge);

    this.floorGlowMaterial = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: this.accent.clone(),
      transparent: true,
      opacity: 0.17,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowPool = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.9), this.floorGlowMaterial);
    glowPool.rotation.x = -Math.PI / 2;
    glowPool.position.y = 0.019;
    glowPool.renderOrder = 2;
    this.scene.add(glowPool);

    this.haloGroup = new THREE.Group();
    this.haloGroup.position.set(0, 1.8, -2.7);
    this.haloMaterial = new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: this.accent.clone(),
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const haloGlow = new THREE.Sprite(this.haloMaterial);
    haloGlow.scale.set(5.6, 5.6, 1);
    this.haloGroup.add(haloGlow);
    this.haloRingMaterial = new THREE.MeshBasicMaterial({
      color: this.accent.clone(),
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const haloRing = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.112, 160), this.haloRingMaterial);
    this.haloGroup.add(haloRing);
    this.scene.add(this.haloGroup);

    for (let i = 0; i < 2; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? this.accent.clone() : this.accent2.clone(),
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.edgeMaterials.push(mat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.035;
      ring.scale.setScalar(3.34);
      this.impactRings.push(ring);
      this.scene.add(ring);
    }
  }

  private buildRings(): void {
    this.stageRings = new THREE.Group();
    this.stageRings.position.y = 1.25;
    const settings = [
      { radius: 3.7, rotation: [1.28, 0.0, 0.28] as [number, number, number], opacity: 0.11, color: this.accent.clone(), speed: 0.032, mix: 0 },
      { radius: 4.25, rotation: [1.05, 0.4, -0.5] as [number, number, number], opacity: 0.06, color: this.accent2.clone(), speed: -0.021, mix: 1 },
      { radius: 2.94, rotation: [0.18, 0.6, 0.08] as [number, number, number], opacity: 0.08, color: this.accent.clone(), speed: 0.045, mix: 0 },
    ];
    for (const setting of settings) {
      const material = new THREE.MeshBasicMaterial({
        color: setting.color,
        transparent: true,
        opacity: setting.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      material.userData.spin = setting.speed;
      material.userData.accentMix = setting.mix;
      this.ringMaterials.push(material);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(setting.radius, 0.006, 4, 230), material);
      ring.rotation.set(...setting.rotation);
      this.stageRings.add(ring);
    }
    this.scene.add(this.stageRings);
  }

  private buildLightShafts(): void {
    this.lightShafts = new THREE.Group();
    const positions: number[] = [];
    const colors: number[] = [];
    const palette = [this.accent, this.accent2];
    for (let i = 0; i < 34; i += 1) {
      const angle = (i / 34) * Math.PI * 2 + Math.random() * 0.07;
      const radius = 3.9 + Math.random() * 2.5;
      const height = 0.6 + Math.random() * 5.1;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions.push(x, 0.04, z, x, height, z);
      const color = palette[i % palette.length].clone().multiplyScalar(0.55 + Math.random() * 0.45);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.lightShaftMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, this.lightShaftMaterial);
    this.lightShafts.add(lines);

    const topGeometry = new THREE.RingGeometry(4.1, 4.13, 96);
    const topMaterial = new THREE.MeshBasicMaterial({
      color: this.accent.clone(),
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    topMaterial.userData.accentMix = 0.55;
    this.ringMaterials.push(topMaterial);
    const topRing = new THREE.Mesh(topGeometry, topMaterial);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 4.8;
    this.lightShafts.add(topRing);
    this.scene.add(this.lightShafts);
  }

  private buildParticles(): void {
    const count = 540;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.55 + Math.pow(Math.random(), 0.62) * 5.6;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -0.4 + Math.random() * 6.4;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i] = Math.random();
      sizes[i] = 0.6 + Math.random() * 2.1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.particleMaterial = shaderMaterial(
      {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uAccent: { value: this.accent.clone() },
        uAccent2: { value: this.accent2.clone() },
      },
      /* glsl */ `
        attribute float aSeed;
        attribute float aSize;
        uniform float uTime;
        uniform float uEnergy;
        uniform float uPixelRatio;
        uniform vec3 uAccent;
        uniform vec3 uAccent2;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vec3 p = position;
          float life = fract(aSeed + uTime * 0.022);
          p.y = mix(-0.3, 6.0, life);
          p.x += sin(uTime * 0.28 + aSeed * 32.0) * (0.22 + aSeed * 0.28);
          p.z += cos(uTime * 0.21 + aSeed * 24.0) * (0.2 + aSeed * 0.24);
          p.y += uEnergy * 0.15 * sin(aSeed * 20.0);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uPixelRatio * (6.5 / max(1.0, -mvPosition.z));
          vAlpha = smoothstep(0.0, 0.14, life) * (1.0 - smoothstep(0.7, 1.0, life));
          vColor = mix(uAccent, uAccent2, fract(aSeed * 8.3));
        }
      `,
      /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float alpha = smoothstep(0.5, 0.06, d);
          float core = smoothstep(0.2, 0.0, d);
          gl_FragColor = vec4(vColor * (1.05 + core * 1.6), alpha * vAlpha * 0.4);
        }
      `,
      { blending: THREE.AdditiveBlending },
    );
    const points = new THREE.Points(geometry, this.particleMaterial);
    points.frustumCulled = false;
    points.renderOrder = 3;
    this.scene.add(points);
  }

  private buildGlyphs(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 64, 64);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(32, 12);
      ctx.lineTo(32, 52);
      ctx.moveTo(12, 32);
      ctx.lineTo(52, 32);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.glyphMaterial = new THREE.PointsMaterial({
      map: texture,
      color: this.accent2.clone(),
      size: 0.085,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const count = 72;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.6 + Math.random() * 4.4;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.3 + Math.random() * 4.8;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.glyphGroup = new THREE.Points(geometry, this.glyphMaterial);
    this.scene.add(this.glyphGroup);
  }

  private buildCodeSprites(): void {
    const texts = [
      'world.execute(me);',
      'if (love) return;',
      'while (true) { you; }',
      'LOVE = ∫₀^∞',
      'object.create(heart)',
      '0xDEAD_LOVE',
      'for (i = 0; i < ∞; i++)',
      'return { me };',
    ];
    const positions = [
      [-3.65, 2.9, -1.1],
      [3.3, 3.35, -1.8],
      [-2.55, 1.15, -2.35],
      [4.1, 1.4, -1.5],
      [-4.4, 4.0, -4.3],
      [4.65, 4.25, -4.0],
      [-5.2, 0.9, -3.0],
      [5.35, 0.7, -2.4],
    ];
    texts.forEach((text, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '500 52px "IBM Plex Mono", "Cascadia Code", monospace';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(255,255,255,0.55)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(text, 18, 92);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: index % 2 === 0 ? this.accent.clone() : this.accent2.clone(),
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      const base = new THREE.Vector3(...(positions[index] as [number, number, number]));
      const width = 2.2 + Math.min(1.3, text.length * 0.045);
      sprite.position.copy(base);
      sprite.scale.set(width, 0.4, 1);
      this.scene.add(sprite);
      this.codeSprites.push(sprite);
      this.codeSpriteData.push({ base, phase: Math.random() * Math.PI * 2, baseOpacity: 0.065 + Math.random() * 0.055 });
    });
  }

  private buildGeometry(): void {
    this.geometryGroup = new THREE.Group();
    this.geometryGroup.position.y = 0;
    this.scene.add(this.geometryGroup);

    // — set of points / sphere of points —
    const count = 280;
    const positions = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i += 1) {
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = golden * i;
      positions[i * 3] = Math.cos(theta) * radius * 2.34;
      positions[i * 3 + 1] = 1.62 + y * 1.78;
      positions[i * 3 + 2] = Math.sin(theta) * radius * 2.34;
    }
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.pointsShellMaterial = new THREE.PointsMaterial({
      color: this.accent.clone(),
      size: 0.035,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.pointsShell = new THREE.Points(pointsGeometry, this.pointsShellMaterial);
    this.geometryGroup.add(this.pointsShell);

    // — circle / circumference —
    this.circleMaterial = new THREE.MeshBasicMaterial({
      color: this.accent.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.circleMesh = new THREE.Mesh(new THREE.TorusGeometry(1.74, 0.008, 4, 180), this.circleMaterial);
    this.circleMesh.position.y = 1.65;
    this.circleMesh.rotation.set(Math.PI / 2.22, 0.1, 0.24);
    this.geometryGroup.add(this.circleMesh);

    // — sine wave —
    const sinePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200;
      const x = (t - 0.5) * 4.4;
      sinePoints.push(new THREE.Vector3(x, 1.9 + Math.sin((t - 0.5) * Math.PI * 4.3) * 0.52, -0.9));
    }
    this.sineMaterial = new THREE.LineBasicMaterial({
      color: this.accent2.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sineLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sinePoints), this.sineMaterial);
    this.geometryGroup.add(this.sineLine);

    // — infinity / limit —
    const infinityPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 240; i += 1) {
      const t = (i / 240) * Math.PI * 2;
      const denom = 1 + Math.sin(t) * Math.sin(t);
      infinityPoints.push(
        new THREE.Vector3(
          1.82 * Math.cos(t) / denom,
          1.8 + (0.88 * Math.sin(t) * Math.cos(t)) / denom,
          -1.35,
        ),
      );
    }
    this.infinityMaterial = new THREE.LineBasicMaterial({
      color: this.accent.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.infinityLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(infinityPoints), this.infinityMaterial);
    this.geometryGroup.add(this.infinityLine);

    // — a heart curve that lives in the love section —
    const heartPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 260; i += 1) {
      const t = (i / 260) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      heartPoints.push(new THREE.Vector3(x * 0.095, 1.82 + (y - 1.6) * 0.082, -1.7));
    }
    this.heartMaterial = new THREE.LineBasicMaterial({
      color: this.accent2.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const heartLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(heartPoints), this.heartMaterial);
    this.heartGroup = new THREE.Group();
    this.heartGroup.add(heartLine);
    this.heartGroup.scale.setScalar(0.9);
    this.geometryGroup.add(this.heartGroup);
  }

  private buildArcs(): void {
    const segmentCount = 27;
    for (let arcIndex = 0; arcIndex < 3; arcIndex += 1) {
      const positions = new Float32Array(segmentCount * 3);
      const geometry = new THREE.BufferGeometry();
      const attribute = new THREE.BufferAttribute(positions, 3);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', attribute);
      const material = new THREE.LineBasicMaterial({
        color: arcIndex === 2 ? this.accent.clone() : this.accent2.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false;
      this.scene.add(line);
      this.arcLines.push(line);
      this.arcMaterials.push(material);
      this.arcPositions.push(attribute);
    }
  }

  private buildGridWall(): void {
    this.gridWallMaterial = shaderMaterial(
      {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uGlitch: { value: 0 },
        uAccent: { value: this.accent.clone() },
        uAccent2: { value: this.accent2.clone() },
      },
      /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uGlitch;
        uniform vec3 uAccent;
        uniform vec3 uAccent2;
        varying vec2 vUv;

        float lineMask(vec2 p) {
          vec2 d = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(0.0001));
          return 1.0 - min(min(d.x, d.y), 1.0);
        }

        void main() {
          vec2 uv = vUv;
          uv.x += step(0.87, fract(uv.y * 19.0 + floor(uTime * 2.3))) * (fract(uTime * 9.1) - 0.5) * 0.045 * uGlitch;
          vec2 gridP = uv * vec2(28.0, 15.0);
          float grid = lineMask(gridP);
          float major = lineMask(uv * vec2(7.0, 4.0)) * 0.8;
          float scan = smoothstep(0.47, 0.5, fract(uv.y * 3.0 - uTime * 0.07)) * smoothstep(0.54, 0.5, fract(uv.y * 3.0 - uTime * 0.07));
          float vignette = smoothstep(0.0, 0.22, uv.x) * smoothstep(1.0, 0.78, uv.x);
          float bars = step(0.72, fract(uv.x * 70.0 + uTime * 0.2)) * 0.15 * uGlitch;
          float alpha = (grid * 0.1 + major * 0.1 + scan * 0.03 + bars) * vignette * uOpacity;
          vec3 color = mix(uAccent, uAccent2, smoothstep(0.0, 1.0, uv.y));
          gl_FragColor = vec4(color * alpha * 2.0, alpha);
        }
      `,
      { blending: THREE.AdditiveBlending, side: THREE.DoubleSide },
    );
    this.gridWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 8.4), this.gridWallMaterial);
    this.gridWall.position.set(0, 3.4, -5.1);
    this.gridWall.renderOrder = -2;
    this.scene.add(this.gridWall);
  }

  private buildLights(): void {
    const ambient = new THREE.AmbientLight(0xc2dad8, 0.52);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xf4fbff, 1.5);
    key.position.set(3.4, 6.8, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.2;
    key.shadow.camera.far = 18;
    key.shadow.camera.left = -3.4;
    key.shadow.camera.right = 3.4;
    key.shadow.camera.top = 4.5;
    key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8affc9, 0.24);
    fill.position.set(-3.2, 2.4, -1.5);
    this.scene.add(fill);

    const front = new THREE.DirectionalLight(0xfff2fa, 0.22);
    front.position.set(0.5, 2.6, 5.5);
    this.scene.add(front);

    const leftSpot = new THREE.SpotLight(0xff5eba, 7.5, 12, Math.PI / 5.5, 0.8, 1.8);
    leftSpot.position.set(-3.4, 4.5, 1.7);
    leftSpot.target.position.set(0, 1.5, 0);
    this.scene.add(leftSpot, leftSpot.target);
    this.spotlights.push(leftSpot);

    const rightSpot = new THREE.SpotLight(0x72f6ff, 6.8, 12, Math.PI / 5.5, 0.85, 1.8);
    rightSpot.position.set(3.5, 3.9, 1.4);
    rightSpot.target.position.set(0, 1.5, 0);
    this.scene.add(rightSpot, rightSpot.target);
    this.spotlights.push(rightSpot);

    const rim = new THREE.PointLight(0xff8bd2, 4.5, 10, 2);
    rim.position.set(0, 2.4, -2.2);
    this.scene.add(rim);
  }

  private markStageOutlinesInvisible(): void {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      markOutlineInvisible(mesh);
    });
  }

  setPointer(x: number, y: number): void {
    this.pointer.set(x, y);
  }

  setFreeCamera(enabled: boolean): void {
    this.freeCamera = enabled;
    this.controls.enabled = enabled;
    if (enabled) {
      this.controls.target.copy(this.lookTarget);
      this.controls.update();
    } else {
      this.snapCamera = false;
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.mobile = this.width < 800;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.post.setSize(this.width, this.height);
  }

  triggerImpact(strength = 1): void {
    this.impact = Math.max(this.impact, Math.min(1.35, strength));
    this.ringPulse = 1;
  }

  triggerBeat(strength = 0.6): void {
    this.beatPulse = Math.max(this.beatPulse, strength);
  }

  triggerCut(strength = 0.8): void {
    if (this.reducedMotion) return;
    const previous = this.shotIndex;
    let next = Math.floor(Math.random() * SHOTS.length);
    if (next === previous) next = (next + 1) % SHOTS.length;
    this.shotIndex = next;
    const shot = SHOTS[next];
    this.cutTargetOffset.copy(shot.target);
    this.cutWeight = Math.max(this.cutWeight, strength);
    this.impact = Math.max(this.impact, 0.25 * strength);
    this.snapCamera = true;
  }

  syncTo(time: number): void {
    if (!this.action) return;
    const normalized = ((time % this.clipDuration) + this.clipDuration) % this.clipDuration;
    this.action.time = normalized;
    this.lastActionTime = normalized;
    this.action.paused = false;
    this.helper?.update(0);
  }

  update(frame: StageFrame): void {
    const dt = Math.min(0.06, Math.max(0, frame.dt));
    this.realTime += dt;
    this.elapsed += dt;
    this.updateSequence += 1;
    const section = frame.section;
    this.audioEnergy += (frame.levels.energy - this.audioEnergy) * (1 - Math.exp(-dt * 5));

    if (section.id !== this.lastSectionId) {
      this.lastSectionId = section.id;
      this.sectionStart = section.start;
      this.sectionCameraPhase = Math.random() * Math.PI * 2;
      if (['fragments', 'illegal', 'execution', 'only', 'final'].includes(section.id)) {
        this.triggerCut(0.85);
      }
      if (['execution', 'final', 'illegal'].includes(section.id)) {
        this.triggerImpact(0.9);
      }
    }

    this.accentTarget.set(section.accent);
    this.accent2Target.set(section.accent2);
    const colorBlend = 1 - Math.exp(-dt * 1.8);
    this.accent.lerp(this.accentTarget, colorBlend);
    this.accent2.lerp(this.accent2Target, colorBlend);

    this.impact *= Math.exp(-dt * 4.2);
    this.beatPulse *= Math.exp(-dt * 6.2);
    this.ringPulse *= Math.exp(-dt * 2.2);
    const sectionGlitch = section.glitch + this.impact * 0.48 + this.beatPulse * 0.1;
    this.glitch += (sectionGlitch - this.glitch) * (1 - Math.exp(-dt * 7));

    this.updateCharacter(frame, dt);
    this.updateEnvironment(frame, dt);
    this.updateCamera(frame, dt);
  }

  private updateCharacter(frame: StageFrame, dt: number): void {
    if (!this.characterRoot) return;
    if (this.action) {
      if (!frame.started) {
        this.action.timeScale = this.reducedMotion ? 0 : 0.105;
        this.helper?.update(dt);
      } else if (frame.playing) {
        const speed = 0.88 + frame.section.energy * 0.3 + frame.levels.energy * 0.1;
        this.action.timeScale = speed;
        const before = this.action.time;
        this.helper?.update(dt);
        if (this.action.time < before - 1) {
          this.triggerImpact(0.78);
          this.triggerCut(0.48);
        }
      } else {
        this.action.timeScale = 0;
        this.helper?.update(0);
      }
      this.lastActionTime = this.action.time;
    }

    const breath = Math.sin(this.elapsed * 1.2) * 0.004;
    this.characterRoot.position.y = this.characterBaseY + breath + this.beatPulse * 0.008 + this.impact * 0.01;
    this.characterRoot.rotation.y = Math.sin(this.elapsed * 0.18) * 0.035;
    const scalePulse = this.characterScale * (1 + this.beatPulse * 0.0025);
    this.characterRoot.scale.setScalar(scalePulse);
  }

  private updateEnvironment(frame: StageFrame, dt: number): void {
    const { section, cue, levels } = frame;
    const time = this.elapsed;
    const highGlitch = ['illegal', 'execution', 'final', 'only'].includes(section.id);

    this.backgroundMaterial.uniforms.uTime.value = time;
    (this.backgroundMaterial.uniforms.uAccent.value as THREE.Color).copy(this.accent);
    (this.backgroundMaterial.uniforms.uAccent2.value as THREE.Color).copy(this.accent2);

    this.floorMaterial.uniforms.uTime.value = time;
    this.floorMaterial.uniforms.uEnergy.value = levels.energy;
    (this.floorMaterial.uniforms.uAccent.value as THREE.Color).copy(this.accent);
    (this.floorMaterial.uniforms.uAccent2.value as THREE.Color).copy(this.accent2);

    this.platformMaterial.uniforms.uTime.value = time;
    this.platformMaterial.uniforms.uEnergy.value = levels.energy;
    this.platformMaterial.uniforms.uImpact.value = this.impact;
    (this.platformMaterial.uniforms.uAccent.value as THREE.Color).copy(this.accent);
    (this.platformMaterial.uniforms.uAccent2.value as THREE.Color).copy(this.accent2);

    this.gridWallMaterial.uniforms.uTime.value = time;
    this.gridWallMaterial.uniforms.uGlitch.value = this.glitch;
    (this.gridWallMaterial.uniforms.uAccent.value as THREE.Color).copy(this.accent);
    (this.gridWallMaterial.uniforms.uAccent2.value as THREE.Color).copy(this.accent2);
    const wallTarget = highGlitch ? 0.8 + this.impact * 0.35 : 0;
    this.gridWallMaterial.uniforms.uOpacity.value +=
      (wallTarget - (this.gridWallMaterial.uniforms.uOpacity.value as number)) * (1 - Math.exp(-dt * 3.6));
    this.gridWall.visible = (this.gridWallMaterial.uniforms.uOpacity.value as number) > 0.008;

    this.particleMaterial.uniforms.uTime.value = time;
    this.particleMaterial.uniforms.uEnergy.value = levels.energy;
    (this.particleMaterial.uniforms.uAccent.value as THREE.Color).copy(this.accent);
    (this.particleMaterial.uniforms.uAccent2.value as THREE.Color).copy(this.accent2);

    this.ringMaterials.forEach((material) => {
      const mix = (material.userData.accentMix as number) ?? 0;
      material.color.copy(this.accent).lerp(this.accent2, mix);
    });
    this.edgeMaterials.forEach((material, index) => {
      material.color.copy(index % 2 === 0 ? this.accent : this.accent2);
    });
    this.floorGlowMaterial.color.copy(this.accent);
    this.floorGlowMaterial.opacity = 0.1 + levels.energy * 0.12 + this.beatPulse * 0.04;
    const quiet = section.id === 'isolation' || section.id === 'trapped';
    this.haloMaterial.color.copy(this.accent);
    this.haloMaterial.opacity = (quiet ? 0.035 : 0.055) + levels.energy * 0.07 + this.beatPulse * 0.04;
    this.haloRingMaterial.color.copy(this.accent);
    this.haloRingMaterial.opacity = (quiet ? 0.06 : 0.13) + levels.energy * 0.14 + this.beatPulse * 0.06;
    this.haloGroup.scale.setScalar(1 + this.beatPulse * 0.015);
    this.haloGroup.rotation.z = Math.sin(time * 0.06) * 0.02;
    this.lightShaftMaterial.opacity = 0.065 + levels.energy * 0.13 + this.impact * 0.05;
    this.spotlights.forEach((light, index) => {
      light.color.copy(index === 0 ? this.accent2 : this.accent);
      light.intensity = (index === 0 ? 8 : 7) + levels.energy * 7 + this.impact * 5;
    });
    this.glyphMaterial.color.copy(this.accent2);
    this.glyphMaterial.opacity = 0.1 + levels.energy * 0.11;
    this.glyphGroup.rotation.y += dt * 0.012;

    this.lightShafts.rotation.y += dt * 0.015;
    this.stageRings.rotation.y += dt * 0.016;
    this.stageRings.rotation.x = Math.sin(time * 0.08) * 0.05;

    this.impactRings.forEach((ring, index) => {
      const material = ring.material as THREE.MeshBasicMaterial;
      const pulse = Math.max(this.ringPulse, this.beatPulse * 0.8);
      const expansion = 1 + (1 - pulse) * 1.8 + index * 0.25;
      ring.scale.setScalar(3.34 * expansion);
      material.opacity = pulse * (index === 0 ? 0.7 : 0.35);
      material.color.copy(index === 0 ? this.accent : this.accent2);
      ring.visible = material.opacity > 0.008;
    });

    this.updateCodeSprites(time, levels.energy);
    this.updateGeoProps(section, cue, dt, time);
    this.updateArcs(section, dt, time);
  }

  private updateCodeSprites(time: number, energy: number): void {
    this.codeSprites.forEach((sprite, index) => {
      const data = this.codeSpriteData[index];
      if (!data) return;
      sprite.position.x = data.base.x + Math.sin(time * 0.17 + data.phase) * 0.14;
      sprite.position.y = data.base.y + Math.sin(time * 0.22 + data.phase * 1.3) * 0.08;
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = data.baseOpacity * (0.48 + energy * 0.58);
      material.color.copy(index % 2 === 0 ? this.accent : this.accent2);
    });
  }

  private updateGeoProps(section: Section, cue: Cue | null, dt: number, time: number): void {
    const isGeometry = section.id === 'geometry';
    const cueIndex = cue?.index ?? -1;
    const shell = isGeometry ? (cueIndex >= 13 && cueIndex <= 15 ? 0.52 : 0.06) : 0.0;
    const circle = isGeometry ? (cueIndex >= 16 && cueIndex <= 18 ? 0.58 : 0.0) : 0.0;
    const sine = isGeometry ? (cueIndex >= 19 && cueIndex <= 21 ? 0.62 : 0.0) : 0.0;
    const infinity = isGeometry ? (cueIndex >= 22 && cueIndex <= 24 ? 0.6 : 0.0) : 0.0;
    const heart = section.id === 'love' ? 0.46 : section.id === 'trapped' ? 0.16 : section.id === 'stimulation' ? 0.045 : 0;
    const blend = 1 - Math.exp(-dt * 3.4);

    this.pointsShellMaterial.opacity += (shell - this.pointsShellMaterial.opacity) * blend;
    this.circleMaterial.opacity += (circle - this.circleMaterial.opacity) * blend;
    this.sineMaterial.opacity += (sine - this.sineMaterial.opacity) * blend;
    this.infinityMaterial.opacity += (infinity - this.infinityMaterial.opacity) * blend;
    this.heartMaterial.opacity += (heart - this.heartMaterial.opacity) * blend;

    this.pointsShellMaterial.size = 0.028 + (cueIndex === 13 ? 0.018 : 0);
    this.pointsShellMaterial.needsUpdate = true;
    this.pointsShellMaterial.color.copy(this.accent);
    this.circleMaterial.color.copy(this.accent);
    this.sineMaterial.color.copy(this.accent2);
    this.infinityMaterial.color.copy(this.accent2);
    this.heartMaterial.color.copy(this.accent2);

    this.pointsShell.rotation.y = time * 0.08;
    this.circleMesh.rotation.z = Math.PI / 2.22 + Math.sin(time * 0.2) * 0.12;
    this.circleMesh.scale.setScalar(1 + Math.sin(time * 1.2) * 0.025);
    this.sineLine.position.x = Math.sin(time * 0.12) * 0.15;
    this.infinityLine.rotation.z = Math.sin(time * 0.09) * 0.08;
    this.heartGroup.scale.setScalar(0.9 + Math.sin(time * 0.7) * 0.025 + this.beatPulse * 0.02);
    this.heartGroup.rotation.y = Math.sin(time * 0.18) * 0.08;

    this.pointsShell.visible = this.pointsShellMaterial.opacity > 0.005;
    this.circleMesh.visible = this.circleMaterial.opacity > 0.005;
    this.sineLine.visible = this.sineMaterial.opacity > 0.005;
    this.infinityLine.visible = this.infinityMaterial.opacity > 0.005;
    this.heartGroup.visible = this.heartMaterial.opacity > 0.005;
  }

  private updateArcs(section: Section, dt: number, time: number): void {
    const active =
      section.id === 'current' ||
      section.id === 'stimulation' ||
      section.id === 'vibration' ||
      section.id === 'roles' ||
      section.id === 'execution';
    this.arcTick += dt;
    if (this.arcTick > (active ? 0.075 : 0.2)) {
      this.arcTick = 0;
      this.regenerateArcs(active ? 1 : 0.2);
    }
    this.arcLines.forEach((line, index) => {
      line.visible = active;
      const material = this.arcMaterials[index];
      material.opacity = active ? 0.35 + this.impact * 0.25 + Math.sin(time * 13 + index) * 0.08 : 0;
      material.color.copy(index === 2 ? this.accent : this.accent2);
    });
  }

  private regenerateArcs(energy: number): void {
    this.arcLines.forEach((line, arcIndex) => {
      const attribute = this.arcPositions[arcIndex];
      const positions = attribute.array as Float32Array;
      const baseAngle = arcIndex * 2.1 + this.realTime * 0.3;
      for (let i = 0; i < attribute.count; i += 1) {
        const t = i / (attribute.count - 1);
        const angle = baseAngle + t * 2.8 + Math.sin(t * 15 + this.realTime * 4 + arcIndex) * 0.22;
        const radius = 0.38 + Math.sin(t * Math.PI) * (0.3 + energy * 0.22) + Math.random() * 0.11;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = 0.26 + t * (2.32 + energy * 0.4) + Math.random() * 0.13;
        positions[i * 3 + 2] = Math.sin(angle) * radius + 0.1;
      }
      attribute.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    });
  }

  private updateCamera(frame: StageFrame, dt: number): void {
    const { section } = frame;
    const direction = section.camera;
    if (this.freeCamera) {
      this.controls.update();
      this.lookTarget.copy(this.controls.target);
      return;
    }

    const time = this.elapsed;
    const orbit =
      Math.sin(time * 0.14 + this.sectionCameraPhase) * direction.orbit +
      Math.sin(time * 0.055 + this.sectionCameraPhase * 0.7) * direction.drift * 0.28;
    const baseTarget = new THREE.Vector3(...direction.target);
    const basePosition = new THREE.Vector3(...direction.position);

    if (this.mobile || this.width / this.height < 0.86) {
      basePosition.z += 0.72;
      basePosition.y += 0.12;
      baseTarget.y -= 0.1;
    }

    const framing: Record<string, number> = {
      boot: 0.62,
      execute: 0.67,
      geometry: 0.67,
      current: 0.7,
      stimulation: 0.72,
      organic: 0.69,
      roles: 0.69,
      vibration: 0.73,
      isolation: 0.56,
      fragments: 0.7,
      illegal: 0.69,
      execution: 0.69,
      only: 0.71,
      love: 0.72,
      trapped: 0.56,
      final: 0.7,
    };
    const mobileScale = this.mobile || this.width / this.height < 0.86 ? 0.9 : 1;
    const frameFraction = (framing[section.id] ?? 0.68) * mobileScale;
    const minimumDistance =
      TARGET_HEIGHT / frameFraction / (2 * Math.tan(THREE.MathUtils.degToRad(direction.fov) / 2));

    const offset = basePosition.sub(baseTarget);
    const baseDistance = Math.max(offset.length() * 1.12, minimumDistance);
    offset.setLength(baseDistance).applyAxisAngle(Y_AXIS, orbit);
    const desired = baseTarget.clone().add(offset);
    const desiredTarget = baseTarget.clone();

    if (!this.reducedMotion) {
      desired.x += this.pointer.x * 0.22;
      desired.y += this.pointer.y * 0.12;
      desiredTarget.x += this.pointer.x * 0.055;
      desiredTarget.y += this.pointer.y * 0.035;
    }

    const shot = SHOTS[this.shotIndex];
    desired.add(shot.position.clone().multiplyScalar(this.cutWeight));
    desiredTarget.add(this.cutTargetOffset.clone().multiplyScalar(this.cutWeight));

    const shakeAmount = direction.shake + this.impact * 0.055 + this.beatPulse * 0.008;
    if (!this.reducedMotion) {
      const shakeX = Math.sin(time * 47.3) * shakeAmount + Math.sin(time * 15.7) * shakeAmount * 0.4;
      const shakeY = Math.cos(time * 41.9) * shakeAmount * 0.65;
      const shakeZ = Math.sin(time * 23.1) * shakeAmount * 0.35;
      desired.x += shakeX;
      desired.y += shakeY;
      desired.z += shakeZ;
    }
    desired.y += Math.sin(time * 1.05) * 0.025 + this.beatPulse * 0.018;

    const targetLerp = 1 - Math.exp(-dt * (this.snapCamera ? 999 : 3.3));
    if (this.snapCamera) {
      this.camera.position.copy(desired);
      this.lookTarget.copy(desiredTarget);
      this.camera.fov = direction.fov;
      this.camera.lookAt(this.lookTarget);
      this.camera.updateProjectionMatrix();
      this.snapCamera = false;
    } else {
      const positionBlend = 1 - Math.exp(-dt * 3.1);
      this.camera.position.lerp(desired, positionBlend);
      this.lookTarget.lerp(desiredTarget, targetLerp);
      const fovTarget = direction.fov + this.beatPulse * 0.5 + this.impact * 1.8;
      this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-dt * 4.6));
      this.camera.lookAt(this.lookTarget);
      this.camera.updateProjectionMatrix();
    }

    this.cutWeight *= Math.exp(-dt * 1.85);
    if (this.cutWeight < 0.005) this.cutWeight = 0;
    this.cutTargetOffset.multiplyScalar(Math.exp(-dt * 1.85));
  }

  render(dt: number): void {
    const safeImpact = this.reducedMotion ? 0 : Math.min(1, this.impact);
    const safeGlitch = this.reducedMotion ? 0 : Math.min(1.2, this.glitch);
    this.post.update({
      time: this.elapsed,
      impact: safeImpact,
      glitch: safeGlitch,
      energy: Math.min(1, this.audioEnergy * 0.72 + this.beatPulse * 0.28),
      accent: this.accent,
    });
    this.post.render(dt);
  }

  getDebugState(): Record<string, unknown> {
    return {
      loaded: this.loaded,
      physicsEnabled: this.physicsEnabled,
      clipDuration: this.clipDuration,
      actionTime: this.action?.time ?? null,
      characterPosition: this.characterRoot?.position.toArray() ?? null,
      characterScale: this.characterRoot?.scale.toArray() ?? null,
      camera: this.camera.position.toArray(),
      shots: SHOTS.length,
      updateSequence: this.updateSequence,
    };
  }

  dispose(): void {
    this.controls.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
