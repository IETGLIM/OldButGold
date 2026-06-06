import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, RapierRigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { EXPLORATION_SCENE } from '@/data/exploration';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';

// ═══════════════════════════════════════════════════════════════
//  KEYBOARD INPUT
// ═══════════════════════════════════════════════════════════════

function useKeyboardInput() {
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up   = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return {
    forward:   () => keys.current.has('KeyW') || keys.current.has('ArrowUp'),
    backward:  () => keys.current.has('KeyS') || keys.current.has('ArrowDown'),
    left:      () => keys.current.has('KeyA') || keys.current.has('ArrowLeft'),
    right:     () => keys.current.has('KeyD') || keys.current.has('ArrowRight'),
    interact:  () => keys.current.has('KeyE'),
  };
}

// ═══════════════════════════════════════════════════════════════
//  PLAYER — capsule body with smooth camera-relative movement
// ═══════════════════════════════════════════════════════════════

export function Player() {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const meshRef = useRef<THREE.Group>(null);
  const input = useKeyboardInput();
  const { camera } = useThree();
  const setPlayerReady = useGameStore(s => s.setPlayerReady);
  const hoveredObject = useGameStore(s => s.hoveredObject);

  const SPEED = 3.5;
  const DAMPING = 0.85;
  const GROUND_Y = 0.75;

  const grounded = useRef(false);
  const spawnFrame = useRef(0);
  const hasInteracted = useRef(false);

  useFrame((_, delta) => {
    if (!rigidBodyRef.current) return;
    const rb = rigidBodyRef.current;
    const dt = Math.min(delta, 0.05);
    spawnFrame.current++;

    if (spawnFrame.current === 20) {
      setPlayerReady(true);
      bus.emit('player:spawned', {});
    }

    // Camera-relative movement
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();

    const moveDir = new THREE.Vector3();
    if (input.forward())  moveDir.add(camDir);
    if (input.backward()) moveDir.sub(camDir);
    if (input.left())     moveDir.sub(camRight);
    if (input.right())    moveDir.add(camRight);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    const vel = rb.linvel();
    const newVx = vel.x + (moveDir.x * SPEED - vel.x) * (1 - DAMPING);
    const newVz = vel.z + (moveDir.z * SPEED - vel.z) * (1 - DAMPING);

    const pos = rb.translation();
    const onGround = pos.y <= GROUND_Y + 0.08;
    let newVy = vel.y;
    if (onGround && vel.y <= 0.05) {
      grounded.current = true;
      newVy = 0;
      if (pos.y < GROUND_Y) rb.setTranslation({ x: pos.x, y: GROUND_Y, z: pos.z }, true);
    } else {
      grounded.current = false;
    }

    rb.setLinvel({ x: newVx, y: newVy, z: newVz }, true);
    bus.emit('player:position', { x: pos.x, y: pos.y, z: pos.z });

    // Interaction via E
    if (input.interact() && hoveredObject && !hasInteracted.current) {
      hasInteracted.current = true;
      bus.emit('interaction:select', { target: hoveredObject });
    } else if (!input.interact()) {
      hasInteracted.current = false;
    }

    // Face movement direction
    if (meshRef.current && moveDir.lengthSq() > 0.01) {
      const target = Math.atan2(moveDir.x, moveDir.z);
      let diff = target - meshRef.current.rotation.y;
      while (diff > Math.PI)  diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      meshRef.current.rotation.y += diff * 0.15;
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={[0, GROUND_Y, 2]}
      enabledRotations={[false, false, false]}
      linearDamping={0}
      angularDamping={100}
      mass={1}
      lockRotations
      type="dynamic"
      colliders={false}
      linearVelocity={[0, 0, 0]}
      angularVelocity={[0, 0, 0]}
    >
      <CapsuleCollider args={[0.5, 0.25]} position={[0, 0.5, 0]} />
      <group ref={meshRef}>
        {/* Body */}
        <mesh position={[0, 0.8, 0]} castShadow>
          <capsuleGeometry args={[0.25, 0.5, 8, 16]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.8} metalness={0.2} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 1.45, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color="#2a2a4e" roughness={0.7} metalness={0.1} />
        </mesh>
        {/* Eyes */}
        {[-0.08, 0.08].map((xOff, i) => (
          <mesh key={i} position={[xOff, 1.5, -0.16]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#00ff41" emissive="#00ff41" emissiveIntensity={2} />
          </mesh>
        ))}
      </group>
    </RigidBody>
  );
}

// ═══════════════════════════════════════════════════════════════
//  FLOOR GRID — cyberpunk grid pattern via canvas texture
// ═══════════════════════════════════════════════════════════════

function createGridTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, size, size);

  // Grid lines
  ctx.strokeStyle = 'rgba(0, 255, 65, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // Subtle dot at intersection
  ctx.fillStyle = 'rgba(0, 255, 65, 0.12)';
  ctx.fillRect(size / 2 - 1, size / 2 - 1, 2, 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}

// ═══════════════════════════════════════════════════════════════
//  CRT TERMINAL — monitor frame + animated green screen
// ═══════════════════════════════════════════════════════════════

const CRT_VERT = `
varying vec2 vScreenUv;
void main() {
  vScreenUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CRT_FRAG = `
precision mediump float;
uniform float uTime;
varying vec2 vScreenUv;

void main() {
  // Scanlines
  float scan = sin(vScreenUv.y * 160.0) * 0.04 + 0.96;
  // Flicker
  float flick = 0.97 + sin(uTime * 14.0) * 0.03;
  // Vignette
  float vig = 1.0 - distance(vScreenUv, vec2(0.5)) * 0.7;
  vig = clamp(vig, 0.3, 1.0);

  vec3 color = vec3(0.0, 0.9, 0.25) * scan * flick * vig;
  // Subtle phosphor warm-up at center
  color += vec3(0.05, 0.15, 0.05) * (1.0 - vig);

  gl_FragColor = vec4(color, 1.0);
}
`;

function CrtTerminal({ onHover, onUnhover, onClick }: {
  onHover: () => void; onUnhover: () => void; onClick: () => void;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  const crtUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  return (
    <group
      position={[1.5, 0, -3.5]}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
      onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Desk */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[1.0, 0.06, 0.6]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.7} />
      </mesh>
      {/* Desk legs */}
      {[-0.42, 0.42].map((x, i) => (
        <mesh key={i} position={[x, 0.18, 0.15]} castShadow>
          <boxGeometry args={[0.06, 0.36, 0.06]} />
          <meshStandardMaterial color="#12121e" roughness={0.9} />
        </mesh>
      ))}

      {/* Monitor body */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[0.7, 0.55, 0.08]} />
        <meshStandardMaterial color="#0d0d18" roughness={0.8} />
      </mesh>

      {/* CRT Screen */}
      <mesh position={[0, 0.72, 0.042]}>
        <planeGeometry args={[0.58, 0.42]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={CRT_VERT}
          fragmentShader={CRT_FRAG}
          uniforms={crtUniforms}
        />
      </mesh>

      {/* Screen glow */}
      <pointLight position={[0, 0.72, 0.3]} intensity={0.4} color="#00ff41" distance={3} decay={2} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  PHOTO FRAME — warm-toned framed memory
// ═══════════════════════════════════════════════════════════════

function createPhotoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  // Warm amber background
  const grad = ctx.createRadialGradient(128, 96, 20, 128, 96, 128);
  grad.addColorStop(0, '#3a2a10');
  grad.addColorStop(1, '#1a1008');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 192);

  // Silhouette figures (two people)
  ctx.fillStyle = '#2a1a08';
  // Person 1 (left)
  ctx.beginPath();
  ctx.arc(90, 100, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(80, 115, 20, 35);
  // Person 2 (right, child)
  ctx.beginPath();
  ctx.arc(150, 115, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(143, 125, 14, 25);

  // Warm glow overlay
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(0, 0, 256, 192);
  ctx.globalAlpha = 1.0;

  // Grain/noise effect
  const imageData = ctx.getImageData(0, 0, 256, 192);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 20;
    imageData.data[i] += noise;
    imageData.data[i + 1] += noise;
    imageData.data[i + 2] += noise;
  }
  ctx.putImageData(imageData, 0, 0);

  return new THREE.CanvasTexture(canvas);
}

function PhotoFrame({ onHover, onUnhover, onClick }: {
  onHover: () => void; onUnhover: () => void; onClick: () => void;
}) {
  const photoTex = useMemo(() => createPhotoTexture(), []);

  return (
    <group
      position={[-1.8, 1.6, -4.92]}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
      onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Frame */}
      <mesh>
        <boxGeometry args={[0.55, 0.42, 0.03]} />
        <meshStandardMaterial color="#2a1a08" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Photo surface */}
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[0.45, 0.32]} />
        <meshBasicMaterial map={photoTex} />
      </mesh>
      {/* Warm backlight */}
      <pointLight position={[0, 0, 0.2]} intensity={0.15} color="#ffd700" distance={2} decay={2} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CITY WINDOW — night cityscape seen through window
// ═══════════════════════════════════════════════════════════════

function createCityTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Dark sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, '#060612');
  skyGrad.addColorStop(0.6, '#0a0a1e');
  skyGrad.addColorStop(1, '#120820');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, 512, 256);

  // Buildings
  const buildingColors = ['#08080e', '#0a0a12', '#060610'];
  for (let x = 0; x < 512; x += 25 + Math.floor(Math.random() * 15)) {
    const w = 18 + Math.floor(Math.random() * 12);
    const h = 50 + Math.floor(Math.random() * 140);
    ctx.fillStyle = buildingColors[Math.floor(Math.random() * buildingColors.length)];
    ctx.fillRect(x, 256 - h, w, h);

    // Lit windows
    for (let wy = 256 - h + 6; wy < 240; wy += 8) {
      for (let wx = x + 3; wx < x + w - 3; wx += 6) {
        if (Math.random() > 0.4) {
          const warmth = Math.random();
          ctx.fillStyle = warmth > 0.5
            ? `rgba(255, 200, 50, ${0.3 + Math.random() * 0.5})`
            : `rgba(100, 180, 255, ${0.2 + Math.random() * 0.3})`;
          ctx.fillRect(wx, wy, 3, 4);
        }
      }
    }
  }

  // Neon signs
  ctx.shadowBlur = 12;
  ctx.shadowColor = '#ff0066';
  ctx.fillStyle = '#ff0066';
  ctx.fillRect(80, 170, 25, 4);
  ctx.shadowColor = '#00e5ff';
  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(320, 140, 18, 3);
  ctx.shadowColor = '#ffaa00';
  ctx.fillStyle = '#ffaa00';
  ctx.fillRect(440, 180, 20, 4);
  ctx.shadowBlur = 0;

  return new THREE.CanvasTexture(canvas);
}

function CityWindow({ onHover, onUnhover, onClick }: {
  onHover: () => void; onUnhover: () => void; onClick: () => void;
}) {
  const cityTex = useMemo(() => createCityTexture(), []);
  const lightRef = useRef<THREE.PointLight>(null);

  // Subtle neon flicker
  useFrame(({ clock }) => {
    if (lightRef.current) {
      lightRef.current.intensity = 0.15 + Math.sin(clock.getElapsedTime() * 3) * 0.03;
    }
  });

  return (
    <group
      position={[0.8, 1.8, -4.92]}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
      onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Window frame */}
      <mesh>
        <boxGeometry args={[1.4, 0.9, 0.05]} />
        <meshStandardMaterial color="#15152a" roughness={0.8} />
      </mesh>
      {/* Window cross bars */}
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[1.3, 0.02, 0.01]} />
        <meshStandardMaterial color="#1a1a30" />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[0.02, 0.8, 0.01]} />
        <meshStandardMaterial color="#1a1a30" />
      </mesh>
      {/* City view */}
      <mesh position={[0, 0, 0.028]}>
        <planeGeometry args={[1.2, 0.72]} />
        <meshBasicMaterial map={cityTex} />
      </mesh>
      {/* Ambient neon reflection */}
      <pointLight ref={lightRef} position={[0, 0, 0.3]} intensity={0.15} color="#00e5ff" distance={3} decay={2} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  DUST PARTICLES — floating motes for atmosphere
// ═══════════════════════════════════════════════════════════════

function DustParticles() {
  const count = 50;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const data = useMemo(() =>
    Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 9,
      y: 0.3 + Math.random() * 3.5,
      z: (Math.random() - 0.5) * 9,
      speed: 0.03 + Math.random() * 0.06,
      phase: Math.random() * Math.PI * 2,
    })),
  []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();

    for (let i = 0; i < count; i++) {
      const p = data[i];
      dummy.position.set(
        p.x + Math.sin(t * p.speed * 8 + p.phase) * 0.4,
        p.y + Math.sin(t * p.speed * 4 + p.phase * 2) * 0.25,
        p.z + Math.cos(t * p.speed * 6 + p.phase) * 0.4,
      );
      dummy.scale.setScalar(0.012 + Math.sin(t * 1.5 + i) * 0.004);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial color="#88aacc" transparent opacity={0.1} depthWrite={false} />
    </instancedMesh>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BOOKSHELF — decorative shelving with colored books
// ═══════════════════════════════════════════════════════════════

function Bookshelf() {
  const bookColors = ['#2a1520', '#15202a', '#1a2515', '#25201a', '#201525', '#152525'];

  return (
    <group position={[4.85, 0, -1]}>
      {/* Shelf frame */}
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[0.25, 2.4, 0.6]} />
        <meshStandardMaterial color="#12121e" roughness={0.9} />
      </mesh>

      {/* Shelves (3) */}
      {[0.5, 1.2, 1.9].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <boxGeometry args={[0.28, 0.03, 0.62]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
        </mesh>
      ))}

      {/* Books on shelves */}
      {[0.55, 1.25, 1.95].map((shelfY, si) => (
        <group key={si}>
          {Array.from({ length: 5 + si }, (_, bi) => {
            const bw = 0.03 + Math.random() * 0.04;
            const bh = 0.18 + Math.random() * 0.12;
            return (
              <mesh key={bi} position={[
                -0.1 + bi * 0.06,
                shelfY + bh / 2 + 0.02,
                (Math.random() - 0.5) * 0.3,
              ]}>
                <boxGeometry args={[bw, bh, 0.15]} />
                <meshStandardMaterial
                  color={bookColors[(si * 5 + bi) % bookColors.length]}
                  roughness={0.85}
                />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  WALL PANELS — detail strips on walls
// ═══════════════════════════════════════════════════════════════

function WallPanels() {
  return (
    <group>
      {/* Back wall: horizontal trim at floor level */}
      <mesh position={[0, 0.05, -4.98]}>
        <boxGeometry args={[10, 0.1, 0.02]} />
        <meshStandardMaterial color="#151525" roughness={0.8} />
      </mesh>
      {/* Back wall: horizontal trim at ceiling */}
      <mesh position={[0, 4.95, -4.98]}>
        <boxGeometry args={[10, 0.1, 0.02]} />
        <meshStandardMaterial color="#151525" roughness={0.8} />
      </mesh>
      {/* Left wall: vertical panel lines */}
      {[-2, -4].map((x, i) => (
        <mesh key={`lv${i}`} position={[x, 2.5, 0]}>
          <boxGeometry args={[0.02, 5, 10]} />
          <meshStandardMaterial color="#0f0f1a" roughness={0.9} />
        </mesh>
      ))}
      {/* Right wall: vertical panel lines */}
      {[2, 4].map((x, i) => (
        <mesh key={`rv${i}`} position={[x, 2.5, 0]}>
          <boxGeometry args={[0.02, 5, 10]} />
          <meshStandardMaterial color="#0f0f1a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  INTERACTIVE OBJECT WRAPPER — shared hover/selection visuals
// ═══════════════════════════════════════════════════════════════

function InteractiveHighlight({ active, color, size }: {
  active: boolean; color: string; size: [number, number];
}) {
  const [pulse, setPulse] = useState(0.2);
  useFrame(({ clock }) => {
    setPulse(active
      ? Math.sin(clock.getElapsedTime() * 4) * 0.3 + 0.7
      : Math.sin(clock.getElapsedTime() * 1.5) * 0.08 + 0.12
    );
  });

  return (
    <mesh position={[0, 0, 0.005]}>
      <planeGeometry args={[size[0] + 0.15, size[1] + 0.15]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={pulse}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CHAIR — simple prop near the desk
// ═══════════════════════════════════════════════════════════════

function Chair() {
  return (
    <group position={[1.5, 0, -2.8]}>
      {/* Seat */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.45, 0.04, 0.4]} />
        <meshStandardMaterial color="#1a1520" roughness={0.85} />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, 0.6, -0.18]} castShadow>
        <boxGeometry args={[0.45, 0.5, 0.04]} />
        <meshStandardMaterial color="#1a1520" roughness={0.85} />
      </mesh>
      {/* Legs */}
      {[
        [-0.18, -0.15], [0.18, -0.15], [-0.18, 0.15], [0.18, 0.15],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.15, z]}>
          <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
          <meshStandardMaterial color="#121218" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SERVER RACK — atmospheric hum machine
// ═══════════════════════════════════════════════════════════════

function ServerRack() {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (lightRef.current) {
      // Subtle pulse — server activity
      lightRef.current.intensity = 0.2 + Math.sin(clock.getElapsedTime() * 5) * 0.05
        + Math.sin(clock.getElapsedTime() * 13) * 0.03;
    }
  });

  return (
    <group position={[-4.7, 0, 1]}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[0.4, 1.6, 0.7]} />
        <meshStandardMaterial color="#0d0d16" roughness={0.9} metalness={0.2} />
      </mesh>
      {/* LED indicators */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[-0.21, 1.35 - i * 0.15, 0]}>
          <boxGeometry args={[0.01, 0.02, 0.02]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? '#00ff41' : i % 3 === 1 ? '#ffaa00' : '#ff0044'}
            emissive={i % 3 === 0 ? '#00ff41' : i % 3 === 1 ? '#ffaa00' : '#ff0044'}
            emissiveIntensity={1.5}
          />
        </mesh>
      ))}
      <pointLight ref={lightRef} position={[0.2, 0.8, 0]} intensity={0.2} color="#00ff41" distance={2} decay={2} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EXPLORATION ROOM — assembles the entire environment
// ═══════════════════════════════════════════════════════════════

export function ExplorationRoom() {
  const setHoveredObject = useGameStore(s => s.setHoveredObject);
  const gridTexture = useMemo(() => createGridTexture(), []);

  const handleExitClick = useCallback(() => {
    bus.emit('transition:start', { from: 'exploration', to: 'end' });
    useGameStore.getState().setPhase('intro-to-explore');
  }, []);

  const scene = EXPLORATION_SCENE;

  return (
    <group>
      {/* ═══ LIGHTING ═══ */}
      <ambientLight intensity={scene.ambientLight} />
      {/* Overhead light */}
      <pointLight position={[0, 3.5, 0]} intensity={0.5} color="#00ff41" distance={12} decay={2} castShadow />
      {/* Accent lights */}
      <pointLight position={[2, 1.5, -2]} intensity={0.3} color="#00e5ff" distance={6} decay={2} />
      <pointLight position={[-2, 2, -3]} intensity={0.2} color="#ff0066" distance={5} decay={2} />

      {/* ═══ FLOOR ═══ */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[5, 0.05, 5]} position={[0, -0.05, 0]} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial map={gridTexture} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* ═══ WALLS (visual) ═══ */}
      {/* Back */}
      <mesh position={[0, 2.5, -5]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>
      {/* Left */}
      <mesh position={[-5, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>
      {/* Right */}
      <mesh position={[5, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>
      {/* Front (behind player) */}
      <mesh position={[0, 2.5, 5]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>

      {/* ═══ WALL PANELS (detail) ═══ */}
      <WallPanels />

      {/* ═══ NEON STRIPS ═══ */}
      {/* Right wall — pink + cyan */}
      <mesh position={[4.95, 0.1, -3]}>
        <boxGeometry args={[0.04, 0.04, 2]} />
        <meshStandardMaterial color="#ff0066" emissive="#ff0066" emissiveIntensity={3} />
      </mesh>
      <mesh position={[4.95, 0.1, 0]}>
        <boxGeometry args={[0.04, 0.04, 2]} />
        <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={3} />
      </mesh>
      {/* Left wall — green */}
      <mesh position={[-4.95, 0.1, -2]}>
        <boxGeometry args={[0.04, 0.04, 3]} />
        <meshStandardMaterial color="#00ff41" emissive="#00ff41" emissiveIntensity={2} />
      </mesh>
      {/* Back wall — amber accent under photo area */}
      <mesh position={[-1.8, 1.3, -4.96]}>
        <boxGeometry args={[0.6, 0.02, 0.02]} />
        <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={1.5} />
      </mesh>

      {/* ═══ INTERACTIVE OBJECTS ═══ */}
      <CrtTerminal
        onHover={() => setHoveredObject('terminal')}
        onUnhover={() => setHoveredObject(null)}
        onClick={() => bus.emit('interaction:select', { target: 'terminal' })}
      />

      <PhotoFrame
        onHover={() => setHoveredObject('photo')}
        onUnhover={() => setHoveredObject(null)}
        onClick={() => bus.emit('interaction:select', { target: 'photo' })}
      />

      <CityWindow
        onHover={() => setHoveredObject('window')}
        onUnhover={() => setHoveredObject(null)}
        onClick={() => bus.emit('interaction:select', { target: 'window' })}
      />

      {/* ═══ PROPS ═══ */}
      <Chair />
      <Bookshelf />
      <ServerRack />

      {/* ═══ EXIT DOOR ═══ */}
      <group position={[0, 0, -4.8]} onClick={handleExitClick}>
        <mesh>
          <boxGeometry args={[1.0, 2.2, 0.1]} />
          <meshStandardMaterial color="#1a0a2e" emissive="#4400aa" emissiveIntensity={0.3} roughness={0.6} />
        </mesh>
        {/* Door frame glow */}
        <pointLight position={[0, 1.1, 0.2]} intensity={0.25} color="#6600cc" distance={3} decay={2} />
      </group>

      {/* ═══ ATMOSPHERE ═══ */}
      <DustParticles />
      <fog attach="fog" args={[scene.fogColor, scene.fogNear, scene.fogFar]} />

      {/* ═══ PHYSICS WALLS ═══ */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[5, 2.5, 0.1]} position={[0, 2.5, -5]} />
        <CuboidCollider args={[0.1, 2.5, 5]} position={[-5, 2.5, 0]} />
        <CuboidCollider args={[0.1, 2.5, 5]} position={[5, 2.5, 0]} />
        <CuboidCollider args={[5, 2.5, 0.1]} position={[0, 2.5, 5]} />
      </RigidBody>
    </group>
  );
}
