import React, { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, RapierRigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { EXPLORATION_SCENE } from '@/data/exploration';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';

// ─── Keyboard Input ───
function useKeyboardInput() {
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Don't capture keys when tooltip is open
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return {
    forward: () => keys.current.has('KeyW') || keys.current.has('ArrowUp'),
    backward: () => keys.current.has('KeyS') || keys.current.has('ArrowDown'),
    left: () => keys.current.has('KeyA') || keys.current.has('ArrowLeft'),
    right: () => keys.current.has('KeyD') || keys.current.has('ArrowRight'),
    interact: () => keys.current.has('KeyE'),
  };
}

// ─── Player Character ───
// Capsule body with smooth camera-relative movement
// Fixed: no spawn jumping, proper ground detection via Rapier contacts

export function Player() {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const meshRef = useRef<THREE.Group>(null);
  const input = useKeyboardInput();
  const setPlayerReady = useGameStore(s => s.setPlayerReady);
  const hoveredObject = useGameStore(s => s.hoveredObject);

  // Movement constants
  const SPEED = 3.5;
  const JUMP_FORCE = 5.5;
  const DAMPING = 0.85;
  const GROUND_Y = 1.0; // exact spawn Y (capsule sits on floor)

  const grounded = useRef(false);
  const canJump = useRef(true);
  const spawnFrame = useRef(0);
  const hasInteracted = useRef(false);

  useFrame((_, delta) => {
    if (!rigidBodyRef.current) return;

    const rb = rigidBodyRef.current;
    const dt = Math.min(delta, 0.05);

    spawnFrame.current++;

    // Notify ready after 20 frames (stable spawn, no jumping)
    if (spawnFrame.current === 20) {
      setPlayerReady(true);
      bus.emit('player:spawned', {});
    }

    // ── Camera-relative movement direction ──
    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);
    cameraDir.y = 0;
    cameraDir.normalize();

    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDir, new THREE.Vector3(0, 1, 0)).normalize();

    const moveDir = new THREE.Vector3();
    if (input.forward()) moveDir.add(cameraDir);
    if (input.backward()) moveDir.sub(cameraDir);
    if (input.left()) moveDir.sub(cameraRight);
    if (input.right()) moveDir.add(cameraRight);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    // ── Apply horizontal velocity ──
    const currentVel = rb.linvel();
    const targetVelX = moveDir.x * SPEED;
    const targetVelZ = moveDir.z * SPEED;

    const newVelX = currentVel.x + (targetVelX - currentVel.x) * (1 - DAMPING);
    const newVelZ = currentVel.z + (targetVelZ - currentVel.z) * (1 - DAMPING);

    // ── Ground check (position-based, simple and reliable) ──
    const position = rb.translation();
    const isOnGround = position.y <= GROUND_Y + 0.08;

    let newVelY = currentVel.y;

    if (isOnGround && currentVel.y <= 0.05) {
      if (!grounded.current) {
        grounded.current = true;
        canJump.current = true;
      }
      // Counteract gravity when grounded — prevents sinking
      newVelY = 0;
      // Snap to ground if slightly below
      if (position.y < GROUND_Y) {
        rb.setTranslation({ x: position.x, y: GROUND_Y, z: position.z }, true);
      }
    } else {
      grounded.current = false;
    }

    rb.setLinvel({ x: newVelX, y: newVelY, z: newVelZ }, true);

    // ── Emit position for camera tracking ──
    bus.emit('player:position', { x: position.x, y: position.y, z: position.z });

    // ── Interaction via E key ──
    if (input.interact() && hoveredObject && !hasInteracted.current) {
      hasInteracted.current = true;
      bus.emit('interaction:select', { target: hoveredObject });
    } else if (!input.interact()) {
      hasInteracted.current = false;
    }

    // ── Visual mesh rotation (face movement direction) ──
    if (meshRef.current && moveDir.lengthSq() > 0.01) {
      const targetAngle = Math.atan2(moveDir.x, moveDir.z);
      const currentAngle = meshRef.current.rotation.y;
      let diff = targetAngle - currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
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
      // Prevent initial velocity — the key fix for spawn jumping
      linearVelocity={[0, 0, 0]}
      angularVelocity={[0, 0, 0]}
    >
      <CapsuleCollider args={[0.5, 0.25]} position={[0, 0.5, 0]} />

      {/* Visual body */}
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

        {/* Eyes - subtle green glow */}
        <mesh position={[-0.08, 1.5, -0.16]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial
            color="#00ff41"
            emissive="#00ff41"
            emissiveIntensity={2}
          />
        </mesh>
        <mesh position={[0.08, 1.5, -0.16]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial
            color="#00ff41"
            emissive="#00ff41"
            emissiveIntensity={2}
          />
        </mesh>
      </group>
    </RigidBody>
  );
}

// ─── Exploration Room ───
// The 3D environment with interactive objects

export function ExplorationRoom() {
  const setHoveredObject = useGameStore(s => s.setHoveredObject);

  const scene = EXPLORATION_SCENE;

  const handleExitClick = () => {
    bus.emit('transition:start', { from: 'exploration', to: 'end' });
    useGameStore.getState().setPhase('intro-to-explore');
  };

  return (
    <group>
      {/* ── Lighting ── */}
      <ambientLight intensity={scene.ambientLight} />
      <pointLight position={[0, 3, 0]} intensity={0.6} color="#00ff41" distance={10} decay={2} castShadow />
      <pointLight position={[1.5, 1.5, -2]} intensity={0.4} color="#00e5ff" distance={5} decay={2} />

      {/* ── Floor ── */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[5, 0.05, 5]} position={[0, 0, 0]} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#0a0a14" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* ── Walls ── */}
      <mesh position={[0, 2, -5]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>

      <mesh position={[-5, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>

      <mesh position={[5, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#0d0d1a" roughness={0.95} />
      </mesh>

      {/* ── Terminal (interactive) ── */}
      <group position={[1.5, 0, -2]}>
        {/* Desk */}
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.8, 0.05, 0.5]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.7} />
        </mesh>
        {/* Screen */}
        <InteractiveObject
          id="terminal"
          label="Терминал"
          position={[0, 0.8, 0]}
          color="#00ff41"
          size={[0.6, 0.4]}
          onHover={() => setHoveredObject('terminal')}
          onUnhover={() => setHoveredObject(null)}
          onClick={() => bus.emit('interaction:select', { target: 'terminal' })}
        />
        {/* CRT glow */}
        <pointLight position={[0, 0.9, 0.2]} intensity={0.3} color="#00ff41" distance={2} />
      </group>

      {/* ── Photo on wall (interactive) ── */}
      <InteractiveObject
        id="photo"
        label="Фотография"
        position={[-1.8, 1.5, -4.95]}
        color="#ffd700"
        size={[0.4, 0.3]}
        onHover={() => setHoveredObject('photo')}
        onUnhover={() => setHoveredObject(null)}
        onClick={() => bus.emit('interaction:select', { target: 'photo' })}
      />

      {/* ── Window (interactive) ── */}
      <mesh position={[-0.5, 1.8, -4.97]}>
        <planeGeometry args={[1.2, 0.8]} />
        <meshStandardMaterial
          color="#0a1628"
          emissive="#00aaff"
          emissiveIntensity={0.15}
        />
      </mesh>
      <InteractiveObject
        id="window"
        label="Окно"
        position={[-0.5, 1.8, -4.93]}
        color="#00e5ff"
        size={[1.2, 0.8]}
        onHover={() => setHoveredObject('window')}
        onUnhover={() => setHoveredObject(null)}
        onClick={() => bus.emit('interaction:select', { target: 'window' })}
      />

      {/* ── Neon strips on walls ── */}
      <mesh position={[4.95, 0.1, -3]}>
        <boxGeometry args={[0.05, 0.05, 2]} />
        <meshStandardMaterial color="#ff0066" emissive="#ff0066" emissiveIntensity={3} />
      </mesh>
      <mesh position={[4.95, 0.1, 0]}>
        <boxGeometry args={[0.05, 0.05, 2]} />
        <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={3} />
      </mesh>
      <mesh position={[-4.95, 0.1, -2]}>
        <boxGeometry args={[0.05, 0.05, 3]} />
        <meshStandardMaterial color="#00ff41" emissive="#00ff41" emissiveIntensity={2} />
      </mesh>

      {/* ── Exit door ── */}
      <group position={[0, 0, -4.8]} onClick={handleExitClick}>
        <mesh>
          <boxGeometry args={[1.0, 2.2, 0.1]} />
          <meshStandardMaterial
            color="#1a0a2e"
            emissive="#4400aa"
            emissiveIntensity={0.3}
            roughness={0.6}
          />
        </mesh>
        {/* Door frame glow */}
        <pointLight position={[0, 1, 0.2]} intensity={0.3} color="#6600cc" distance={3} />
      </group>

      {/* ── Fog ── */}
      <fog attach="fog" args={[scene.fogColor, scene.fogNear, scene.fogFar]} />

      {/* ── Physics: Wall colliders ── */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[5, 2.5, 0.1]} position={[0, 2.5, -5]} />
        <CuboidCollider args={[0.1, 2.5, 5]} position={[-5, 2.5, 0]} />
        <CuboidCollider args={[0.1, 2.5, 5]} position={[5, 2.5, 0]} />
      </RigidBody>
    </group>
  );
}

// ─── Interactive Object Component ───

const InteractiveObject = ({
  id,
  label,
  position,
  color,
  size,
  onHover,
  onUnhover,
  onClick,
}: {
  id: string;
  label: string;
  position: [number, number, number];
  color: string;
  size: [number, number];
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}) => {
  const hoveredObject = useGameStore(s => s.hoveredObject);
  const hovered = hoveredObject === id;
  const [pulse, setPulse] = useState(0);

  useFrame(({ clock }) => {
    if (hovered) {
      setPulse(Math.sin(clock.getElapsedTime() * 4) * 0.3 + 0.7);
    } else {
      setPulse(Math.sin(clock.getElapsedTime() * 1.5) * 0.15 + 0.2);
    }
  });

  return (
    <group
      position={position}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
      onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Base mesh */}
      <mesh>
        <planeGeometry args={size} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={pulse}
          transparent
          opacity={hovered ? 0.9 : 0.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Border glow when hovered */}
      {hovered && (
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[size[0] + 0.1, size[1] + 0.1]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
};
