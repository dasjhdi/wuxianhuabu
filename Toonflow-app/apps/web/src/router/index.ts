import { createRouter, createWebHashHistory } from "vue-router";
import { useHelloStore } from "@/stores/hello";
import { loadSettings } from "@/stores/settings";
import { authState, ensureAuth } from "@/lib/auth";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/home",
    },
    {
      path: "/login",
      component: () => import("@/pages/login/index.vue"),
    },
    {
      path: "/setup",
      component: () => import("@/pages/setup/index.vue"),
    },
    {
      path: "/hello",
      beforeEnter: async () => await useHelloStore().load() ? { path: "/home", replace: true } : true,
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
    {
      path: "/ecommerce",
      component: () => import("@/pages/ecommerce/index.vue"),
    },
    {
      path: "/admin",
      component: () => import("@/pages/admin/index.vue"),
      meta: { requiresAdmin: true },
      children: [
        {
          path: "",
          component: () => import("@/pages/admin/dashboard.vue"),
          meta: { title: "仪表盘", subtitle: "团队、项目与生成任务的整体运行情况" },
        },
        {
          path: "users",
          component: () => import("@/pages/admin/users.vue"),
          meta: { title: "成员管理", subtitle: "账号、角色与登录状态" },
        },
        {
          path: "projects",
          component: () => import("@/pages/admin/projects.vue"),
          meta: { title: "项目管理", subtitle: "工作区项目、画布与磁盘占用" },
        },
        {
          path: "usage",
          component: () => import("@/pages/admin/usage.vue"),
          meta: { title: "用量统计", subtitle: "生成任务的数量、成功率与模型分布" },
        },
        {
          path: "audit",
          component: () => import("@/pages/admin/audit.vue"),
          meta: { title: "操作日志", subtitle: "登录、账号变更与项目操作留痕" },
        },
        {
          path: "settings",
          component: () => import("@/pages/admin/settings.vue"),
          meta: { title: "系统设置", subtitle: "站点、访问策略与运行环境" },
        },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  await ensureAuth();
  if (!authState.initialized) {
    return to.path === "/setup" ? true : { path: "/setup", replace: true };
  }
  if (!authState.user) {
    if (to.path === "/login") return true;
    return { path: "/login", replace: true, query: to.fullPath !== "/" ? { redirect: to.fullPath } : undefined };
  }
  if (to.path === "/login" || to.path === "/setup" || to.path === "/hello") return { path: "/home", replace: true };
  if (to.meta.requiresAdmin && authState.user.role !== "admin") return { path: "/home", replace: true };
  // ACT: 设置是画布、节点与引导页的数据源；登录完成后统一加载，避免页面用空配置渲染。
  await loadSettings();
  return true;
});

export default router;
