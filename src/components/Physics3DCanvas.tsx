/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { PhysicsParams, PhysicsResults } from "../types";

interface Physics3DCanvasProps {
  params: PhysicsParams;
  results: PhysicsResults;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface ProjectedPoint {
  screenX: number;
  screenY: number;
  depth: number;
}

interface RenderablePolygon {
  type: "polygon";
  depth: number;
  color: string;
  outlineColor?: string;
  points: ProjectedPoint[];
  // Grain lines specific to this face
  grainLines?: { p0: ProjectedPoint; p1: ProjectedPoint }[];
}

interface RenderableLine {
  type: "line";
  depth: number;
  p0: ProjectedPoint;
  p1: ProjectedPoint;
  color: string;
  width: number;
  dashed?: boolean;
}

interface RenderableMarker {
  type: "marker";
  depth: number;
  point: ProjectedPoint;
  label: string;
  color: string;
  subLabel?: string;
}

type SceneItem = RenderablePolygon | RenderableLine | RenderableMarker;

export default function Physics3DCanvas({ params, results }: Physics3DCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Camera Orbit Angles (Default isometric view angle)
  const [cameraYaw, setCameraYaw] = useState<number>(0.55); // Rotation around vertical Y
  const [cameraPitch, setCameraPitch] = useState<number>(0.25); // Rotation around horizontal X
  const isDragging = useRef<boolean>(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset Camera View
  const resetCamera = () => {
    setCameraYaw(0.55);
    setCameraPitch(0.25);
  };

  // Drag interaction to orbit the camera
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;

    // Adjust camera angles based on drag
    setCameraYaw((prev) => prev - dx * 0.007);
    setCameraPitch((prev) => Math.max(-0.6, Math.min(0.8, prev - dy * 0.007))); // Clamp pitch to avoid turning upside down

    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  // Projection math
  const projectPoint = (
    pt: Point3D,
    yaw: number,
    pitch: number,
    width: number,
    height: number
  ): ProjectedPoint => {
    // 1. Camera Yaw rotation (around Y axis)
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const x1 = pt.x * cosY - pt.z * sinY;
    const z1 = pt.x * sinY + pt.z * cosY;
    const y1 = pt.y;

    // 2. Camera Pitch rotation (around X axis)
    const cosX = Math.cos(pitch);
    const sinX = Math.sin(pitch);
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = y1 * sinX + z1 * cosX;
    const x2 = x1;

    // Perspective parameters
    const cameraDistance = 320;
    const zoomScale = 16.5; // Scales physical cm to pixels
    const factor = cameraDistance / (z2 + cameraDistance);

    const screenX = width / 2 + x2 * zoomScale * factor;
    const screenY = height / 2 - y2 * zoomScale * factor; // Invert Y for screen coords

    return { screenX, screenY, depth: z2 };
  };

  // Rigid body transformation for the rotating plate
  // 1. Align the local plate diagonal (from -a/2,-b/2 to +a/2,+b/2) along the world X axis
  // 2. Rotate around the world X axis by current angle theta
  const getPlateVertexInWorld = (
    lx: number,
    ly: number,
    lz: number,
    a: number,
    b: number,
    theta: number
  ): Point3D => {
    // Rotation around local Z-axis by -phi to align diagonal along local X axis
    const phi = Math.atan2(b, a);
    const cosP = Math.cos(-phi);
    const sinP = Math.sin(-phi);

    const rx = lx * cosP - ly * sinP;
    const ry = lx * sinP + ly * cosP;
    const rz = lz;

    // Rotate around world X axis (which is now the diagonal axis OP) by angle theta
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const wx = rx;
    const wy = ry * cosT - rz * sinT;
    const wz = ry * sinT + rz * cosT;

    return { x: wx, y: wy, z: wz };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Setup High DPI canvas backbuffer
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);

    // Active physics dimensions (converted from m to cm for rendering)
    const a = params.plateLength * 100;
    const b = params.plateWidth * 100;
    const c = params.plateThickness * 100;
    const theta = results.currentAngle;

    // Define diagonal length
    const d = Math.sqrt(a * a + b * b);

    // Render pipeline array
    const sceneQueue: SceneItem[] = [];

    // Lighting setup
    const lightSource: Point3D = { x: 0.4, y: 0.9, z: -0.3 };
    const lenL = Math.sqrt(lightSource.x ** 2 + lightSource.y ** 2 + lightSource.z ** 2);
    const L = { x: lightSource.x / lenL, y: lightSource.y / lenL, z: lightSource.z / lenL };

    const getLitColor = (baseR: number, baseG: number, baseB: number, normal: Point3D) => {
      const dot = normal.x * L.x + normal.y * L.y + normal.z * L.z;
      const intensity = 0.45 + 0.55 * Math.max(0, dot);
      return `rgb(${Math.round(baseR * intensity)}, ${Math.round(baseG * intensity)}, ${Math.round(baseB * intensity)})`;
    };

    // Helper to generate 3D cube faces (all faces with outward normal & camera space depth)
    const addCubeToScene = (
      W: number,
      H: number,
      D: number,
      centerX: number,
      centerY: number,
      centerZ: number,
      baseColor: { r: number; g: number; b: number },
      isWood: boolean
    ) => {
      // Cube vertices
      const localVerts: Point3D[] = [
        { x: -W / 2, y: -H / 2, z: -D / 2 },
        { x: W / 2, y: -H / 2, z: -D / 2 },
        { x: W / 2, y: H / 2, z: -D / 2 },
        { x: -W / 2, y: H / 2, z: -D / 2 },
        { x: -W / 2, y: -H / 2, z: D / 2 },
        { x: W / 2, y: -H / 2, z: D / 2 },
        { x: W / 2, y: H / 2, z: D / 2 },
        { x: -W / 2, y: H / 2, z: D / 2 },
      ];

      // Shift vertices to world center position
      const worldVerts = localVerts.map((v) => ({
        x: v.x + centerX,
        y: v.y + centerY,
        z: v.z + centerZ,
      }));

      // Map to screen
      const projected = worldVerts.map((v) => projectPoint(v, cameraYaw, cameraPitch, width, height));

      // Define 6 faces with CCW winding (outward normals)
      const faceDefs = [
        { indices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 }, name: "front" },   // Front (+Z)
        { indices: [1, 0, 3, 2], normal: { x: 0, y: 0, z: -1 }, name: "back" },  // Back (-Z)
        { indices: [7, 6, 2, 3], normal: { x: 0, y: 1, z: 0 }, name: "top" },   // Top (+Y)
        { indices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 }, name: "bottom" },// Bottom (-Y)
        { indices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 }, name: "right" },  // Right (+X)
        { indices: [4, 7, 3, 0], normal: { x: -1, y: 0, z: 0 }, name: "left" },  // Left (-X)
      ];

      faceDefs.forEach((face) => {
        // Compute average depth of face
        const faceProjected = face.indices.map((idx) => projected[idx]);
        const avgDepth = faceProjected.reduce((sum, p) => sum + p.depth, 0) / 4;

        // Lighting
        const color = getLitColor(baseColor.r, baseColor.g, baseColor.b, face.normal);

        // Optional static wood grains for base/pillars
        let grains: { p0: ProjectedPoint; p1: ProjectedPoint }[] | undefined;
        if (isWood) {
          grains = [];
          if (face.name === "front" || face.name === "back") {
            const zPlane = face.name === "front" ? D/2 : -D/2;
            const yOffsets = [-H / 3, -H / 12, H / 5, H / 2.5];
            yOffsets.forEach((yo) => {
              const gp0 = projectPoint({ x: -W / 2 + centerX, y: yo + centerY, z: zPlane + centerZ }, cameraYaw, cameraPitch, width, height);
              const gp1 = projectPoint({ x: W / 2 + centerX, y: yo + centerY, z: zPlane + centerZ }, cameraYaw, cameraPitch, width, height);
              grains?.push({ p0: gp0, p1: gp1 });
            });
          } else if (face.name === "top" || face.name === "bottom") {
            const yPlane = face.name === "top" ? H/2 : -H/2;
            const zOffsets = [-D / 3, -D / 12, D / 4, D / 2.5];
            zOffsets.forEach((zo) => {
              const gp0 = projectPoint({ x: -W / 2 + centerX, y: yPlane + centerY, z: zo + centerZ }, cameraYaw, cameraPitch, width, height);
              const gp1 = projectPoint({ x: W / 2 + centerX, y: yPlane + centerY, z: zo + centerZ }, cameraYaw, cameraPitch, width, height);
              grains?.push({ p0: gp0, p1: gp1 });
            });
          } else if (face.name === "left" || face.name === "right") {
            const xPlane = face.name === "right" ? W/2 : -W/2;
            const zOffsets = [-D / 3, -D / 12, D / 4, D / 2.5];
            zOffsets.forEach((zo) => {
              const gp0 = projectPoint({ x: xPlane + centerX, y: -H / 2 + centerY, z: zo + centerZ }, cameraYaw, cameraPitch, width, height);
              const gp1 = projectPoint({ x: xPlane + centerX, y: H / 2 + centerY, z: zo + centerZ }, cameraYaw, cameraPitch, width, height);
              grains?.push({ p0: gp0, p1: gp1 });
            });
          }
        }

        sceneQueue.push({
          type: "polygon",
          depth: avgDepth,
          color,
          points: faceProjected,
          grainLines: grains,
          outlineColor: `rgba(${Math.round(baseColor.r * 0.7)}, ${Math.round(baseColor.g * 0.7)}, ${Math.round(baseColor.b * 0.7)}, 0.45)`,
        });
      });
    };

    // 1. ADD BASE WOOD BLOCK
    // Proportions relative to plate diagonal 'd'
    const baseW = d + 11;
    const baseH = 1.6;
    const baseD = 13.0;
    const baseColor = { r: 145, g: 104, b: 68 }; // Rich Walnut Brown
    addCubeToScene(baseW, baseH, baseD, 0, -11.0, 0, baseColor, true);

    // 2. ADD VERTICAL PILLARS (TIANG KAYU)
    const pillarW = 1.4;
    const pillarH = 12.5;
    const pillarD = 1.4;
    const pillarXOffset = d / 2 + 2.0;
    const pillarY = -11.0 + pillarH / 2; // Supported on top of base
    addCubeToScene(pillarW, pillarH, pillarD, -pillarXOffset, pillarY, 0, baseColor, true);
    addCubeToScene(pillarW, pillarH, pillarD, pillarXOffset, pillarY, 0, baseColor, true);

    // 3. ADD ROTATING WOODEN PLATE (THE MAIN BLOCK)
    // Vertices in local coordinate system
    const plateLocalVerts: Point3D[] = [
      { x: -a / 2, y: -b / 2, z: -c / 2 },
      { x: a / 2, y: -b / 2, z: -c / 2 },
      { x: a / 2, y: b / 2, z: -c / 2 },
      { x: -a / 2, y: b / 2, z: -c / 2 },
      { x: -a / 2, y: -b / 2, z: c / 2 },
      { x: a / 2, y: -b / 2, z: c / 2 },
      { x: a / 2, y: b / 2, z: c / 2 },
      { x: -a / 2, y: b / 2, z: c / 2 },
    ];

    // Compute active world coordinates for plate vertices
    const plateWorldVerts = plateLocalVerts.map((v) =>
      getPlateVertexInWorld(v.x, v.y, v.z, a, b, theta)
    );

    // Map plate world vertices to screen space
    const plateProjected = plateWorldVerts.map((v) =>
      projectPoint(v, cameraYaw, cameraPitch, width, height)
    );

    // Base colors of plate
    const plateColor = { r: 196, g: 153, b: 110 }; // Elegant Oak/Teak Wood

    // 6 Faces of the rotating plate with respective normal vector
    // To find normal, we take the rotating frame's normals!
    // Since the plate is rotated by theta around world X, and aligned,
    // its local normals must be rotated through the exact same matrix (aligned, then rotated around X)!
    const getRotatedFaceNormal = (localNorm: Point3D): Point3D => {
      const phi = Math.atan2(b, a);
      const cosP = Math.cos(-phi);
      const sinP = Math.sin(-phi);

      // Rotate local normal around Z by -phi
      const rx = localNorm.x * cosP - localNorm.y * sinP;
      const ry = localNorm.x * sinP + localNorm.y * cosP;
      const rz = localNorm.z;

      // Rotate around world X by theta
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      return {
        x: rx,
        y: ry * cosT - rz * sinT,
        z: ry * sinT + rz * cosT,
      };
    };

    const plateFaceDefs = [
      { indices: [4, 5, 6, 7], localNorm: { x: 0, y: 0, z: 1 }, name: "front" },
      { indices: [1, 0, 3, 2], localNorm: { x: 0, y: 0, z: -1 }, name: "back" },
      { indices: [7, 6, 2, 3], localNorm: { x: 0, y: 1, z: 0 }, name: "top" },
      { indices: [0, 1, 5, 4], localNorm: { x: 0, y: -1, z: 0 }, name: "bottom" },
      { indices: [1, 2, 6, 5], localNorm: { x: 1, y: 0, z: 0 }, name: "right" },
      { indices: [4, 7, 3, 0], localNorm: { x: -1, y: 0, z: 0 }, name: "left" },
    ];

    plateFaceDefs.forEach((face) => {
      const faceProjected = face.indices.map((idx) => plateProjected[idx]);
      const avgDepth = faceProjected.reduce((sum, p) => sum + p.depth, 0) / 4;

      // Get world face normal rotated
      const worldNormal = getRotatedFaceNormal(face.localNorm);
      const color = getLitColor(plateColor.r, plateColor.g, plateColor.b, worldNormal);

      // Rotating wood grains for rotating plate faces
      const grains: { p0: ProjectedPoint; p1: ProjectedPoint }[] = [];
      if (face.name === "front" || face.name === "back") {
        const zPlane = face.name === "front" ? c / 2 : -c / 2;
        const yOffsets = [-b / 3, -b / 12, b / 6, b / 2.5];
        yOffsets.forEach((yo) => {
          const l0 = { x: -a / 2, y: yo, z: zPlane };
          const l1 = { x: a / 2, y: yo, z: zPlane };
          const w0 = getPlateVertexInWorld(l0.x, l0.y, l0.z, a, b, theta);
          const w1 = getPlateVertexInWorld(l1.x, l1.y, l1.z, a, b, theta);
          const p0 = projectPoint(w0, cameraYaw, cameraPitch, width, height);
          const p1 = projectPoint(w1, cameraYaw, cameraPitch, width, height);
          grains.push({ p0, p1 });
        });
      } else if (face.name === "top" || face.name === "bottom") {
        const yPlane = face.name === "top" ? b / 2 : -b / 2;
        const zOffsets = [-c / 3, 0, c / 3];
        zOffsets.forEach((zo) => {
          const l0 = { x: -a / 2, y: yPlane, z: zo };
          const l1 = { x: a / 2, y: yPlane, z: zo };
          const w0 = getPlateVertexInWorld(l0.x, l0.y, l0.z, a, b, theta);
          const w1 = getPlateVertexInWorld(l1.x, l1.y, l1.z, a, b, theta);
          const p0 = projectPoint(w0, cameraYaw, cameraPitch, width, height);
          const p1 = projectPoint(w1, cameraYaw, cameraPitch, width, height);
          grains.push({ p0, p1 });
        });
      }

      sceneQueue.push({
        type: "polygon",
        depth: avgDepth,
        color,
        points: faceProjected,
        grainLines: grains,
        outlineColor: `rgba(${Math.round(plateColor.r * 0.75)}, ${Math.round(plateColor.g * 0.75)}, ${Math.round(plateColor.b * 0.75)}, 0.5)`,
      });
    });

    // 4. ADD METAL AXLE (POROS BESI)
    // Runs perfectly along X-axis
    const axleXMin = -pillarXOffset;
    const axleXMax = pillarXOffset;
    const numAxleSegments = 16;
    for (let i = 0; i < numAxleSegments; i++) {
      const x0 = axleXMin + (axleXMax - axleXMin) * (i / numAxleSegments);
      const x1 = axleXMin + (axleXMax - axleXMin) * ((i + 1) / numAxleSegments);

      const p0 = projectPoint({ x: x0, y: 0, z: 0 }, cameraYaw, cameraPitch, width, height);
      const p1 = projectPoint({ x: x1, y: 0, z: 0 }, cameraYaw, cameraPitch, width, height);

      // Average depth of this axle segment
      const avgDepth = (p0.depth + p1.depth) / 2;

      // Steel lighting
      const steelNormal = { x: 0, y: 1, z: 0 }; // cylindrical highlight approximation
      const steelColor = getLitColor(165, 180, 200, steelNormal); // Shiny silver gray

      sceneQueue.push({
        type: "line",
        depth: avgDepth - 0.2, // slightly lower depth to draw nicely
        p0,
        p1,
        color: steelColor,
        width: 3,
      });
    }

    // =================================================================
    // NEW: ADD SMALL SPOOL CYLINDER, STRING, AND HANGING WEIGHT
    // =================================================================
    const spoolRadius = params.shaftRadius * 100;
    const coreR = spoolRadius;
    const flangeR = spoolRadius * 1.3;
    const spoolXStart = d / 2 + 0.2;
    const spoolXEnd = d / 2 + 0.9;
    const numSpoolSegments = 12;
    const spoolColor = { r: 195, g: 155, b: 65 }; // Shiny Gold/Brass spool

    const spoolVertsLeft: Point3D[] = [];
    const spoolVertsRight: Point3D[] = [];

    for (let i = 0; i < numSpoolSegments; i++) {
      const phi = (i / numSpoolSegments) * 2 * Math.PI;
      const cosP = Math.cos(phi + theta); // rotated in sync with plate
      const sinP = Math.sin(phi + theta);

      spoolVertsLeft.push({ x: spoolXStart, y: coreR * cosP, z: coreR * sinP });
      spoolVertsRight.push({ x: spoolXEnd, y: coreR * cosP, z: coreR * sinP });
    }

    // Draw the 12 core cylinder faces
    for (let i = 0; i < numSpoolSegments; i++) {
      const next = (i + 1) % numSpoolSegments;
      const quadLocal = [
        spoolVertsLeft[i],
        spoolVertsRight[i],
        spoolVertsRight[next],
        spoolVertsLeft[next],
      ];
      const quadProjected = quadLocal.map((v) => projectPoint(v, cameraYaw, cameraPitch, width, height));
      const avgDepth = quadProjected.reduce((sum, p) => sum + p.depth, 0) / 4;

      const normalPhi = ((i + 0.5) / numSpoolSegments) * 2 * Math.PI;
      const faceNormal = { x: 0, y: Math.cos(normalPhi + theta), z: Math.sin(normalPhi + theta) };
      const color = getLitColor(spoolColor.r, spoolColor.g, spoolColor.b, faceNormal);

      sceneQueue.push({
        type: "polygon",
        depth: avgDepth - 0.1,
        color,
        points: quadProjected,
        outlineColor: "rgba(100, 80, 20, 0.25)",
      });
    }

    // Draw flanges at both ends
    const addFlangeDisk = (xPos: number) => {
      const outerVerts: Point3D[] = [];
      const innerVerts: Point3D[] = [];
      for (let i = 0; i < numSpoolSegments; i++) {
        const phi = (i / numSpoolSegments) * 2 * Math.PI;
        const cosP = Math.cos(phi + theta);
        const sinP = Math.sin(phi + theta);
        outerVerts.push({ x: xPos, y: flangeR * cosP, z: flangeR * sinP });
        innerVerts.push({ x: xPos, y: 0, z: 0 });
      }

      for (let i = 0; i < numSpoolSegments; i++) {
        const next = (i + 1) % numSpoolSegments;
        const triLocal = [
          innerVerts[i],
          outerVerts[i],
          outerVerts[next],
        ];
        const triProjected = triLocal.map((v) => projectPoint(v, cameraYaw, cameraPitch, width, height));
        const avgDepth = triProjected.reduce((sum, p) => sum + p.depth, 0) / 3;

        const faceNormal = { x: xPos > spoolXStart + 0.3 ? 1 : -1, y: 0, z: 0 };
        const color = getLitColor(spoolColor.r, spoolColor.g, spoolColor.b, faceNormal);

        sceneQueue.push({
          type: "polygon",
          depth: avgDepth - 0.15,
          color,
          points: triProjected,
          outlineColor: "rgba(100, 80, 20, 0.3)",
        });
      }
    };

    addFlangeDisk(spoolXStart);
    addFlangeDisk(spoolXEnd);

    // Dynamic hanging weight cylinder
    const mGrams = params.loadMass * 1000;
    const wRadius = 0.5 + ((mGrams - 10) / 190) * 0.45; // scale width: 0.5 to 0.95 cm
    const wHeight = 1.0 + ((mGrams - 10) / 190) * 0.8;  // scale height: 1.0 to 1.8 cm
    const weightX = (spoolXStart + spoolXEnd) / 2;
    
    // Scale currentY (0 to -fallHeight) to fit nicely in base clearance (0 to -8.5cm)
    const visualY = (results.currentY / params.fallHeight) * 8.5;
    const weightY = visualY - 1.0; // Starts 1cm below axle
    const weightZ = -coreR; // Tangent from spool core

    const numWeightSides = 10;
    const weightColor = { r: 110, g: 125, b: 140 }; // Industrial iron grey
    const weightVertsTop: Point3D[] = [];
    const weightVertsBottom: Point3D[] = [];

    for (let i = 0; i < numWeightSides; i++) {
      const phi = (i / numWeightSides) * 2 * Math.PI;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      weightVertsTop.push({
        x: weightX + wRadius * cosP,
        y: weightY + wHeight / 2,
        z: weightZ + wRadius * sinP,
      });
      weightVertsBottom.push({
        x: weightX + wRadius * cosP,
        y: weightY - wHeight / 2,
        z: weightZ + wRadius * sinP,
      });
    }

    // Weight cylinder sides
    for (let i = 0; i < numWeightSides; i++) {
      const next = (i + 1) % numWeightSides;
      const quadLocal = [
        weightVertsBottom[i],
        weightVertsTop[i],
        weightVertsTop[next],
        weightVertsBottom[next],
      ];
      const quadProjected = quadLocal.map((v) => projectPoint(v, cameraYaw, cameraPitch, width, height));
      const avgDepth = quadProjected.reduce((sum, p) => sum + p.depth, 0) / 4;

      const normalPhi = ((i + 0.5) / numWeightSides) * 2 * Math.PI;
      const faceNormal = { x: Math.cos(normalPhi), y: 0, z: Math.sin(normalPhi) };
      const color = getLitColor(weightColor.r, weightColor.g, weightColor.b, faceNormal);

      sceneQueue.push({
        type: "polygon",
        depth: avgDepth,
        color,
        points: quadProjected,
        outlineColor: "rgba(50, 60, 70, 0.4)",
      });
    }

    // Weight cylinder top/bottom caps
    const addWeightCap = (verts: Point3D[], isTop: boolean) => {
      const center = { x: weightX, y: isTop ? weightY + wHeight / 2 : weightY - wHeight / 2, z: weightZ };
      for (let i = 0; i < numWeightSides; i++) {
        const next = (i + 1) % numWeightSides;
        const triLocal = [
          center,
          verts[i],
          verts[next],
        ];
        const triProjected = triLocal.map((v) => projectPoint(v, cameraYaw, cameraPitch, width, height));
        const avgDepth = triProjected.reduce((sum, p) => sum + p.depth, 0) / 3;

        const faceNormal = { x: 0, y: isTop ? 1 : -1, z: 0 };
        const color = getLitColor(weightColor.r, weightColor.g, weightColor.b, faceNormal);

        sceneQueue.push({
          type: "polygon",
          depth: avgDepth - 0.05,
          color,
          points: triProjected,
          outlineColor: "rgba(50, 60, 70, 0.35)",
        });
      }
    };

    addWeightCap(weightVertsTop, true);
    addWeightCap(weightVertsBottom, false);

    // 1. Vertical Nylon string from tangent to weight
    const pStringSpool = projectPoint({ x: weightX, y: 0, z: -coreR }, cameraYaw, cameraPitch, width, height);
    const pStringWeight = projectPoint({ x: weightX, y: weightY + wHeight / 2, z: weightZ }, cameraYaw, cameraPitch, width, height);

    sceneQueue.push({
      type: "line",
      depth: (pStringSpool.depth + pStringWeight.depth) / 2 - 0.1,
      p0: pStringSpool,
      p1: pStringWeight,
      color: "rgba(240, 240, 235, 0.95)", // Highly visible nylon string
      width: 2.0,
    });

    // 2. Wrapped Thread Coil (representing the single-loop coil uncoiling)
    const numWrapPoints = 16;
    const wrapFraction = Math.max(0, 1 - (Math.abs(theta) / (2 * Math.PI)));
    if (wrapFraction > 0.01) {
      const wrapPoints: ProjectedPoint[] = [];
      for (let i = 0; i <= numWrapPoints; i++) {
        const phi = (i / numWrapPoints) * 2 * Math.PI * wrapFraction;
        const angle = -Math.PI / 2 + phi; // wraps starting from bottom-front tangent point
        const pt = {
          x: weightX,
          y: (coreR + 0.04) * Math.sin(angle),
          z: (coreR + 0.04) * Math.cos(angle),
        };
        wrapPoints.push(projectPoint(pt, cameraYaw, cameraPitch, width, height));
      }

      for (let i = 0; i < wrapPoints.length - 1; i++) {
        sceneQueue.push({
          type: "line",
          depth: (wrapPoints[i].depth + wrapPoints[i+1].depth) / 2 - 0.15,
          p0: wrapPoints[i],
          p1: wrapPoints[i+1],
          color: "rgba(240, 240, 235, 0.95)",
          width: 2.0,
        });
      }
    }
    // =================================================================

    // 5. ADD SUMBU DIAGONAL OP RED DASHED LINE
    // Shows the exact rotating axis OP along the axle
    const opScale = pillarXOffset + 1.5;
    const op0 = projectPoint({ x: -opScale, y: 0, z: 0 }, cameraYaw, cameraPitch, width, height);
    const op1 = projectPoint({ x: opScale, y: 0, z: 0 }, cameraYaw, cameraPitch, width, height);
    
    sceneQueue.push({
      type: "line",
      depth: -999, // Render OP Axis line on top for clarity
      p0: op0,
      p1: op1,
      color: "rgba(239, 68, 68, 0.85)", // Red arrow
      width: 1.5,
      dashed: true,
    });

    // 6. ADD VELOCITY VECTOR GREEN ARROW
    // Represents omega vector along the rotation axis (aligned with world X-axis)
    // Start arrow at right support corner (point P)
    const pCornerX = d / 2;
    const omegaVal = results.currentOmega;
    
    if (Math.abs(omegaVal) > 0.05) {
      // Length scales with current speed
      const arrowLength = Math.max(3.0, Math.min(8.0, Math.abs(omegaVal) * 0.35));
      const directionSign = omegaVal > 0 ? 1 : -1;
      
      const arrowStartX = pCornerX;
      const arrowEndX = pCornerX + arrowLength * directionSign;

      const ptStart = projectPoint({ x: arrowStartX, y: 0, z: 0 }, cameraYaw, cameraPitch, width, height);
      const ptEnd = projectPoint({ x: arrowEndX, y: 0, z: 0 }, cameraYaw, cameraPitch, width, height);

      sceneQueue.push({
        type: "line",
        depth: -1000, // Top of scene
        p0: ptStart,
        p1: ptEnd,
        color: "#22c55e", // Bright green velocity vector
        width: 4.5,
      });

      // Arrow head points along the velocity direction
      const headLength = 1.0;
      const angleOffsets = [0.3, -0.3];
      angleOffsets.forEach((ao) => {
        const headW = {
          x: arrowEndX - headLength * directionSign,
          y: headLength * Math.sin(ao),
          z: headLength * Math.cos(ao),
        };
        const ptHead = projectPoint(headW, cameraYaw, cameraPitch, width, height);
        sceneQueue.push({
          type: "line",
          depth: -1001,
          p0: ptEnd,
          p1: ptHead,
          color: "#22c55e",
          width: 3,
        });
      });

      // Label ω at arrow tip
      const ptLabel = projectPoint({ x: arrowEndX + 1.0 * directionSign, y: 1.0, z: 0 }, cameraYaw, cameraPitch, width, height);
      sceneQueue.push({
        type: "marker",
        depth: -1002,
        point: ptLabel,
        label: "ω",
        color: "#22c55e",
        subLabel: `${omegaVal.toFixed(1)} rad/s`,
      });
    }

    // 7. LABELS O AND P AT PLATE CORNERS
    // Corner O is local (-a/2, -b/2, 0) -> rotates to world (-d/2, 0, 0)
    // Corner P is local (a/2, b/2, 0) -> rotates to world (d/2, 0, 0)
    const ptO = projectPoint({ x: -d / 2, y: -0.6, z: 0 }, cameraYaw, cameraPitch, width, height);
    const ptP = projectPoint({ x: d / 2, y: 0.6, z: 0 }, cameraYaw, cameraPitch, width, height);

    sceneQueue.push({
      type: "marker",
      depth: -995,
      point: ptO,
      label: "O",
      color: "#ef4444",
    });

    sceneQueue.push({
      type: "marker",
      depth: -996,
      point: ptP,
      label: "P",
      color: "#ef4444",
    });

    // Sort scene elements by camera space depth back-to-front (descending depth values)
    const sortedScene = sceneQueue.sort((a, b) => b.depth - a.depth);

    // Draw everything in sorted order
    sortedScene.forEach((item) => {
      if (item.type === "polygon") {
        // Fill face
        ctx.beginPath();
        ctx.moveTo(item.points[0].screenX, item.points[0].screenY);
        for (let idx = 1; idx < item.points.length; idx++) {
          ctx.lineTo(item.points[idx].screenX, item.points[idx].screenY);
        }
        ctx.closePath();
        ctx.fillStyle = item.color;
        ctx.fill();

        // Draw wood grain lines
        if (item.grainLines && item.grainLines.length > 0) {
          ctx.save();
          // Clip drawing of grain lines to the face polygon to avoid leaking
          ctx.beginPath();
          ctx.moveTo(item.points[0].screenX, item.points[0].screenY);
          for (let idx = 1; idx < item.points.length; idx++) {
            ctx.lineTo(item.points[idx].screenX, item.points[idx].screenY);
          }
          ctx.closePath();
          ctx.clip();

          ctx.strokeStyle = item.outlineColor || "rgba(100,50,20, 0.35)";
          ctx.lineWidth = 1.0;
          ctx.globalAlpha = 0.65;
          item.grainLines.forEach((gl) => {
            ctx.beginPath();
            ctx.moveTo(gl.p0.screenX, gl.p0.screenY);
            ctx.lineTo(gl.p1.screenX, gl.p1.screenY);
            ctx.stroke();
          });
          ctx.restore();
        }

        // Draw fine edge borders
        if (item.outlineColor) {
          ctx.strokeStyle = item.outlineColor;
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(item.points[0].screenX, item.points[0].screenY);
          for (let idx = 1; idx < item.points.length; idx++) {
            ctx.lineTo(item.points[idx].screenX, item.points[idx].screenY);
          }
          ctx.closePath();
          ctx.stroke();
        }
      } else if (item.type === "line") {
        ctx.beginPath();
        ctx.moveTo(item.p0.screenX, item.p0.screenY);
        ctx.lineTo(item.p1.screenX, item.p1.screenY);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.width;
        if (item.dashed) {
          ctx.setLineDash([4, 4]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]); // Reset
      } else if (item.type === "marker") {
        // Draw small red/green coordinate anchor dot
        ctx.beginPath();
        ctx.arc(item.point.screenX, item.point.screenY, 3, 0, 2 * Math.PI);
        ctx.fillStyle = item.color;
        ctx.fill();

        // Render typography label text
        ctx.fillStyle = item.color;
        ctx.font = "bold 13px 'Space Grotesk', 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, item.point.screenX, item.point.screenY - 14);

        if (item.subLabel) {
          ctx.font = "normal 10px 'JetBrains Mono', monospace";
          ctx.fillStyle = "#475569";
          ctx.fillText(item.subLabel, item.point.screenX, item.point.screenY + 14);
        }
      }
    });

    // Overlay technical compass references inside the canvas
    ctx.save();
    ctx.font = "normal 10px 'Inter', sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("Seret 3D untuk Orbit Kamera", 16, height - 16);
    ctx.restore();

  }, [params, results, cameraYaw, cameraPitch]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[360px] bg-slate-50 border border-slate-100 rounded-xl flex flex-col cursor-grab active:cursor-grabbing select-none overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      id="canvas-3d-container"
    >
      {/* 3D Canvas */}
      <canvas ref={canvasRef} className="w-full h-full flex-grow block" />

      {/* Camera Reset floating control */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          resetCamera();
        }}
        className="absolute bottom-4 right-4 bg-white/90 hover:bg-white border border-slate-200 hover:border-slate-300 text-slate-600 font-sans text-xs px-2.5 py-1.5 rounded-md shadow-xs transition-colors cursor-pointer"
        id="btn-reset-camera"
      >
        Atur Ulang Kamera
      </button>
    </div>
  );
}
