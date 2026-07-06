/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PhysicsParams {
  plateLength: number;      // a (m)
  plateWidth: number;       // b (m)
  plateThickness: number;   // c (m)
  plateMass: number;        // M (kg)
  numRotations: number;     // n
  observationTime: number;  // t (seconds)
  userInitialSpeed: number; // Initial speed input (0 = auto)
  frictionCoeff: number;    // mu (0 to 0.2)
  speedMultiplier: number;  // 0.5, 1, 2
  autoStop: boolean;        // Whether to stop after target rotations
  loadMass: number;         // m (kg)
  shaftRadius: number;      // r (m)
  fallHeight: number;       // h (m)
}

export interface PhysicsResults {
  volume: number;           // m^3
  density: number;          // kg/m^3
  inertiaXX: number;        // kg*m^2
  inertiaYY: number;        // kg*m^2
  inertiaZZ: number;        // kg*m^2
  inertiaDiag: number;      // kg*m^2
  omega0: number;           // rad/s (initial angular velocity)
  currentOmega: number;     // rad/s (current angular velocity)
  currentAngle: number;     // radians
  currentL: number;         // kg*m^2/s (angular momentum)
  currentEk: number;        // J (kinetic energy, Joules)
  acceleration: number;     // a (m/s^2)
  tension: number;          // T (N)
  torque: number;           // tau (N*m)
  angularAcceleration: number; // alpha (rad/s^2)
  inertiaExperiment: number; // I_exp (kg*m^2)
  tFall: number;            // seconds
  currentY: number;         // m (current vertical position)
  isFalling: boolean;       // is it currently falling
  currentV: number;         // m/s (instantaneous linear velocity of spool/string)
  currentVTepi: number;     // m/s (instantaneous linear velocity at the corner of the plate)
}

export interface ChartDataPoint {
  time: number;             // seconds
  omega: number;            // rad/s
  ek: number;               // Joules (J)
}

export interface TheoryPracticeRow {
  parameter: string;
  unit: string;
  theory: number;
  experiment: number;
  description: string;
}
