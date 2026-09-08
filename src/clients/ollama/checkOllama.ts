import "dotenv/config";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3.5:latest";

async function main() {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: "Odpowiedz jednym krótkim zdaniem po polsku: czy połączenie działa?"
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  const data = await response.json();

  console.log(JSON.stringify({
    model,
    response: data.message?.content ?? data
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});