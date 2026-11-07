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

function getProviderStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isProviderTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const providerError = error as { name?: unknown; message?: unknown };
  const name = typeof providerError.name === "string" ? providerError.name : "";
  const message =
    typeof providerError.message === "string" ? providerError.message : "";
  return /timeout|timed out|aborted/i.test(`${name} ${message}`);
}

function isProviderBusy(error: unknown): boolean {
  const status = getProviderStatus(error);
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    isProviderTimeout(error)
  );
}

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

  const history = (parsed.data.history ?? []).map((entry) => ({
    role: entry.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: entry.content }],
  }));

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        // Return an actionable error instead of leaving the visitor waiting.
        timeout: 35_000,
        retryOptions: { attempts: 1 },
      },
    });
    const contents = [
      ...history,
      { role: "user" as const, parts: [{ text: parsed.data.message }] },
    ];
    const config = {
      systemInstruction: CITY_GUIDE_SYSTEM_PROMPT,
      temperature: settings.temperature,
      topP: settings.topP,
      maxOutputTokens: settings.maxOutputTokens,
      // This is a short local guide, so leave the token budget for the answer.
      thinkingConfig: { thinkingBudget: 0 },
    };

    const result = await ai.models.generateContent({
      model: DEFAULT_CHAT_MODEL,
      contents,
      config,
    });

    if (!result.text) {
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
      model: DEFAULT_CHAT_MODEL,
    });

    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Gemini city guide request failed");
    const providerIsBusy = isProviderBusy(error);
    res.status(providerIsBusy ? 503 : 502).json({
      error: providerIsBusy
        ? "The city guide is busy right now. Please try again in a moment."
        : "The city guide could not answer just now. Please try again.",
    });
  }
});

export default router;
