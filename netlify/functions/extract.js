exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { type, content } = body;

  let userContent;
  if (type === "image") {
    userContent = [
      {
        type: "image_url",
        image_url: {
          url: `data:${content.mediaType};base64,${content.base64}`,
        },
      },
      {
        type: "text",
        text: buildPrompt(),
      },
    ];
  } else {
    userContent = buildPrompt() + "\n\nINVOICE TEXT:\n" + content;
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: type === "image" ? "qwen/qwen3.8-27b" : "llama-3.3-70b-versatile",
        max_tokens: 1024,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: data?.error?.message || "Groq API error" }),
      };
    }

    const text = data.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const clean = text.replace(/```json|```/gi, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ raw: text }) }; }
      } else {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ raw: text }) };
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ data: parsed }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message || "Server error" }),
    };
  }
};

function buildPrompt() {
  return `You are an invoice data extraction system. Extract ALL fields from this invoice and return ONLY a valid JSON object with exactly these keys (use null if missing):

{
  "supplier_name": string or null,
  "invoice_number": string or null,
  "invoice_date": string or null,
  "due_date": string or null,
  "currency": string or null,
  "subtotal": number or null,
  "tax_amount": number or null,
  "total_amount": number or null,
  "payment_terms": string or null,
  "bill_to": string or null,
  "line_items": [
    {
      "description": string,
      "quantity": number or null,
      "unit_price": number or null,
      "total": number or null
    }
  ]
}

Return ONLY the JSON. No explanation, no markdown fences. Raw JSON only.`;
}
