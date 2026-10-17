import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uImpact: { value: 0 },
    uGlitch: { value: 0 },
    uEnergy: { value: 0 },
    uAccent: { value: new THREE.Color('#63ffb6') },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uImpact;
    uniform float uGlitch;
    uniform float uEnergy;
    uniform vec3 uAccent;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 345.45));
      p += dot(p, p + 34.345);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      float time = uTime;
      vec2 resolution = max(uResolution, vec2(1.0));

      float band = floor(uv.y * 38.0);
      float bandNoise = hash21(vec2(band, floor(time * 17.0)));
      float strip = step(0.76, bandNoise);
      uv.x += (bandNoise - 0.5) * (uGlitch * 0.034 + uImpact * 0.012) * strip;

      float pulse = step(0.987, hash21(vec2(floor(uv.y * 150.0), floor(time * 31.0)))) * uGlitch;
      float aberration = 0.00028 + uImpact * 0.0048 + uEnergy * 0.0008 + pulse * 0.002;
      vec3 color;
      color.r = texture2D(tDiffuse, uv + vec2(aberration, 0.0)).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - vec2(aberration, 0.0)).b;

      float scan = sin(uv.y * resolution.y * 1.18) * 0.5 + 0.5;
      color *= 1.0 - scan * 0.023 - 0.01;

      float sweep = smoothstep(0.045, 0.0, abs(uv.y - fract(time * 0.032)));
      color += uAccent * sweep * 0.015;

      float grain = hash21(uv * resolution + vec2(time * 31.0, time * 17.0)) - 0.5;
      color += grain * 0.007;

      vec2 centered = uv - 0.5;
      float vignette = smoothstep(0.97, 0.22, length(centered * vec2(1.28, 1.0)));
      color *= mix(0.46, 1.0, vignette);

      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color += uAccent * 0.014 * (1.0 - smoothstep(0.0, 0.38, luminance));
      color = (color - 0.5) * 1.055 + 0.5;

      float redFlash = step(0.975, bandNoise) * uImpact;
      color = mix(color, vec3(1.0, 0.035, 0.09), redFlash * 0.17);

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

class OutlineRenderPass extends Pass {
  private readonly effect: OutlineEffect;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  constructor(effect: OutlineEffect, scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.effect = effect;
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.clear = false;
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    renderer.setRenderTarget(readBuffer);
    this.effect.render(this.scene, this.camera);
  }
}

export interface FXUniformState {
  time: number;
  impact: number;
  glitch: number;
  energy: number;
  accent: THREE.Color;
}

export class PostPipeline {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly width: number;
  private readonly height: number;
  private readonly pixelRatio: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    outline: OutlineEffect,
    width: number,
    height: number,
  ) {
    this.width = width;
    this.height = height;
    this.pixelRatio = renderer.getPixelRatio();
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.composer.addPass(new OutlineRenderPass(outline, scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.34, 0.5, 0.9);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(CinematicShader);
    this.grade.uniforms.uResolution.value.set(width * this.pixelRatio, height * this.pixelRatio);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.grade.uniforms.uResolution.value.set(width * this.pixelRatio, height * this.pixelRatio);
  }

  update(state: FXUniformState): void {
    this.grade.uniforms.uTime.value = state.time;
    this.grade.uniforms.uImpact.value = state.impact;
    this.grade.uniforms.uGlitch.value = state.glitch;
    this.grade.uniforms.uEnergy.value = state.energy;
    (this.grade.uniforms.uAccent.value as THREE.Color).copy(state.accent);
    this.bloom.strength = 0.3 + state.energy * 0.32 + state.impact * 0.22;
    this.bloom.radius = 0.42 + state.energy * 0.16;
  }

  render(delta: number): void {
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.grade.dispose();
  }
}
