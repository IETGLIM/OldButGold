import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OPENING_POEM, POEM_REVEAL_DELAY } from '@/data/poem';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';

// ─── Constants ───
const RAIN_COLS = 50;
const RAIN_ROWS = 40;
const CHAR_SIZE = 0.18;
const RAIN_CHARACTERS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
const ASSEMBLY_DURATION = 2000; // ms for chars to fly to poem position
const LINE_SPACING = 0.45;
const MATRIX_PHASE_MS = 5000; // how long rain falls before assembly begins

// ─── 3D Rain Character ───
// Individual character that falls in 3D space, then can be "captured" to form poem text

interface RainChar {
  col: number;
  row: number;        // position in column (0 = top)
  speed: number;
  charIndex: number;
  phase: 'falling' | 'captured' | 'idle'; // idle = hasn't started yet
  targetPos: THREE.Vector3 | null;  // where to fly to when captured
  captureStart: number;             // timestamp when captured
  captureFrom: THREE.Vector3;       // position when capture started
  originalSpeed: number;
}

// ─── 3D Matrix Rain Field ───
// Instanced mesh for all rain characters — true 3D particles

function MatrixRainField({ poemRevealStep, poemFade }: { poemRevealStep: number; poemFade: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const startTimeRef = useRef(Date.now());

  // Create all rain characters
  const rainChars = useRef<RainChar[]>([]);
  const totalChars = RAIN_COLS * RAIN_ROWS;

  // Pre-calculate poem character target positions
  const poemTargets = useMemo(() => {
    const targets: { pos: THREE.Vector3; charIndex: number; lineIndex: number; charInLine: number }[] = [];
    const nonEmptyLines = OPENING_POEM.filter(l => l.trim() !== '');
    const startY = (nonEmptyLines.length * LINE_SPACING) / 2;
    let y = startY;
    let lineIdx = 0;

    for (let i = 0; i < OPENING_POEM.length; i++) {
      const line = OPENING_POEM[i];
      if (line.trim() === '') {
        y -= 0.2;
        lineIdx++;
        continue;
      }
      // Center the line
      const lineChars = line.length;
      const xOffset = -(lineChars * CHAR_SIZE) / 2;
      for (let c = 0; c < lineChars; c++) {
        targets.push({
          pos: new THREE.Vector3(xOffset + c * CHAR_SIZE, y, 0),
          charIndex: 0, // will be set during capture
          lineIndex: lineIdx,
          charInLine: c,
        });
      }
      y -= LINE_SPACING;
      lineIdx++;
    }
    return targets;
  }, []);

  // Initialize rain characters
  useEffect(() => {
    const chars: RainChar[] = [];
    for (let col = 0; col < RAIN_COLS; col++) {
      for (let row = 0; row < RAIN_ROWS; row++) {
        const x = (col - RAIN_COLS / 2) * CHAR_SIZE * 1.2;
        const z = -Math.random() * 15 - 2; // spread in depth
        const startY_pos = (RAIN_ROWS - row) * CHAR_SIZE * 1.5 + Math.random() * 5;
        const speed = 0.5 + Math.random() * 1.5;
        chars.push({
          col,
          row,
          speed,
          charIndex: Math.floor(Math.random() * RAIN_CHARACTERS.length),
          phase: Math.random() < 0.7 ? 'falling' : 'idle', // stagger start
          targetPos: null,
          captureStart: 0,
          captureFrom: new THREE.Vector3(x, startY_pos, z),
          originalSpeed: speed,
        });
      }
    }
    rainChars.current = chars;
  }, []);

  // Track which poem chars have been captured
  const capturedSet = useRef<Set<number>>(new Set());
  const lastRevealStep = useRef(-1);

  // Assign targets when poem lines are revealed
  useEffect(() => {
    if (poemRevealStep <= lastRevealStep.current) return;

    for (let lineIdx = lastRevealStep.current + 1; lineIdx <= poemRevealStep && lineIdx < OPENING_POEM.length; lineIdx++) {
      const line = OPENING_POEM[lineIdx];
      if (line.trim() === '') continue;

      // Find target positions for this line
      const lineTargets = poemTargets.filter(t => t.lineIndex === lineIdx);

      // Find available falling characters to capture (prefer closer to Z=0)
      const available = rainChars.current
        .filter(c => c.phase === 'falling' && !capturedSet.current.has(rainChars.current.indexOf(c)))
        .sort((a, b) => {
          const aZ = a.captureFrom.z;
          const bZ = b.captureFrom.z;
          return Math.abs(bZ) - Math.abs(aZ); // closer to camera first
        });

      const now = Date.now();
      for (let i = 0; i < lineTargets.length && i < available.length; i++) {
        const char = available[i];
        const target = lineTargets[i];
        char.phase = 'captured';
        char.targetPos = target.pos.clone();
        char.captureStart = now + i * 30; // stagger captures slightly
        char.charIndex = target.charInLine; // index into the actual poem text
        capturedSet.current.add(rainChars.current.indexOf(char));
      }

      bus.emit('intro:poem-line', { index: lineIdx, text: OPENING_POEM[lineIdx] });
    }
    lastRevealStep.current = poemRevealStep;
  }, [poemRevealStep, poemTargets]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000;
    const rainExtent = 12; // how tall the rain field is

    for (let i = 0; i < rainChars.current.length; i++) {
      const c = rainChars.current[i];

      if (c.phase === 'idle') {
        // Delayed start — activate randomly
        if (Math.random() < 0.02) c.phase = 'falling';
        dummy.position.set(0, -100, -100); // hide
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      if (c.phase === 'falling') {
        // Fall in 3D space
        const x = (c.col - RAIN_COLS / 2) * CHAR_SIZE * 1.2;
        const baseY = (RAIN_ROWS - c.row) * CHAR_SIZE * 1.5;
        c.captureFrom.y = baseY - (elapsed * c.speed * 2);
        // Wrap around
        if (c.captureFrom.y < -rainExtent) {
          c.captureFrom.y += rainExtent * 2;
          c.charIndex = Math.floor(Math.random() * RAIN_CHARACTERS.length);
        }
        // Slight X wobble
        c.captureFrom.x = x + Math.sin(elapsed * 0.5 + c.col * 0.3) * 0.05;

        dummy.position.copy(c.captureFrom);
        const distToCenter = Math.abs(c.captureFrom.z + 7) / 15;
        const scale = 0.6 + distToCenter * 0.4;
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      if (c.phase === 'captured') {
        const timeSinceCapture = now - c.captureStart;
        if (timeSinceCapture < 0) {
          // Not yet captured — keep falling
          dummy.position.copy(c.captureFrom);
          dummy.scale.set(0.6, 0.6, 0.6);
          dummy.updateMatrix();
          meshRef.current.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const t = Math.min(timeSinceCapture / ASSEMBLY_DURATION, 1);
        // Eased interpolation (ease-out cubic)
        const eased = 1 - Math.pow(1 - t, 3);

        const pos = new THREE.Vector3().lerpVectors(c.captureFrom, c.targetPos!, eased);
        // Add a slight arc trajectory
        const arc = Math.sin(t * Math.PI) * 0.5;
        pos.y += arc;
        pos.z = c.captureFrom.z * (1 - eased); // converge to Z=0

        dummy.position.copy(pos);
        const scale = 0.6 + eased * 0.5; // grow as they arrive
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, totalChars]}>
      <planeGeometry args={[CHAR_SIZE * 0.9, CHAR_SIZE * 0.9]} />
      <meshBasicMaterial
        color="#00ff41"
        transparent
        opacity={0.9}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

// ─── Poem Text Overlay ───
// Canvas-based text that fades in as chars assemble at their positions

function PoemText({ revealStep, fade }: { revealStep: number; fade: number }) {
  const [textures, setTextures] = useState<THREE.CanvasTexture[]>([]);

  // Create textures for each line
  useEffect(() => {
    const newTextures: THREE.CanvasTexture[] = [];
    for (let i = 0; i < OPENING_POEM.length; i++) {
      const line = OPENING_POEM[i];
      if (line.trim() === '') {
        newTextures.push(null!);
        continue;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 1024, 64);
      ctx.font = '600 28px "Courier New", monospace';
      ctx.fillStyle = '#00ff41';
      ctx.shadowColor = '#00ff41';
      ctx.shadowBlur = 12;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(line, 512, 32);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      newTextures.push(tex);
    }
    setTextures(newTextures);
    return () => newTextures.forEach(t => t?.dispose());
  }, []);

  const linePositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    const nonEmptyCount = OPENING_POEM.filter(l => l.trim() !== '').length;
    const startY = (nonEmptyCount * LINE_SPACING) / 2;
    let y = startY;
    for (let i = 0; i < OPENING_POEM.length; i++) {
      if (OPENING_POEM[i].trim() === '') {
        y -= 0.2;
        positions.push([0, y, 0]);
      } else {
        positions.push([0, y, 0.05]); // slightly in front of rain
        y -= LINE_SPACING;
      }
    }
    return positions;
  }, []);

  const [glowPulse, setGlowPulse] = useState(1);
  useFrame(({ clock }) => {
    setGlowPulse(Math.sin(clock.getElapsedTime() * 3) * 0.12 + 0.88);
  });

  return (
    <group>
      {OPENING_POEM.map((line, i) => {
        if (line.trim() === '' || !textures[i]) return null;
        const isActive = i === revealStep;
        const isRevealed = i <= revealStep;
        return (
          <mesh key={i} position={linePositions[i]}>
            <planeGeometry args={[line.length * 0.28 + 0.6, 0.32]} />
            <meshBasicMaterial
              map={textures[i]}
              transparent
              opacity={isRevealed ? (isActive ? glowPulse : 1) * fade : 0}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── 3D Matrix Rain Background Glow ───
function RainBackground() {
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useRef({
    uTime: { value: 0 },
  });

  useFrame(({ clock }) => {
    uniforms.current.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh position={[0, 0, -10]}>
      <planeGeometry args={[30, 20]} />
      <meshBasicMaterial color="#020208" />
    </mesh>
  );
}

// ─── Full Intro Scene ───
// 3D Matrix Rain → Characters fly to form poem → Fade → Transition

export function IntroScene() {
  const { camera } = useThree();
  const setPhase = useGameStore(s => s.setPhase);
  const setIntroMatrixDone = useGameStore(s => s.setIntroMatrixDone);
  const introPoemComplete = useGameStore(s => s.introPoemComplete);
  const setIntroPoemComplete = useGameStore(s => s.setIntroPoemComplete);
  const setIntroStep = useGameStore(s => s.setIntroStep);
  const [poemRevealStep, setPoemRevealStep] = useState(-1);
  const [poemFade, setPoemFade] = useState(1);
  const [rainFade, setRainFade] = useState(1);
  const phaseRef = useRef<'rain' | 'assembly' | 'complete'>('rain');
  const skipRef = useRef(false);

  // Phase 1: Pure rain for a while, then start assembly
  useEffect(() => {
    const matrixTimer = setTimeout(() => {
      phaseRef.current = 'assembly';
      setIntroMatrixDone(true);
      bus.emit('intro:matrix-done', {});

      // Start revealing lines one by one
      let step = 0;
      const revealInterval = setInterval(() => {
        step++;
        if (step >= OPENING_POEM.length) {
          clearInterval(revealInterval);
          setIntroPoemComplete(true);
          bus.emit('intro:poem-complete', {});
          phaseRef.current = 'complete';
        } else {
          setPoemRevealStep(step);
          setIntroStep(step);
        }
      }, POEM_REVEAL_DELAY);

      return () => clearInterval(revealInterval);
    }, MATRIX_PHASE_MS);

    return () => clearTimeout(matrixTimer);
  }, [setIntroMatrixDone, setIntroPoemComplete, setIntroStep]);

  // Phase 2: Poem complete → fade out → transition
  useEffect(() => {
    if (!introPoemComplete) return;

    // Fade rain
    const rainFadeStart = Date.now();
    const rainFadeInterval = setInterval(() => {
      const t = Math.min((Date.now() - rainFadeStart) / 1500, 1);
      setRainFade(1 - t);
      if (t >= 1) clearInterval(rainFadeInterval);
    }, 16);

    // Fade poem after a beat
    const poemFadeStart = Date.now() + 800;
    const poemFadeInterval = setInterval(() => {
      const t = Math.min((Date.now() - poemFadeStart) / 1500, 1);
      setPoemFade(1 - t);
      if (t >= 1) clearInterval(poemFadeInterval);
    }, 16);

    // Camera pull-back
    const cameraAnim = setInterval(() => {
      const t = Math.min((Date.now() - rainFadeStart) / 2500, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      camera.position.z = 6 + eased * 4;
      camera.position.y = eased * -1;
    }, 16);

    // Transition
    const transitionTimer = setTimeout(() => {
      bus.emit('transition:start', { from: 'intro', to: 'exploration' });
      setPhase('intro-to-explore');
    }, 3000);

    return () => {
      clearTimeout(transitionTimer);
      clearInterval(rainFadeInterval);
      clearInterval(poemFadeInterval);
      clearInterval(cameraAnim);
    };
  }, [introPoemComplete, setPhase, camera]);

  // Skip handler
  useEffect(() => {
    const handleSkip = () => {
      if (introPoemComplete || skipRef.current) return;
      skipRef.current = true;

      // Immediately reveal everything
      phaseRef.current = 'complete';
      setIntroMatrixDone(true);
      setPoemRevealStep(OPENING_POEM.length - 1);
      setIntroStep(OPENING_POEM.length);
      setRainFade(0);

      // Small delay then fade poem and transition
      setTimeout(() => {
        setIntroPoemComplete(true);
      }, 500);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [introPoemComplete, setIntroMatrixDone, setIntroStep, setIntroPoemComplete]);

  // Camera animation during intro
  useFrame(({ clock }) => {
    if (phaseRef.current === 'rain') {
      // Slow drift forward through rain
      const t = clock.getElapsedTime();
      camera.position.set(
        Math.sin(t * 0.15) * 0.3,
        Math.cos(t * 0.1) * 0.2,
        6 - Math.min(t * 0.15, 1.5)
      );
      camera.lookAt(0, 0, 0);
    } else if (phaseRef.current === 'assembly') {
      // Camera holds steady, slight breathing
      const t = clock.getElapsedTime();
      camera.position.set(
        Math.sin(t * 0.2) * 0.1,
        Math.sin(t * 0.15) * 0.1,
        4.5
      );
      camera.lookAt(0, 0, 0);
    }
  });

  return (
    <group>
      {/* Deep background */}
      <mesh position={[0, 0, -20]}>
        <planeGeometry args={[40, 30]} />
        <meshBasicMaterial color="#010108" />
      </mesh>

      {/* Atmospheric glow strips */}
      <mesh position={[0, -5, -8]}>
        <planeGeometry args={[20, 3]} />
        <meshBasicMaterial color="#001200" transparent opacity={0.5} />
      </mesh>

      {/* 3D Matrix Rain + Assembly */}
      <MatrixRainField poemRevealStep={poemRevealStep} poemFade={poemFade} />

      {/* Poem text overlay */}
      <PoemText revealStep={poemRevealStep} fade={poemFade} />

      <ambientLight intensity={0.05} />
    </group>
  );
}
