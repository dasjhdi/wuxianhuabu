import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Material } from "three";

// ACT: 白模道具库 —— 用少量基础几何体拼出可辨识的桌椅门窗，保证预演阶段零外部资源、可直接参与走位与运镜。
export const propKinds = [
  "wall", "door", "window", "column", "stairs", "platform",
  "table", "chair", "sofa", "bed", "counter", "shelf", "tree", "streetLight",
] as const;
export type PropKind = typeof propKinds[number];

export const propGroups: { key: string; label: string; items: { kind: PropKind; label: string }[] }[] = [
  {
    key: "structure",
    label: "建筑结构",
    items: [
      { kind: "wall", label: "墙体" },
      { kind: "door", label: "门" },
      { kind: "window", label: "窗" },
      { kind: "column", label: "立柱" },
      { kind: "stairs", label: "台阶" },
      { kind: "platform", label: "平台" },
    ],
  },
  {
    key: "furniture",
    label: "场景道具",
    items: [
      { kind: "table", label: "餐桌" },
      { kind: "chair", label: "椅子" },
      { kind: "sofa", label: "沙发" },
      { kind: "bed", label: "床" },
      { kind: "counter", label: "柜台" },
      { kind: "shelf", label: "货架" },
      { kind: "tree", label: "树木" },
      { kind: "streetLight", label: "路灯" },
    ],
  },
];

export const propLabels = Object.fromEntries(propGroups.flatMap(group => group.items.map(item => [item.kind, item.label]))) as Record<PropKind, string>;
export const propSizes: Record<PropKind, { width: number; height: number; depth: number }> = {
  wall: { width: 3, height: 2.8, depth: 0.16 },
  door: { width: 1.1, height: 2.2, depth: 0.2 },
  window: { width: 1.4, height: 1.4, depth: 0.16 },
  column: { width: 0.42, height: 2.9, depth: 0.42 },
  stairs: { width: 1.6, height: 0.9, depth: 1.8 },
  platform: { width: 3, height: 0.2, depth: 3 },
  table: { width: 1.6, height: 0.78, depth: 0.9 },
  chair: { width: 0.5, height: 0.95, depth: 0.55 },
  sofa: { width: 2, height: 0.85, depth: 0.9 },
  bed: { width: 1.7, height: 1.1, depth: 2.1 },
  counter: { width: 1.9, height: 1.05, depth: 0.7 },
  shelf: { width: 1.8, height: 2, depth: 0.45 },
  tree: { width: 2, height: 3.4, depth: 2 },
  streetLight: { width: 1.4, height: 4, depth: 0.3 },
};

function shade(hex: string, factor: number) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const channel = (offset: number) => Math.max(0, Math.min(255, Math.round(((value >> offset) & 0xff) * factor)));
  return `#${[16, 8, 0].map(offset => channel(offset).toString(16).padStart(2, "0")).join("")}`;
}

export function disposeProp(root: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse(child => {
    const mesh = child as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

// ACT: 单位米，脚底 / 底边在 y=0，面向 +Z；同一实例内材质共享，便于统一着色与释放。
export function createProp(id: string, kind: PropKind, color = "#b9bec7"): Group {
  const root = new Group();
  root.name = `prop:${id}`;
  root.userData.threeJsonId = id;
  root.userData.tag = "directorProp";
  const base = new MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 });
  const dark = new MeshStandardMaterial({ color: shade(color, 0.78), roughness: 0.82, metalness: 0.03 });
  // ACT: 记录相对亮度，换色时保留深色部件的层次，不会把整件道具压成同一个颜色。
  base.userData.tint = 1;
  dark.userData.tint = 0.78;

  function box(width: number, height: number, depth: number, x: number, y: number, z: number, material: Material = base, rotationY = 0) {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  function cylinder(radiusTop: number, radiusBottom: number, height: number, x: number, y: number, z: number, material: Material = base) {
    const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, 16), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  switch (kind) {
    case "wall":
      box(3, 2.8, 0.16, 0, 1.4, 0);
      box(3, 0.12, 0.24, 0, 2.86, 0, dark);
      break;
    case "door": {
      box(1.1, 2.2, 0.06, 0, 1.1, 0);
      box(1.28, 0.1, 0.18, 0, 2.25, 0, dark);
      box(0.08, 2.2, 0.18, -0.6, 1.1, 0, dark);
      box(0.08, 2.2, 0.18, 0.6, 1.1, 0, dark);
      const knob = new Mesh(new SphereGeometry(0.045, 12, 10), dark);
      knob.position.set(0.4, 1.02, 0.08);
      root.add(knob);
      break;
    }
    case "window":
      box(1.4, 1.4, 0.06, 0, 1.4, 0, dark);
      box(1.28, 1.28, 0.04, 0, 1.4, 0.03, base);
      box(0.06, 1.28, 0.06, 0, 1.4, 0.05, dark);
      box(1.28, 0.06, 0.06, 0, 1.4, 0.05, dark);
      break;
    case "column":
      box(0.42, 0.12, 0.42, 0, 0.06, 0, dark);
      cylinder(0.16, 0.18, 2.66, 0, 1.45, 0);
      box(0.42, 0.12, 0.42, 0, 2.84, 0, dark);
      break;
    case "stairs":
      for (let step = 0; step < 6; step += 1) {
        box(1.6, 0.15, 0.3, 0, 0.075 + step * 0.15, -0.75 + step * 0.3, step % 2 ? dark : base);
      }
      break;
    case "platform":
      box(3, 0.2, 3, 0, 0.1, 0);
      break;
    case "table":
      box(1.6, 0.08, 0.9, 0, 0.74, 0);
      for (const x of [-0.7, 0.7]) for (const z of [-0.36, 0.36]) box(0.08, 0.7, 0.08, x, 0.35, z, dark);
      break;
    case "chair":
      box(0.5, 0.07, 0.5, 0, 0.45, 0);
      box(0.5, 0.5, 0.06, 0, 0.7, -0.22, dark);
      for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) box(0.05, 0.42, 0.05, x, 0.21, z, dark);
      break;
    case "sofa":
      box(2, 0.42, 0.9, 0, 0.25, 0);
      box(2, 0.5, 0.18, 0, 0.68, -0.36, dark);
      box(0.18, 0.6, 0.9, -0.91, 0.45, 0, dark);
      box(0.18, 0.6, 0.9, 0.91, 0.45, 0, dark);
      box(1.5, 0.12, 0.7, 0, 0.5, 0.05);
      break;
    case "bed":
      box(1.7, 0.28, 2.1, 0, 0.18, 0, dark);
      box(1.6, 0.24, 2, 0, 0.44, 0.02);
      box(1.7, 0.9, 0.1, 0, 0.55, -1.02, dark);
      box(0.6, 0.14, 0.36, -0.4, 0.63, -0.72);
      box(0.6, 0.14, 0.36, 0.4, 0.63, -0.72);
      break;
    case "counter":
      box(1.9, 1, 0.7, 0, 0.5, 0);
      box(2, 0.07, 0.8, 0, 1.03, 0, dark);
      box(1.5, 0.5, 0.04, 0, 0.55, 0.36, dark);
      break;
    case "shelf":
      box(1.8, 2, 0.08, 0, 1, -0.2, dark);
      for (const y of [0.1, 0.55, 1, 1.45, 1.95]) box(1.8, 0.06, 0.45, 0, y, 0, y === 1.95 ? dark : base);
      box(0.06, 2, 0.45, -0.87, 1, 0, dark);
      box(0.06, 2, 0.45, 0.87, 1, 0, dark);
      break;
    case "tree":
      cylinder(0.12, 0.18, 1.6, 0, 0.8, 0, dark);
      for (const [radius, y] of [[0.95, 2.05], [0.75, 2.65], [0.5, 3.1]] as const) {
        const crown = new Mesh(new SphereGeometry(radius, 18, 14), base);
        crown.position.set(0, y, 0);
        crown.castShadow = true;
        crown.receiveShadow = true;
        root.add(crown);
      }
      break;
    case "streetLight":
      cylinder(0.08, 0.12, 3.8, 0, 1.9, 0, dark);
      box(0.9, 0.08, 0.08, 0.4, 3.75, 0, dark);
      box(0.3, 0.12, 0.24, 0.78, 3.68, 0);
      box(0.34, 0.06, 0.28, 0, 0.03, 0, dark);
      break;
  }
  return root;
}
