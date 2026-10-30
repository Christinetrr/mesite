import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Must be rendered as a child of <ShaderGradientCanvas>.
// Each frame it grabs the finished gradient, runs a water simulation driven by
// the cursor, and redraws the gradient refracted through the ripples.

const GRID_SCALE = 0.25; // water grid resolution relative to the screen
const STEPS_PER_FRAME = 2; // higher = ripples travel faster
const PUSH_STRENGTH = 1.0; // how hard the cursor pushes the water

// Stretches a rectangle over the whole screen so the fragment shader runs on every pixel
const fullscreenVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

//Shader for how water moves
const waterPhysicsShader = `
  uniform sampler2D uWater; // height in R, velocity in G
  uniform vec2 uCellSize, uCursor, uPrevCursor;
  uniform float uAspect, uPushStrength;
  varying vec2 vUv;

  const float DAMPING = 0.92; // closer to 1 = ripples last longer
  const float RADIUS = 0.035; // drop size, as a fraction of screen height

  void main() {
    vec2 stepX = vec2(uCellSize.x, 0.0), stepY = vec2(0.0, uCellSize.y);
    vec4 water = texture2D(uWater, vUv);
    float neighborHeight = (texture2D(uWater, vUv + stepX).r + texture2D(uWater, vUv - stepX).r +
                            texture2D(uWater, vUv + stepY).r + texture2D(uWater, vUv - stepY).r) * 0.25;
    water.g = (water.g + (neighborHeight - water.r) * 2.0) * DAMPING;
    water.r += water.g;

    // Push the water down along the path the cursor took since last frame
    vec2 scale = vec2(uAspect, 1.0);
    vec2 pathStart = uPrevCursor * scale, path = uCursor * scale - pathStart, point = vUv * scale;
    float alongPath = clamp(dot(point - pathStart, path) / max(dot(path, path), 1e-6), 0.0, 1.0);
    float distToPath = length(point - pathStart - path * alongPath);
    float push = max(0.0, 1.0 - distToPath / RADIUS);
    push = 0.5 - cos(push * 3.14159265) * 0.5;
    water.r -= push * push * uPushStrength; // squared: sharp point instead of a round bowl

    gl_FragColor = water;
  }
`;

//Shader for how water looks
const waterDesignShader = `
  uniform sampler2D uGradient, uWater;
  uniform vec2 uCellSize;
  varying vec2 vUv;

  const float REFRACTION = 0.2; // how much the ripples bend the background
  const float SHINE = 4.0; // highlight on the ripple crests

  void main() {
    vec2 stepX = vec2(uCellSize.x, 0.0), stepY = vec2(0.0, uCellSize.y);
    vec2 slope = vec2(texture2D(uWater, vUv + stepX).r - texture2D(uWater, vUv - stepX).r,
                      texture2D(uWater, vUv + stepY).r - texture2D(uWater, vUv - stepY).r);
    vec3 color = texture2D(uGradient, vUv + slope * REFRACTION).rgb;
    // Brighten slopes facing the top-left, darken the ones facing away
    color += dot(slope, vec2(-0.7, 0.7)) * SHINE;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export default function CursorRipple() {
  const { gl, scene, camera, size } = useThree();
  const cursor = useRef({
    position: new THREE.Vector2(),
    lastPosition: new THREE.Vector2(),
    isTracking: false,
  });
  const renderCountAfterLastFrame = useRef(-1);
  const gpuRef = useRef(null);

  useEffect(() => {
    const c = cursor.current;
    const pixelRatio = gl.getPixelRatio();
    const gridWidth = Math.max(1, Math.floor(size.width * GRID_SCALE));
    const gridHeight = Math.max(1, Math.floor(size.height * GRID_SCALE));
    const cellSize = new THREE.Vector2(1 / gridWidth, 1 / gridHeight); // one grid cell, in 0–1 units

    const createWaterGrid = () =>
      new THREE.WebGLRenderTarget(gridWidth, gridHeight, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
      });
    //
    const waterGrids = [createWaterGrid(), createWaterGrid()];

    const gradientCopy = new THREE.FramebufferTexture(
      Math.floor(size.width * pixelRatio),
      Math.floor(size.height * pixelRatio),
    );
    const physicsMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: waterPhysicsShader,
      uniforms: {
        uWater: { value: null },
        uCellSize: { value: cellSize },
        uAspect: { value: size.width / size.height },
        uCursor: { value: c.position },
        uPrevCursor: { value: c.lastPosition },
        uPushStrength: { value: 0 },
      },
    });
    const designMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: waterDesignShader,
      uniforms: {
        uGradient: { value: gradientCopy },
        uWater: { value: null },
        uCellSize: { value: cellSize },
      },
      depthTest: false,
      depthWrite: false,
    });
    const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    screenQuad.frustumCulled = false;
    gpuRef.current = {
      gradientCopy,
      waterGrids,
      physicsMaterial,
      designMaterial,
      screenQuad,
      screenCamera: new THREE.OrthographicCamera(),
    };

    // Listen on pointer move to update the cursor position
    const handlePointerMove = (e) => {
      const rect = gl.domElement.getBoundingClientRect();
      c.position.set(
        (e.clientX - rect.left) / rect.width,
        1 - (e.clientY - rect.top) / rect.height,
      );
      //update to current position
      if (!c.isTracking) {
        c.lastPosition.copy(c.position);
        c.isTracking = true;
      }
    };
    const handlePointerLeaveWindow = (e) => {
      if (!e.relatedTarget) {
        c.isTracking = false;
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerout", handlePointerLeaveWindow);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerLeaveWindow);
      gpuRef.current = null;
      const gpuResources = [
        gradientCopy,
        ...waterGrids,
        physicsMaterial,
        designMaterial,
        screenQuad.geometry,
      ];
      for (const resource of gpuResources) {
        resource.dispose();
      }
    };
  }, [gl, size.width, size.height]);

  // Priority 2 runs after ShaderGradient's own grain pass (priority 1)
  useFrame(() => {
    const gpu = gpuRef.current;
    if (!gpu) {
      return;
    }
    const drawFullscreen = (material, target) => {
      gpu.screenQuad.material = material;
      gl.setRenderTarget(target);
      gl.render(gpu.screenQuad, gpu.screenCamera);
    };

    // Grab the finished gradient (drawing it ourselves if nothing else did, e.g. grain off)
    gl.setRenderTarget(null);
    if (gl.info.render.frame === renderCountAfterLastFrame.current)
      gl.render(scene, camera);
    gl.copyFramebufferToTexture(gpu.gradientCopy);

    // Advance the water; a still cursor has zero speed, so it pushes nothing
    const { position, lastPosition } = cursor.current;
    const physics = gpu.physicsMaterial.uniforms;

    // Faster cursor = stronger push, capped at PUSH_STRENGTH
    const distanceMoved = position.distanceTo(lastPosition);
    const pushThisFrame = Math.min(
      distanceMoved * PUSH_STRENGTH * 10,
      PUSH_STRENGTH,
    );

    for (let step = 0; step < STEPS_PER_FRAME; step++) {
      const [readGrid, writeGrid] = gpu.waterGrids;
      physics.uWater.value = readGrid.texture;
      // Push only on the first step; the remaining steps just let the waves spread
      if (step === 0) {
        physics.uPushStrength.value = pushThisFrame;
      } else {
        physics.uPushStrength.value = 0;
      }
      drawFullscreen(gpu.physicsMaterial, writeGrid);
      gpu.waterGrids.reverse(); // swap: the grid just written becomes the one to read
    }
    lastPosition.copy(position);

    // Draw the gradient refracted through the water
    gpu.designMaterial.uniforms.uWater.value = gpu.waterGrids[0].texture;
    drawFullscreen(gpu.designMaterial, null);
    renderCountAfterLastFrame.current = gl.info.render.frame;
  }, 2);

  return null;
}
