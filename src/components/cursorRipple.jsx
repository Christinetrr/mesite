import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Must be rendered as a child of <ShaderGradientCanvas>.
// Each frame it grabs the finished gradient, runs a water simulation driven by
// the cursor, and redraws the gradient refracted through the ripples.

const SIM_SCALE = 0.25; // simulation resolution relative to the screen
const STEPS_PER_FRAME = 2; // higher = ripples travel faster
const DAMPING = 0.92; // closer to 1 = ripples last longer
const RADIUS = 0.035; // drop size, as a fraction of screen height
const STRENGTH = 1.0; // how hard the cursor pushes the water
const REFRACTION = 0.2; // how much the ripples bend the background
const SHINE = 4.0; // highlight on the ripple crests

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Height field stored in R, velocity in G
const simFragment = /* glsl */ `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uAspect;
  uniform vec2 uMouse;
  uniform vec2 uPrevMouse;
  uniform float uDrop;
  uniform float uRadius;
  uniform float uDamping;
  varying vec2 vUv;

  void main() {
    vec4 info = texture2D(uState, vUv);
    float avg = (
      texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r +
      texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r +
      texture2D(uState, vUv + vec2(0.0, uTexel.y)).r +
      texture2D(uState, vUv - vec2(0.0, uTexel.y)).r
    ) * 0.25;
    info.g += (avg - info.r) * 2.0;
    info.g *= uDamping;
    info.r += info.g;

    // Push the water down along the path the cursor took since last frame
    vec2 scale = vec2(uAspect, 1.0);
    vec2 p = vUv * scale;
    vec2 a = uPrevMouse * scale;
    vec2 ab = uMouse * scale - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(p - (a + ab * t));
    float drop = max(0.0, 1.0 - d / uRadius);
    drop = 0.5 - cos(drop * 3.14159265) * 0.5;
    drop *= drop; // sharper point in the middle instead of a round bowl
    info.r -= drop * uDrop;

    gl_FragColor = info;
  }
`;

const compositeFragment = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uRefraction;
  uniform float uShine;
  varying vec2 vUv;

  void main() {
    float hL = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
    float hR = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
    float hD = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
    float hU = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;
    vec2 slope = vec2(hR - hL, hU - hD);

    vec3 color = texture2D(uScene, vUv + slope * uRefraction).rgb;
    // Brighten slopes facing the top-left, darken the ones facing away
    color += dot(slope, vec2(-0.7, 0.7)) * uShine;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createSimTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

export default function CursorRipple() {
  const { gl, scene, camera, size } = useThree();
  const mouse = useRef({ x: 0, y: 0, prevX: 0, prevY: 0, moved: 0, started: false });
  const lastRenderFrame = useRef(-1);
  const fxRef = useRef(null);

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const bufferW = Math.floor(size.width * dpr);
    const bufferH = Math.floor(size.height * dpr);
    const simW = Math.max(1, Math.floor(size.width * SIM_SCALE));
    const simH = Math.max(1, Math.floor(size.height * SIM_SCALE));
    const simTexel = new THREE.Vector2(1 / simW, 1 / simH);

    const sceneTexture = new THREE.FramebufferTexture(bufferW, bufferH);
    const targets = [createSimTarget(simW, simH), createSimTarget(simW, simH)];

    const simMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: simFragment,
      uniforms: {
        uState: { value: null },
        uTexel: { value: simTexel },
        uAspect: { value: size.width / size.height },
        uMouse: { value: new THREE.Vector2() },
        uPrevMouse: { value: new THREE.Vector2() },
        uDrop: { value: 0 },
        uRadius: { value: RADIUS },
        uDamping: { value: DAMPING },
      },
    });

    const compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      uniforms: {
        uScene: { value: sceneTexture },
        uState: { value: null },
        uTexel: { value: simTexel },
        uRefraction: { value: REFRACTION },
        uShine: { value: SHINE },
      },
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);

    // Start the water flat
    const clearColor = gl.getClearColor(new THREE.Color());
    const clearAlpha = gl.getClearAlpha();
    gl.setClearColor(0x000000, 0);
    for (const target of targets) {
      gl.setRenderTarget(target);
      gl.clear();
    }
    gl.setRenderTarget(null);
    gl.setClearColor(clearColor, clearAlpha);

    const fx = {
      sceneTexture,
      targets,
      simMaterial,
      compositeMaterial,
      quad,
      quadScene,
      quadCamera: new THREE.OrthographicCamera(),
    };
    fxRef.current = fx;

    return () => {
      fxRef.current = null;
      sceneTexture.dispose();
      targets.forEach((t) => t.dispose());
      simMaterial.dispose();
      compositeMaterial.dispose();
      quad.geometry.dispose();
    };
  }, [gl, size.width, size.height]);

  useEffect(() => {
    // Listen on window: the page content sits on top of the canvas
    const handlePointerMove = (e) => {
      const rect = gl.domElement.getBoundingClientRect();
      mouse.current.x = (e.clientX - rect.left) / rect.width;
      mouse.current.y = 1 - (e.clientY - rect.top) / rect.height;
      if (!mouse.current.started) {
        // First move: start here instead of streaking in from elsewhere
        mouse.current.prevX = mouse.current.x;
        mouse.current.prevY = mouse.current.y;
        mouse.current.started = true;
      }
      mouse.current.moved = 1;
    };
    // Cursor left the window: don't streak across to wherever it comes back in
    const handlePointerOut = (e) => {
      if (!e.relatedTarget) mouse.current.started = false;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerout", handlePointerOut);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
    };
  }, [gl]);

  // Priority 2 runs after ShaderGradient's own grain pass (priority 1)
  useFrame(() => {
    const fx = fxRef.current;
    if (!fx) return;
    gl.setRenderTarget(null);

    // If nothing else drew this frame (e.g. grain is off), draw the scene ourselves
    if (gl.info.render.frame === lastRenderFrame.current) {
      gl.render(scene, camera);
    }
    gl.copyFramebufferToTexture(fx.sceneTexture);

    // Advance the water simulation
    const m = mouse.current;
    const speed = Math.hypot(m.x - m.prevX, m.y - m.prevY);
    const sim = fx.simMaterial.uniforms;
    sim.uMouse.value.set(m.x, m.y);
    sim.uPrevMouse.value.set(m.prevX, m.prevY);
    fx.quad.material = fx.simMaterial;
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      sim.uState.value = fx.targets[0].texture;
      sim.uDrop.value =
        i === 0 && m.moved ? Math.min(speed * STRENGTH * 10, STRENGTH) : 0;
      gl.setRenderTarget(fx.targets[1]);
      gl.render(fx.quadScene, fx.quadCamera);
      fx.targets.reverse();
    }
    m.prevX = m.x;
    m.prevY = m.y;
    m.moved = 0;

    // Draw the gradient refracted through the water
    fx.compositeMaterial.uniforms.uState.value = fx.targets[0].texture;
    fx.quad.material = fx.compositeMaterial;
    gl.setRenderTarget(null);
    gl.render(fx.quadScene, fx.quadCamera);

    lastRenderFrame.current = gl.info.render.frame;
  }, 2);

  return null;
}
