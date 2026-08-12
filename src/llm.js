/**
 * 创建 LLM 决策客户端，用于 agent 决策模式
 * @param {object} agentConfig - agent 配置
 * @returns {object|null} LLM 客户端或 null（未启用时）
 */
function createLlmClient(agentConfig) {
  if (agentConfig.decisionMode !== "llm") return null;

  const llmConfig = agentConfig.llm || {};
  const apiKey = process.env[llmConfig.apiKeyEnv || "OPENAI_API_KEY"];
  if (!apiKey) return null;

  const baseUrl = process.env[llmConfig.baseUrlEnv || "OPENAI_BASE_URL"] || "https://api.openai.com/v1";
  const model =
    process.env[llmConfig.modelEnv || "OPENAI_MODEL"] || llmConfig.defaultModel || "gpt-4.1-mini";

  return {
    async decide(input) {
      const prompt = buildDecisionPrompt(input);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: {
            type: "json_object",
          },
          messages: [
            {
              role: "system",
              content:
                "你是国际化自动化 agent 的决策器。只能从 allowedActions 中选择一个 action，并返回 JSON：{\"action\":\"...\",\"reason\":\"...\"}",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM 调用失败: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      return {
        action: parsed.action,
        reason: parsed.reason || "",
      };
    },
  };
}

/**
 * 构建 LLM 决策提示词
 * @param {object} input - 输入对象 { allowedActions, suggestedAction, state }
 * @returns {string} JSON 格式的提示词
 */
function buildDecisionPrompt(input) {
  return JSON.stringify(
    {
      goal: "让目标项目国际化流程尽量自动执行到可验证结束",
      allowedActions: input.allowedActions,
      suggestedAction: input.suggestedAction,
      state: input.state,
    },
    null,
    2,
  );
}

module.exports = {
  createLlmClient,
};
