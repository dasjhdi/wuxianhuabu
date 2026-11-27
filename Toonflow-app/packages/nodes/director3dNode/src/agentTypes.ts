// ACT: 导演台对话记录 —— 只保存用户指令与助手结论，工具调用过程作为临时状态，避免画布数据膨胀。
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: number;
  status?: "running" | "done" | "error" | "stopped" | "pending";
  error?: string;
  instruction?: string;
}

export interface PendingApplyView {
  title: string;
  detail: string;
  thumb?: string;
}
