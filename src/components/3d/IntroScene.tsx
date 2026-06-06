import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OPENING_POEM, POEM_REVEAL_DELAY } from '@/data/poem';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Katakana + digits — classic Matrix alphabet
const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';

// Atlas grid layout
const ATLAS_COLS = 14;
const ATLAS_ROWS = 4; // 14 × 4 = 56 cells (exactly our char count)

// Rain field
const RAIN_COLS = 55;
const CHARS_PER_COL = 28;
const TOTAL_INSTANCES = RAIN_COLS * CHARS_PER_COL; // 1540

const CHAR_SIZE = 0.24;
const COL_SPACING = 0.3;
const ROW_SPACING = CHAR_SIZE * 1.3;
const FALL_SPEED_MIN = 1.5;
const FALL_SPEED_MAX = 4.0;

// Timing (ms)
const RAIN_PHASE_MS = 4500;
const SLOW_DOWN_MS = 1200;
const CONVERGE_MS = 2500;
const LINE_REVEAL_MS = 2200;

// Poem layout
const LINE_SPACING = 0.5;

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface ColumnState {
  speed: number;
  headY: number;
  z: number;
  scale: number;
  chars: Float32Array;
}

type RainPhase = 'falling' | 'slowing' | 'converging' | 'poem' | 'fading';

// ═══════════════════════════════════════════════════════════════
//  TEXTURE ATLAS — real katakana glyphs on a canvas grid
// ═══════════════════════════════════════════════════════════════

function createCharAtlas(): THREE.CanvasTexture {
  const CELL = 64;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const ctx = canvas.getContext('2d')!;

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // White glyphs — will be tinted green by shader
  ctx.font = `bold ${Math.floor(CELL * 0.78)}px "Courier New", "MS Gothic", "Noto Sans JP", monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < CHARS.length; i++) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    ctx.fillText(CHARS[i], col * CELL + CELL / 2, row * CELL + CELL / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; // Crisp pixels, no blur
  texture.minFilter = THREE.NearestFilter;
  texture.flipY = false;

  return texture;
}

// ═══════════════════════════════════════════════════════════════
//  SHADERS — per-instance character rendering from atlas
// ═══════════════════════════════════════════════════════════════

const RAIN_VERT = `
// Per-instance attributes
attribute float aCharIdx;
attribute float aBright;

varying float vBright;
varying vec2 vUv2;
varying float vCharIdx;

void main() {
  vBright   = aBright;
  vUv2      = uv;
  vCharIdx  = aCharIdx;

  // Standard instancing: each instance has its own matrix
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const RAIN_FRAG = `
precision mediump float;

uniform sampler2D uAtlas;
uniform float uCols;
uniform float uRows;

varying float vBright;
varying vec2 vUv2;
varying float vCharIdx;

void main() {
  // Select character cell from atlas grid
  float idx = floor(vCharIdx + 0.5);
  float col = mod(idx, uCols);
  float row = floor(idx / uCols);

  // Map UV to the correct cell (flipY = false → manual Y correction)
  vec2 atlasUV = vec2(
    (col + vUv2.x) / uCols,
    (row + 1.0 - vUv2.y) / uRows
  );

  float tex = texture2D(uAtlas, atlasUV).r;
  if (tex < 0.08) discard; // Skip empty pixels

  // Brightness-modulated glow
  float glow = vBright * (0.7 + tex * 0.3);

  // Green matrix color; hotter (brighter) chars shift toward white
  vec3 color = mix(
    vec3(0.0, 0.85, 0.22),
    vec3(0.5, 1.0, 0.65),
    pow(clamp(vBright, 0.0, 1.0), 3.5)
  );

  float alpha = tex * smoothstep(0.0, 0.12, glow);

  gl_FragColor = vec4(color * glow, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════
//  MATRIX RAIN FIELD — instanced mesh with real characters
// ═══════════════════════════════════════════════════════════════

interface MatrixRainFieldProps {
  phase: RainPhase;
  globalFade: number;
}

function MatrixRainField({ phase, globalFade }: MatrixRainFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const atlasTexture = useMemo(() => createCharAtlas(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Column data
  const columns = useRef<ColumnState[]>([]);
  // Per-instance attribute arrays
  const charIdxArr = useRef<Float32Array | null>(null);
  const brightArr = useRef<Float32Array | null>(null);
  // Phase transition tracking
  const phaseStartRef = useRef(0);
  const prevPhaseRef = useRef<RainPhase>('falling');

  // ── Initialise columns ──
  useMemo(() => {
    const cols: ColumnState[] = [];
    for (let c = 0; c < RAIN_COLS; c++) {
      const z = -(Math.random() * 20 + 1);
      const depthFactor = 1.0 - Math.abs(z + 10) / 20; // 0..1, 1 = closest
      const scale = 0.3 + depthFactor * 0.7;

      const chars = new Float32Array(CHARS_PER_COL);
      for (let r = 0; r < CHARS_PER_COL; r++) {
        chars[r] = Math.floor(Math.random() * CHARS.length);
      }

      cols.push({
        speed: FALL_SPEED_MIN + Math.random() * (FALL_SPEED_MAX - FALL_SPEED_MIN),
        headY: Math.random() * CHARS_PER_COL * 2, // stagger start
        z,
        scale,
        chars,
      });
    }
    columns.current = cols;
  }, []);

  // ── Set up instanced buffer attributes on mount ──
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const geo = mesh.geometry;

    const ci = new Float32Array(TOTAL_INSTANCES);
    const br = new Float32Array(TOTAL_INSTANCES);
    charIdxArr.current = ci;
    brightArr.current = br;

    geo.setAttribute('aCharIdx', new THREE.InstancedBufferAttribute(ci, 1));
    geo.setAttribute('aBright', new THREE.InstancedBufferAttribute(br, 1));

    return () => {
      geo.deleteAttribute('aCharIdx');
      geo.deleteAttribute('aBright');
    };
  }, []);

  // ── Track phase transitions ──
  useEffect(() => {
    if (phase !== prevPhaseRef.current) {
      phaseStartRef.current = performance.now();
      prevPhaseRef.current = phase;
    }
  }, [phase]);

  // ── Per-frame update ──
  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    const ci = charIdxArr.current;
    const br = brightArr.current;
    if (!mesh || !ci || !br) return;

    const dt = Math.min(delta, 0.05);
    const now = performance.now();
    const elapsed = clock.getElapsedTime();
    const phaseElapsed = (now - phaseStartRef.current) / 1000; // seconds

    // ── Speed multiplier per phase ──
    let speedMult = 1;
    if (phase === 'slowing') {
      speedMult = Math.max(0, 1 - phaseElapsed / (SLOW_DOWN_MS / 1000));
    } else if (phase === 'converging' || phase === 'poem') {
      speedMult = 0.03;
    } else if (phase === 'fading') {
      speedMult = 0.01;
    }

    // ── Advance column heads ──
    for (let c = 0; c < RAIN_COLS; c++) {
      const col = columns.current[c];
      col.headY += col.speed * dt * speedMult;

      // Matrix flicker: randomly change char at column head
      if (Math.random() < 0.08) {
        const headRow = ((Math.floor(col.headY) % CHARS_PER_COL) + CHARS_PER_COL) % CHARS_PER_COL;
        col.chars[headRow] = Math.floor(Math.random() * CHARS.length);
      }
    }

    // ── Convergence factor ──
    let convergeFactor = 0;
    if (phase === 'converging') {
      const raw = Math.min(phaseElapsed / (CONVERGE_MS / 1000), 1.0);
      convergeFactor = 1 - Math.pow(1 - raw, 2); // ease-out quad
    } else if (phase === 'poem' || phase === 'fading') {
      convergeFactor = 1.0;
    }

    // ── Fading factor ──
    let fadeMult = globalFade;
    if (phase === 'poem') fadeMult *= 0.2; // dim rain behind poem
    if (phase === 'fading') fadeMult *= Math.max(0, 1 - phaseElapsed / 2.0);

    // ── Update every instance ──
    const fieldHeight = CHARS_PER_COL * ROW_SPACING;

    for (let c = 0; c < RAIN_COLS; c++) {
      const col = columns.current[c];
      const baseX = (c - RAIN_COLS / 2) * COL_SPACING;

      for (let r = 0; r < CHARS_PER_COL; r++) {
        const idx = c * CHARS_PER_COL + r;
        const headDist = col.headY - r;

        // Brightness: exponential decay from column head
        let brightness = Math.exp(-headDist * 0.22);
        if (headDist < 0) brightness = 0; // above head = invisible
        brightness *= fadeMult;

        // ── World position ──
        const rawY = (CHARS_PER_COL - r) * ROW_SPACING
          - (col.headY % CHARS_PER_COL) * ROW_SPACING;
        // Wrap into visible range
        let y = ((rawY % fieldHeight) + fieldHeight) % fieldHeight - fieldHeight * 0.4;
        let x = baseX + Math.sin(elapsed * 0.25 + c * 0.4) * 0.04; // gentle wobble
        let z = col.z;
        let s = col.scale;

        // ── Apply convergence ──
        if (convergeFactor > 0) {
          // Subtle spiral as chars converge to origin
          const angle = Math.atan2(y, x) + convergeFactor * Math.PI * 0.4;
          const radius = Math.sqrt(x * x + z * z) * (1 - convergeFactor);
          x = Math.cos(angle) * radius;
          z = Math.sin(angle) * radius;
          y *= (1 - convergeFactor * 0.6);
          s *= (1 - convergeFactor * 0.4);
        }

        dummy.position.set(x, y, z);
        dummy.scale.setScalar(Math.max(s, 0.01));
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);

        ci[idx] = col.chars[r];
        br[idx] = brightness;
      }
    }

    // Mark buffers dirty
    mesh.instanceMatrix.needsUpdate = true;
    const ciAttr = mesh.geometry.getAttribute('aCharIdx') as THREE.InstancedBufferAttribute | undefined;
    const brAttr = mesh.geometry.getAttribute('aBright') as THREE.InstancedBufferAttribute | undefined;
    if (ciAttr) ciAttr.needsUpdate = true;
    if (brAttr) brAttr.needsUpdate = true;
  });

  // ── Shader uniforms ──
  const uniforms = useMemo(() => ({
    uAtlas: { value: atlasTexture },
    uCols:  { value: ATLAS_COLS },
    uRows:  { value: ATLAS_ROWS },
  }), [atlasTexture]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, TOTAL_INSTANCES]}>
      <planeGeometry args={[CHAR_SIZE, CHAR_SIZE]} />
      <shaderMaterial
        vertexShader={RAIN_VERT}
        fragmentShader={RAIN_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

// ═══════════════════════════════════════════════════════════════
//  POEM TEXT OVERLAY — canvas textures with glow
// ═══════════════════════════════════════════════════════════════

function PoemText({ revealStep, fade }: { revealStep: number; fade: number }) {
  const [textures, setTextures] = useState<THREE.CanvasTexture[]>([]);

  useEffect(() => {
    const texs: THREE.CanvasTexture[] = [];
    for (let i = 0; i < OPENING_POEM.length; i++) {
      const line = OPENING_POEM[i];
      if (line.trim() === '') { texs.push(null!); continue; }

      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 1024, 64);

      // Double-pass for stronger glow
      for (let pass = 0; pass < 2; pass++) {
        ctx.shadowColor = '#00ff41';
        ctx.shadowBlur = pass === 0 ? 18 : 10;
        ctx.font = '600 30px "Courier New", monospace';
        ctx.fillStyle = '#00ff41';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(line, 512, 32);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      texs.push(tex);
    }
    setTextures(texs);
    return () => texs.forEach(t => t?.dispose());
  }, []);

  // Line positions
  const linePositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    const nonEmpty = OPENING_POEM.filter(l => l.trim() !== '');
    const startY = (nonEmpty.length * LINE_SPACING) / 2;
    let y = startY;
    for (let i = 0; i < OPENING_POEM.length; i++) {
      if (OPENING_POEM[i].trim() === '') {
        positions.push([0, y, 0]);
        y -= 0.3;
      } else {
        positions.push([0, y, 0.05]);
        y -= LINE_SPACING;
      }
    }
    return positions;
  }, []);

  // Gentle pulse
  const [pulse, setPulse] = useState(0.92);
  useFrame(({ clock }) => {
    setPulse(Math.sin(clock.getElapsedTime() * 2.5) * 0.08 + 0.92);
  });

  return (
    <group>
      {OPENING_POEM.map((line, i) => {
        if (line.trim() === '' || !textures[i]) return null;
        const isActive = i === revealStep;
        const isRevealed = i <= revealStep;
        const opacity = isRevealed ? (isActive ? pulse : 1) * fade : 0;

        return (
          <mesh key={i} position={linePositions[i]}>
            <planeGeometry args={[line.length * 0.28 + 0.8, 0.35]} />
            <meshBasicMaterial
              map={textures[i]}
              transparent
              opacity={opacity}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  AMBIENT PARTICLES — tiny floating dots for depth
// ═══════════════════════════════════════════════════════════════

function AmbientParticles({ fade }: { fade: number }) {
  const count = 80;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const data = useMemo(() =>
    Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 30,
      y: (Math.random() - 0.5) * 20,
      z: -(Math.random() * 15 + 2),
      speed: 0.1 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
    })),
  []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();

    for (let i = 0; i < count; i++) {
      const p = data[i];
      dummy.position.set(
        p.x + Math.sin(t * p.speed + p.phase) * 0.5,
        p.y + Math.sin(t * p.speed * 0.7 + p.phase * 2) * 0.3,
        p.z,
      );
      const s = (0.02 + Math.sin(t * 2 + i) * 0.01) * fade;
      dummy.scale.setScalar(Math.max(s, 0.001));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial color="#00ff41" transparent opacity={0.12} depthWrite={false} />
    </instancedMesh>
  );
}

// ═══════════════════════════════════════════════════════════════
//  INTRO SCENE — orchestration
// ═══════════════════════════════════════════════════════════════

export function IntroScene() {
  const { camera } = useThree();
  const setPhase = useGameStore(s => s.setPhase);
  const setIntroMatrixDone = useGameStore(s => s.setIntroMatrixDone);
  const setIntroPoemComplete = useGameStore(s => s.setIntroPoemComplete);
  const setIntroStep = useGameStore(s => s.setIntroStep);
  const introPoemComplete = useGameStore(s => s.introPoemComplete);

  const [rainPhase, setRainPhase] = useState<RainPhase>('falling');
  const [poemRevealStep, setPoemRevealStep] = useState(-1);
  const [poemFade, setPoemFade] = useState(1);
  const [rainFade, setRainFade] = useState(1);
  const skipRef = useRef(false);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  // Cleanup on unmount
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // ── Phase machine ──
  useEffect(() => {
    if (skipRef.current) return;

    // Phase 1 → Pure rain
    const t1 = setTimeout(() => {
      setRainPhase('slowing');
      setIntroMatrixDone(true);
      bus.emit('intro:matrix-done', {});

      // Phase 2 → Slow down
      const t2 = setTimeout(() => {
        setRainPhase('converging');

        // Phase 3 → Converge, then reveal poem
        const t3 = setTimeout(() => {
          setRainPhase('poem');

          // Reveal poem lines one by one
          let step = 0;
          const interval = setInterval(() => {
            step++;
            if (step >= OPENING_POEM.length) {
              clearInterval(interval);
              setIntroPoemComplete(true);
              bus.emit('intro:poem-complete', {});
            } else {
              setPoemRevealStep(step);
              setIntroStep(step);
              if (OPENING_POEM[step].trim() !== '') {
                bus.emit('intro:poem-line', { index: step, text: OPENING_POEM[step] });
              }
            }
          }, LINE_REVEAL_MS);
          timersRef.current.push(interval as unknown as NodeJS.Timeout);
        }, CONVERGE_MS);
        timersRef.current.push(t3);
      }, SLOW_DOWN_MS);
      timersRef.current.push(t2);
    }, RAIN_PHASE_MS);
    timersRef.current.push(t1);

    return () => timersRef.current.forEach(clearTimeout);
  }, [setIntroMatrixDone, setIntroPoemComplete, setIntroStep]);

  // ── Poem complete → fade → transition ──
  useEffect(() => {
    if (!introPoemComplete || skipRef.current) return;

    const start = Date.now();

    // Fade rain
    const ri = setInterval(() => {
      const t = Math.min((Date.now() - start) / 1500, 1);
      setRainFade(1 - t);
      if (t >= 1) clearInterval(ri);
    }, 16);

    // Fade poem (delayed)
    const pi = setInterval(() => {
      const t = Math.min((Date.now() - start - 1200) / 1500, 1);
      setPoemFade(Math.max(0, 1 - t));
      if (t >= 1) clearInterval(pi);
    }, 16);

    // Camera pull-back
    const ci = setInterval(() => {
      const t = Math.min((Date.now() - start) / 2500, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      camera.position.z = 6 + eased * 3;
      camera.position.y = eased * -0.5;
    }, 16);

    // Transition
    const tt = setTimeout(() => {
      setRainPhase('fading');
      bus.emit('transition:start', { from: 'intro', to: 'exploration' });
      setPhase('intro-to-explore');
    }, 3200);

    return () => {
      clearTimeout(tt);
      clearInterval(ri);
      clearInterval(pi);
      clearInterval(ci);
    };
  }, [introPoemComplete, setPhase, camera]);

  // ── Skip handler (Enter / Space) ──
  useEffect(() => {
    const handleSkip = () => {
      if (introPoemComplete || skipRef.current) return;
      skipRef.current = true;

      // Clear all pending timers
      timersRef.current.forEach(clearTimeout);

      setRainPhase('fading');
      setIntroMatrixDone(true);
      setPoemRevealStep(OPENING_POEM.length - 1);
      setIntroStep(OPENING_POEM.length);
      setRainFade(0);

      setTimeout(() => setIntroPoemComplete(true), 300);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [introPoemComplete, setIntroMatrixDone, setIntroStep, setIntroPoemComplete]);

  // ── Cinematic camera ──
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    if (rainPhase === 'falling') {
      // Slow drift forward through the rain
      camera.position.set(
        Math.sin(t * 0.12) * 0.4,
        Math.cos(t * 0.08) * 0.25,
        7 - Math.min(t * 0.18, 2.0),
      );
      camera.lookAt(0, 0, 0);
    } else if (rainPhase === 'slowing' || rainPhase === 'converging') {
      // Hold steady, slight breathing
      camera.position.set(
        Math.sin(t * 0.15) * 0.15,
        Math.sin(t * 0.1) * 0.1,
        5,
      );
      camera.lookAt(0, 0, 0);
    } else if (rainPhase === 'poem') {
      // Focused on poem, perfectly still
      camera.position.set(0, 0, 6);
      camera.lookAt(0, 0, 0);
    }
    // fading/intro-to-explore: camera controlled by transition effect above
  });

  return (
    <group>
      {/* Deep background plane */}
      <mesh position={[0, 0, -25]}>
        <planeGeometry args={[50, 40]} />
        <meshBasicMaterial color="#010108" />
      </mesh>

      {/* Atmospheric ground glow */}
      <mesh position={[0, -7, -5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[25, 15]} />
        <meshBasicMaterial color="#001208" transparent opacity={0.4} />
      </mesh>

      {/* Top atmospheric haze */}
      <mesh position={[0, 8, -10]}>
        <planeGeometry args={[30, 5]} />
        <meshBasicMaterial color="#000a06" transparent opacity={0.3} />
      </mesh>

      {/* 3D Matrix Rain Field */}
      <MatrixRainField phase={rainPhase} globalFade={rainFade} />

      {/* Ambient floating particles */}
      <AmbientParticles fade={rainFade} />

      {/* Poem text overlay */}
      <PoemText revealStep={poemRevealStep} fade={poemFade} />

      {/* Minimal ambient light (scene is mostly emissive) */}
      <ambientLight intensity={0.03} />
    </group>
  );
}
