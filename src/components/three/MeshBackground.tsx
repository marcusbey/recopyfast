"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";

// Vertex shader with cloud-like displacement
const vertexShader = `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uClickTime;
  uniform vec2 uClickPosition;

  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vWorldPos;

  // Simplex 3D noise
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Multi-octave noise for cloud-like billowing
    float noise1 = snoise(vec3(pos.xy * 0.1, uTime * 0.05)) * 1.5;
    float noise2 = snoise(vec3(pos.xy * 0.2 + 50.0, uTime * 0.03)) * 0.8;
    float noise3 = snoise(vec3(pos.xy * 0.4 + 100.0, uTime * 0.02)) * 0.4;

    // Mouse interaction - creates a bulge
    float mouseDist = distance(uv, uMouse);
    float mouseEffect = smoothstep(0.5, 0.0, mouseDist) * 1.2;

    // Click ripple
    float timeSinceClick = uTime - uClickTime;
    float clickDist = distance(uv, uClickPosition);
    float rippleRadius = timeSinceClick * 0.4;
    float ripple = 0.0;
    if (timeSinceClick < 3.0 && timeSinceClick > 0.0) {
      float rippleWidth = 0.15;
      float edge = smoothstep(rippleRadius - rippleWidth, rippleRadius, clickDist)
                 * smoothstep(rippleRadius + rippleWidth, rippleRadius, clickDist);
      ripple = edge * sin(clickDist * 15.0 - timeSinceClick * 4.0) * 0.8 * (1.0 - timeSinceClick / 3.0);
    }

    float elevation = noise1 + noise2 + noise3 + mouseEffect + ripple;
    pos.z += elevation;

    vElevation = elevation;
    vWorldPos = pos;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Fragment shader - actual cloud rendering
const fragmentShader = `
  uniform float uTime;
  uniform vec2 uMouse;

  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vWorldPos;

  // FBM noise for cloud texture
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise2D(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * (snoise2D(p * frequency) * 0.5 + 0.5);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }

  void main() {
    // Sky gradient - more saturated blue for better cloud contrast
    vec3 skyTop = vec3(0.6, 0.8, 1.0);        // More saturated blue
    vec3 skyBottom = vec3(0.85, 0.92, 1.0);   // Light blue
    vec3 skyColor = mix(skyBottom, skyTop, vUv.y);

    // Cloud density using FBM
    vec2 cloudUV = vWorldPos.xy * 0.08 + vec2(uTime * 0.01, uTime * 0.005);
    float cloudDensity = fbm(cloudUV);

    // Second layer for more detail
    vec2 cloudUV2 = vWorldPos.xy * 0.15 + vec2(uTime * 0.015, -uTime * 0.008);
    float cloudDensity2 = fbm(cloudUV2);

    // Combine cloud layers
    float clouds = cloudDensity * 0.6 + cloudDensity2 * 0.4;

    // Shape clouds - sharper cloud definition for more visible edges
    clouds = smoothstep(0.25, 0.55, clouds);

    // Elevation affects cloud brightness (3D depth)
    float elevationLight = vElevation * 0.15 + 0.5;

    // Cloud colors - white with subtle blue shadows
    vec3 cloudWhite = vec3(1.0, 1.0, 1.0);
    vec3 cloudShadow = vec3(0.85, 0.88, 0.95);
    vec3 cloudColor = mix(cloudShadow, cloudWhite, elevationLight);

    // Blend clouds with sky - increased opacity for more visible clouds
    vec3 finalColor = mix(skyColor, cloudColor, clouds * 0.95);

    // Mouse glow - subtle highlight
    float mouseGlow = smoothstep(0.4, 0.0, distance(vUv, uMouse)) * 0.15;
    finalColor = mix(finalColor, vec3(1.0), mouseGlow);

    // Fade at edges for seamless blend
    float edgeFade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    edgeFade *= smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.7, vUv.y);

    gl_FragColor = vec4(finalColor, edgeFade);
  }
`;

interface CloudPlaneProps {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  clickRef: React.MutableRefObject<{ time: number; x: number; y: number }>;
  scrollProgress: number;
}

function CloudPlane({ mouseRef, clickRef, scrollProgress }: CloudPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uClickTime: { value: -10 },
      uClickPosition: { value: new THREE.Vector2(0.5, 0.5) },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;

    // Smooth mouse following
    const targetMouse = new THREE.Vector2(
      mouseRef.current.x,
      mouseRef.current.y,
    );
    uniforms.uMouse.value.lerp(targetMouse, 0.05);

    // Update click
    uniforms.uClickTime.value = clickRef.current.time;
    uniforms.uClickPosition.value.set(clickRef.current.x, clickRef.current.y);

    // Rotate based on scroll
    if (groupRef.current) {
      const initialRotation = -Math.PI / 3;
      const finalRotation = -Math.PI / 2.2;
      const progress = Math.min(scrollProgress / 0.15, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        initialRotation,
        finalRotation,
        eased,
      );
      groupRef.current.position.y = THREE.MathUtils.lerp(0, -3, eased);
      groupRef.current.position.z = THREE.MathUtils.lerp(0, -2, eased);
    }
  });

  return (
    <group ref={groupRef} rotation={[-Math.PI / 3, 0, 0]} position={[0, 0, 0]}>
      <mesh ref={meshRef}>
        <planeGeometry args={[40, 40, 100, 100]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          side={THREE.DoubleSide}
          transparent={true}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Scene({ scrollProgress }: { scrollProgress: number }) {
  const { gl } = useThree();
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const clickRef = useRef({ time: -10, x: 0.5, y: 0.5 });
  const clockRef = useRef(new THREE.Clock());

  useEffect(() => {
    clockRef.current.start();
    const canvas = gl.domElement;

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = (event.clientX - rect.left) / rect.width;
      mouseRef.current.y = 1 - (event.clientY - rect.top) / rect.height;
    };

    const handleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      clickRef.current = {
        time: clockRef.current.getElapsedTime(),
        x: (event.clientX - rect.left) / rect.width,
        y: 1 - (event.clientY - rect.top) / rect.height,
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("click", handleClick);
    };
  }, [gl]);

  return (
    <>
      <CloudPlane
        mouseRef={mouseRef}
        clickRef={clickRef}
        scrollProgress={scrollProgress}
      />
    </>
  );
}

interface MeshBackgroundProps {
  scrollProgress?: number;
}

export default function MeshBackground({
  scrollProgress = 0,
}: MeshBackgroundProps) {
  return (
    <div className="fixed inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 8, 15], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ pointerEvents: "auto" }}
      >
        <Scene scrollProgress={scrollProgress} />
      </Canvas>
      {/* Sky gradient fallback */}
      <div
        className="absolute inset-0 -z-20 bg-gradient-to-b from-sky-100 via-sky-50 to-white"
        aria-hidden="true"
      />
    </div>
  );
}
