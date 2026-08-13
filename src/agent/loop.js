const { toToolDefinitions } = require("./tools");

/**
 * 执行 tool-calling agent loop
 * @param {object} client - openai SDK 客户端实例
 * @param {string} model - 模型名称
 * @param {string} systemPrompt - system prompt
 * @param {object[]} tools - 工具数组（含 execute 函数）
 * @param {number} maxSteps - 最大步数
 * @returns {object} { ok, message, stepCount, timeline }
 */
async function runAgentLoop(client, model, systemPrompt, tools, maxSteps) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "请开始执行国际化流程。" },
  ];
  const toolDefinitions = toToolDefinitions(tools);
  const timeline = [];

  for (let step = 0; step < maxSteps; step += 1) {
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        tools: toolDefinitions,
        temperature: 0,
      });
    } catch (err) {
      return {
        ok: false,
        message: `LLM 调用失败: ${err.message}`,
        stepCount: step,
        timeline,
      };
    }

    const message = response.choices[0].message;
    messages.push(message);

    // 没有 tool_calls 说明 agent 认为任务完成了
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        ok: true,
        message: message.content || "agent 流程执行完成",
        stepCount: step + 1,
        timeline,
      };
    }

    // 依次执行每个 tool call
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      const tool = tools.find((t) => t.name === toolName);

      let result;
      if (!tool) {
        result = { error: `未知工具: ${toolName}` };
      } else {
        let args;
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch (_parseErr) {
          args = {};
        }
        try {
          result = await tool.execute(args);
        } catch (err) {
          result = { error: err.message };
        }
      }

      const resultJson = JSON.stringify(result);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultJson,
      });

      timeline.push({
        step: step + 1,
        action: toolName,
        reason: toolCall.function.arguments
          ? toolCall.function.arguments.slice(0, 200)
          : "{}",
        result: resultJson.slice(0, 500),
      });

      console.log(
        `[step${step + 1} tool]: ${toolName} → ${resultJson.slice(0, 200)}`,
      );
    }
  }

  return {
    ok: false,
    message: "超过最大步数，agent 主动停止",
    stepCount: maxSteps,
    timeline,
  };
}

module.exports = {
  runAgentLoop,
};
