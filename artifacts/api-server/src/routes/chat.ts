import { GoogleGenAI } from "@google/genai";
import { Router, type IRouter } from "express";
import {
  GetChatSystemPromptResponse,
  SendChatMessageBody,
  SendChatMessageResponse,
} from "@workspace/api-zod";
import {
  CHAT_SETTING_BOUNDS,
  CITY_GUIDE_SYSTEM_PROMPT,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_SETTINGS,
} from "../city";

const router: IRouter = Router();

router.get("/chat/system-prompt", (_req, res): void => {
  const response = GetChatSystemPromptResponse.parse({
    systemPrompt: CITY_GUIDE_SYSTEM_PROMPT,
  });
  res.json(response);
});

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please send a valid question and settings." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "Add a GEMINI_API_KEY secret to enable the city guide.",
    });
    return;
  }

  const settings = {
    temperature:
      parsed.data.settings?.temperature ?? DEFAULT_CHAT_SETTINGS.temperature,
    topP: parsed.data.settings?.topP ?? DEFAULT_CHAT_SETTINGS.topP,
    maxOutputTokens:
      parsed.data.settings?.maxOutputTokens ??
      DEFAULT_CHAT_SETTINGS.maxOutputTokens,
  };

  // Keep validated settings within the same bounds that Prompt Lab displays.
  const settingsAreInBounds =
    settings.temperature >= CHAT_SETTING_BOUNDS.temperature.min &&
    settings.temperature <= CHAT_SETTING_BOUNDS.temperature.max &&
    settings.topP >= CHAT_SETTING_BOUNDS.topP.min &&
    settings.topP <= CHAT_SETTING_BOUNDS.topP.max &&
    settings.maxOutputTokens >= CHAT_SETTING_BOUNDS.maxOutputTokens.min &&
    settings.maxOutputTokens <= CHAT_SETTING_BOUNDS.maxOutputTokens.max;

  if (!settingsAreInBounds) {
    res.status(400).json({ error: "The selected settings are out of range." });
    return;
  }

  const model = DEFAULT_CHAT_MODEL;
  const history = (parsed.data.history ?? []).map((entry) => ({
    role: entry.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: entry.content }],
  }));

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        // Keep upstream retries bounded so a stalled provider does not leave
        // the visitor's chat waiting indefinitely.
        timeout: 120_000,
        retryOptions: { attempts: 1 },
      },
    });
    const result = await ai.models.generateContent({
      model,
      contents: [
        ...history,
        { role: "user", parts: [{ text: parsed.data.message }] },
      ],
      config: {
        systemInstruction: CITY_GUIDE_SYSTEM_PROMPT,
        temperature: settings.temperature,
        topP: settings.topP,
        maxOutputTokens: settings.maxOutputTokens,
        // This is a short local guide, so keep hidden reasoning minimal and
        // leave the configured token budget for the visitor-facing answer.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    if (!result.text) {
      req.log.warn("Gemini returned an empty city guide answer");
      res.status(502).json({
        error: "The city guide could not answer just now. Please try again.",
      });
      return;
    }

    const usage = {
      promptTokens: result.usageMetadata?.promptTokenCount ?? null,
      outputTokens: result.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: result.usageMetadata?.totalTokenCount ?? null,
      finishReason: String(result.candidates?.[0]?.finishReason ?? "UNKNOWN"),
    };

    const response = SendChatMessageResponse.parse({
      reply: result.text,
      usage,
      settings,
      model,
    });

    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Gemini city guide request failed");
    res.status(502).json({
      error: "The city guide could not answer just now. Please try again.",
    });
  }
});

export default router;
