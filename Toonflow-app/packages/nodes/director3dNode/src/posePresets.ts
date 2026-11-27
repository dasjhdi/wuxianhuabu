import { mannequinJoints } from "./mannequin";

export type PoseValue = Partial<Record<typeof mannequinJoints[number], { x: number; y: number; z: number }>>;

export interface PosePreset {
  name: string;
  pose: PoseValue;
}

// ACT: 关节零旋转为自然垂臂站姿；肩肘绕负 X 向前抬起、绕 Z 外展，膝绕正 X 向后弯曲。
// 预设只覆盖单帧静态姿势，复杂动作仍走 AI 生成关键帧轨道。
export const posePresets: PosePreset[] = [
  { name: "自然站立", pose: {} },
  {
    name: "双手叉腰",
    pose: {
      leftShoulder: { x: 0, y: 0, z: 0.55 }, rightShoulder: { x: 0, y: 0, z: -0.55 },
      leftElbow: { x: -1.15, y: 0, z: 0.35 }, rightElbow: { x: -1.15, y: 0, z: -0.35 },
      leftWrist: { x: -0.5, y: 0, z: 0 }, rightWrist: { x: -0.5, y: 0, z: 0 },
    },
  },
  {
    name: "抱胸",
    pose: {
      leftShoulder: { x: -0.35, y: 0.35, z: 0.15 }, rightShoulder: { x: -0.35, y: -0.35, z: -0.15 },
      leftElbow: { x: -1.65, y: 0, z: 0 }, rightElbow: { x: -1.65, y: 0, z: 0 },
    },
  },
  {
    name: "挥手致意",
    pose: {
      rightShoulder: { x: -2.55, y: 0, z: -0.35 }, rightElbow: { x: -0.5, y: 0, z: -0.3 },
      leftShoulder: { x: 0, y: 0, z: 0.12 },
    },
  },
  {
    name: "指向前方",
    pose: {
      rightShoulder: { x: -1.5, y: -0.15, z: -0.1 }, rightElbow: { x: -0.12, y: 0, z: 0 },
      leftShoulder: { x: 0, y: 0, z: 0.1 },
    },
  },
  {
    name: "双手合十",
    pose: {
      leftShoulder: { x: -0.85, y: 0.5, z: 0.2 }, rightShoulder: { x: -0.85, y: -0.5, z: -0.2 },
      leftElbow: { x: -1.5, y: 0, z: 0.4 }, rightElbow: { x: -1.5, y: 0, z: -0.4 },
      leftWrist: { x: -0.55, y: 0.35, z: 0 }, rightWrist: { x: -0.55, y: -0.35, z: 0 },
    },
  },
  {
    name: "奔跑姿态",
    pose: {
      leftShoulder: { x: -0.85, y: 0, z: 0.1 }, rightShoulder: { x: 0.75, y: 0, z: -0.1 },
      leftElbow: { x: -1.1, y: 0, z: 0 }, rightElbow: { x: -0.5, y: 0, z: 0 },
      leftHip: { x: -0.75, y: 0, z: 0 }, leftKnee: { x: 0.55, y: 0, z: 0 },
      rightHip: { x: 0.55, y: 0, z: 0 }, rightKnee: { x: 1.15, y: 0, z: 0 },
      spine: { x: 0.12, y: 0, z: 0 },
    },
  },
  {
    name: "浅蹲警戒",
    pose: {
      leftHip: { x: -0.6, y: 0, z: 0.12 }, rightHip: { x: -0.6, y: 0, z: -0.12 },
      leftKnee: { x: 1.0, y: 0, z: 0 }, rightKnee: { x: 1.0, y: 0, z: 0 },
      leftAnkle: { x: -0.4, y: 0, z: 0 }, rightAnkle: { x: -0.4, y: 0, z: 0 },
      spine: { x: 0.28, y: 0, z: 0 },
      leftElbow: { x: -1.2, y: 0, z: 0.2 }, rightElbow: { x: -1.2, y: 0, z: -0.2 },
    },
  },
];

export function findPosePreset(name: string) {
  return posePresets.find(preset => preset.name === name);
}
