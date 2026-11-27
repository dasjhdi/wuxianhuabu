import { z } from "@toonflow/nodes-scaffold/runtime";
import { createJsonScene, getObjectByThreeJsonId, registerObject, type SceneRuntime } from "threejson/core";
import { AmbientLight, BackSide, Box3, Color, DirectionalLight, Fog, GridHelper, Group, HemisphereLight, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, ShadowMaterial, Sphere, SphereGeometry, SRGBColorSpace, TextureLoader, Vector3, type Material, type WebGLRenderTarget } from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createMannequin, mannequinJoints } from "./mannequin";
import { createProp, disposeProp, propKinds } from "./props";

const coordinate = z.number().min(-10000).max(10000);
const vector = z.strictObject({ x: coordinate, y: coordinate, z: coordinate });
const color = z.string().regex(/^#[\da-f]{6}$/i);
// ACT: 模型只接受工作区上传目录下的路径，或运行时解析出的 blob URL；禁止任意外部地址，避免浏览器替 AI 请求第三方资源。
export function isSafeModelPath(value: string) {
  if (/^blob:/.test(value)) return !value.includes("..");
  return /^assets\/[^\s\\:*?"<>|#]+$/.test(value) && !value.includes("..") && !value.includes("//") && /\.(glb|gltf)$/i.test(value);
}
// ACT: 场景只接入基础几何体、内置人偶和用户上传的模型，不接受可执行脚本、HTML 或外部资源配置。
export const sceneSchema = z.strictObject({
  version: z.literal("next"),
  sceneConfig: z.strictObject({
    scene: z.strictObject({ background: color }),
    camera: z.strictObject({ position: vector, fov: z.number().min(10).max(120), near: z.number().min(0.01).max(10), far: z.number().min(20).max(10000), roll: z.number().min(-180).max(180).optional() }),
    controls: z.strictObject({ target: vector }),
    lights: z.array(z.strictObject({
      type: z.enum(["ambient", "directional", "point", "spot", "hemisphere"]),
      color, intensity: z.number().min(0).max(100), position: vector.optional(), target: vector.optional(),
    })).max(16),
  }),
  objectList: z.array(z.strictObject({
    threeJsonId: z.string().trim().min(1).max(100), name: z.string().max(100).optional(),
    objType: z.enum(["box", "sphere", "cylinder", "cone", "ring", "torus", "capsule", "plane", "mannequin", "model", "prop"]),
    geometry: z.record(z.string().regex(/^[a-zA-Z]+$/), z.union([z.number().min(0).max(10000), z.boolean()]))
      .refine(value => Object.entries(value).every(([key, size]) => !/segments/i.test(key) || (typeof size === "number" && Number.isInteger(size) && size >= 1 && size <= 64)), "细分段数必须是 1～64 的整数"),
    position: vector,
    rotation: z.strictObject({ rotationX: coordinate, rotationY: coordinate, rotationZ: coordinate }).optional(),
    scale: z.strictObject({ scaleX: coordinate, scaleY: coordinate, scaleZ: coordinate }).optional(),
    model: z.strictObject({ path: z.string().min(1).max(600).refine(isSafeModelPath, "模型路径无效，请重新上传") }).describe("仅 model：用户上传的 GLB / GLTF 模型路径").optional(),
    prop: z.enum(propKinds).describe("仅 prop：内置白模道具，如 wall/door/table/chair/sofa/tree").optional(),
    pose: z.partialRecord(z.enum(mannequinJoints), vector).describe("仅 mannequin：关节相对父关节的局部 XYZ 旋转，弧度，省略为自然站姿").optional(),
    hiddenParts: z.array(z.enum(mannequinJoints)).max(mannequinJoints.length).describe("仅 mannequin：不显示指定关节及其下游部位，省略为完整人偶").optional(),
    material: z.strictObject({
      type: z.enum(["standard", "basic", "phong", "lambert"]), color,
      roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional(),
      opacity: z.number().min(0).max(1).optional(), transparent: z.boolean().optional(), wireframe: z.boolean().optional(),
    }),
  }).refine(object => object.objType === "mannequin" || (!object.pose && !object.hiddenParts), "仅人偶支持关节姿态和部位隐藏")
    .refine(object => (object.objType === "model") === !!object.model, "只有 model 类型需要 model.path，其他类型不能填写 model")
    .refine(object => (object.objType === "prop") === !!object.prop, "只有 prop 类型需要 prop 组件名，其他类型不能填写 prop")
    .refine(object => Object.keys(object.geometry).length === 0 || object.objType !== "model", "上传模型不支持 geometry 参数")
    .refine(object => !object.scale || [object.scale.scaleX, object.scale.scaleY, object.scale.scaleZ].every(value => Math.abs(value) >= 0.01), "缩放不能为 0")).max(200).refine(objects => new Set(objects.map(object => object.threeJsonId)).size === objects.length, "物体 ID 不能重复"),
});
export type SceneDocument = z.infer<typeof sceneSchema>;
export type SceneObject = SceneDocument["objectList"][number];
export const cameraViewSchema = sceneSchema.shape.sceneConfig.pick({ camera: true, controls: true });
export type CameraView = z.infer<typeof cameraViewSchema>;

export function createMannequinObject(id: string): SceneDocument["objectList"][number] {
  return {
    threeJsonId: id, name: "关节人偶", objType: "mannequin", geometry: {},
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#c7a77b", roughness: 0.75 },
  };
}

export interface SceneSettings {
  gridVisible: boolean;
  skyVisible: boolean;
  gridOpacity: number;
  groundVisible: boolean;
  groundStrength: number;
  groundHeight: number;
  backdropEnabled: boolean;
  backdropPath?: string;
  backdropScale: number;
  backdropRotation: number;
  backdropOffsetY: number;
}

export const defaultSceneSettings: SceneSettings = {
  gridVisible: true,
  // ACT: 白模预演默认使用深灰摄影棚底色，不叠加天空盒，和参考界面的中性背景一致。
  skyVisible: false,
  gridOpacity: 0.55,
  groundVisible: true,
  groundStrength: 0.9,
  groundHeight: 0,
  backdropEnabled: false,
  backdropScale: 1,
  backdropRotation: 0,
  backdropOffsetY: 0,
};

export function applySceneSettings(runtime: SceneRuntime, settings: SceneSettings) {
  let sky = runtime.scene.children.find(child => child instanceof Sky);
  if (!sky && settings.skyVisible) {
    sky = new Sky();
    sky.scale.setScalar(450000);
    sky.material.uniforms.sunPosition!.value.set(10, 16, 12);
    // 单独压缩天空的 HDR 高亮，保留模型原有的亮度。
    sky.material.fragmentShader = sky.material.fragmentShader.replace(
      "#include <tonemapping_fragment>",
      "gl_FragColor.rgb = gl_FragColor.rgb / (gl_FragColor.rgb + vec3(2.0));",
    );
    runtime.scene.add(sky);
  }

  for (const child of runtime.scene.children) {
    if (child instanceof GridHelper) {
      child.visible = settings.gridVisible;
      const material = child.material as LineBasicMaterial;
      material.transparent = true;
      material.opacity = Math.max(0.05, settings.gridOpacity);
    }
  }

  let ground = runtime.scene.children.find(child => child.userData.tag === "directorGround") as Mesh | undefined;
  if (!ground) {
    ground = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: "#34383f", roughness: 1, metalness: 0, transparent: true }));
    ground.rotation.x = -Math.PI / 2;
    ground.userData.tag = "directorGround";
    ground.receiveShadow = true;
    runtime.scene.add(ground);
  }
  (ground.material as MeshStandardMaterial).color.set("#34383f");
  (ground.material as MeshStandardMaterial).opacity = Math.max(0.06, settings.groundStrength);
  ground.visible = settings.groundVisible;
  ground.position.y = settings.groundHeight - 0.01;

  const shadowCatcher = runtime.scene.children.find(child => child.userData.tag === "directorShadow") as Mesh | undefined;
  if (shadowCatcher) shadowCatcher.position.y = settings.groundHeight - 0.005;

  // ACT: 全景背景用反向球体贴图承载用户上传的 2D 场景图，人物与几何体在球内摆放。
  const backdropOn = settings.backdropEnabled && !!settings.backdropPath;
  let backdrop = runtime.scene.children.find(child => child.userData.tag === "directorBackdrop") as Mesh | undefined;
  if (backdropOn) {
    if (!backdrop) {
      backdrop = new Mesh(new SphereGeometry(380, 48, 32), new MeshBasicMaterial({ side: BackSide, depthWrite: false }));
      backdrop.userData.tag = "directorBackdrop";
      backdrop.renderOrder = -1;
      runtime.scene.add(backdrop);
    }
    const material = backdrop.material as MeshBasicMaterial;
    if (material.userData.url !== settings.backdropPath) {
      material.map?.dispose();
      material.map = null;
      material.userData.url = settings.backdropPath;
      new TextureLoader().load(settings.backdropPath!, texture => {
        texture.colorSpace = SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
        runtime.invalidate();
      });
    }
    backdrop.visible = true;
    backdrop.scale.setScalar(settings.backdropScale);
    backdrop.rotation.y = settings.backdropRotation * Math.PI / 180;
    backdrop.position.y = settings.backdropOffsetY;
  } else if (backdrop) {
    backdrop.visible = false;
  }

  if (sky) sky.visible = settings.skyVisible && !backdropOn;
  // ACT: 全景背景是半径 380 的球体，雾会把背景整块吃掉；开启背景图时关闭雾。
  if (backdropOn) runtime.scene.fog = null;
  else if (!runtime.scene.fog) runtime.scene.fog = new Fog(runtime.scene.background as Color ?? new Color("#34383f"), 45, 160);
  runtime.invalidate();
}

export interface LightingSettings {
  globalEnabled: boolean;
  globalIntensity: number;
  sunEnabled: boolean;
  azimuth: number;
  elevation: number;
  color: string;
  intensity: number;
}

export function getSceneLighting(document: SceneDocument): LightingSettings {
  const lights = document.sceneConfig.lights;
  const main = lights.find(light => light.type === "directional");
  const position = main?.position ?? { x: 0, y: 1, z: 0 };
  const target = main?.target ?? { x: 0, y: 0, z: 0 };
  const direction = new Vector3(position.x - target.x, position.y - target.y, position.z - target.z).normalize();
  return {
    globalEnabled: lights.some(light => light.type === "ambient" || light.type === "hemisphere"),
    globalIntensity: lights.find(light => light.type === "ambient" || light.type === "hemisphere")?.intensity ?? 0.8,
    // 默认开启主光与投影，物体才有体积感；用户可在光照面板关闭。
    sunEnabled: true,
    azimuth: (Math.atan2(direction.x, direction.z) * 180 / Math.PI + 360) % 360,
    elevation: Math.asin(direction.y) * 180 / Math.PI,
    color: main?.color ?? "#ffffff",
    intensity: main?.intensity ?? 2,
  };
}

export function applyLighting(runtime: SceneRuntime, lighting: LightingSettings) {
  let main: DirectionalLight | undefined;
  let hasGlobalLight = false;
  runtime.scene.traverse(object => {
    if (object instanceof AmbientLight || object instanceof HemisphereLight) {
      object.visible = lighting.globalEnabled;
      object.intensity = lighting.globalIntensity;
      hasGlobalLight = true;
    }
    if (!main && object instanceof DirectionalLight) main = object;
  });
  if (!hasGlobalLight && lighting.globalEnabled) runtime.scene.add(new AmbientLight("#ffffff", lighting.globalIntensity));
  if (!main) {
    main = new DirectionalLight();
    runtime.scene.add(main, main.target);
  }
  if (!main.target.parent) runtime.scene.add(main.target);
  const azimuth = lighting.azimuth * Math.PI / 180;
  const elevation = lighting.elevation * Math.PI / 180;
  const distance = main.position.distanceTo(main.target.position) || 20;
  main.position.set(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).multiplyScalar(distance).add(main.target.position);
  main.color.set(lighting.color);
  main.intensity = lighting.intensity;
  main.visible = lighting.sunEnabled;
  main.castShadow = main.visible;
  main.shadow.mapSize.set(2048, 2048);
  main.shadow.normalBias = 0.04;
  main.shadow.bias = -0.0001;
  // 天空盒的太阳位置与主光保持一致，避免投影方向和画面里的太阳对不上。
  const sunDirection = main.position.clone().sub(main.target.position).normalize();
  runtime.scene.children.find(object => object instanceof Sky)?.material.uniforms.sunPosition!.value.copy(sunDirection);
  updateSunShadow(runtime);
  runtime.invalidate();
}

export function updateSunShadow(runtime: SceneRuntime) {
  const main = runtime.scene.children.find(object => object instanceof DirectionalLight) as DirectionalLight | undefined;
  if (!main?.castShadow) return;
  const bounds = new Box3();
  runtime.scene.updateMatrixWorld(true);
  // ACT: 阴影范围只按真实物体计算；400 米地面与全景球会把阴影相机撑到覆盖整个场地，让投影糊成一片。
  const helpers = new Set(["directorGround", "directorBackdrop", "directorShadow", "directorHelper"]);
  const isHelper = (object: Object3D) => {
    for (let node: Object3D | null = object; node; node = node.parent ?? null) {
      if (helpers.has(String(node.userData?.tag ?? ""))) return true;
    }
    return false;
  };
  runtime.scene.traverse(object => {
    if (object instanceof Mesh && !(object instanceof Sky) && !(object.material instanceof ShadowMaterial) && !isHelper(object)) bounds.expandByObject(object);
  });
  const sphere = bounds.isEmpty() ? new Sphere(new Vector3(), 10) : bounds.getBoundingSphere(new Sphere());
  const radius = Math.max(5, sphere.radius * 1.5);
  const direction = main.position.clone().sub(main.target.position).normalize();
  main.target.position.copy(sphere.center);
  main.position.copy(sphere.center).addScaledVector(direction, radius * 2);
  Object.assign(main.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 4 });
  main.shadow.camera.updateProjectionMatrix();
}

export function createEmptyScene(): SceneDocument {
  return {
    version: "next",
    sceneConfig: {
      scene: { background: "#34383f" },
      camera: { position: { x: 10, y: 8, z: 12 }, fov: 55, near: 0.1, far: 1000 },
      controls: { target: { x: 0, y: 0, z: 0 } },
      lights: [
        { type: "ambient", color: "#ffffff", intensity: 0.8 },
        { type: "directional", color: "#ffffff", intensity: 2, position: { x: 10, y: 16, z: 12 } },
      ],
    },
    objectList: [],
  };
}

// ---------- 物体状态应用（搭建舞台与原位编辑共用） ----------
export function applyObjectTransform(target: Object3D, object: SceneObject) {
  target.position.set(object.position.x, object.position.y, object.position.z);
  target.rotation.set(object.rotation?.rotationX ?? 0, object.rotation?.rotationY ?? 0, object.rotation?.rotationZ ?? 0);
  target.scale.set(object.scale?.scaleX ?? 1, object.scale?.scaleY ?? 1, object.scale?.scaleZ ?? 1);
}

function eachMaterial(target: Object3D, apply: (material: Material) => void) {
  const seen = new Set<Material>();
  target.traverse(part => {
    const mesh = part as { material?: Material | Material[] };
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(material)) continue;
      seen.add(material);
      apply(material);
    }
  });
}

// ACT: 人偶由自建关节骨架组成，材质由人偶内部共享；模型保留自身贴图，material.color 仅作着色。
export function applyObjectAppearance(target: Object3D, object: SceneObject, modelTint = new Map<Object3D, string>()) {
  const appearance = { roughness: object.material.roughness, metalness: object.material.metalness, opacity: object.material.opacity, transparent: object.material.transparent, wireframe: object.material.wireframe };
  eachMaterial(target, material => {
    const standard = material as MeshStandardMaterial;
    if (!object.model) Object.assign(standard, Object.fromEntries(Object.entries(appearance).filter(([, value]) => value !== undefined)));
    const tint = typeof standard.userData?.tint === "number" ? standard.userData.tint : 1;
    standard.color?.set(object.material.color);
    if (tint !== 1) standard.color?.multiplyScalar(tint);
  });
  if (object.model) modelTint.set(target, object.material.color);
}

export function applyPose(target: Object3D, pose: SceneObject["pose"]) {
  const applied = new Set<string>();
  for (const [name, rotation] of Object.entries(pose ?? {})) {
    const joint = target.getObjectByName(name);
    if (!joint) continue;
    joint.rotation.set(rotation.x, rotation.y, rotation.z);
    applied.add(name);
  }
  // 未出现在 pose 中的关节回到自然站姿，保证编辑器里“关节归零”后立即生效。
  for (const name of mannequinJoints) {
    if (applied.has(name)) continue;
    target.getObjectByName(name)?.rotation.set(0, 0, 0);
  }
}

// ---------- 上传模型 ----------
type ModelTemplate = { root: Object3D; size: number };
const modelTemplates = new Map<string, Promise<ModelTemplate>>();

// ACT: 同一模型文件只解析一次，之后按实例克隆（几何与贴图共享）；尺寸离谱的模型自动归一到约 2 米，底部落在 y=0。
async function loadModelTemplate(url: string): Promise<ModelTemplate> {
  let task = modelTemplates.get(url);
  if (!task) {
    task = (async () => {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(root);
      const size = bounds.getSize(new Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      const scale = largest > 0 && (largest < 0.2 || largest > 10) ? 2 / largest : 1;
      const center = bounds.getCenter(new Vector3());
      root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      root.scale.setScalar(scale);
      return { root, size: largest * scale };
    })();
    modelTemplates.set(url, task);
    task.catch(() => modelTemplates.delete(url));
  }
  return task;
}

export async function preloadModelAssets(scene: SceneDocument) {
  const paths = [...new Set(scene.objectList.flatMap(object => object.model ? [object.model.path] : []))];
  await Promise.all(paths.map(path => loadModelTemplate(path)));
}

export function clearModelCache() {
  modelTemplates.clear();
}

function buildModelInstance(template: ModelTemplate, object: SceneObject) {
  const wrapper = new Object3D();
  wrapper.name = `model:${object.threeJsonId}`;
  wrapper.userData.threeJsonId = object.threeJsonId;
  wrapper.userData.tag = "directorModel";
  wrapper.add(template.root.clone(true));
  return wrapper;
}

// ACT: 属性编辑后判断能否原位刷新：结构、几何、外观与模型文件没变时，只更新位移 / 旋转 / 缩放 / 颜色 / 姿势 / 背景色，不重建舞台。
export function canSyncInPlace(previous: SceneDocument, next: SceneDocument) {
  const config = (document: SceneDocument) => JSON.stringify({ ...document.sceneConfig, scene: undefined });
  if (config(previous) !== config(next) || previous.objectList.length !== next.objectList.length) return false;
  return previous.objectList.every((before, index) => {
    const after = next.objectList[index]!;
    return before.threeJsonId === after.threeJsonId && before.objType === after.objType && before.model?.path === after.model?.path && before.prop === after.prop
      && JSON.stringify(before.geometry) === JSON.stringify(after.geometry)
      && JSON.stringify(before.hiddenParts) === JSON.stringify(after.hiddenParts);
  });
}

export function syncSceneInPlace(runtime: SceneRuntime, next: SceneDocument, modelTint = new Map<Object3D, string>()) {
  for (const object of next.objectList) {
    const target = getObjectByThreeJsonId(object.threeJsonId, runtime.scene);
    if (!target) throw new Error(`场景中找不到物体：${object.name || object.threeJsonId}`);
    applyObjectTransform(target, object);
    applyObjectAppearance(target, object, modelTint);
    if (object.objType === "mannequin") applyPose(target, object.pose);
  }
  runtime.scene.background = new Color(next.sceneConfig.scene.background);
  updateSunShadow(runtime);
  runtime.invalidate();
}

function disposeModel(root: Object3D) {
  const geometries = new Set<{ dispose(): void }>();
  const materials = new Set<Material>();
  const textures = new Set<{ dispose(): void }>();
  root.traverse(part => {
    const mesh = part as { geometry?: { dispose(): void }; material?: Material | Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value && typeof (value as { dispose?: unknown }).dispose === "function" && value !== material) textures.add(value as { dispose(): void });
    }
  });
  geometries.forEach(item => item.dispose());
  textures.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
}

// ACT: 旧版本默认底色是近黑色；加载时统一迁移到新的摄影棚灰，避免每个旧场景都要手动改色。
export function migrateSceneBackground(document: SceneDocument): SceneDocument {
  if (document.sceneConfig.scene.background.toLowerCase() === "#202024") {
    return { ...document, sceneConfig: { ...document.sceneConfig, scene: { ...document.sceneConfig.scene, background: "#34383f" } } };
  }
  return document;
}

export async function createStage(canvas: HTMLCanvasElement, document: SceneDocument, beforeFrame?: () => void, aspect = 16 / 9, lighting?: LightingSettings, settings: SceneSettings = defaultSceneSettings) {
  document = migrateSceneBackground(sceneSchema.parse(document));
  const width = Math.round(960 * Math.min(1, aspect) / 2) * 2;
  const height = Math.round(960 / Math.max(1, aspect) / 2) * 2;
  let runtime: SceneRuntime | undefined;
  try {
    const next = runtime = await createJsonScene({
      ...document,
      objectList: document.objectList.filter(object => object.objType !== "mannequin" && object.objType !== "model" && object.objType !== "prop"),
      sceneConfig: {
        ...document.sceneConfig, canvasWidth: width, canvasHeight: height,
        controls: { enabled: false },
        renderer: { antialias: true, ratioRate: 1 / window.devicePixelRatio, shadowMapEnabled: true },
        renderLoop: { autoResize: false, firstAutoResize: false, updateAnimations: false, scheduleMode: "demand" },
      },
    }, { canvas, beforeFrame, onRuntimeReady: context => { runtime = context.runtime; } });
    // 模型文件先全部就绪，任何一个加载失败都整体回滚，避免出现半截场景。
    const templates = new Map<SceneObject, ModelTemplate>();
    await Promise.all(document.objectList.filter(object => object.model).map(async object => { templates.set(object, await loadModelTemplate(object.model!.path)); }));
    const modelTint = new Map<Object3D, string>();
    for (const object of document.objectList) {
      if (object.objType === "mannequin") {
        const mannequin = createMannequin(object.threeJsonId, object.material.color, object.hiddenParts);
        applyObjectTransform(mannequin, object);
        applyPose(mannequin, object.pose);
        applyObjectAppearance(mannequin, object);
        next.scene.add(mannequin);
        registerObject(mannequin, object, { recursive: false }, next.scene);
      } else if (object.model) {
        const instance = buildModelInstance(templates.get(object)!, object);
        applyObjectTransform(instance, object);
        applyObjectAppearance(instance, object, modelTint);
        next.scene.add(instance);
        registerObject(instance, object, { recursive: false }, next.scene);
      } else if (object.objType === "prop" && object.prop) {
        const prop = createProp(object.threeJsonId, object.prop, object.material.color);
        applyObjectTransform(prop, object);
        applyObjectAppearance(prop, object);
        next.scene.add(prop);
        registerObject(prop, object, { recursive: false }, next.scene);
      }
    }
    // ACT: PBR 模型在没有环境贴图时金属部分会发黑；仅在场景含上传模型时补一张室内环境光，保持纯几何场景原有观感。
    if (modelTint.size) {
      const pmrem = new PMREMGenerator(next.renderer);
      const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
      next.scene.environment = target.texture;
      next.scene.userData.environmentTarget = target;
      pmrem.dispose();
    }
    // 离屏 canvas 没有布局尺寸，不能依赖运行时从 clientWidth / clientHeight 推断。
    next.renderer.setSize(width, height, false);
    next.camera.aspect = aspect;
    const { x, y, z } = document.sceneConfig.controls.target;
    next.camera.lookAt(x, y, z);
    next.camera.updateProjectionMatrix();
    next.renderer.shadowMap.type = PCFSoftShadowMap;
    next.scene.traverse(object => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    // 网格线无法接收阴影，用透明地面承接太阳光投影。
    const shadowGround = new Mesh(new PlaneGeometry(200, 200), new ShadowMaterial({ opacity: 0.35 }));
    shadowGround.rotation.x = -Math.PI / 2;
    shadowGround.position.y = -0.01;
    shadowGround.userData.tag = "directorShadow";
    shadowGround.receiveShadow = true;
    next.scene.add(shadowGround);
    next.scene.add(new GridHelper(200, 200, 0x6b7482, 0x4a505a));
    applySceneSettings(next, settings);
    if (lighting) applyLighting(next, lighting);
    return next;
  } catch (error) {
    if (runtime) disposeStage(runtime);
    throw error;
  }
}

// ACT: 滚转（荷兰角）不是 Three 相机原生参数，用「镜头朝向 + 绕视线旋转」表达；
// 抓取时把相机 up 投影到「参考上方向 / 右方向」平面上反解出角度，保证存回的角度可复现同一画面。
export function cameraRollDegrees(camera: PerspectiveCamera) {
  const forward = camera.getWorldDirection(new Vector3()).normalize();
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const worldUp = new Vector3(0, 1, 0);
  const referenceUp = worldUp.clone().addScaledVector(forward, -worldUp.dot(forward));
  if (referenceUp.lengthSq() < 1e-6) return 0;
  referenceUp.normalize();
  const right = new Vector3().crossVectors(forward, referenceUp).normalize();
  return Math.atan2(up.dot(right), up.dot(referenceUp)) * 180 / Math.PI;
}

export function captureCamera(runtime: SceneRuntime): CameraView {
  const { camera } = runtime;
  const { x, y, z } = camera.position;
  const target = camera.getWorldDirection(new Vector3()).add(camera.position);
  const roll = Math.round(cameraRollDegrees(camera) * 100) / 100;
  return {
    camera: { position: { x, y, z }, fov: camera.fov, near: camera.near, far: camera.far, ...(Math.abs(roll) > 0.01 ? { roll } : {}) },
    controls: { target: { x: target.x, y: target.y, z: target.z } },
  };
}

export function capturePreview(runtime: SceneRuntime) {
  runtime.renderer.render(runtime.scene, runtime.camera);
  const preview = runtime.renderer.domElement.toDataURL("image/jpeg", 0.85);
  if (!preview.startsWith("data:image/jpeg;base64,")) throw new Error("镜头截图失败");
  return preview;
}

export function disposeStage(runtime: SceneRuntime) {
  for (const child of runtime.scene.children) {
    if (child instanceof GridHelper) child.dispose();
    if (child instanceof Sky) {
      child.geometry.dispose();
      child.material.dispose();
    }
    if (child.userData?.tag === "directorBackdrop") {
      const backdropMesh = child as Mesh;
      backdropMesh.geometry.dispose();
      const material = backdropMesh.material as MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    }
    if (child.userData?.tag === "directorModel") disposeModel(child);
    if (child.userData?.tag === "directorProp") disposeProp(child as Group);
  }
  (runtime.scene.userData.environmentTarget as WebGLRenderTarget | undefined)?.dispose();
  runtime.dispose();
  runtime.renderer.forceContextLoss();
}
