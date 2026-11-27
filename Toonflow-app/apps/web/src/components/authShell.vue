<template>
  <div class="authPage">
    <section class="authAside" aria-hidden="true">
      <div class="gridLayer" />
      <div class="orb orbViolet" />
      <div class="orb orbTeal" />
      <div class="orb orbAmber" />
      <div class="asideBody">
        <div class="asideBrand">
          <span class="brandMark">创</span>
          <span class="brandText">创梦</span>
        </div>
        <h1 class="asideTitle">把一句灵感，<br />变成一部短剧</h1>
        <p class="asideLead">从剧本拆解、分镜生成到成片合成，一整套 AI 短剧工作流，都在同一块画布上完成。</p>
        <ul class="asideFeatures">
          <li><span class="featureDot" />剧本一句话拆成分镜清单</li>
          <li><span class="featureDot" />角色与场景资产跨镜头保持一致</li>
          <li><span class="featureDot" />批量生成后自动拼接、配乐、出片</li>
        </ul>
      </div>
      <footer class="asideFooter">
        <span>{{ system.siteName || "创梦" }} · AI 短剧创作工作台</span>
        <span class="footerMeta">v{{ version }}</span>
      </footer>
    </section>

    <section class="authMain">
      <div class="authCard">
        <div class="cardBrand">
          <span class="brandMark small">创</span>
          <span>{{ system.siteName || "创梦" }}</span>
        </div>
        <h2 class="cardTitle">{{ title }}</h2>
        <p class="cardSubtitle">{{ subtitle }}</p>
        <slot />
        <div class="cardFooter">
          <slot name="footer" />
        </div>
      </div>
      <p class="legalLine">登录即表示你已阅读并同意团队的使用规范。账号由管理员统一分配。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { authState } from "@/lib/auth";

defineProps<{ title: string; subtitle: string }>();

const system = authState.system;
const version = import.meta.env.appVersion ?? "";
</script>

<style scoped>
.authPage {
  display: flex;
  min-height: 100vh;
  background: #07080c;
  color: #e8eaf1;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
}
.authAside {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 54%;
  min-height: 100vh;
  padding: 48px 56px 32px;
  overflow: hidden;
  background: radial-gradient(120% 90% at 10% 0%, #141834 0%, #0a0b12 55%, #07080c 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.gridLayer {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(75% 65% at 30% 35%, #000 20%, transparent 100%);
}
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.55;
}
.orbViolet { width: 420px; height: 420px; top: -120px; left: -80px; background: #6d4dff; }
.orbTeal { width: 360px; height: 360px; right: -90px; top: 32%; background: #0f9f9a; opacity: 0.38; }
.orbAmber { width: 260px; height: 260px; left: 22%; bottom: -110px; background: #d9782d; opacity: 0.28; }
.asideBody { position: relative; z-index: 1; max-width: 520px; }
.asideBrand { display: flex; align-items: center; gap: 12px; margin-bottom: 64px; }
.brandMark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: linear-gradient(140deg, #8f6bff, #4a2ed6);
  color: #fff;
  font-size: 17px;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(109, 77, 255, 0.4);
}
.brandMark.small { width: 30px; height: 30px; border-radius: 9px; font-size: 14px; }
.brandText { font-size: 17px; font-weight: 600; letter-spacing: 2px; }
.asideTitle { margin: 0 0 20px; font-size: clamp(34px, 3.4vw, 48px); line-height: 1.24; font-weight: 650; letter-spacing: -0.5px; }
.asideLead { margin: 0 0 40px; max-width: 430px; color: rgba(232, 234, 241, 0.62); font-size: 15px; line-height: 1.85; }
.asideFeatures { display: flex; flex-direction: column; gap: 16px; margin: 0; padding: 0; list-style: none; color: rgba(232, 234, 241, 0.8); font-size: 14px; }
.asideFeatures li { display: flex; align-items: center; gap: 12px; }
.featureDot { width: 6px; height: 6px; border-radius: 50%; background: #8f6bff; box-shadow: 0 0 0 4px rgba(143, 107, 255, 0.16); }
.asideFooter { position: relative; z-index: 1; display: flex; justify-content: space-between; color: rgba(232, 234, 241, 0.34); font-size: 12px; }
.footerMeta { font-variant-numeric: tabular-nums; }

.authMain { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 40px 28px; }
.authCard { width: min(392px, 100%); }
.cardBrand { display: flex; align-items: center; gap: 10px; margin-bottom: 30px; color: rgba(232, 234, 241, 0.72); font-size: 14px; letter-spacing: 1px; }
.cardTitle { margin: 0 0 10px; font-size: 27px; font-weight: 650; letter-spacing: -0.3px; }
.cardSubtitle { margin: 0 0 30px; color: rgba(232, 234, 241, 0.5); font-size: 13.5px; line-height: 1.7; }
.cardFooter { margin-top: 4px; }
.legalLine { max-width: 392px; margin: 0; color: rgba(232, 234, 241, 0.26); font-size: 11.5px; line-height: 1.7; text-align: center; }

:deep(.authForm .el-form-item) { margin-bottom: 18px; }
:deep(.authForm .el-form-item__label) { color: rgba(232, 234, 241, 0.62); font-size: 12.5px; padding-bottom: 6px !important; }
:deep(.authForm .el-input__wrapper) {
  background: rgba(255, 255, 255, 0.045);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  border-radius: 10px;
  padding: 4px 14px;
  transition: box-shadow 0.18s ease, background 0.18s ease;
}
:deep(.authForm .el-input__wrapper:hover) { background: rgba(255, 255, 255, 0.06); }
:deep(.authForm .el-input__wrapper.is-focus) { background: rgba(255, 255, 255, 0.07); box-shadow: 0 0 0 1px #8f6bff inset, 0 0 0 3px rgba(143, 107, 255, 0.16); }
:deep(.authForm .el-input__inner) { color: #eef0f6; height: 40px; }
:deep(.authForm .el-input__inner::placeholder) { color: rgba(232, 234, 241, 0.28); }
:deep(.authForm .el-checkbox__label) { color: rgba(232, 234, 241, 0.55); font-size: 12.5px; }
:deep(.authForm .el-checkbox__inner) { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.18); }
:deep(.authForm .el-form-item__error) { color: #ff8b8b; padding-top: 5px; }

@media (max-width: 960px) {
  .authAside { display: none; }
  .authMain { padding: 32px 22px; }
}
</style>
