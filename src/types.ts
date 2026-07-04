/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PhysicsParams {
  plateLength: number;      // a (cm)
  plateWidth: number;       // b (cm)
  plateThickness: number;   // c (cm)
  plateMass: number;        // M (gram)
  numRotations: number;     // n
  observationTime: number;  // t (seconds)
  userInitialSpeed: number; // Initial speed input (0 = auto)
  frictionCoeff: number;    // mu (0 to 0.2)
  speedMultiplier: number;  // 0.5, 1, 2
  autoStop: boolean;        // Whether to stop after target rotations
}

export interface PhysicsResults {
  volume: number;           // cm^3
  density: number;          // g/cm^3
  inertiaXX: number;        // g*cm^2
  inertiaYY: number;        // g*cm^2
  inertiaZZ: number;        // g*cm^2
  inertiaDiag: number;      // g*cm^2
  omega0: number;           // rad/s (initial angular velocity)
  currentOmega: number;     // rad/s (current angular velocity)
  currentAngle: number;     // radians
  currentL: number;         // g*cm^2/s (angular momentum)
  currentEk: number;        // erg (kinetic energy)
}

export interface ChartDataPoint {
  time: number;             // seconds
  omega: number;            // rad/s
  ek: number;               // milliJoules (mJ)
}

export interface TheoryPracticeRow {
  parameter: string;
  unit: string;
  theory: number;
  experiment: number;
  errorPercent: number;
  description: string;
}
