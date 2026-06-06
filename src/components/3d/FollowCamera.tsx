import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';

// ─── Follow Camera ───
// Smooth third-person camera with orbit via mouse drag
// Listens to player:position events from Rapier RigidBody

export function FollowCamera() {
  const { camera } = useThree();
  const playerReady = useGameStore(s => s.playerReady);
  const phase = useGameStore(s => s.phase);

  const angle = useRef(0);
  const pitch = useRef(0.3);
  const distance = useRef(4.5);
  const targetPos = useRef(new THREE.Vector3(0, 1, 2));
  const currentPos = useRef(new THREE.Vector3(0, 4, 8));
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Mouse orbit controls
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      // Only orbit on right-click or when canvas is clicked
      if (e.button === 0 || e.button === 2) {
        isDragging.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      angle.current -= dx * 0.005;
      pitch.current = Math.max(-0.2, Math.min(1.0, pitch.current + dy * 0.005));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => { isDragging.current = false; };

    const onWheel = (e: WheelEvent) => {
      distance.current = Math.max(2, Math.min(10, distance.current + e.deltaY * 0.005));
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Touch support
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        angle.current -= dx * 0.008;
        pitch.current = Math.max(-0.2, Math.min(1.0, pitch.current + dy * 0.008));
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    };

    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Listen to player position events
  useEffect(() => {
    const unsub = bus.on('player:position', ({ x, y, z }) => {
      targetPos.current.set(x, y, z);
    });
    return unsub;
  }, []);

  useFrame(() => {
    // During intro, keep camera static looking at poem
    if (phase === 'intro') {
      camera.position.set(0, 0, 6);
      camera.lookAt(0, 0, 0);
      currentPos.current.set(0, 0, 6);
      return;
    }

    if (!playerReady) {
      // Transitioning — smoothly move to starting position
      const target = new THREE.Vector3(0, 3.5, 7);
      currentPos.current.lerp(target, 0.02);
      camera.position.copy(currentPos.current);
      camera.lookAt(0, 1, 2);
      return;
    }

    // Exploration — follow player using tracked position
    const lookTarget = new THREE.Vector3(
      targetPos.current.x,
      targetPos.current.y + 1.2,
      targetPos.current.z
    );

    // Calculate camera position from orbit angles
    const camX = targetPos.current.x + Math.sin(angle.current) * distance.current;
    const camY = lookTarget.y + pitch.current * distance.current + 1.5;
    const camZ = targetPos.current.z + Math.cos(angle.current) * distance.current;

    const targetCamPos = new THREE.Vector3(camX, camY, camZ);
    currentPos.current.lerp(targetCamPos, 0.08);
    camera.position.copy(currentPos.current);
    camera.lookAt(lookTarget);
  });

  return null;
}
