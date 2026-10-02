// Executor de eco: prova a ponte ponta a ponta sem IA e sem efeito colateral.
export const echoExecutor = {
  name: "echo",
  async execute(task) {
    const recebido = String(task?.payload?.instruction_text ?? "").slice(0, 500);
    return ["PONTE_OK", `task_id: ${task.task_id}`, `recebido: ${recebido}`, "executor: echo"].join("\n");
  }
};
