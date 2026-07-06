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
  Hash,
  X,
  Calculator
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  PhysicsParams,
  PhysicsResults,
  ChartDataPoint,
  TheoryPracticeRow
} from "./types";
import Physics3DCanvas from "./components/Physics3DCanvas";
import QuickChart from "./components/QuickChart";

const formatPhysicsValue = (val: number): string => {
  const absVal = Math.abs(val);
  if (absVal === 0) return "0.0000";
  if (absVal >= 0.001) {
    return val.toFixed(4);
  } else {
    const str = val.toExponential(4);
    const parts = str.split("e");
    const mantissa = parseFloat(parts[0]).toFixed(4);
    const exponent = parseInt(parts[1], 10);
    
    const supChars: { [key: string]: string } = {
      "-": "⁻",
      "+": "⁺",
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹",
    };
    
    const supExponent = exponent.toString().split("").map(char => supChars[char] || char).join("");
    return `${mantissa} ×10${supExponent}`;
  }
};

export default function App() {
  // 1. INPUT PARAMETER STATES (with real-world laboratory defaults in SI units)
  const [plateLength, setPlateLength] = useState<number>(0.10); // a (m)
  const [plateWidth, setPlateWidth] = useState<number>(0.10);  // b (m)
  const [plateThickness, setPlateThickness] = useState<number>(0.012); // c (m)
  const [plateMass, setPlateMass] = useState<number>(0.070);    // M (kg)
  const [numRotations, setNumRotations] = useState<number>(3); // n (Jumlah Putaran)
  const [observationTime, setObservationTime] = useState<number>(1.50); // t (Waktu Pengukuran, default 1.50 s)
  const [userInitialSpeed, setUserInitialSpeed] = useState<number>(0); // 0 = automatic (compat)
  const [frictionCoeff, setFrictionCoeff] = useState<number>(0.02); // Damping factor
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1); // Animation speed
  const [autoStop, setAutoStop] = useState<boolean>(true); // Stop on target rotations
  const [activeFormulaKey, setActiveFormulaKey] = useState<string | null>(null); // Interactive formula popup key

  // NEW PARAMETERS REQUESTED BY THE USER IN SI UNITS
  const [loadMass, setLoadMass] = useState<number>(0.060); // m (kg) - Default 0.060kg, slider 0.010 - 0.500kg
  const [shaftRadius, setShaftRadius] = useState<number>(0.005); // r (m) - Default 0.005m
  const [fallHeight, setFallHeight] = useState<number>(0.80); // h (m) - Default 0.80m

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
    const volume = plateLength * plateWidth * plateThickness; // m³
    // 2. Density
    const density = plateMass / (volume || 1); // kg/m³

    // 3. Inertia Tensor (diagonal elements in kg*m²)
    const inertiaXX = (plateMass * (plateWidth ** 2)) / 12;
    const inertiaYY = (plateMass * (plateWidth ** 2)) / 12;
    const inertiaZZ = (2 / 3) * plateMass * (plateLength ** 2);

    // 4. Moment of inertia about diagonal axis OP (kg*m²)
    // Formula requested by user: I_OP = M * (a² + b²) / 12
    const inertiaDiag = (plateMass * (plateLength ** 2 + plateThickness ** 2)) / 12;

    // Damping constant (beta) scaled from friction coefficient
    const beta = Math.max(0.001, frictionCoeff) * 1.5;

    // PHYSICAL CONSTANTS & EQUATIONS
    const g = 9.80665; // Gravity acceleration in m/s² (SI)
    const m = loadMass;
    const r = shaftRadius;
    const h = fallHeight;

    // Linear acceleration of descending load: a = (m * g * r²) / (I_OP + m * r²)
    const acceleration = (m * g * (r ** 2)) / (inertiaDiag + m * (r ** 2));

    // Fall time: t_fall = sqrt(2h / a)
    const tFall = Math.sqrt((2 * h) / (acceleration || 1));

    // Tension in the string during fall: T = m(g - a)
    const tension = m * (g - acceleration);

    // Torque on shaft: tau = T * r
    const torque = tension * r;

    // Angular acceleration: alpha = a / r
    const angularAcceleration = acceleration / r;

    // Experimental moment of inertia derived from standard formula: I = mr²((g - a)/a)
    const inertiaExperiment = m * (r ** 2) * ((g - acceleration) / (acceleration || 1));

    return {
      volume,
      density,
      inertiaXX,
      inertiaYY,
      inertiaZZ,
      inertiaDiag,
      beta,
      acceleration,
      tFall,
      tension,
      torque,
      angularAcceleration,
      inertiaExperiment,
    };
  }, [plateLength, plateWidth, plateThickness, plateMass, frictionCoeff, loadMass, shaftRadius, fallHeight]);

  // Assemble dynamic values for rendering and results panel
  const results: PhysicsResults = useMemo(() => {
    const inertiaDiag = calculatedStatic.inertiaDiag;
    const isFalling = simElapsedTime <= calculatedStatic.tFall && isPlaying;
    
    // Dynamic values
    const currentL = inertiaDiag * currentOmega; // kg*m²/s
    const currentEk = 0.5 * inertiaDiag * (currentOmega ** 2); // Joules (J)

    // Dynamic vertical position of the falling mass, acceleration, tension, torque, and angular acceleration
    let currentY = 0;
    let dynamicAcc = 0;
    let dynamicTension = 0;
    let dynamicTorque = 0;
    let dynamicAlpha = 0;

    if (simElapsedTime <= calculatedStatic.tFall) {
      currentY = -0.5 * calculatedStatic.acceleration * (simElapsedTime ** 2);
      dynamicAcc = calculatedStatic.acceleration;
      dynamicTension = calculatedStatic.tension;
      dynamicTorque = calculatedStatic.torque;
      dynamicAlpha = calculatedStatic.angularAcceleration;
    } else {
      currentY = -fallHeight;
      dynamicAcc = 0;
      dynamicTension = 0;
      dynamicTorque = 0;
      dynamicAlpha = -calculatedStatic.beta * currentOmega;
    }

    return {
      volume: calculatedStatic.volume,
      density: calculatedStatic.density,
      inertiaXX: calculatedStatic.inertiaXX,
      inertiaYY: calculatedStatic.inertiaYY,
      inertiaZZ: calculatedStatic.inertiaZZ,
      inertiaDiag: inertiaDiag,
      omega0: 0, // Starts from rest
      currentOmega: currentOmega,
      currentAngle: currentAngle,
      currentL: currentL,
      currentEk: currentEk,
      acceleration: dynamicAcc,
      tension: dynamicTension,
      torque: dynamicTorque,
      angularAcceleration: dynamicAlpha,
      inertiaExperiment: calculatedStatic.inertiaExperiment,
      tFall: calculatedStatic.tFall,
      currentY: currentY,
      isFalling: isFalling,
      currentV: currentOmega * shaftRadius,
      currentVTepi: currentOmega * (Math.sqrt(plateLength ** 2 + plateWidth ** 2) / 2),
    };
  }, [calculatedStatic, currentOmega, currentAngle, simElapsedTime, isPlaying, fallHeight, shaftRadius, plateLength, plateWidth]);

  // 2b. CALCULATED ROTATION MEASUREMENTS ("PENGUKURAN ROTASI")
  const rotationMeasurements = useMemo(() => {
    const n = numRotations;
    const t = observationTime;
    
    const T = n > 0 ? t / n : 0; // Periode (s)
    const f = t > 0 ? n / t : 0; // Frekuensi (Hz)
    const omega = 2 * Math.PI * f; // Kecepatan Sudut (rad/s)
    
    const I_teori = calculatedStatic.inertiaDiag;
    const I_eksperimen = results.inertiaExperiment;
    
    // L = I * omega
    const L_teori = I_teori * omega;
    const L_eksperimen = I_eksperimen * omega;
    
    // Ek = 0.5 * I * omega^2
    const Ek_teori = 0.5 * I_teori * (omega ** 2);
    const Ek_eksperimen = 0.5 * I_eksperimen * (omega ** 2);

    const plateRadius = Math.sqrt(plateLength ** 2 + plateWidth ** 2) / 2;
    const v_poros = omega * shaftRadius;
    const v_tepi = omega * plateRadius;
    
    return {
      n,
      t,
      T,
      f,
      omega,
      L_teori,
      L_eksperimen,
      Ek_teori,
      Ek_eksperimen,
      v_poros,
      v_tepi,
    };
  }, [numRotations, observationTime, calculatedStatic.inertiaDiag, results.inertiaExperiment, shaftRadius, plateLength, plateWidth]);
  const formulaDetails = useMemo(() => {
    if (!activeFormulaKey) return null;

    const a_dim = plateLength;      // a (Panjang)
    const b_dim = plateThickness;   // b (Tebal)
    const c_dim = plateWidth;       // c (Panjang)
    const M_mass = plateMass;
    const V_vol = results.volume;
    const rho_dens = results.density;
    const Ixx_val = results.inertiaXX;
    const Iyy_val = results.inertiaYY;
    const Izz_val = results.inertiaZZ;
    const Iop_val = results.inertiaDiag;
    const omega_val = results.currentOmega;
    const L_val = results.currentL;
    const Ek_val = results.currentEk;

    const m_load = loadMass;
    const r_shaft = shaftRadius;
    const h_fall = fallHeight;
    const g_const = 9.80665;

    const details: Record<
      string,
      {
        title: string;
        symbol: string;
        unit: string;
        generalFormula: string;
        description: string;
        variables: { label: string; val: string; desc: string }[];
        steps: string[];
        resultText: string;
      }
    > = {
      volume: {
        title: "Volume Plat Persegi Panjang",
        symbol: "V",
        unit: "m³",
        generalFormula: "V = a × b × c",
        description:
          "Volume merepresentasikan besarnya ruang tiga dimensi yang diisi oleh plat persegi panjang tebal.",
        variables: [
          { label: "a (Panjang)", val: `${a_dim.toFixed(3)} m`, desc: "Panjang plat (a)" },
          { label: "b (Tebal)", val: `${b_dim.toFixed(3)} m`, desc: "Tebal plat (b)" },
          { label: "c (Panjang)", val: `${c_dim.toFixed(3)} m`, desc: "Panjang plat (c)" },
        ],
        steps: [
          `V = a × b × c`,
          `V = ${a_dim.toFixed(3)} × ${b_dim.toFixed(3)} × ${c_dim.toFixed(3)}`,
          `V = ${(a_dim * b_dim).toExponential(4)} × ${c_dim.toFixed(3)}`,
          `V = ${V_vol.toExponential(4)} m³`
        ],
        resultText: `${V_vol.toExponential(4)} m³`,
      },
      density: {
        title: "Massa Jenis (Densitas)",
        symbol: "ρ",
        unit: "kg/m³",
        generalFormula: "ρ = M / V",
        description:
          "Massa jenis mengukur kerapatan massa per satuan volume benda. Nilai homogenitas diasumsikan merata di seluruh plat.",
        variables: [
          { label: "M (Massa)", val: `${M_mass.toFixed(3)} kg`, desc: "Massa total plat" },
          { label: "V (Volume)", val: `${V_vol.toExponential(4)} m³`, desc: "Volume total plat" },
        ],
        steps: [
          `ρ = M / V`,
          `ρ = ${M_mass.toFixed(3)} / ${V_vol.toExponential(4)}`,
          `ρ = ${rho_dens.toFixed(2)} kg/m³`
        ],
        resultText: `${rho_dens.toFixed(2)} kg/m³`,
      },
      inertiaXX: {
        title: "Momen Inersia Sumbu-X",
        symbol: "I_xx",
        unit: "kg·m²",
        generalFormula: "I_xx = M * (c² / 12)",
        description:
          "Ukuran kelembaman rotasi plat ketika diputar mengelilingi sumbu-X yang melintasi pusat massa.",
        variables: [
          { label: "M (Massa)", val: `${M_mass.toFixed(3)} kg`, desc: "Massa total plat" },
          { label: "c (Panjang)", val: `${c_dim.toFixed(3)} m`, desc: "Panjang plat (c)" },
        ],
        steps: [
          `I_xx = M × (c² / 12)`,
          `I_xx = ${M_mass.toFixed(3)} × (${c_dim.toFixed(3)}² / 12)`,
          `I_xx = ${M_mass.toFixed(3)} × (${(c_dim**2).toFixed(6)} / 12)`,
          `I_xx = ${M_mass.toFixed(3)} × ${((c_dim**2)/12).toExponential(4)}`,
          `I_xx = ${Ixx_val.toExponential(4)} kg·m²`
        ],
        resultText: `${Ixx_val.toExponential(4)} kg·m²`,
      },
      inertiaYY: {
        title: "Momen Inersia Sumbu-Y",
        symbol: "I_yy",
        unit: "kg·m²",
        generalFormula: "I_yy = M * (c² / 12)",
        description:
          "Ukuran kelembaman rotasi plat ketika diputar mengelilingi sumbu-Y yang melintasi pusat massa.",
        variables: [
          { label: "M (Massa)", val: `${M_mass.toFixed(3)} kg`, desc: "Massa total plat" },
          { label: "c (Panjang)", val: `${c_dim.toFixed(3)} m`, desc: "Panjang plat (c)" },
        ],
        steps: [
          `I_yy = M × (c² / 12)`,
          `I_yy = ${M_mass.toFixed(3)} × (${c_dim.toFixed(3)}² / 12)`,
          `I_yy = ${M_mass.toFixed(3)} × (${(c_dim**2).toFixed(6)} / 12)`,
          `I_yy = ${M_mass.toFixed(3)} × ${((c_dim**2)/12).toExponential(4)}`,
          `I_yy = ${Iyy_val.toExponential(4)} kg·m²`
        ],
        resultText: `${Iyy_val.toExponential(4)} kg·m²`,
      },
      inertiaZZ: {
        title: "Momen Inersia Sumbu-Z",
        symbol: "I_zz",
        unit: "kg·m²",
        generalFormula: "I_zz = (2/3) * M * a²",
        description:
          "Momen inersia terhadap sumbu tegak lurus bidang plat (sumbu-Z) yang melalui pusat geometri plat.",
        variables: [
          { label: "M (Massa)", val: `${M_mass.toFixed(3)} kg`, desc: "Massa total plat" },
          { label: "a (Panjang)", val: `${a_dim.toFixed(3)} m`, desc: "Panjang plat (a)" },
        ],
        steps: [
          `I_zz = (2/3) × M × a²`,
          `I_zz = (2/3) × ${M_mass.toFixed(3)} × ${a_dim.toFixed(3)}²`,
          `I_zz = 0.667 × ${M_mass.toFixed(3)} × ${(a_dim**2).toFixed(6)}`,
          `I_zz = ${(2/3 * M_mass).toFixed(5)} × ${(a_dim**2).toFixed(6)}`,
          `I_zz = ${Izz_val.toExponential(4)} kg·m²`
        ],
        resultText: `${Izz_val.toExponential(4)} kg·m²`,
      },
      inertiaDiag: {
        title: "Momen Inersia Sumbu Diagonal OP",
        symbol: "I_OP",
        unit: "kg·m²",
        generalFormula: "I_OP = M * (a² + b²) / 12",
        description:
          "Momen inersia plat terhadap sumbu diagonal OP yang menghubungkan sudut O ke sudut P, dihitung menggunakan formula I_OP = M * (a² + b²) / 12.",
        variables: [
          { label: "M (Massa)", val: `${M_mass.toFixed(3)} kg`, desc: "Massa total plat" },
          { label: "a (Panjang)", val: `${a_dim.toFixed(3)} m`, desc: "Panjang plat (a)" },
          { label: "b (Tebal)", val: `${b_dim.toFixed(3)} m`, desc: "Tebal plat (b)" },
        ],
        steps: [
          `I_OP = M × (a² + b²) / 12`,
          `I_OP = ${M_mass.toFixed(3)} × (${a_dim.toFixed(3)}² + ${b_dim.toFixed(3)}²) / 12`,
          `I_OP = ${M_mass.toFixed(3)} × (${(a_dim**2).toFixed(6)} + ${(b_dim**2).toFixed(6)}) / 12`,
          `I_OP = ${M_mass.toFixed(3)} × ${(a_dim**2 + b_dim**2).toFixed(6)} / 12`,
          `I_OP = ${(M_mass * (a_dim**2 + b_dim**2)).toExponential(4)} / 12`,
          `I_OP = ${Iop_val.toExponential(4)} kg·m²`
        ],
        resultText: `${Iop_val.toExponential(4)} kg·m²`,
      },
      currentL: {
        title: "Momentum Sudut (L)",
        symbol: "L",
        unit: "kg·m²/s",
        generalFormula: "L = I_OP * ω",
        description:
          "Momentum sudut rotasi menggambarkan kuantitas gerak melingkar benda. Nilainya bertambah seiring tarikan tali, dan berkurang seiring meluruhnya kecepatan sudut akibat gesekan poros.",
        variables: [
          { label: "I_OP (Inersia OP)", val: `${Iop_val.toExponential(4)} kg·m²`, desc: "Momen inersia sumbu diagonal" },
          { label: "ω (Kecepatan Sudut)", val: `${omega_val.toFixed(3)} rad/s`, desc: "Kecepatan sudut saat ini" },
        ],
        steps: [
          `L = I_OP × ω`,
          `L = ${Iop_val.toExponential(4)} × ${omega_val.toFixed(3)}`,
          `L = ${L_val.toExponential(4)} kg·m²/s`
        ],
        resultText: `${L_val.toExponential(4)} kg·m²/s`,
      },
      currentEk: {
        title: "Energi Kinetik Rotasi (Ek)",
        symbol: "E_k",
        unit: "J",
        generalFormula: "E_k = (1/2) * I_OP * ω²",
        description:
          "Energi kinetik rotasi yang tersimpan dalam sistem akibat putaran plat kayu. Energi kinetik bertambah selama penarikan beban dan melambat perlahan akibat gesekan.",
        variables: [
          { label: "I_OP (Inersia OP)", val: `${Iop_val.toExponential(4)} kg·m²`, desc: "Momen inersia sumbu diagonal" },
          { label: "ω (Kecepatan Sudut)", val: `${omega_val.toFixed(3)} rad/s`, desc: "Kecepatan sudut saat ini" },
        ],
        steps: [
          `E_k = (1/2) × I_OP × ω²`,
          `E_k = 0.5 × ${Iop_val.toExponential(4)} × (${omega_val.toFixed(3)})²`,
          `E_k = ${(0.5 * Iop_val).toExponential(4)} × ${(omega_val ** 2).toFixed(5)}`,
          `E_k = ${Ek_val.toExponential(4)} J (≈ ${(Ek_val * 1000).toFixed(2)} mJ)`
        ],
        resultText: `${Ek_val.toExponential(4)} J`,
      },
      acceleration: {
        title: "Percepatan Linear Beban Jatuh (a)",
        symbol: "a",
        unit: "m/s²",
        generalFormula: "a = (m * g * r²) / (I_OP + m * r²)",
        description: "Percepatan linier turunnya beban vertikal karena tarikan gravitasi bumi g, dikurangi kelembaman rotasi dari piringan/plat kayu.",
        variables: [
          { label: "m (Massa Beban)", val: `${m_load.toFixed(3)} kg`, desc: "Massa beban gantung" },
          { label: "g (Gravitasi)", val: `${g_const.toFixed(5)} m/s²`, desc: "Percepatan gravitasi bumi" },
          { label: "r (Radius Poros)", val: `${r_shaft.toFixed(4)} m`, desc: "Jari-jari poros silinder lilitan" },
          { label: "I_OP (Inersia OP)", val: `${Iop_val.toExponential(4)} kg·m²`, desc: "Momen inersia sumbu diagonal" }
        ],
        steps: [
          `a = (m × g × r²) / (I_OP + m × r²)`,
          `a = (${m_load.toFixed(3)} × ${g_const.toFixed(5)} × ${r_shaft.toFixed(4)}²) / (${Iop_val.toExponential(4)} + ${m_load.toFixed(3)} × ${r_shaft.toFixed(4)}²)`,
          `a = (${(m_load * g_const).toFixed(4)} × ${(r_shaft**2).toExponential(4)}) / (${Iop_val.toExponential(4)} + ${(m_load * (r_shaft**2)).toExponential(4)})`,
          `a = ${(m_load * g_const * (r_shaft**2)).toExponential(4)} / ${(Iop_val + m_load * (r_shaft**2)).toExponential(4)}`,
          `a = ${results.acceleration.toFixed(4)} m/s²`
        ],
        resultText: `${results.acceleration.toFixed(4)} m/s²`
      },
      accelerationExperiment: {
        title: "Percepatan Linear Eksperimen (a_eksp)",
        symbol: "a_eksp",
        unit: "m/s²",
        generalFormula: "a_eksp = 2 * h / t²",
        description: "Percepatan linear beban gantung yang dihitung berdasarkan hasil pengukuran eksperimental jarak jatuh h dan waktu jatuh t hasil stopwatch di bawah kondisi ideal.",
        variables: [
          { label: "h (Tinggi Jatuh)", val: `${h_fall.toFixed(2)} m`, desc: "Tinggi jatuh vertikal beban" },
          { label: "t (Waktu Jatuh)", val: `${calculatedStatic.tFall.toFixed(4)} s`, desc: "Waktu jatuh dari stopwatch ideal" }
        ],
        steps: [
          `a_eksp = 2 × h / t²`,
          `a_eksp = 2 × ${h_fall.toFixed(2)} / (${calculatedStatic.tFall.toFixed(4)})²`,
          `a_eksp = ${(2 * h_fall).toFixed(3)} / ${(calculatedStatic.tFall ** 2).toFixed(5)}`,
          `a_eksp = ${((2 * h_fall) / (calculatedStatic.tFall ** 2)).toFixed(4)} m/s²`
        ],
        resultText: `${((2 * h_fall) / (calculatedStatic.tFall ** 2)).toFixed(4)} m/s²`
      },
      tension: {
        title: "Tegangan Tali Beban (T)",
        symbol: "T",
        unit: "N",
        generalFormula: "T = m * (g - a)",
        description: "Tegangan pada tali akibat beban gantung. Nilainya lebih kecil dari gaya berat m*g karena beban sedang dipercepat ke bawah.",
        variables: [
          { label: "m (Massa Beban)", val: `${m_load.toFixed(3)} kg`, desc: "Massa beban gantung" },
          { label: "g (Gravitasi)", val: `${g_const.toFixed(5)} m/s²`, desc: "Percepatan gravitasi bumi" },
          { label: "a (Percepatan)", val: `${results.acceleration.toFixed(4)} m/s²`, desc: "Percepatan beban jatuh" }
        ],
        steps: [
          `T = m × (g - a)`,
          `T = ${m_load.toFixed(3)} × (${g_const.toFixed(5)} - ${results.acceleration.toFixed(4)})`,
          `T = ${m_load.toFixed(3)} × ${(g_const - results.acceleration).toFixed(4)}`,
          `T = ${results.tension.toFixed(4)} N`
        ],
        resultText: `${results.tension.toFixed(4)} N`
      },
      torque: {
        title: "Torsi Putar pada Poros (τ)",
        symbol: "τ",
        unit: "N·m",
        generalFormula: "τ = T * r",
        description: "Momen gaya (torsi) yang dihasilkan oleh tegangan tali pada silinder poros kecil beradius r. Torsi ini yang mempercepat rotasi plat.",
        variables: [
          { label: "T (Tegangan Tali)", val: `${results.tension.toFixed(4)} N`, desc: "Gaya tegangan tali" },
          { label: "r (Radius Poros)", val: `${r_shaft.toFixed(4)} m`, desc: "Jari-jari poros silinder" }
        ],
        steps: [
          `τ = T × r`,
          `τ = ${results.tension.toFixed(4)} × ${r_shaft.toFixed(4)}`,
          `τ = ${results.torque.toExponential(4)} N·m`
        ],
        resultText: `${results.torque.toExponential(4)} N·m`
      },
      angularAcceleration: {
        title: "Percepatan Sudut Rotasi (α)",
        symbol: "α",
        unit: "rad/s²",
        generalFormula: "α = a / r",
        description: "Percepatan sudut rotasi sistem. Hubungan langsung kinematika rotasi karena tali tergulung tanpa slip pada poros silinder.",
        variables: [
          { label: "a (Percepatan)", val: `${results.acceleration.toFixed(4)} m/s²`, desc: "Percepatan linear beban" },
          { label: "r (Radius Poros)", val: `${r_shaft.toFixed(4)} m`, desc: "Jari-jari poros silinder lilitan" }
        ],
        steps: [
          `α = a / r`,
          `α = ${results.acceleration.toFixed(4)} / ${r_shaft.toFixed(4)}`,
          `α = ${results.angularAcceleration.toFixed(2)} rad/s²`
        ],
        resultText: `${results.angularAcceleration.toFixed(2)} rad/s²`
      },
      inertiaExperiment: {
        title: "Momen Inersia Eksperimen Sumbu Diagonal",
        symbol: "I",
        unit: "kg·m²",
        generalFormula: "I = m * r² * [ (g - a) / a ]",
        description: "Momen inersia eksperimen yang diturunkan langsung dari percepatan linear beban. Percepatan ini di laboratorium dihitung dari waktu jatuh t dan tinggi h dengan rumus a = 2h/t².",
        variables: [
          { label: "m (Massa Beban)", val: `${m_load.toFixed(3)} kg`, desc: "Massa beban gantung" },
          { label: "r (Radius Poros)", val: `${r_shaft.toFixed(4)} m`, desc: "Radius poros" },
          { label: "g (Gravitasi)", val: `${g_const.toFixed(5)} m/s²`, desc: "Gravitasi bumi" },
          { label: "a (Percepatan)", val: `${results.acceleration.toFixed(4)} m/s²`, desc: "Percepatan linear beban" }
        ],
        steps: [
          `I = m × r² × [ (g - a) / a ]`,
          `I = ${m_load.toFixed(3)} × ${r_shaft.toFixed(4)}² × [ (${g_const.toFixed(5)} - ${results.acceleration.toFixed(4)}) / ${results.acceleration.toFixed(4)} ]`,
          `I = ${(m_load * (r_shaft**2)).toExponential(4)} × [ ${(g_const - results.acceleration).toFixed(4)} / ${results.acceleration.toFixed(4)} ]`,
          `I = ${(m_load * (r_shaft**2)).toExponential(4)} × ${( (g_const - results.acceleration) / results.acceleration ).toFixed(4)}`,
          `I = ${results.inertiaExperiment.toExponential(4)} kg·m²`
        ],
        resultText: `${results.inertiaExperiment.toExponential(4)} kg·m²`
      },
      currentV: {
        title: "Kecepatan Linear Beban / Sumbu (v)",
        symbol: "v",
        unit: "m/s",
        generalFormula: "v = ω * r",
        description: "Kecepatan linear dari beban jatuh (atau titik pada permukaan poros silinder beradius r). Diturunkan dari hubungan kinematika rotasi v = ω × r.",
        variables: [
          { label: "ω (Kecepatan Sudut)", val: `${omega_val.toFixed(4)} rad/s`, desc: "Kecepatan sudut saat ini" },
          { label: "r (Radius Poros)", val: `${r_shaft.toFixed(4)} m`, desc: "Jari-jari poros silinder" }
        ],
        steps: [
          `v = ω × r`,
          `v = ${omega_val.toFixed(4)} × ${r_shaft.toFixed(4)}`,
          `v = ${results.currentV.toFixed(4)} m/s`
        ],
        resultText: `${results.currentV.toFixed(4)} m/s`
      },
      currentVTepi: {
        title: "Kecepatan Linear Ujung Plat (v_tepi)",
        symbol: "v_tepi",
        unit: "m/s",
        generalFormula: "v_tepi = ω * R_diagonal",
        description: "Kecepatan linier pada ujung terluar (sudut O dan P) dari plat kayu berputar. Radius diagonal dihitung dengan R_diagonal = sqrt(a² + c²) / 2.",
        variables: [
          { label: "ω (Kecepatan Sudut)", val: `${omega_val.toFixed(4)} rad/s`, desc: "Kecepatan sudut saat ini" },
          { label: "a (Panjang Plat)", val: `${a_dim.toFixed(3)} m`, desc: "Panjang plat" },
          { label: "c (Lebar Plat)", val: `${c_dim.toFixed(3)} m`, desc: "Lebar plat" }
        ],
        steps: [
          `R_diagonal = sqrt(a² + c²) / 2`,
          `R_diagonal = sqrt(${a_dim.toFixed(3)}² + ${c_dim.toFixed(3)}²) / 2`,
          `R_diagonal = ${(Math.sqrt(a_dim**2 + c_dim**2)/2).toFixed(4)} m`,
          `v_tepi = ω × R_diagonal`,
          `v_tepi = ${omega_val.toFixed(4)} × ${(Math.sqrt(a_dim**2 + c_dim**2)/2).toFixed(4)}`,
          `v_tepi = ${results.currentVTepi.toFixed(3)} m/s`
        ],
        resultText: `${results.currentVTepi.toFixed(3)} m/s`
      }
    };

    return details[activeFormulaKey] || null;
  }, [activeFormulaKey, plateLength, plateWidth, plateThickness, plateMass, results, loadMass, shaftRadius, fallHeight]);

  // Initialize/Reset simulation speed on startup or parameter change
  const reinitializeSimulation = () => {
    setIsPlaying(false);
    angleRef.current = 0;
    omegaRef.current = 0; // Starts from rest!
    simElapsedTimeRef.current = 0;
    lastGraphTimeRef.current = 0;

    setCurrentAngle(0);
    setCurrentOmega(0);
    setSimElapsedTime(0);

    // Initial data point for graph
    setChartData([
      {
        time: 0,
        omega: 0,
        ek: 0,
      },
    ]);
  };

  // Re-run reinitialization whenever core parameters change
  useEffect(() => {
    reinitializeSimulation();
  }, [calculatedStatic.acceleration, calculatedStatic.inertiaDiag, fallHeight, shaftRadius]);

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

        const tFall = calculatedStatic.tFall;
        const beta = calculatedStatic.beta;
        const r = shaftRadius;
        const a = calculatedStatic.acceleration;

        let nextOmega = 0;
        let nextAngle = 0;

        if (simElapsedTimeRef.current <= tFall) {
          // Falling phase: exact constant linear/angular acceleration
          nextOmega = (a * simElapsedTimeRef.current) / r;
          nextAngle = 0.5 * (a / r) * (simElapsedTimeRef.current ** 2);
        } else {
          // Free rotation phase with viscous damping
          const tFree = simElapsedTimeRef.current - tFall;
          const omegaMax = (a * tFall) / r;
          const angleAtFall = 0.5 * (a / r) * (tFall ** 2);

          nextOmega = omegaMax * Math.exp(-beta * tFree);
          nextAngle = angleAtFall + (omegaMax / beta) * (1 - Math.exp(-beta * tFree));
        }

        // When omega gets below 0.01 rad/s and we are post-fall, stop the animation automatically
        if (simElapsedTimeRef.current > tFall && nextOmega < 0.01) {
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

        // Streaming data to graph history at structured 0.04s intervals
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
  }, [calculatedStatic, speedMultiplier, shaftRadius]);

  // 4. ACTION BUTTON HANDLERS
  const togglePlay = () => {
    if (currentOmega === 0 && simElapsedTime >= calculatedStatic.tFall) {
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
      if (simElapsedTime <= calculatedStatic.tFall) {
        return {
          text: "Beban Jatuh (Akse)",
          style: "bg-blue-50 text-blue-700 border-blue-100 animate-pulse",
        };
      } else {
        return {
          text: "Rotasi Bebas (Inersia)",
          style: "bg-emerald-50 text-emerald-700 border-emerald-100",
        };
      }
    } else {
      return {
        text: "Berhenti",
        style: "bg-slate-100 text-slate-600 border-slate-200",
      };
    }
  };

  const statusBadge = getStatusBadge();

  // 6. CALCULATE EXPERIMENT VS THEORY DATA
  const comparisonData: TheoryPracticeRow[] = useMemo(() => {
    const I_teori = calculatedStatic.inertiaDiag;
    const t_teori = calculatedStatic.tFall;
    const a_teori = calculatedStatic.acceleration;
    const v_teori = a_teori * t_teori;

    // Under ideal conditions, experimental values are identical to theoretical values
    const I_eksperimen = I_teori;
    const t_eksperimen = t_teori;
    const a_eksperimen = a_teori;
    const v_eksperimen = v_teori;

    return [
      {
        parameter: "Momen Inersia Sumbu Diagonal (I_OP)",
        unit: "kg·m²",
        theory: I_teori,
        experiment: I_eksperimen,
        description: "Inersia teoritis dari geometri plat vs inersia eksperimental yang dihitung dari waktu jatuh beban.",
      },
      {
        parameter: "Waktu Jatuh Beban (t)",
        unit: "detik",
        theory: t_teori,
        experiment: t_eksperimen,
        description: "Waktu tempuh ideal jatuh vertikal h vs pengukuran manual.",
      },
      {
        parameter: "Percepatan Linear Beban (a)",
        unit: "m/s²",
        theory: a_teori,
        experiment: a_eksperimen,
        description: "Percepatan konstan teoritis m*g*r²/(I+m*r²) vs hasil perhitungan eksperimen.",
      },
      {
        parameter: "Kecepatan Linear Akhir Beban (v_akhir)",
        unit: "m/s",
        theory: v_teori,
        experiment: v_eksperimen,
        description: "Kecepatan akhir beban gantung tepat saat mencapai lantai (v = a · t).",
      },
    ];
  }, [calculatedStatic]);

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
                Geometri Plat (m)
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <input
                    type="number"
                    step="0.01"
                    value={plateLength}
                    onChange={(e) => setPlateLength(Math.max(0.01, Math.min(0.50, parseFloat(e.target.value) || 0.01)))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-length"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Panjang (a)</span>
                </div>
                <div className="flex flex-col">
                  <input
                    type="number"
                    step="0.001"
                    value={plateThickness}
                    onChange={(e) => setPlateThickness(Math.max(0.001, Math.min(0.10, parseFloat(e.target.value) || 0.001)))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-thickness"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Tebal (b)</span>
                </div>
                <div className="flex flex-col">
                  <input
                    type="number"
                    step="0.01"
                    value={plateWidth}
                    onChange={(e) => setPlateWidth(Math.max(0.01, Math.min(0.50, parseFloat(e.target.value) || 0.01)))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center"
                    id="input-width"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 uppercase text-center font-semibold">Panjang (c)</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Massa Plat (kg)
              </label>
              <input
                type="number"
                step="0.001"
                value={plateMass}
                onChange={(e) => setPlateMass(Math.max(0.005, Math.min(2.0, parseFloat(e.target.value) || 0.005)))}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                id="input-mass"
              />
            </div>

            {/* Parameter Beban Panel */}
            <div className="space-y-4 border-t border-slate-100 pt-3" id="panel-beban">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Parameter Beban Gantung
              </h4>
              
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <span>Massa Beban (m)</span>
                  <span className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-sm">{loadMass.toFixed(3)} kg</span>
                </div>
                <input
                  type="range"
                  min="0.010"
                  max="0.500"
                  step="0.005"
                  value={loadMass}
                  onChange={(e) => setLoadMass(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 my-1"
                  id="input-load-mass"
                />
                <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                  <span>0.01 kg</span>
                  <span>0.25 kg</span>
                  <span>0.50 kg</span>
                </div>
              </div>

              {/* Realtime Gravitational Force */}
              <div className="bg-slate-50 border border-slate-100 p-2 rounded-lg flex items-center justify-between text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gaya Berat (F = m·g)</span>
                <span className="font-mono font-bold text-slate-700">
                  {(loadMass * 9.80665).toFixed(4)} N
                </span>
              </div>
            </div>

            {/* Parameter Poros & Lintasan Panel */}
            <div className="space-y-3 border-t border-slate-100 pt-3" id="panel-poros">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Parameter Poros & Lintasan
              </h4>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <span>Jari-jari Poros (r)</span>
                  <span className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-sm">{shaftRadius.toFixed(4)} m</span>
                </div>
                <input
                  type="range"
                  min="0.002"
                  max="0.020"
                  step="0.0005"
                  value={shaftRadius}
                  onChange={(e) => setShaftRadius(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 my-1"
                  id="input-shaft-radius"
                />
                <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                  <span>0.002 m</span>
                  <span>0.011 m</span>
                  <span>0.020 m</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <span>Tinggi Jatuh Beban (h)</span>
                  <span className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-sm">{fallHeight.toFixed(2)} m</span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="2.00"
                  step="0.05"
                  value={fallHeight}
                  onChange={(e) => setFallHeight(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 my-1"
                  id="input-fall-height"
                />
                <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                  <span>0.10 m</span>
                  <span>1.05 m</span>
                  <span>2.00 m</span>
                </div>
              </div>
            </div>

            {/* Friction Coeff */}
            <div className="space-y-1 border-t border-slate-100 pt-3">
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
                <span>0.00 (Tanpa Gesek)</span>
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

          {/* PANEL INPUT: PENGUKURAN ROTASI */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
              <span>PENGUKURAN ROTASI</span>
            </h3>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between">
                  <span>Jumlah Putaran (n)</span>
                  <span className="text-blue-600 font-mono text-[9px] lowercase font-normal">putaran</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={numRotations}
                  onChange={(e) => setNumRotations(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  id="input-rotations-n"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between">
                  <span>Waktu Pengukuran (t)</span>
                  <span className="text-blue-600 font-mono text-[9px] lowercase font-normal">detik</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={observationTime}
                  onChange={(e) => setObservationTime(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  id="input-time-t"
                />
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
          <div className="bg-slate-50 rounded-lg border border-slate-200/80 px-4 py-3.5 w-full max-w-[280px] font-mono text-xs text-slate-700 shadow-xs flex flex-col gap-2 select-none" id="realtime-status-card">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Sudut</span>
              <span className="font-bold text-slate-800 text-sm">
                {((currentAngle * 180) / Math.PI).toFixed(1)}°
              </span>
            </div>
            <div className="border-t border-slate-200/50"></div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Fase & Waktu</span>
              <span className="font-bold text-slate-800 text-sm">
                {simElapsedTime <= results.tFall ? (
                  <span className="text-blue-600">Jatuh: {simElapsedTime.toFixed(2)}s <span className="text-[10px] text-slate-400">/ {results.tFall.toFixed(2)}s</span></span>
                ) : (
                  <span className="text-emerald-600">Inersia: {simElapsedTime.toFixed(2)}s</span>
                )}
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
                autoStop,
                loadMass,
                shaftRadius,
                fallHeight
              }} results={results} />
            </div>
          </div>

          {/* Quick Stats Bar at the bottom of the Center Section */}
          <div className="mt-4 flex justify-between px-2 gap-2">
            <div 
              onClick={() => setActiveFormulaKey("volume")}
              className="text-center cursor-pointer group hover:bg-blue-50/40 border border-transparent hover:border-blue-100 transition-all p-2 rounded-lg flex-1"
              title="Klik untuk melihat rumus & langkah perhitungan"
            >
              <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1 group-hover:text-blue-500 transition-colors">
                Volume <HelpCircle className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
              </div>
              <div className="font-mono font-bold text-blue-600 text-base md:text-lg">
                {results.volume.toExponential(3)} <span className="text-[10px] font-normal text-slate-400">m³</span>
              </div>
            </div>
            <div 
              onClick={() => setActiveFormulaKey("density")}
              className="text-center border-x border-slate-100 px-4 flex-grow cursor-pointer group hover:bg-blue-50/40 hover:border-blue-100 transition-all p-2 rounded-lg flex-1"
              title="Klik untuk melihat rumus & langkah perhitungan"
            >
              <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1 group-hover:text-blue-500 transition-colors">
                Massa Jenis <HelpCircle className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
              </div>
              <div className="font-mono font-bold text-blue-600 text-base md:text-lg">
                {results.density.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">kg/m³</span>
              </div>
            </div>
            <div 
              onClick={() => setActiveFormulaKey("inertiaDiag")}
              className="text-center cursor-pointer group hover:bg-blue-50/40 border border-transparent hover:border-blue-100 transition-all p-2 rounded-lg flex-1"
              title="Klik untuk melihat rumus & langkah perhitungan"
            >
              <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1 group-hover:text-blue-500 transition-colors">
                I Diagonal <HelpCircle className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
              </div>
              <div className="font-mono font-bold text-blue-600 text-base md:text-lg">
                {results.inertiaDiag.toExponential(3)} <span className="text-[10px] font-normal text-slate-400">kg·m²</span>
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
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3 flex items-center justify-between">
              <span>Hasil Kalkulasi Realtime</span>
              <span className="text-[9px] bg-blue-50 text-blue-600 font-bold px-1.5 py-0.5 rounded uppercase">Click Row for Formula</span>
            </h3>

            <div className="space-y-2 text-xs">
              {/* Geometri & Massa Jenis */}
              <div className="grid grid-cols-2 gap-2">
                <div 
                  onClick={() => setActiveFormulaKey("volume")}
                  className="bg-slate-50 border border-slate-100 p-2 rounded-lg cursor-pointer group hover:bg-blue-50 hover:border-blue-200 transition-all text-center"
                  title="Klik untuk melihat rumus & langkah perhitungan Volume"
                >
                  <span className="text-slate-400 font-bold uppercase text-[9px] flex items-center justify-center gap-0.5 group-hover:text-blue-600">
                    Volume Plat <HelpCircle className="w-2.5 h-2.5 opacity-60" />
                  </span>
                  <span className="font-mono font-bold text-slate-700 text-xs block mt-0.5">{results.volume.toExponential(3)} m³</span>
                </div>
                <div 
                  onClick={() => setActiveFormulaKey("density")}
                  className="bg-slate-50 border border-slate-100 p-2 rounded-lg cursor-pointer group hover:bg-blue-50 hover:border-blue-200 transition-all text-center"
                  title="Klik untuk melihat rumus & langkah perhitungan Massa Jenis"
                >
                  <span className="text-slate-400 font-bold uppercase text-[9px] flex items-center justify-center gap-0.5 group-hover:text-blue-600">
                    Massa Jenis (ρ) <HelpCircle className="w-2.5 h-2.5 opacity-60" />
                  </span>
                  <span className="font-mono font-bold text-slate-700 text-xs block mt-0.5">{results.density.toFixed(1)} kg/m³</span>
                </div>
              </div>

              {/* Momen Inersia Utama */}
              <div className="grid grid-cols-3 gap-1.5 py-0.5 border-b border-slate-50 font-mono text-[10px]">
                <div 
                  onClick={() => setActiveFormulaKey("inertiaXX")}
                  className="flex flex-col bg-slate-50 p-1.5 rounded-md border border-slate-100/50 cursor-pointer group hover:bg-blue-50/50 hover:border-blue-200 transition-all text-center"
                  title="Klik untuk melihat rumus Ixx"
                >
                  <span className="text-slate-400 font-bold uppercase text-[9px] flex items-center justify-center gap-0.5 group-hover:text-blue-600">
                    Ixx (kg·m²) <HelpCircle className="w-2 h-2 opacity-60" />
                  </span>
                  <span className="font-bold text-slate-700">{results.inertiaXX.toExponential(2)}</span>
                </div>
                <div 
                  onClick={() => setActiveFormulaKey("inertiaYY")}
                  className="flex flex-col bg-slate-50 p-1.5 rounded-md border border-slate-100/50 cursor-pointer group hover:bg-blue-50/50 hover:border-blue-200 transition-all text-center"
                  title="Klik untuk melihat rumus Iyy"
                >
                  <span className="text-slate-400 font-bold uppercase text-[9px] flex items-center justify-center gap-0.5 group-hover:text-blue-600">
                    Iyy (kg·m²) <HelpCircle className="w-2 h-2 opacity-60" />
                  </span>
                  <span className="font-bold text-slate-700">{results.inertiaYY.toExponential(2)}</span>
                </div>
                <div 
                  onClick={() => setActiveFormulaKey("inertiaZZ")}
                  className="flex flex-col bg-slate-50 p-1.5 rounded-md border border-slate-100/50 cursor-pointer group hover:bg-blue-50/50 hover:border-blue-200 transition-all text-center"
                  title="Klik untuk melihat rumus Izz"
                >
                  <span className="text-slate-400 font-bold uppercase text-[9px] flex items-center justify-center gap-0.5 group-hover:text-blue-600">
                    Izz (kg·m²) <HelpCircle className="w-2 h-2 opacity-60" />
                  </span>
                  <span className="font-bold text-slate-700">{results.inertiaZZ.toExponential(2)}</span>
                </div>
              </div>

              {/* Momen Inersia Sumbu Diagonal OP (Teoritis) */}
              <div 
                onClick={() => setActiveFormulaKey("inertiaDiag")}
                className="flex items-center justify-between py-1.5 border border-blue-100 bg-blue-50/40 px-2.5 rounded-lg my-1 cursor-pointer group hover:bg-blue-50 hover:border-blue-300 transition-all"
                title="Klik untuk melihat rumus & langkah perhitungan I Diagonal OP"
              >
                <span className="text-blue-700 font-bold uppercase text-[10px] flex items-center gap-1 group-hover:text-blue-800">
                  I Diagonal OP (Teori) <HelpCircle className="w-2.5 h-2.5 opacity-80 group-hover:opacity-100" />
                </span>
                <div className="text-right">
                  <span className="font-mono font-bold text-blue-800 block text-xs">{results.inertiaDiag.toExponential(3)} kg·m²</span>
                </div>
              </div>

              {/* Dinamika Rotasi Sumbu Utama */}
              <div className="border-t border-slate-100 pt-2 pb-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Kinematika & Dinamika Rotasi</span>
                
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-500 uppercase text-[9px] font-semibold">Kecepatan Sudut (ω)</span>
                    <span className="font-mono font-bold text-slate-700">{results.currentOmega.toFixed(3)} rad/s</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("currentL")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Momentum Sudut"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Momentum Sudut (L) <HelpCircle className="w-2 h-2 opacity-60" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.currentL.toExponential(3)} kg·m²/s</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("currentEk")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-indigo-600 font-medium group"
                    title="Klik untuk melihat rumus Energi Kinetik"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-indigo-600">
                      Energi Kinetik (Ek) <HelpCircle className="w-2 h-2 opacity-60" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-indigo-600">{results.currentEk.toExponential(3)} J</span>
                  </div>
                </div>
              </div>

              {/* Dinamika Beban Jatuh (Eksperimen) */}
              <div className="border-t border-slate-100 pt-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Eksperimen Beban Jatuh</span>
                
                <div className="space-y-1.5">
                  <div 
                    onClick={() => setActiveFormulaKey("acceleration")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Percepatan Linear Teori"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Percepatan Teori (a) <HelpCircle className="w-2 h-2 opacity-60" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.acceleration.toFixed(4)} m/s²</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("accelerationExperiment")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Percepatan Linear Eksperimen"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Percepatan Eksp (a_eksp) <HelpCircle className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                    </span>
                    <span className="font-mono font-bold text-emerald-600 group-hover:text-blue-600">
                      {((2 * fallHeight) / (calculatedStatic.tFall ** 2)).toFixed(4)} m/s²
                    </span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("currentV")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Kecepatan Linear Sumbu/Beban"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Kecepatan Linear Beban (v) <HelpCircle className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.currentV.toFixed(4)} m/s</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("currentVTepi")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Kecepatan Linear Ujung Plat"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Kecepatan Linear Ujung (v_tepi) <HelpCircle className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.currentVTepi.toFixed(3)} m/s</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("tension")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Tegangan Tali"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Tegangan Tali (T) <HelpCircle className="w-2 h-2 opacity-60" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.tension.toFixed(4)} N</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("torque")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Torsi"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Torsi Sumbu (τ) <HelpCircle className="w-2 h-2 opacity-60" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.torque.toExponential(3)} N·m</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("angularAcceleration")}
                    className="flex justify-between items-center py-0.5 cursor-pointer hover:text-blue-600 font-medium group"
                    title="Klik untuk melihat rumus Percepatan Sudut"
                  >
                    <span className="text-slate-500 uppercase text-[9px] font-semibold flex items-center gap-0.5 group-hover:text-blue-600">
                      Percepatan Sudut (α) <HelpCircle className="w-2 h-2 opacity-60" />
                    </span>
                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-600">{results.angularAcceleration.toFixed(3)} rad/s²</span>
                  </div>

                  <div 
                    onClick={() => setActiveFormulaKey("inertiaExperiment")}
                    className="flex items-center justify-between py-1.5 border border-emerald-100 bg-emerald-50/40 px-2.5 rounded-lg my-1 cursor-pointer group hover:bg-emerald-50 hover:border-emerald-300 transition-all"
                    title="Klik untuk melihat rumus & langkah perhitungan Momen Inersia Eksperimen"
                  >
                    <span className="text-emerald-700 font-bold uppercase text-[10px] flex items-center gap-1 group-hover:text-emerald-800">
                      I Eksperimen (I) <HelpCircle className="w-2.5 h-2.5 opacity-80 group-hover:opacity-100" />
                    </span>
                    <span className="font-mono font-bold text-emerald-800 block text-xs">{results.inertiaExperiment.toExponential(3)} kg·m²</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* PANEL HASIL: PENGUKURAN ROTASI */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm" id="rotation-measurement-results">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3 flex items-center justify-between">
              <span>Hasil Pengukuran Rotasi</span>
              <span className="text-[9px] bg-indigo-50 text-indigo-600 font-bold px-1.5 py-0.5 rounded uppercase font-sans">Kalkulasi Mandiri</span>
            </h3>
            
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 border border-slate-100/60 p-2 rounded-lg text-center">
                  <span className="text-slate-400 font-bold uppercase text-[9px] block">Jumlah Putaran (n)</span>
                  <span className="font-mono font-bold text-slate-700 text-xs block mt-0.5">{rotationMeasurements.n} putaran</span>
                </div>
                <div className="bg-slate-50 border border-slate-100/60 p-2 rounded-lg text-center">
                  <span className="text-slate-400 font-bold uppercase text-[9px] block">Waktu Ukur (t)</span>
                  <span className="font-mono font-bold text-slate-700 text-xs block mt-0.5">{rotationMeasurements.t.toFixed(2)} s</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 border border-slate-100/60 p-2 rounded-lg text-center">
                  <span className="text-slate-400 font-bold uppercase text-[9px] block">Periode (T)</span>
                  <span className="font-mono font-bold text-slate-700 text-xs block mt-0.5">{rotationMeasurements.T.toFixed(4)} s</span>
                </div>
                <div className="bg-slate-50 border border-slate-100/60 p-2 rounded-lg text-center">
                  <span className="text-slate-400 font-bold uppercase text-[9px] block">Frekuensi (f)</span>
                  <span className="font-mono font-bold text-slate-700 text-xs block mt-0.5">{rotationMeasurements.f.toFixed(2)} Hz</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg text-center">
                <span className="text-slate-400 font-bold uppercase text-[9px] block">Kecepatan Sudut (ω)</span>
                <span className="font-mono font-bold text-blue-600 text-sm block mt-0.5">{rotationMeasurements.omega.toFixed(4)} rad/s</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 border border-slate-100/60 p-2 rounded-lg text-center">
                  <span className="text-slate-400 font-bold uppercase text-[8px] block">v_sumbu (ω · r)</span>
                  <span className="font-mono font-bold text-indigo-600 text-[11px] block mt-0.5">{rotationMeasurements.v_poros.toFixed(4)} m/s</span>
                </div>
                <div className="bg-slate-50 border border-slate-100/60 p-2 rounded-lg text-center">
                  <span className="text-slate-400 font-bold uppercase text-[8px] block">v_tepi (ω · R)</span>
                  <span className="font-mono font-bold text-indigo-600 text-[11px] block mt-0.5">{rotationMeasurements.v_tepi.toFixed(3)} m/s</span>
                </div>
              </div>

              {/* Momentum Sudut & Energi Kinetik Table / Rows */}
              <div className="border-t border-slate-100 pt-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Besaran Dinamika Rotasi</span>
                
                <div className="space-y-2">
                  <div className="bg-blue-50/20 border border-blue-100/40 p-2.5 rounded-lg">
                    <span className="text-blue-700 font-bold uppercase text-[9px] block mb-1">Momentum Sudut (L = I · ω)</span>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                      <div>
                        <span className="text-slate-400 text-[8px] uppercase block">Teori</span>
                        <span className="font-bold text-slate-700 block mt-0.5">{rotationMeasurements.L_teori.toExponential(4)}<br/><span className="text-[8px] font-normal text-slate-400">kg·m²/s</span></span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[8px] uppercase block">Eksperimen</span>
                        <span className="font-bold text-emerald-700 block mt-0.5">{rotationMeasurements.L_eksperimen.toExponential(4)}<br/><span className="text-[8px] font-normal text-slate-400">kg·m²/s</span></span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-50/20 border border-indigo-100/40 p-2.5 rounded-lg">
                    <span className="text-indigo-700 font-bold uppercase text-[9px] block mb-1">Energi Kinetik Rotasi (Ek = ½ I · ω²)</span>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                      <div>
                        <span className="text-slate-400 text-[8px] uppercase block">Teori</span>
                        <span className="font-bold text-slate-700 block mt-0.5">{rotationMeasurements.Ek_teori.toExponential(4)}<br/><span className="text-[8px] font-normal text-slate-400">J</span></span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[8px] uppercase block">Eksperimen</span>
                        <span className="font-bold text-emerald-700 block mt-0.5">{rotationMeasurements.Ek_eksperimen.toExponential(4)}<br/><span className="text-[8px] font-normal text-slate-400">J</span></span>
                      </div>
                    </div>
                  </div>
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
                    <th className="py-2 px-2 font-semibold text-right">Nilai Eksperimen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-mono text-slate-600">
                  {comparisonData.map((row, idx) => (
                    <tr key={`comp-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 px-2 font-sans font-medium text-slate-700">{row.parameter}</td>
                      <td className="py-2.5 px-2 text-center text-slate-400">{row.unit}</td>
                      <td className="py-2.5 px-2 text-right text-slate-800 font-semibold">{formatPhysicsValue(row.theory)}</td>
                      <td className="py-2.5 px-2 text-right text-slate-800 font-semibold">{formatPhysicsValue(row.experiment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-center justify-end gap-3 pt-2 border-t border-slate-50">
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
                Ketika sebuah plat persegi berputar terhadap sumbu diagonalnya, arah kecepatan sudut omega (ω) berhimpit dengan diagonal <strong>OP</strong>.
              </p>
              <p>
                Momen inersia plat terhadap diagonal utama dihitung menggunakan formula:
              </p>
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 font-mono text-[10px] text-slate-600 leading-normal flex flex-col gap-1">
                <div className="font-bold text-blue-800 text-[9px] uppercase tracking-wider">Formula Momen Inersia:</div>
                <div className="text-slate-800 font-semibold">{"I_OP = M * (a² + b²) / 12"}</div>
              </div>
              <p>
                Dimana a adalah panjang plat, b adalah lebar plat, dan M adalah massa benda. Formula ini merepresentasikan kontribusi inersia terhadap sumbu diagonal utama secara langsung dari dimensi bidang plat.
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

      {/* FORMULA & CALCULATION DETAIL MODAL */}
      <AnimatePresence>
        {activeFormulaKey && formulaDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop with fade-in */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveFormulaKey(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm cursor-pointer"
            />

            {/* Modal Body with scale-up & fade-in */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden relative z-10 flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/10 p-2 rounded-lg backdrop-blur-md">
                    <Calculator className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[10px] tracking-wider uppercase text-blue-100">Detail Perhitungan</h4>
                    <h3 className="text-base font-extrabold tracking-tight mt-0.5">{formulaDetails.title}</h3>
                  </div>
                </div>
                <button
                  onClick={() => setActiveFormulaKey(null)}
                  className="text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                  id="btn-close-modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content scrollable area */}
              <div className="p-6 overflow-y-auto space-y-5 text-slate-700 text-xs">
                
                {/* General Formula */}
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Rumus Umum</span>
                  <div className="bg-slate-900 text-slate-100 p-3.5 rounded-xl font-mono text-center font-bold text-xs md:text-sm border border-slate-800 shadow-inner flex flex-col gap-1 select-all">
                    <span className="text-blue-400 text-[10px] font-semibold">{formulaDetails.symbol} = ...</span>
                    <span>{formulaDetails.generalFormula}</span>
                  </div>
                </div>

                {/* Variable Values */}
                <div className="space-y-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Nilai Variabel Saat Ini</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {formulaDetails.variables.map((variable, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-2 rounded-lg">
                        <div className="bg-blue-100/60 text-blue-700 font-mono font-extrabold text-[9px] px-1.5 py-0.5 rounded-sm">
                          {variable.label}
                        </div>
                        <div className="flex-grow min-w-0">
                          <span className="font-mono font-bold text-slate-800 text-[11px] block truncate">{variable.val}</span>
                          <span className="text-[9px] text-slate-400 font-semibold block truncate">{variable.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step-by-Step Calculation */}
                <div className="space-y-2.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Langkah Kalkulasi Realtime</span>
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 font-mono text-[11px] text-slate-600 space-y-2 shadow-inner">
                    {formulaDetails.steps.map((step, idx) => {
                      const isLast = idx === formulaDetails.steps.length - 1;
                      return (
                        <div key={idx} className={`flex items-start gap-2 ${isLast ? "pt-1.5 border-t border-slate-200 mt-1.5" : ""}`}>
                          <span className="text-slate-300 font-semibold select-none">{idx + 1}.</span>
                          <div className="flex-grow">
                            <span className={isLast ? "text-blue-700 font-extrabold text-xs" : "text-slate-600 font-medium"}>
                              {step}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Physical Context Description */}
                <div className="bg-blue-50/50 border border-blue-100/70 p-3.5 rounded-xl flex gap-3">
                  <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-slate-500 leading-relaxed font-sans font-medium">
                    {formulaDetails.description}
                  </p>
                </div>

              </div>

              {/* Footer Actions */}
              <div className="border-t border-slate-100 p-4 bg-slate-50 flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Kalkulasi Dinamis Terkini
                </div>
                <button
                  onClick={() => setActiveFormulaKey(null)}
                  className="bg-slate-900 text-white font-bold text-xs py-2 px-5 rounded-lg hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
                >
                  Selesai
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
