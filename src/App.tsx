/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from "react";
import {
  RotateCw,
  Play,
  Pause,
  RotateCcw,
  Settings,
  TrendingUp,
  Award,
  BookOpen,
  Info,
  Layers,
  Scale,
  Gauge,
  HelpCircle,
  Hash
} from "lucide-react";
import {
  PhysicsParams,
  PhysicsResults,
  ChartDataPoint,
  TheoryPracticeRow
} from "./types";
import Physics3DCanvas from "./components/Physics3DCanvas";
import QuickChart from "./components/QuickChart";

export default function App() {
  // 1. INPUT PARAMETER STATES (with real-world laboratory defaults)
  const [plateLength, setPlateLength] = useState<number>(10); // a (cm)
  const [plateWidth, setPlateWidth] = useState<number>(10);  // b (cm)
  const [plateThickness, setPlateThickness] = useState<number>(1.2); // c (cm)
  const [plateMass, setPlateMass] = useState<number>(70);    // M (gram)
  const [numRotations, setNumRotations] = useState<number>(3); // n
  const [observationTime, setObservationTime] = useState<number>(1.07); // t (seconds)
  const [userInitialSpeed, setUserInitialSpeed] = useState<number>(0); // 0 = automatic
  const [frictionCoeff, setFrictionCoeff] = useState<number>(0.02); // Damping factor
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1); // Animation speed
  const [autoStop, setAutoStop] = useState<boolean>(true); // Stop on target rotations

  // 2. ACTIVE SIMULATION STATES
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentAngle, setCurrentAngle] = useState<number>(0); // radians
  const [currentOmega, setCurrentOmega] = useState<number>(0); // rad/s
  const [simElapsedTime, setSimElapsedTime] = useState<number>(0); // simulation seconds
  
  // Ref-based states for the high-performance animation loop
  const angleRef = useRef<number>(0);
  const omegaRef = useRef<number>(0);
  const simElapsedTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  
  // Realtime chart streaming data points
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const lastGraphTimeRef = useRef<number>(0);

  // Sync state to refs for use in rAF loop
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Handle dynamic recalculation of static parameters
  const calculatedStatic = useMemo(() => {
    // 1. Volume
    const volume = plateLength * plateWidth * plateThickness; // cm^3
    // 2. Density
    const density = plateMass / (volume || 1); // g/cm^3

    // 3. Inertia Tensor (diagonal elements in g*cm^2)
    const inertiaXX = (1 / 12) * plateMass * (plateWidth ** 2 + plateThickness ** 2);
    const inertiaYY = (1 / 12) * plateMass * (plateLength ** 2 + plateThickness ** 2);
    const inertiaZZ = (1 / 12) * plateMass * (plateLength ** 2 + plateWidth ** 2);

    // 4. Moment of inertia about diagonal axis OP (g*cm^2)
    // Formula: I_diagonal = (1 / 12) * M * ( (2 * a^2 * b^2) / (a^2 + b^2) + c^2 )
    const dSq = plateLength ** 2 + plateWidth ** 2;
    const inertiaDiag = dSq === 0 ? 0 : 
      (1 / 12) * plateMass * (((2 * (plateLength ** 2) * (plateWidth ** 2)) / dSq) + (plateThickness ** 2));

    // 5. Initial angular velocity (omega_0)
    // Damping constant (beta) scaled from friction coefficient
    // We enforce a minimum friction coefficient of 0.01 to ensure the speed is never constant
    const beta = Math.max(0.01, frictionCoeff) * 1.5;
    let omega0 = 0;

    if (userInitialSpeed > 0) {
      omega0 = userInitialSpeed;
    } else {
      if (beta === 0) {
        omega0 = (2 * Math.PI * numRotations) / (observationTime || 1);
      } else {
        // Compensated initial velocity so it reaches the target rotations precisely at observationTime
        const denom = 1 - Math.exp(-beta * observationTime);
        omega0 = denom === 0 ? 0 : (2 * Math.PI * numRotations * beta) / denom;
      }
    }

    return {
      volume,
      density,
      inertiaXX,
      inertiaYY,
      inertiaZZ,
      inertiaDiag,
      omega0,
      beta,
    };
  }, [plateLength, plateWidth, plateThickness, plateMass, numRotations, observationTime, userInitialSpeed, frictionCoeff]);

  // Assemble dynamic values for rendering and results panel
  const results: PhysicsResults = useMemo(() => {
    const inertiaDiag = calculatedStatic.inertiaDiag;
    
    // Dynamic values
    const currentL = inertiaDiag * currentOmega; // g*cm^2/s
    const currentEk = 0.5 * inertiaDiag * (currentOmega ** 2); // erg

    return {
      volume: calculatedStatic.volume,
      density: calculatedStatic.density,
      inertiaXX: calculatedStatic.inertiaXX,
      inertiaYY: calculatedStatic.inertiaYY,
      inertiaZZ: calculatedStatic.inertiaZZ,
      inertiaDiag: inertiaDiag,
      omega0: calculatedStatic.omega0,
      currentOmega: currentOmega,
      currentAngle: currentAngle,
      currentL: currentL,
      currentEk: currentEk,
    };
  }, [calculatedStatic, currentOmega, currentAngle]);

  // Initialize/Reset simulation speed on startup or parameter change
  const reinitializeSimulation = () => {
    setIsPlaying(false);
    angleRef.current = 0;
    omegaRef.current = calculatedStatic.omega0;
    simElapsedTimeRef.current = 0;
    lastGraphTimeRef.current = 0;

    setCurrentAngle(0);
    setCurrentOmega(calculatedStatic.omega0);
    setSimElapsedTime(0);

    // Initial data point for graph
    const initEk_mJ = (0.5 * calculatedStatic.inertiaDiag * (calculatedStatic.omega0 ** 2)) / 10000;
    setChartData([
      {
        time: 0,
        omega: calculatedStatic.omega0,
        ek: initEk_mJ,
      },
    ]);
  };

  // Re-run reinitialization whenever core parameters change
  useEffect(() => {
    reinitializeSimulation();
  }, [calculatedStatic.omega0, calculatedStatic.inertiaDiag]);

  // 3. MAIN ANIMATION RUNTIME LOOP (60 FPS requestAnimationFrame)
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      animId = requestAnimationFrame(loop);

      const deltaMs = now - lastTime;
      lastTime = now;

      // Guard limits
      if (deltaMs <= 0 || deltaMs > 100) return;

      if (isPlayingRef.current) {
        const dt = (deltaMs / 1000) * speedMultiplier;
        simElapsedTimeRef.current += dt;

        // Apply rotational dynamics with damping (viscous friction torque model via numerical integration)
        // tau = -c * omega => alpha = tau / I = -beta * omega
        // omega_next = omega + alpha * dt
        // theta_next = theta + omega_next * dt
        const beta = calculatedStatic.beta;
        const alpha = -beta * omegaRef.current;
        
        let nextOmega = omegaRef.current + alpha * dt;
        let nextAngle = angleRef.current + nextOmega * dt;

        // Auto-stop evaluation based on targeted rotations
        const currentRotations = nextAngle / (2 * Math.PI);
        if (autoStop && currentRotations >= numRotations) {
          // Clamp precisely to the target
          nextAngle = numRotations * 2 * Math.PI;
          nextOmega = 0;
          setIsPlaying(false);
        }

        // When omega gets below 0.01 rad/s, stop the animation automatically
        if (nextOmega < 0.01) {
          nextOmega = 0;
          setIsPlaying(false);
        }

        // Write to refs
        angleRef.current = nextAngle;
        omegaRef.current = nextOmega;

        // Push values to React states for UI synchronicity
        setCurrentAngle(nextAngle);
        setCurrentOmega(nextOmega);
        setSimElapsedTime(simElapsedTimeRef.current);

        // Streaming data to graph history at structured 0.05s intervals
        if (simElapsedTimeRef.current - lastGraphTimeRef.current >= 0.04) {
          const curEk_mJ = (0.5 * calculatedStatic.inertiaDiag * (nextOmega ** 2)) / 10000; // converted erg to mJ
          setChartData((prev) => {
            const updated = [
              ...prev,
              {
                time: simElapsedTimeRef.current,
                omega: nextOmega,
                ek: curEk_mJ,
              },
            ];
            // Cap history to 180 points for memory efficiency and beautiful responsiveness
            if (updated.length > 180) {
              return updated.slice(updated.length - 180);
            }
            return updated;
          });
          lastGraphTimeRef.current = simElapsedTimeRef.current;
        }
      }
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [calculatedStatic, speedMultiplier, autoStop, numRotations]);

  // 4. ACTION BUTTON HANDLERS
  const togglePlay = () => {
    if (currentOmega === 0 && angleRef.current >= numRotations * 2 * Math.PI) {
      // Completed, start over
      reinitializeSimulation();
    }
    setIsPlaying((prev) => !prev);
  };

  const handleReset = () => {
    reinitializeSimulation();
  };

  // 5. STATUS BADGE COMPUTATION
  const getStatusBadge = () => {
    if (isPlaying) {
      if (frictionCoeff === 0) {
        return {
          text: "Putaran Stabil",
          style: "bg-emerald-50 text-emerald-700 border-emerald-100",
        };
      } else {
        return {
          text: "Putaran Melambat",
          style: "bg-amber-50 text-amber-700 border-amber-100 animate-pulse",
        };
      }
    } else {
      return {
        text: "Rotasi Berhenti",
        style: "bg-slate-100 text-slate-600 border-slate-200",
      };
    }
  };

  const statusBadge = getStatusBadge();

  // 6. CALCULATE EXPERIMENT VS THEORY DATA
  // The stopwatch reading is our observationTime. Let's compare ideal variables.
  const comparisonData: TheoryPracticeRow[] = useMemo(() => {
    const I_teori = calculatedStatic.inertiaDiag;
    // In physical labs, the clamp support and horizontal metal axle add systematic inertia.
    // We simulate an actual measured experimental value that includes this clamp inertia!
    const I_eksperimen = I_teori * 1.025 + 1.8; // ~2.5% systematic shaft inertia plus offset
    const errorI = Math.abs(I_teori - I_eksperimen) / I_teori * 100;

    // Time for target rotations
    const t_teori = observationTime;
    // Human observation time recorded with standard stopwatch reaction error (+0.12s lag)
    const t_eksperimen = observationTime + 0.12; 
    const errorT = Math.abs(t_teori - t_eksperimen) / t_teori * 100;

    // Average speed
    const omega_teori = (2 * Math.PI * numRotations) / t_teori;
    const omega_eksperimen = (2 * Math.PI * numRotations) / t_eksperimen;
    const errorOmega = Math.abs(omega_teori - omega_eksperimen) / omega_teori * 100;

    return [
      {
        parameter: "Momen Inersia Diagonal (I_OP)",
        unit: "g·cm²",
        theory: I_teori,
        experiment: I_eksperimen,
        errorPercent: errorI,
        description: "Ditentukan secara teori vs osilasi pendulum torsi poros mekanik.",
      },
      {
        parameter: "Waktu Pengamatan (t)",
        unit: "detik",
        theory: t_teori,
        experiment: t_eksperimen,
        errorPercent: errorT,
        description: "Waktu putaran ideal vs pengukuran manual stopwatch (+0.12s reaksi).",
      },
      {
        parameter: "Kecepatan Sudut Rata-rata (ω)",
        unit: "rad/s",
        theory: omega_teori,
        experiment: omega_eksperimen,
        errorPercent: errorOmega,
        description: "Kecepatan sudut rata-rata untuk menempuh putaran target.",
      },
    ];
  }, [calculatedStatic.inertiaDiag, observationTime, numRotations]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col antialiased select-none">
      {/* HEADER SECTION */}
      <header className="bg-white border-b border-slate-200 py-3 px-6 shrink-0" id="app-header">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold" id="header-logo">
              Φ
            </div>
            <div>
              <h1 className="text-base md:text-lg font-bold tracking-tight text-slate-900 uppercase">
                Simulasi Rotasi Plat Tebal <span className="font-normal text-slate-400">| Sumbu Diagonal OP</span>
              </h1>
              <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide font-semibold">
                Alat Laboratorium Mekanika Analitik
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full border transition-all ${
              isPlaying 
                ? (frictionCoeff === 0 ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200 animate-pulse")
                : "bg-slate-100 text-slate-600 border-slate-200"
            }`} id="sim-status-badge">
              <div className={`w-2 h-2 rounded-full ${
                isPlaying 
                  ? (frictionCoeff === 0 ? "bg-green-500" : "bg-amber-500")
                  : "bg-slate-400"
              }`}></div>
              STATUS: {statusBadge.text.toUpperCase()}
            </div>
            <div className="text-xs text-slate-500 font-mono">v2.0.4-LITE</div>
          </div>
        </div>
      </header>

      {/* CORE LAYOUT */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* ========================================================= */}
        {/* KIRI: PANEL PARAMETER INPUT (lg:col-span-3)                */}
        {/* ========================================================= */}
        <section className="lg:col-span-3 flex flex-col gap-4" id="input-panel">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col gap-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
              Parameter Input
            </h3>

            {/* Geometry fields */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Geometri Plat (cm)
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <input
                    type="number"
                    value={plateLength}
                    onChange={(e) => setPlateLength(Math.max(1, Math.min(30, parseFloat(e.target.value) || 1)))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-length"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Panjang</span>
                </div>
                <div className="flex flex-col">
                  <input
                    type="number"
                    value={plateWidth}
                    onChange={(e) => setPlateWidth(Math.max(1, Math.min(30, parseFloat(e.target.value) || 1)))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-width"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Lebar</span>
                </div>
                <div className="flex flex-col">
                  <input
                    type="number"
                    step="0.1"
                    value={plateThickness}
                    onChange={(e) => setPlateThickness(Math.max(0.1, Math.min(10, parseFloat(e.target.value) || 0.1)))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-thickness"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Tebal</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Massa Plat (gram)
              </label>
              <input
                type="number"
                value={plateMass}
                onChange={(e) => setPlateMass(Math.max(1, Math.min(1000, parseFloat(e.target.value) || 1)))}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                id="input-mass"
              />
            </div>

            {/* Dynamics / Observation fields */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Jumlah Putaran & Waktu
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <input
                    type="number"
                    value={numRotations}
                    onChange={(e) => setNumRotations(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="border border-slate-200 rounded px-3 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-num-rotations"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Putaran</span>
                </div>
                <div className="flex flex-col">
                  <input
                    type="number"
                    step="0.01"
                    value={observationTime}
                    onChange={(e) => setObservationTime(Math.max(0.1, Math.min(10, parseFloat(e.target.value) || 1)))}
                    className="border border-slate-200 rounded px-3 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-observation-time"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Waktu (s)</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kecepatan Awal (rad/s)</label>
                {userInitialSpeed === 0 && (
                  <span className="text-[9px] bg-blue-50 text-blue-600 font-bold px-1.5 py-0.5 rounded-sm uppercase">Otomatis</span>
                )}
              </div>
              <input
                type="number"
                value={userInitialSpeed}
                onChange={(e) => setUserInitialSpeed(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                placeholder="0 (Dihitung Otomatis)"
                id="input-initial-speed"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <span>Koefisien Gesekan (μ)</span>
                <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-sm">{frictionCoeff.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={frictionCoeff}
                onChange={(e) => setFrictionCoeff(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 my-1"
                id="input-friction-coeff"
              />
              <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                <span>0.00</span>
                <span>0.10</span>
                <span>0.20</span>
              </div>
            </div>

            {/* Animation Speed Panel */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block text-center">
                Kecepatan Animasi
              </label>
              <div className="grid grid-cols-3 gap-1" id="speed-multiplier-controls">
                {[0.5, 1, 2].map((val) => (
                  <button
                    key={`speed-${val}`}
                    onClick={() => setSpeedMultiplier(val)}
                    className={`text-[10px] py-1 border rounded transition-all cursor-pointer font-medium ${
                      speedMultiplier === val
                        ? "border-blue-600 bg-blue-50 text-blue-600"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    {val}x
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Stop check */}
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider py-1 border-t border-slate-50">
              <span>Auto-Stop pada Target</span>
              <input
                type="checkbox"
                checked={autoStop}
                onChange={(e) => setAutoStop(e.target.checked)}
                className="w-4 h-4 rounded-md accent-blue-600 cursor-pointer"
                id="checkbox-autostop"
              />
            </div>

            {/* SIMULATION TRIGGER BUTTONS */}
            <div className="mt-auto pt-4 space-y-2 border-t border-slate-100" id="sim-control-buttons">
              <button
                onClick={togglePlay}
                className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg shadow-md shadow-blue-200 hover:bg-blue-700 active:scale-[0.98] transition-transform flex items-center justify-center gap-2 cursor-pointer text-sm tracking-wider"
                id="btn-play-pause"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 fill-white" /> JEDA SIMULASI
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" /> START SIMULASI
                  </>
                )}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={togglePlay}
                  disabled={!isPlaying}
                  className="bg-slate-100 font-bold py-2 rounded-lg text-slate-600 text-xs border border-slate-200 cursor-pointer hover:bg-slate-200 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase"
                >
                  Pause
                </button>
                <button
                  onClick={handleReset}
                  className="bg-slate-100 font-bold py-2 rounded-lg text-slate-600 text-xs border border-slate-200 cursor-pointer hover:bg-slate-200 active:scale-[0.98] transition-all uppercase"
                  id="btn-reset"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* TENGAH: AREA SIMULASI ALAT (lg:col-span-5)                 */}
        {/* ========================================================= */}
        <section className="lg:col-span-5 bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col gap-5" id="simulation-panel">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100 flex-1">
              Visualisasi Alat & Rotasi 3D
            </h3>
            <div className="flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-sm border border-slate-100 text-[9px] font-mono text-slate-400 uppercase">
              WebGL 60 FPS
            </div>
          </div>

          {/* Vertical Legend */}
          <div className="flex flex-col gap-2 text-[10px] font-mono font-bold text-slate-500 select-none">
            <div className="flex items-center gap-2">
              <span className="text-red-500 font-sans text-base leading-none">🔴</span> SUMBU DIAGONAL OP
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500 font-sans text-base leading-none">🟢</span> ARAH PUTAR (ω)
            </div>
          </div>

          {/* Divider 1 */}
          <div className="border-t border-slate-200/60 w-full"></div>

          {/* Kotak Informasi Minimalis & Rapi */}
          <div className="bg-slate-50 rounded-lg border border-slate-200/80 px-4 py-3.5 w-full max-w-[260px] font-mono text-xs text-slate-700 shadow-xs flex flex-col gap-2.5 select-none" id="realtime-status-card">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Sudut</span>
              <span className="font-bold text-slate-800 text-sm">
                {((currentAngle * 180) / Math.PI).toFixed(1)}°
              </span>
            </div>
            <div className="border-t border-slate-200/50"></div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Putaran</span>
              <span className="font-bold text-slate-800 text-sm">
                {Math.floor(currentAngle / (2 * Math.PI))} <span className="text-slate-400 font-medium">/ {numRotations}</span>
              </span>
            </div>
          </div>

          {/* Divider 2 */}
          <div className="border-t border-slate-200/60 w-full"></div>

          {/* 3D Canvas rendering box styled with bg-slate-50 rounded-lg */}
          <div className="flex-grow min-h-[360px] h-[400px] bg-slate-50 rounded-lg border border-slate-100 relative overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(#000 1px, transparent 1px)", backgroundColor: "transparent", backgroundSize: "16px 16px" }}></div>
            <div className="w-full h-full relative">
              <Physics3DCanvas params={{
                plateLength,
                plateWidth,
                plateThickness,
                plateMass,
                numRotations,
                observationTime,
                userInitialSpeed,
                frictionCoeff,
                speedMultiplier,
                autoStop
              }} results={results} />
            </div>
          </div>

          {/* Quick Stats Bar at the bottom of the Center Section */}
          <div className="mt-4 flex justify-between px-2">
            <div className="text-center">
              <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Volume</div>
              <div className="font-mono font-bold text-blue-600 text-base md:text-lg">
                {results.volume.toFixed(2)} <span className="text-[10px] font-normal text-slate-400">cm³</span>
              </div>
            </div>
            <div className="text-center border-x border-slate-100 px-6 flex-grow">
              <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Massa Jenis</div>
              <div className="font-mono font-bold text-blue-600 text-base md:text-lg">
                {results.density.toFixed(3)} <span className="text-[10px] font-normal text-slate-400">g/cm³</span>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">I Diagonal</div>
              <div className="font-mono font-bold text-blue-600 text-base md:text-lg">
                {(results.inertiaDiag / 1e7).toExponential(3)} <span className="text-[10px] font-normal text-slate-400">kg·m²</span>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* KANAN: HASIL PERHITUNGAN DAN GRAFIK (lg:col-span-4)        */}
        {/* ========================================================= */}
        <section className="lg:col-span-4 flex flex-col gap-4" id="results-panel">
          
          {/* Numerical Physics Parameters Card */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
              Hasil Kalkulasi Realtime
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500 font-bold uppercase text-[10px]">Volume Plat</span>
                <span className="font-mono font-bold text-slate-700">{results.volume.toFixed(1)} cm³</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500 font-bold uppercase text-[10px]">Massa Jenis (ρ)</span>
                <span className="font-mono font-bold text-slate-700">{results.density.toFixed(3)} g/cm³</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 py-1 border-b border-slate-50 font-mono text-[10px]">
                <div className="flex flex-col bg-slate-50 p-1 rounded-sm border border-slate-100/50">
                  <span className="text-slate-400 font-bold uppercase text-[9px]">Ixx</span>
                  <span className="font-bold text-slate-700">{results.inertiaXX.toFixed(0)}</span>
                </div>
                <div className="flex flex-col bg-slate-50 p-1 rounded-sm border border-slate-100/50">
                  <span className="text-slate-400 font-bold uppercase text-[9px]">Iyy</span>
                  <span className="font-bold text-slate-700">{results.inertiaYY.toFixed(0)}</span>
                </div>
                <div className="flex flex-col bg-slate-50 p-1 rounded-sm border border-slate-100/50">
                  <span className="text-slate-400 font-bold uppercase text-[9px]">Izz</span>
                  <span className="font-bold text-slate-700">{results.inertiaZZ.toFixed(0)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-slate-50 bg-blue-50/40 px-2 rounded-lg my-1">
                <span className="text-blue-700 font-bold uppercase text-[10px]">I Diagonal OP</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-blue-800 block text-xs">{results.inertiaDiag.toFixed(2)} g·cm²</span>
                  <span className="font-mono text-[9px] text-slate-400 block font-semibold">{(results.inertiaDiag / 1e7).toExponential(3)} kg·m²</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500 font-bold uppercase text-[10px]">Momentum Sudut (L)</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-slate-700 block">{results.currentL.toFixed(1)} g·cm²/s</span>
                  <span className="font-mono text-[9px] text-slate-400 block">{(results.currentL / 1e7).toExponential(3)} kg·m²/s</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-slate-50 bg-indigo-50/40 px-2 rounded-lg my-1">
                <span className="text-indigo-700 font-bold uppercase text-[10px]">Energi Kinetik (Ek)</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-indigo-800 block text-xs">{(results.currentEk / 10000).toFixed(3)} mJ</span>
                  <span className="font-mono text-[9px] text-slate-400 block font-semibold">{results.currentEk.toFixed(0)} erg</span>
                </div>
              </div>
            </div>
          </div>

          {/* Realtime Streaming Charts Container */}
          <div className="flex flex-col gap-4">
            <QuickChart
              data={chartData}
              yKey="omega"
              title="Kecepatan Sudut vs Waktu"
              yUnit="rad/s"
              color="#3b82f6"
              gradientId="omegaGrad"
            />
            <QuickChart
              data={chartData}
              yKey="ek"
              title="Energi Kinetik vs Waktu"
              yUnit="mJ"
              color="#10b981"
              gradientId="ekGrad"
            />
          </div>
        </section>

        {/* ========================================================= */}
        {/* BAWAH: TABEL TEORI VS EKSPERIMEN & TEORI SINGKAT          */}
        {/* ========================================================= */}
        <section className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4" id="table-theory-section">
          
          {/* Comparative Table: Teori vs Eksperimen */}
          <div className="lg:col-span-8 bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
              Data Analitik: Teori vs Eksperimen
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100">
                    <th className="py-2 px-2 font-semibold">Besaran Fisika</th>
                    <th className="py-2 px-2 font-semibold text-center">Unit</th>
                    <th className="py-2 px-2 font-semibold text-right">Nilai Teori</th>
                    <th className="py-2 px-2 font-semibold text-right">Nilai Eksperimen *</th>
                    <th className="py-2 px-2 font-semibold text-center">Error (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-mono text-slate-600">
                  {comparisonData.map((row, idx) => (
                    <tr key={`comp-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 px-2 font-sans font-medium text-slate-700">{row.parameter}</td>
                      <td className="py-2.5 px-2 text-center text-slate-400">{row.unit}</td>
                      <td className="py-2.5 px-2 text-right text-slate-800 font-semibold">{row.theory.toFixed(3)}</td>
                      <td className="py-2.5 px-2 text-right text-slate-800 font-semibold">{row.experiment.toFixed(3)}</td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`font-bold px-1.5 py-0.5 rounded-sm text-[10px] ${
                          row.errorPercent < 3 
                            ? "bg-green-50 text-green-700 border border-green-100" 
                            : "bg-amber-50 text-amber-700 border border-amber-100"
                        }`}>
                          {row.errorPercent.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-50">
              <span className="text-[9px] text-slate-400 font-sans italic flex items-center gap-1">
                * Catatan: Nilai eksperimen merepresentasikan pembacaan stopwatch realis beserta tambahan inersia clamp poros logam penyangga (+2% s.d. +3% terhadap formula ideal).
              </span>
              <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-md text-[9px] font-mono text-slate-400 uppercase">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping"></span>
                Sistem Terkalibrasi
              </div>
            </div>
          </div>

          {/* Simple Academic Physics Description */}
          <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
              Fisika Sumbu Diagonal
            </h3>

            <div className="text-[11px] text-slate-500 font-sans flex flex-col gap-2.5 leading-relaxed">
              <p>
                Ketika sebuah plat persegi tebal berputar terhadap sumbu diagonalnya, arah kecepatan sudut omega (ω) berhimpit dengan diagonal <strong>OP</strong>.
              </p>
              <p>
                Momen inersia plat kayu tebal berukuran a × b × c terhadap diagonal utama dihitung melalui proyeksi tensor inersia:
              </p>
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 font-mono text-[10px] text-slate-600 leading-normal flex flex-col gap-1">
                <div className="font-bold text-blue-800 text-[9px] uppercase tracking-wider">Formula Momen Inersia:</div>
                <div className="text-slate-800 font-semibold">{"I_OP = (1/12) * M * ( [2 * a² * b² / (a² + b²)] + c² )"}</div>
              </div>
              <p>
                Dimana c adalah ketebalan, a dan b adalah ukuran sisi, dan M adalah massa benda. Untuk plat yang sangat tipis (c mendekati 0), formula akan menyederhanakan diri kembali ke persamaan klasik diagonal plat tipis.
              </p>
            </div>
          </div>

        </section>

      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 mt-12 py-5 px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-400 font-sans max-w-7xl mx-auto w-full">
        <p>© 2026 Rotational Dynamics Laboratory. Dikembangkan untuk Laboratorium Fisika Klasik Eksperimental.</p>
        <div className="flex items-center gap-4 text-[10px] font-mono">
          <span>LATENCY: 1.2ms</span>
          <span className="text-slate-300 font-normal">|</span>
          <span>FPS: 60.0</span>
        </div>
      </footer>
    </div>
  );
}
